import json
import subprocess
import unittest
import test_cli


class GeneratedProjectionContracts(unittest.TestCase):
    def setUp(self):
        self.fixture = test_cli.CompilerContracts()
        self.fixture.setUp()
        self.root = self.fixture.root
        self.config = self.fixture.config
        (self.root / "src/fast.ts").unlink()
        self.fields = ["id", "done"]
        self.prepare(self.fields)

    def tearDown(self):
        self.fixture.tearDown()

    def prepare(self, fields):
        self.fields = fields
        self.config["units"][0]["variants"][0].update(
            {
                "entry": "src/generated/project.mjs",
                "generate": {"kind": "projection", "export": "calc", "fields": fields},
            }
        )
        (self.root / "src/main.ts").write_text('export {calc} from "./strategy.ts";')
        (self.root / "src/baseline.ts").write_text(
            "const fields = " + json.dumps(fields) + ";\n"
            "export function calc(input) { const output = {}; for (const key of fields) "
            "Object.defineProperty(output, key, {value:input[key],writable:true,"
            "enumerable:true,configurable:true}); return output; }"
        )
        self.fixture.save()

    def cli(self, *args, **kwargs):
        return self.fixture.cli(*args, **kwargs)

    def execute(self, source):
        module = json.dumps((self.root / "out/app.js").as_uri())
        run = subprocess.run(
            [
                "node",
                "--input-type=module",
                "-e",
                "import assert from 'node:assert/strict';import {calc} from "
                + module
                + ";"
                + source,
            ],
            text=True,
            capture_output=True,
        )
        self.assertEqual(run.returncode, 0, run.stderr)

    def test_generated_module_is_inspectable_without_creating_an_authored_file(self):
        result = self.cli("doctor")
        generated = result["generatedModules"][0]
        self.assertEqual(generated["path"], "src/generated/project.mjs")
        self.assertIn("export function calc(input)", generated["content"])
        self.assertIn('["id"]: input["id"]', generated["content"])
        self.assertFalse((self.root / "src/generated").exists())
        self.assertEqual(result["decisions"][0]["selected"], "baseline")

    def test_missing_profile_keeps_identical_baseline_and_drops_generated_code(self):
        result = self.cli("build")
        before = (self.root / "out/app.js").read_bytes()
        self.assertEqual(result["decisions"][0]["selected"], "baseline")
        self.cli("build", "--mode", "baseline")
        self.assertEqual(before, (self.root / "out/app.js").read_bytes())
        self.assertFalse(any("state-generated" in x for x in result["inputs"]))

    def test_qualified_generated_projection_is_used_and_source_mapped(self):
        self.fixture.profile()
        result = self.cli("build", "--profile", str(self.root / "profile.json"))
        self.assertEqual(result["decisions"][0]["selected"], "fast")
        self.assertTrue(any("state-generated" in x for x in result["inputs"]))
        self.execute(
            "assert.deepEqual(calc({id:7,done:true,extra:9}),{id:7,done:true});"
        )
        source_map = json.loads((self.root / "out/app.js.map").read_text())
        self.assertTrue(
            any(
                "export function calc(input)" in x for x in source_map["sourcesContent"]
            )
        )
        self.assertFalse((self.root / "src/generated/project.mjs").exists())

    def test_generated_getters_throw_in_order_and_descriptors_match(self):
        self.fixture.profile()
        self.cli("build", "--profile", str(self.root / "profile.json"))
        self.execute("""const seen=[]; const input={get id(){seen.push('id');return 7;},get done(){seen.push('done');return false;}};
            const result=calc(input);assert.deepEqual(seen,['id','done']);
            assert.deepEqual(Object.getOwnPropertyDescriptor(result,'id'),{value:7,enumerable:true,writable:true,configurable:true});
            const error=new Error('stop');seen.length=0;
            assert.throws(()=>calc({get id(){throw error;},get done(){seen.push('unexpected');}}),e=>e===error);
            assert.deepEqual(seen,[]);""")

    def test_special_field_names_are_data_not_prototype_or_source_code(self):
        self.prepare(
            ["__proto__", "constructor", "", "quote'\"", "я😀", "10", "line\nend"]
        )
        self.fixture.profile()
        result = self.cli("build", "--profile", str(self.root / "profile.json"))
        self.assertEqual(result["decisions"][0]["selected"], "fast")
        self.execute(
            "const keys="
            + json.dumps(self.fields)
            + ";const input=Object.create(null);"
            "keys.forEach((key,i)=>Object.defineProperty(input,key,{value:i,enumerable:true}));"
            "const result=calc(input);assert.equal(Object.getPrototypeOf(result),Object.prototype);"
            "keys.forEach((key,i)=>assert.equal(result[key],i));assert.equal(Object.keys(result).length,keys.length);"
        )

    def test_generation_spec_is_in_the_evidence_fingerprint(self):
        self.fixture.profile()
        self.config["units"][0]["variants"][0]["generate"]["fields"].append("other")
        self.fixture.save()
        result = self.cli("doctor", "--profile", str(self.root / "profile.json"))
        self.assertEqual(result["decisions"][0]["selected"], "baseline")
        self.assertTrue(
            any(
                "stale" in reason
                for reason in result["decisions"][0]["candidates"][0]["reasons"]
            )
        )

    def test_generator_rejects_invalid_contract_data(self):
        generator = self.config["units"][0]["variants"][0]["generate"]
        for fields in [["id", "id"], [4], "id", ["id"] * 257]:
            generator["fields"] = fields
            self.fixture.save()
            result = self.cli("doctor", ok=False)
            self.assertIn("projection", result.stderr.lower())

    def test_generated_source_cannot_overwrite_or_escape_the_project(self):
        variant = self.config["units"][0]["variants"][0]
        for entry in ["src/baseline.ts", "outside.mjs", "../outside.mjs"]:
            variant["entry"] = entry
            self.fixture.save()
            self.cli("doctor", ok=False)
        self.assertIn(
            "Object.defineProperty", (self.root / "src/baseline.ts").read_text()
        )

    def test_invalid_export_and_executor_are_rejected(self):
        variant = self.config["units"][0]["variants"][0]
        for name in ["", "x;throw", "default"]:
            variant["generate"]["export"] = name
            self.fixture.save()
            self.cli("doctor", ok=False)
        variant["generate"]["export"] = "calc"
        variant["executor"] = "wasm-worker"
        self.fixture.save()
        self.cli("doctor", ok=False)

    def test_real_bundle_size_can_reject_a_profile_qualified_generator(self):
        self.prepare([f"field{i}" for i in range(80)])
        self.fixture.profile()
        result = self.cli("build", "--profile", str(self.root / "profile.json"))
        self.assertEqual(result["decisions"][0]["selected"], "baseline")
        self.assertIn("bytes exceeded", result["bundleFallback"])

    def test_generated_path_cannot_replace_an_authored_role_in_another_unit(self):
        original = json.loads(json.dumps(self.config))
        (self.root / "src/other-strategy.ts").write_text(
            'export {calc} from "./baseline.ts";'
        )
        for role in ["baseline", "facade", "variant"]:
            with self.subTest(role=role):
                self.config.clear()
                self.config.update(json.loads(json.dumps(original)))
                other = {
                    "id": "other",
                    "facade": "src/other-strategy.ts",
                    "baseline": "src/baseline.ts",
                    "timing": "sync",
                    "contract": "number-double-v1",
                    "variants": [],
                }
                if role == "variant":
                    other["variants"] = [
                        {
                            "id": "borrowed",
                            "entry": "src/generated/project.mjs",
                            "executor": "js-main",
                            "contract": "number-double-v1",
                        }
                    ]
                else:
                    other[role] = "src/generated/project.mjs"
                self.config["units"].append(other)
                self.fixture.save()
                result = self.cli("doctor", ok=False)
                self.assertIn("generated path used by an authored role", result.stderr)


if __name__ == "__main__":
    unittest.main()
