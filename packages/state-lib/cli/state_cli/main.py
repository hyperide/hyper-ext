"""Small Python surface; parsing and optimization decisions belong to Rust statec."""

import argparse, gzip, hashlib, json, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[2]
EXTENSIONS = {".js", ".mjs", ".jsx", ".ts", ".tsx", ".mts"}
CONFIG_NAMES = ("tsconfig.json", "jsconfig.json")
BUILD_CONSTANT_NAME = re.compile(r"__STATE_BUILD_[A-Z][A-Z0-9_]*__")


def contained(root, relative, *, required=True):
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        raise ValueError("Expected a nonempty relative path")
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("Path escapes project: " + relative)
    if required and not path.is_file():
        raise ValueError("Missing input: " + relative)
    return path


BUDGET_KEYS = {"maxRawBytes", "maxGzipBytes", "maxBrotliBytes"}
LOCK_FILES = [
    "package.json",
    "tsconfig.json",
    "jsconfig.json",
    "bun.lock",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
]
TOOLCHAIN_FILES = [
    "compiler/Cargo.lock",
    "compiler/Cargo.toml",
    "compiler/src/lib.rs",
    "compiler/src/main.rs",
    "compiler/src/projection.rs",
    "compiler/src/command.rs",
    "cli/state_cli/main.py",
    "build-tools/bundle.mjs",
    "build-tools/config-inputs.mjs",
    "build-tools/bun.lock",
    "build-tools/package.json",
]


def validate_budgets(config):
    budgets = config.get("budgets", {})
    if not isinstance(budgets, dict) or any(
        key not in BUDGET_KEYS or type(value) is not int or value < 0
        for key, value in budgets.items()
    ):
        raise ValueError("budgets must contain known nonnegative integer byte limits")


def read_source(path, root, source_root, digest):
    if not path.resolve().is_relative_to(source_root):
        raise ValueError("Source symlink escapes sourceRoot")
    rel = path.relative_to(root).as_posix()
    data = path.read_bytes()
    if len(data) > 16 * 1024 * 1024:
        raise ValueError("Input exceeds preview size limit")
    digest.update(rel.encode() + b"\0" + hashlib.sha256(data).digest())
    if path.suffix in EXTENSIONS:
        return {"path": rel, "content": data.decode("utf-8")}
    return None


def scan_sources(root, source_root, digest):
    files = []
    configs = []
    for path in sorted(source_root.rglob("*")):
        if path.is_file():
            entry = read_source(path, root, source_root, digest)
            if path.name in CONFIG_NAMES:
                configs.append(path.relative_to(root).as_posix())
            if entry is not None:
                files.append(entry)
    return files, configs


def compiler_inputs(root, files, configs):
    payload = {
        "root": str(root),
        "files": [file["path"] for file in files],
        "configs": configs,
    }
    child = subprocess.run(
        ["node", str(PACKAGE / "build-tools/config-inputs.mjs")],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=False,
    )
    if child.returncode:
        raise ValueError("Compiler configuration: " + child.stderr.strip())
    return json.loads(child.stdout)


def digest_existing(digest, base, names):
    for name in names:
        path = base / name
        if path.is_file():
            digest.update(name.encode() + hashlib.sha256(path.read_bytes()).digest())


def register_generated(root, source_root, variant, generated):
    destination = contained(root, variant["entry"], required=False)
    if (
        not destination.is_relative_to(source_root)
        or destination.exists()
        or destination in generated
    ):
        raise ValueError("projection: generated path collides or escapes sourceRoot")
    generated.add(destination)


def generated_paths(root, source_root, config):
    generated = set()
    for unit in config["units"]:
        for variant in unit["variants"]:
            if "generate" in variant:
                register_generated(root, source_root, variant, generated)
    return generated


def authored_paths(unit):
    # Facades and baselines must always be authored inputs. A virtual path
    # belongs only to the variant that explicitly declares its generation.
    authored = [unit["facade"], unit["baseline"]]
    authored.extend(v["entry"] for v in unit["variants"] if "generate" not in v)
    for variant in unit["variants"]:
        generator = variant.get("generate", {})
        if generator.get("kind") == "json-command":
            runtime = generator.get("runtime")
            if not isinstance(runtime, str):
                raise ValueError("command: missing authored runtime module")
            authored.append(runtime)
    return authored


def check_authored(root, authored, generated, inventory):
    for name in authored:
        if contained(root, name, required=False) in generated:
            raise ValueError("projection: generated path used by an authored role")
        contained(root, name)
        if name not in inventory:
            raise ValueError("Every authored strategy must belong to sourceRoot")


def check_units(root, config, generated, inventory):
    seen = set()
    facades = set()
    if config.get("entry") not in inventory:
        raise ValueError("Entry must belong to sourceRoot")
    for unit in config["units"]:
        if unit["id"] in seen or unit["facade"] in facades:
            raise ValueError("Duplicate unit/facade")
        seen.add(unit["id"])
        facades.add(unit["facade"])
        check_authored(root, authored_paths(unit), generated, inventory)
        ids = [v["id"] for v in unit["variants"]]
        if len(set(ids)) != len(ids) or "baseline" in ids:
            raise ValueError("Variant IDs must be unique; baseline is reserved")


def validate_build_constants(config):
    constants = config.get("buildConstants", {})
    if not isinstance(constants, dict) or any(
        not BUILD_CONSTANT_NAME.fullmatch(name) or type(value) not in (bool, str)
        for name, value in constants.items()
    ):
        raise ValueError(
            "buildConstants require reserved __STATE_BUILD_*__ names and boolean/string literals"
        )


def unit_entries(unit):
    return [unit["facade"], unit["baseline"], *[v["entry"] for v in unit["variants"]]]


def validate_browser_root(root, source_root, config):
    browser_root = config.get("browserRoot")
    if browser_root is None:
        return
    web_root = contained(root, browser_root, required=False)
    if not web_root.is_dir() or not web_root.is_relative_to(source_root):
        raise ValueError("browserRoot must be a directory inside sourceRoot")
    if not contained(root, config["entry"]).is_relative_to(web_root):
        raise ValueError("Entry must belong to browserRoot")
    for unit in config["units"]:
        if any(
            not contained(root, name, required=False).is_relative_to(web_root)
            for name in unit_entries(unit)
        ):
            raise ValueError(
                "Every authored and generated strategy must belong to browserRoot"
            )


def load_config(args):
    config_file = Path(args.config).resolve()
    root = config_file.parent
    config = json.loads(config_file.read_text())
    if config.get("version") != 1:
        raise ValueError("Unsupported config version")
    validate_budgets(config)
    source_root = contained(root, config["sourceRoot"], required=False)
    if not source_root.is_dir():
        raise ValueError("sourceRoot must be a directory")
    validate_build_constants(config)
    validate_browser_root(root, source_root, config)
    return root, config, source_root


def request_for(args):
    root, config, source_root = load_config(args)
    digest = hashlib.sha256(
        json.dumps(config, sort_keys=True, separators=(",", ":")).encode()
    )
    files, configs = scan_sources(root, source_root, digest)
    inputs = compiler_inputs(root, files, configs)
    digest.update(json.dumps(inputs, sort_keys=True, separators=(",", ":")).encode())
    # Profile validity includes optional Wasm/data inputs, project locks and our toolchain sources.
    digest_existing(digest, root, LOCK_FILES)
    digest_existing(digest, PACKAGE, TOOLCHAIN_FILES)
    inventory = {f["path"] for f in files}
    generated = generated_paths(root, source_root, config)
    check_units(root, config, generated, inventory)
    profile = json.loads(Path(args.profile).read_text()) if args.profile else None
    return (
        root,
        config,
        {
            "version": 1,
            "config": config,
            "files": files,
            "sourceHash": digest.hexdigest(),
            "compilerInputs": inputs,
            "profile": profile,
            "mode": args.mode,
        },
    )


def native_plan(request):
    # A configured binary is an explicit install path, never downloaded/executed implicitly.
    binary = Path(
        os.environ.get("STATEC_BIN", str(PACKAGE / "compiler/target/debug/statec"))
    )
    if not binary.is_file():
        raise RuntimeError(
            "Build statec first: cargo build --locked --manifest-path "
            + str(PACKAGE / "compiler/Cargo.toml")
        )
    # nosemgrep: python.django.security.injection.command.subprocess-injection.subprocess-injection -- argv list without a shell; the executable is the operator's own STATEC_BIN install path or the repo build output, never request data
    child = subprocess.run(
        [str(binary)],
        input=json.dumps(request),
        text=True,
        encoding="utf-8",
        capture_output=True,
        check=False,
    )
    if child.returncode:
        raise RuntimeError(child.stderr.strip())
    return json.loads(child.stdout)


def build_defines(config):
    return {
        name: json.dumps(value)
        for name, value in config.get("buildConstants", {}).items()
    }


def browser_root_path(root, config):
    name = config.get("browserRoot")
    return None if name is None else str(contained(root, name, required=False))


def emit(root, config, plan, source_files, *, baseline=False, compare=False):
    # source_files is the validated inventory from request_for, not a fresh walk.
    generated = {
        str(contained(root, module["path"], required=False)): module["content"]
        for module in plan.get("generatedModules", [])
    }

    def selected_entry(name):
        path = contained(root, name, required=False)
        if str(path) not in generated:
            # Authored selections must still exist immediately before bundling.
            path = contained(root, name)
        return str(path)

    aliases = {
        str(contained(root, d["facade"])): {
            "contents": d["rewrite"]["before"]
            + json.dumps(selected_entry(d["entry"]))
            + d["rewrite"]["after"],
            "resolveDir": str(contained(root, d["facade"]).parent),
        }
        for d in plan["decisions"]
        if not baseline and d["selected"] != "baseline"
    }
    data = {
        "root": str(root),
        "entry": str(contained(root, config["entry"])),
        "sourceFiles": [str((root / file["path"]).resolve()) for file in source_files],
        "aliases": aliases,
        "compare": compare,
        "generated": generated,
        "outDir": str(contained(root, config["outDir"], required=False)),
        "target": config.get("emitTarget", "es2022"),
        "defines": build_defines(config),
        "browserRoot": browser_root_path(root, config),
    }
    child = subprocess.run(
        ["node", str(PACKAGE / "build-tools/bundle.mjs")],
        input=json.dumps(data),
        text=True,
        encoding="utf-8",
        capture_output=True,
        check=False,
    )
    if child.returncode:
        raise RuntimeError(child.stderr.strip())
    return json.loads(child.stdout)


def retain_baseline(decision, reason):
    selected = decision["selected"]
    for candidate in decision["candidates"]:
        if candidate["variant"] == selected:
            candidate["eligible"] = False
            candidate["reasons"].append(reason)
    decision["selected"] = "baseline"
    decision["entry"] = decision["baseline"]
    decision["fallback"] = reason


def retain_all(plan, reason):
    for decision in plan["decisions"]:
        if decision["selected"] != "baseline":
            retain_baseline(decision, reason)


def reexports_baseline(root, decision):
    source = decision.get("baselineImport")
    expected = contained(root, decision["baseline"])
    return (
        isinstance(source, str)
        and source.startswith(".")
        and (contained(root, decision["facade"]).parent / source).resolve() == expected
    )


def verify_facades(root, plan):
    for decision in plan["decisions"]:
        if decision["selected"] != "baseline" and not reexports_baseline(
            root, decision
        ):
            retain_baseline(decision, "Facade does not re-export the declared baseline")


def checked_output_dir(root, config):
    out = contained(root, config["outDir"], required=False)
    source_root = contained(root, config["sourceRoot"], required=False)
    if (
        out == root
        or out == source_root
        or source_root.is_relative_to(out)
        or out.is_relative_to(source_root)
    ):
        raise ValueError("Output must be separate from sourceRoot and project root")
    if out.exists() and (
        not out.is_dir()
        or (any(out.iterdir()) and not (out / ".state-owned").is_file())
    ):
        raise ValueError("Refusing to overwrite a non-generated output directory")
    return out


def bundle_size(bundle):
    content = bundle["code"].encode()
    return {
        "raw": len(content),
        "gzip": len(gzip.compress(content, mtime=0)),
        "brotli": bundle["brotliBytes"],
    }


def emit_selected(root, config, plan, source_files):
    # Compare the actual whole emitted bundle, not merely a claimed per-module budget.
    selected = [d for d in plan["decisions"] if d["selected"] != "baseline"]
    if selected:
        pair = emit(root, config, plan, source_files, compare=True)
        original, result = pair["baseline"], pair["selected"]
    else:
        original = result = emit(root, config, plan, source_files, baseline=True)
    missing = [
        d
        for d in selected
        if str(contained(root, d["facade"])) not in result.get("rewritten", [])
    ]
    if missing:
        reason = "Declared facade was not rewritten by the bundler; baseline emitted"
        retain_all(plan, reason)
        plan["bundleFallback"] = reason
        result = original
    return original, result


def compare_sizes(plan, original, result):
    reference = bundle_size(original)
    measured = bundle_size(result)
    if any(
        measured[metric] > reference[metric] for metric in ("raw", "gzip", "brotli")
    ):
        retain_all(plan, "Actual emitted raw/gzip/Brotli bytes exceeded baseline")
        plan["bundleFallback"] = (
            "Actual emitted bytes exceeded baseline; baseline emitted instead"
        )
        result = original
        measured = reference
    return result, reference, measured


def enforce_budgets(config, measured):
    limits = config.get("budgets", {})
    names = {"raw": "maxRawBytes", "gzip": "maxGzipBytes", "brotli": "maxBrotliBytes"}
    violations = [
        f"{metric} {measured[metric]} > {limits[key]}"
        for metric, key in names.items()
        if key in limits and measured[metric] > limits[key]
    ]
    if violations:
        raise ValueError("Absolute bundle budget exceeded: " + "; ".join(violations))
    return limits


def write_outputs(out, outputs):
    # NamedTemporaryFile creates 0600; emitted files follow the process umask like any build output.
    umask = os.umask(0)
    os.umask(umask)
    for name, content in outputs.items():
        with tempfile.NamedTemporaryFile(
            mode="w", dir=out, delete=False, encoding="utf-8"
        ) as temporary:
            os.fchmod(temporary.fileno(), 0o666 & ~umask)
            temporary.write(content)
            temporary.flush()
            os.fsync(temporary.fileno())
            temp = temporary.name
        os.replace(temp, out / name)


class PublicationRecovery(OSError):
    """The previous generation could not be restored and is kept for recovery."""


def warn_cleanup(message, path, failure):
    print(
        json.dumps({"warning": message, "path": str(path), "error": str(failure)}),
        file=sys.stderr,
    )


def acquire_publication_lock(out):
    out.parent.mkdir(parents=True, exist_ok=True)
    lock = out.parent / ("." + out.name + ".state-publish.lock")
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as failure:
        raise OSError("Another publication owns " + str(lock)) from failure
    os.close(descriptor)
    return lock


def release_publication_lock(lock):
    # The committed directory and its leftover lock are separate outcomes. Do not
    # hide a commit or mask an earlier failure.
    try:
        lock.unlink(missing_ok=True)
    except OSError as failure:
        warn_cleanup("Publication lock cleanup required", lock, failure)


def discard_stage(stage):
    # Publication has its own commit point. A leftover recovery directory must not
    # turn a successfully installed generation into a failure.
    if stage is None:
        return
    try:
        shutil.rmtree(stage)
    except OSError as failure:
        warn_cleanup("Staging cleanup required", stage, failure)


def check_replaceable(out, outputs):
    if not out.exists():
        return
    if not out.is_dir() or any(
        path.name not in outputs or not path.is_file() for path in out.iterdir()
    ):
        raise ValueError("Refusing to replace output containing unowned files")
    marker = out / ".state-owned"
    if any(out.iterdir()) and (
        not marker.is_file() or marker.read_text() != "state-build-v1\n"
    ):
        raise ValueError("Refusing to replace an unrecognized generated output")


def restore_previous(out, previous):
    if not previous.exists():
        return
    try:
        os.replace(previous, out)
    except OSError as failure:
        raise PublicationRecovery(
            "Publication failed; previous output preserved at " + str(previous)
        ) from failure


def install_generation(out, ready, previous):
    if out.exists():
        os.replace(out, previous)
    try:
        os.replace(ready, out)
    except OSError:
        restore_previous(out, previous)
        raise


def publish_outputs(out, outputs):
    """Publish one complete generation; retain the old directory on failed restore."""
    lock = acquire_publication_lock(out)
    stage = None
    try:
        check_replaceable(out, outputs)
        stage = Path(tempfile.mkdtemp(prefix=".state-publish-", dir=out.parent))
        ready = stage / "next"
        ready.mkdir()
        write_outputs(ready, outputs)
        install_generation(out, ready, stage / "previous")
    except PublicationRecovery:
        stage = None
        raise
    finally:
        discard_stage(stage)
        release_publication_lock(lock)


def annotate_plan(plan, config, request):
    plan["buildConstants"] = config.get("buildConstants", {})
    plan["browserRoot"] = config.get("browserRoot")
    plan["compilerInputs"] = request["compilerInputs"]


def ensure_inputs_unchanged(args, request):
    _, _, current = request_for(args)
    if current["sourceHash"] != request["sourceHash"]:
        raise ValueError(
            "Source or compiler configuration changed during build; retry with current inputs"
        )


def build(args):
    root, config, request = request_for(args)
    plan = native_plan(request)
    plan["phase"] = "analysis-only"
    annotate_plan(plan, config, request)
    verify_facades(root, plan)

    if args.command in ["doctor", "explain"]:
        return plan
    out = checked_output_dir(root, config)
    original, result = emit_selected(root, config, plan, request["files"])
    result, reference, measured = compare_sizes(plan, original, result)
    limits = enforce_budgets(config, measured)
    plan["budgetCheck"] = {
        "scope": "emitted-entry-javascript",
        "passed": True,
        "limits": limits,
        "relativeMetrics": ["raw", "gzip", "brotli"],
    }
    if args.require_improvement and all(
        d["selected"] == "baseline" for d in plan["decisions"]
    ):
        raise ValueError("No independently qualified improvement; baseline retained")
    plan["emitted"] = {
        "baseline": reference,
        "selected": measured,
        "sourceMap": True,
        "runtimeDispatcher": False,
    }
    plan["phase"] = "emitted-and-size-checked"
    plan["bundler"] = result["version"]
    plan["inputs"] = result["inputs"]
    plan["contributions"] = result.get("contributions", {})
    plan["prelink"] = result["prelink"]
    ensure_inputs_unchanged(args, request)
    publish_outputs(
        out,
        {
            ".state-owned": "state-build-v1\n",
            "app.js": result["code"],
            "app.js.map": result["map"],
            "state.manifest.json": json.dumps(plan, indent=2) + "\n",
        },
    )
    return plan


def main():
    parser = argparse.ArgumentParser(
        prog="state",
        description="Evidence-gated build-time module specialization (preview)",
    )
    parser.add_argument("command", choices=["build", "doctor", "explain"])
    parser.add_argument("--config", default="state.config.json")
    parser.add_argument("--profile")
    parser.add_argument("--mode", choices=["baseline", "auto"], default="auto")
    parser.add_argument("--require-improvement", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(build(args), ensure_ascii=False))
        return 0
    except (ValueError, KeyError, TypeError, OSError, RuntimeError) as failure:
        print(json.dumps({"error": str(failure)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
