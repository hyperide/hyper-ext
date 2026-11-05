"""The browser compiler executes the same Rust planner, not a JS imitation."""

import json
import subprocess
import unittest
import test_cli


class BrowserCompilerContracts(unittest.TestCase):
    def setUp(self):
        self.fixture = test_cli.CompilerContracts()
        self.fixture.setUp()
        self.root = test_cli.ROOT

    def tearDown(self):
        self.fixture.tearDown()

    def request(self):
        return {
            "version": 1,
            "config": self.fixture.config,
            "sourceHash": "a" * 64,
            "mode": "auto",
            "profile": None,
            "files": [
                {
                    "path": str(p.relative_to(self.fixture.root)),
                    "content": p.read_text(),
                }
                for p in sorted((self.fixture.root / "src").glob("*"))
            ],
        }

    def wasm(self, payload, ok=True):
        package = self.root / "compiler/pkg-web"
        import hashlib

        manifest = json.loads((package / "build-manifest.json").read_text())
        for relative, expected in manifest["files"].items():
            actual = hashlib.sha256(
                (self.root / "compiler" / relative).read_bytes()
            ).hexdigest()
            self.assertEqual(
                actual,
                expected,
                "Rebuild changed compiler source/artifact: " + relative,
            )
        self.assertTrue(
            (package / "statec.js").is_file(),
            "Build the real browser compiler before the parity test",
        )
        script = """import init,{compile_json} from "%s";import{readFileSync}from'node:fs';
await init({module_or_path:readFileSync("%s")});
try{const input=readFileSync(0,'utf8');try{compile_json('{bad')}catch{}const first=compile_json(input);if(first!==compile_json(input))throw Error('Repeated result changed');console.log(first);}catch(error){console.error(String(error));process.exitCode=2;}"""
        result = subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                script % ((package / "statec.js").as_uri(), package / "statec_bg.wasm"),
            ],
            input=payload,
            text=True,
            capture_output=True,
        )
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
        return json.loads(result.stdout) if ok else result.stderr

    def test_native_and_wasm_plans_match_exactly(self):
        request = self.request()
        native = subprocess.run(
            [str(self.root / "compiler/target/debug/statec")],
            input=json.dumps(request),
            text=True,
            capture_output=True,
        )
        self.assertEqual(native.returncode, 0, native.stderr)
        self.assertEqual(self.wasm(json.dumps(request)), json.loads(native.stdout))

    def test_real_syntax_diagnostics_and_repeated_compilation(self):
        request = self.request()
        request["files"][0]["content"] = "const = ;"
        self.assertIn("Syntax diagnostics", self.wasm(json.dumps(request), False))
        first = self.wasm(json.dumps(self.request()))
        self.assertEqual(first, self.wasm(json.dumps(self.request())))

    def test_malformed_and_oversized_input_fail_without_host_execution(self):
        self.wasm("{bad", False)
        self.assertIn("request exceeds", self.wasm(" " * (4 * 1024 * 1024 + 1), False))

    def test_shared_planner_source_participates_in_profile_identity(self):
        source = (self.root / "cli/state_cli/main.py").read_text()
        self.assertIn("compiler/src/lib.rs", source)
        self.assertIn("compiler/Cargo.toml", source)

    def test_web_profile_does_not_change_native_release_policy(self):
        import tomllib

        config = tomllib.loads((self.root / "compiler/Cargo.toml").read_text())
        self.assertNotIn("release", config.get("profile", {}))
        self.assertEqual(config["profile"]["web"]["inherits"], "release")

    def test_fresh_profile_selection_and_unbounded_ratios_match(self):
        request = self.request()
        request["profile"] = {
            "version": 1,
            "sourceHash": request["sourceHash"],
            "correctness": [
                {
                    "unit": "calc",
                    "variant": "fast",
                    "target": "test-target",
                    "passed": True,
                    "testHash": "b" * 64,
                }
            ],
            "records": [
                {
                    "unit": "calc",
                    "variant": "fast",
                    "target": "test-target",
                    "case": case,
                    "metric": metric,
                    "baseline": [2, 2, 2],
                    "candidate": [1, 1, 1],
                }
                for case in ["tiny", "large"]
                for metric in ["latency", "bytes"]
            ],
        }
        for unbounded in [False, True]:
            with self.subTest(unbounded=unbounded):
                if unbounded:
                    request["profile"]["records"][0]["baseline"] = [0, 0, 0]
                native = subprocess.run(
                    [str(self.root / "compiler/target/debug/statec")],
                    input=json.dumps(request),
                    text=True,
                    capture_output=True,
                )
                self.assertEqual(native.returncode, 0, native.stderr)
                expected = json.loads(native.stdout)
                self.assertEqual(
                    expected["decisions"][0]["selected"],
                    "baseline" if unbounded else "fast",
                )
                self.assertEqual(self.wasm(json.dumps(request)), expected)

    def test_large_minimum_sample_count_cannot_wrap_in_wasm(self):
        request = self.request()
        request["profile"] = {
            "version": 1,
            "sourceHash": request["sourceHash"],
            "correctness": [
                {
                    "unit": "calc",
                    "variant": "fast",
                    "target": "test-target",
                    "passed": True,
                    "testHash": "b" * 64,
                }
            ],
            "records": [
                {
                    "unit": "calc",
                    "variant": "fast",
                    "target": "test-target",
                    "case": case,
                    "metric": metric,
                    "baseline": [],
                    "candidate": [],
                }
                for case in ["tiny", "large"]
                for metric in ["latency", "bytes"]
            ],
        }
        for minimum in [2**32, 2**32 + 1, 2**64 - 1]:
            with self.subTest(minimum=minimum):
                request["config"]["minimumSamples"] = minimum
                native = subprocess.run(
                    [str(self.root / "compiler/target/debug/statec")],
                    input=json.dumps(request),
                    text=True,
                    capture_output=True,
                )
                self.assertEqual(native.returncode, 0, native.stderr)
                expected = json.loads(native.stdout)
                self.assertEqual(expected["decisions"][0]["selected"], "baseline")
                actual = self.wasm(json.dumps(request))
                self.assertEqual(actual["decisions"][0]["selected"], "baseline")
                self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
