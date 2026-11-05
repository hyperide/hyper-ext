import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "cli" / "bin" / "state"


class CompilerContracts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "src").mkdir()
        (self.root / "src/main.ts").write_text(
            'import { calc } from "./strategy.ts"; export const result = calc(7);'
        )
        (self.root / "src/strategy.ts").write_text(
            'export { calc } from "./baseline.ts";'
        )
        (self.root / "src/baseline.ts").write_text(
            "export const calc = (n: number) => n * 2;"
        )
        (self.root / "src/fast.ts").write_text(
            "export const calc = (n: number) => n + n;"
        )
        self.config = {
            "version": 1,
            "sourceRoot": "src",
            "entry": "src/main.ts",
            "outDir": "out",
            "targets": ["test-target"],
            "capabilities": [],
            "metrics": ["latency", "bytes"],
            "cases": ["tiny", "large"],
            "minimumSamples": 3,
            "units": [
                {
                    "id": "calc",
                    "facade": "src/strategy.ts",
                    "baseline": "src/baseline.ts",
                    "timing": "sync",
                    "contract": "number-double-v1",
                    "variants": [
                        {
                            "id": "fast",
                            "entry": "src/fast.ts",
                            "contract": "number-double-v1",
                            "executor": "js-main",
                            "requires": [],
                        }
                    ],
                }
            ],
        }
        self.save()

    def tearDown(self):
        self.tmp.cleanup()

    def save(self):
        (self.root / "state.config.json").write_text(json.dumps(self.config))

    def cli(self, *args, ok=True):
        p = subprocess.run(
            [
                sys.executable,
                str(CLI),
                *args,
                "--config",
                str(self.root / "state.config.json"),
            ],
            text=True,
            capture_output=True,
        )
        if ok:
            self.assertEqual(p.returncode, 0, p.stderr)
        else:
            self.assertNotEqual(p.returncode, 0)
        return json.loads(p.stdout) if p.returncode == 0 else p

    def profile(self):
        digest = self.cli("doctor")["sourceHash"]
        records = [
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
        ]
        data = {
            "version": 1,
            "sourceHash": digest,
            "correctness": [
                {
                    "unit": "calc",
                    "variant": "fast",
                    "target": "test-target",
                    "passed": True,
                    "testHash": "a" * 64,
                }
            ],
            "records": records,
        }
        (self.root / "profile.json").write_text(json.dumps(data))
        return data

    def test_missing_profile_is_byte_identical_to_explicit_baseline(self):
        self.cli("build")
        first = (self.root / "out/app.js").read_bytes()
        self.cli("build", "--mode", "baseline")
        self.assertEqual(first, (self.root / "out/app.js").read_bytes())

    def test_qualified_candidate_is_selected_with_no_runtime_dispatch(self):
        self.profile()
        result = self.cli("build", "--profile", str(self.root / "profile.json"))
        self.assertEqual(result["decisions"][0]["selected"], "fast")
        self.assertNotIn("statec", (self.root / "out/app.js").read_text())
        executed = subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                f'import {{ result }} from {json.dumps((self.root / "out/app.js").as_uri())}; if(result!==14)throw Error("wrong output")',
            ],
            capture_output=True,
            text=True,
        )
        self.assertEqual(executed.returncode, 0, executed.stderr)

    def test_source_map_sources_resolve_from_the_emitted_directory(self):
        self.cli("build")
        out = self.root / "out"
        sources = json.loads((out / "app.js.map").read_text())["sources"]
        self.assertTrue(sources)
        for source in sources:
            self.assertTrue((out / source).resolve().is_file(), source)

    def test_emitted_files_are_readable_by_the_serving_user(self):
        umask = os.umask(0)
        os.umask(umask)
        self.cli("build")
        for name in ("app.js", "app.js.map", "state.manifest.json"):
            mode = (self.root / "out" / name).stat().st_mode & 0o777
            self.assertEqual(mode, 0o666 & ~umask, name)

    def test_one_worst_case_regression_cannot_hide_in_an_average(self):
        d = self.profile()
        d["records"][0]["candidate"] = [1, 1, 3]
        (self.root / "profile.json").write_text(json.dumps(d))
        result = self.cli("doctor", "--profile", str(self.root / "profile.json"))
        self.assertEqual(result["decisions"][0]["selected"], "baseline")

    def test_stale_sources_revoke_optimization(self):
        self.profile()
        (self.root / "src/fast.ts").write_text(
            "export const calc = (n:number) => n+n+1;"
        )
        self.assertEqual(
            self.cli("doctor", "--profile", str(self.root / "profile.json"))[
                "decisions"
            ][0]["selected"],
            "baseline",
        )

    def test_sync_contract_cannot_move_to_worker(self):
        self.config["units"][0]["variants"][0]["executor"] = "js-worker"
        self.save()
        self.profile()
        self.assertEqual(
            self.cli("doctor", "--profile", str(self.root / "profile.json"))[
                "decisions"
            ][0]["selected"],
            "baseline",
        )

    def test_capability_and_correctness_are_required(self):
        self.config["units"][0]["variants"][0]["requires"] = ["crossOriginIsolated"]
        self.save()
        self.profile()
        self.assertEqual(
            self.cli("doctor", "--profile", str(self.root / "profile.json"))[
                "decisions"
            ][0]["selected"],
            "baseline",
        )

    def test_invalid_typescript_fails_in_native_parser(self):
        (self.root / "src/main.ts").write_text("export const broken = ;")
        self.cli("doctor", ok=False)

    def test_non_generated_output_and_path_escape_are_rejected(self):
        (self.root / "out").mkdir()
        (self.root / "out/keep.txt").write_text("user data")
        self.cli("build", ok=False)
        self.assertEqual((self.root / "out/keep.txt").read_text(), "user data")
        self.config["units"][0]["baseline"] = "../outside.ts"
        self.save()
        self.cli("doctor", ok=False)

    def test_no_profile_preserves_original_facade_side_effects(self):
        (self.root / "src/strategy.ts").write_text(
            'globalThis.__stateProof = 9; export { calc } from "./baseline.ts";'
        )
        self.cli("build")
        result = subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                f'import {json.dumps((self.root / "out/app.js").as_uri())}; if(globalThis.__stateProof!==9) throw Error("facade effects erased")',
            ],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_side_effectful_facade_cannot_be_specialized(self):
        (self.root / "src/strategy.ts").write_text(
            'globalThis.__stateProof=9;export {calc} from "./baseline.ts";'
        )
        self.profile()
        self.assertEqual(
            self.cli("doctor", "--profile", str(self.root / "profile.json"))[
                "decisions"
            ][0]["selected"],
            "baseline",
        )

    def test_specialization_preserves_named_export_subset(self):
        (self.root / "src/baseline.ts").write_text(
            "export function calc(n:number){let sum=0;for(let i=0;i<2;i++)sum+=n;return sum;}"
        )
        (self.root / "src/fast.ts").write_text(
            "export const calc=(n:number)=>n+n;export const hidden=99;"
        )
        (self.root / "src/main.ts").write_text(
            'import * as api from "./strategy.ts";export const result=Object.keys(api);'
        )
        self.profile()
        self.cli("build", "--profile", str(self.root / "profile.json"))
        p = subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                f'import {{ result }} from {json.dumps((self.root / "out/app.js").as_uri())};if(result.length!==1||result[0]!=="calc")throw Error(JSON.stringify(result))',
            ],
            capture_output=True,
            text=True,
        )
        self.assertEqual(p.returncode, 0, p.stderr)

    def test_wasm_asset_changes_revoke_profile(self):
        (self.root / "src/module.wasm").write_bytes(b"first")
        self.profile()
        (self.root / "src/module.wasm").write_bytes(b"changed")
        self.assertEqual(
            self.cli("doctor", "--profile", str(self.root / "profile.json"))[
                "decisions"
            ][0]["selected"],
            "baseline",
        )

    def test_unmatched_extensionless_import_is_not_reported_as_specialized(self):
        (self.root / "src/main.ts").write_text(
            'import {calc} from "./strategy";export const result=calc(7);'
        )
        self.profile()
        result = self.cli("build", "--profile", str(self.root / "profile.json"))
        self.assertEqual(result["decisions"][0]["selected"], "baseline")
        self.assertIn("not rewritten", result["decisions"][0]["fallback"])

    def test_equal_profile_does_not_claim_a_strict_improvement(self):
        profile = self.profile()
        for row in profile["records"]:
            row["candidate"] = row["baseline"]
        (self.root / "profile.json").write_text(json.dumps(profile))
        result = self.cli("doctor", "--profile", str(self.root / "profile.json"))
        self.assertFalse(result["decisions"][0]["candidates"][0]["eligible"])

    def test_star_export_is_not_a_safe_named_facade(self):
        (self.root / "src/strategy.ts").write_text('export * from "./baseline.ts";')
        self.profile()
        result = self.cli("doctor", "--profile", str(self.root / "profile.json"))
        self.assertEqual(result["decisions"][0]["selected"], "baseline")

    def test_worst_observed_ratio_includes_rejected_regression_cells(self):
        profile = self.profile()
        profile["records"][0]["candidate"] = [1, 1, 3]
        (self.root / "profile.json").write_text(json.dumps(profile))
        result = self.cli("doctor", "--profile", str(self.root / "profile.json"))
        candidate = result["decisions"][0]["candidates"][0]
        self.assertFalse(candidate["eligible"])
        self.assertEqual(candidate["worstObservedRatio"], 1.5)

    def test_missing_samples_have_no_observed_ratio(self):
        profile = self.profile()
        profile["records"] = []
        (self.root / "profile.json").write_text(json.dumps(profile))
        candidate = self.cli("doctor", "--profile", str(self.root / "profile.json"))[
            "decisions"
        ][0]["candidates"][0]
        self.assertIsNone(candidate["worstObservedRatio"])

    def test_positive_candidate_over_zero_baseline_is_explicitly_unbounded(self):
        profile = self.profile()
        profile["records"][0]["baseline"] = [0, 0, 0]
        profile["records"][0]["candidate"] = [1, 1, 1]
        (self.root / "profile.json").write_text(json.dumps(profile))
        candidate = self.cli("doctor", "--profile", str(self.root / "profile.json"))[
            "decisions"
        ][0]["candidates"][0]
        self.assertIsNone(candidate["worstObservedRatio"])
        self.assertTrue(candidate["worstObservedRatioUnbounded"])


if __name__ == "__main__":
    unittest.main()
