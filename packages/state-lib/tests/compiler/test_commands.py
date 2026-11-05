import json
import subprocess
import unittest
import test_cli


class GeneratedCommandContracts(unittest.TestCase):
    def setUp(self):
        self.fixture = test_cli.CompilerContracts()
        self.fixture.setUp()
        self.root = self.fixture.root
        self.config = self.fixture.config
        source = test_cli.ROOT / "experiments/2026-09-19-cow/json-draft.mjs"
        (self.root / "src/owned.mjs").write_bytes(source.read_bytes())
        (self.root / "src/main.ts").write_text('export {calc} from "./strategy.ts";')
        (self.root / "src/fast.ts").unlink()
        self.spec = {
            "kind": "json-command",
            "export": "calc",
            "runtime": "src/owned.mjs",
            "operation": "groups",
            "path": ["columns"],
            "itemsField": "items",
            "field": "text",
            "value": {"arg": "text"},
        }
        self.config["units"][0]["variants"][0].update(
            entry="src/generated.mjs", generate=self.spec
        )
        (self.root / "src/baseline.ts").write_text(
            'import {beginJsonDraft} from "./owned.mjs";export function calc(base,args){const tx=beginJsonDraft(base);try{for(const col of tx.draft.columns)for(const item of col.items)item.text=args.text;return tx.finish();}catch(e){tx.abort();throw e;}}'
        )
        self.fixture.save()

    def tearDown(self):
        self.fixture.tearDown()

    def cli(self, *args, **kwargs):
        return self.fixture.cli(*args, **kwargs)

    def execute(self, assertions):
        plan = self.cli("doctor")
        module = self.root / "generated-under-test.mjs"
        module.write_text(plan["generatedModules"][0]["content"])
        script = (
            'import assert from "node:assert/strict";import {calc} from '
            + json.dumps(module.as_uri())
            + ";import {ownJson,beginJsonDraft} from "
            + json.dumps((self.root / "src/owned.mjs").as_uri())
            + ";"
            + assertions
        )
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return plan

    def test_native_generated_dense_command_keeps_old_values_and_owned_output(self):
        plan = self.execute(
            'const old=ownJson({columns:[{items:[{text:"old",id:1},{text:"older",id:2}]}]});const next=calc(old,{text:"new"});assert.equal(old.columns[0].items[0].text,"old");assert(next.columns[0].items.every(r=>r.text==="new"));assert(Object.isFrozen(next));assert.equal(beginJsonDraft(next).strategy,"cow");'
        )
        self.assertIn("setJsonGroups", plan["generatedModules"][0]["content"])
        self.assertFalse((self.root / "src/generated.mjs").exists())

    def test_native_point_command_supports_dynamic_indices(self):
        self.spec.update(
            operation="set",
            path=["rows", {"arg": "index"}, "done"],
            value={"arg": "done"},
        )
        self.fixture.save()
        self.execute(
            "const old=ownJson({rows:[{done:false},{done:false}]});const next=calc(old,{index:1,done:true});assert.equal(next.rows[0],old.rows[0]);assert.equal(next.rows[1].done,true);assert.equal(old.rows[1].done,false);"
        )

    def test_generated_move_reuses_payloads_and_checks_indices(self):
        self.spec.clear()
        self.spec.update(
            kind="json-command",
            export="calc",
            runtime="src/owned.mjs",
            operation="move",
            path=["a"],
            targetPath=["b"],
            fromIndex={"arg": "from"},
            toIndex={"arg": "to"},
        )
        self.fixture.save()
        self.execute(
            "const old=ownJson({a:[{v:1}],b:[]});const next=calc(old,{from:0,to:0});assert.equal(next.b[0],old.a[0]);assert.equal(old.a.length,1);assert.throws(()=>calc(old,{from:2,to:0}));"
        )

    def test_runtime_must_be_authored_inside_source_root(self):
        for path in ["../outside.mjs", "missing.mjs", "src/generated.mjs"]:
            with self.subTest(path=path):
                self.spec["runtime"] = path
                self.fixture.save()
                self.cli("doctor", ok=False)

    def test_invalid_or_async_generation_is_rejected(self):
        original = dict(self.spec)
        for field, value in [
            ("operation", "unknown"),
            ("path", [None]),
            ("path", [{"arg": 4}]),
            ("path", []),
            ("field", 4),
            ("export", "default"),
        ]:
            with self.subTest(field=field):
                self.spec.clear()
                self.spec.update(original)
                self.spec[field] = value
                self.fixture.save()
                self.cli("doctor", ok=False)
        self.spec.clear()
        self.spec.update(original)
        self.config["units"][0]["timing"] = "async"
        self.fixture.save()
        self.cli("doctor", ok=False)

    def test_qualified_generated_command_is_bundled_without_proxy_cow_engine(self):
        self.fixture.profile()
        plan = self.cli("build", "--profile", str(self.root / "profile.json"))
        self.assertEqual(plan["decisions"][0]["selected"], "fast")
        output = (self.root / "out/app.js").read_text()
        self.assertNotIn("new Proxy", output)
        self.assertLessEqual(
            plan["emitted"]["selected"]["raw"], plan["emitted"]["baseline"]["raw"]
        )
        self.assertLessEqual(
            plan["emitted"]["selected"]["gzip"], plan["emitted"]["baseline"]["gzip"]
        )


if __name__ == "__main__":
    unittest.main()
