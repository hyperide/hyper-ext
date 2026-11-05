"""Whole browser-entry specialization must execute the same public contract."""

import json
import shutil
import subprocess
import unittest
from pathlib import Path

import test_cli


class StaticEntryContracts(unittest.TestCase):
    def setUp(self):
        self.fixture = test_cli.CompilerContracts()
        self.fixture.setUp()
        self.root = self.fixture.root
        self.config = self.fixture.config
        self.config["units"] = []
        self.config["buildConstants"] = {"__STATE_BUILD_BASELINE__": False}
        self.config["browserRoot"] = "src"
        (self.root / "src/main.ts").write_text("""
import {legacy} from '/legacy.ts';
import {current} from './current.ts';
export function run(x) {
  return (typeof __STATE_BUILD_BASELINE__ === 'boolean' ? __STATE_BUILD_BASELINE__ : true) ? legacy(x) : current(x);
}
""")
        (self.root / "src/legacy.ts").write_text(
            'export const legacy = x => ({value:x+1,source:"LEGACY_EXECUTOR_MARKER"});'
        )
        (self.root / "src/current.ts").write_text(
            'export const current = x => ({value:x+1,source:"CURRENT_EXECUTOR_MARKER"});'
        )
        self.fixture.save()

    def tearDown(self):
        self.fixture.tearDown()

    def run_output(self):
        module = (self.root / "out/app.js").as_uri()
        return json.loads(
            subprocess.check_output(
                [
                    "node",
                    "--input-type=module",
                    "-e",
                    f"import {{run}} from {json.dumps(module)};console.log(JSON.stringify(await run(7)));",
                ],
                text=True,
            )
        )

    def test_known_backend_drops_other_executor_and_executes(self):
        plan = self.fixture.cli("build")
        code = (self.root / "out/app.js").read_text()
        self.assertNotIn("LEGACY_EXECUTOR_MARKER", code)
        self.assertEqual(
            self.run_output(), {"value": 8, "source": "CURRENT_EXECUTOR_MARKER"}
        )
        self.assertEqual(plan["buildConstants"], self.config["buildConstants"])

    def test_baseline_is_specialized_equally_and_preserves_result(self):
        self.config["buildConstants"]["__STATE_BUILD_BASELINE__"] = True
        self.fixture.save()
        self.fixture.cli("build", "--mode", "baseline")
        self.assertNotIn(
            "CURRENT_EXECUTOR_MARKER", (self.root / "out/app.js").read_text()
        )
        self.assertEqual(
            self.run_output(), {"value": 8, "source": "LEGACY_EXECUTOR_MARKER"}
        )

    def test_constant_change_invalidates_source_identity(self):
        first = self.fixture.cli("doctor")["sourceHash"]
        self.config["buildConstants"]["__STATE_BUILD_BASELINE__"] = True
        self.fixture.save()
        self.assertNotEqual(first, self.fixture.cli("doctor")["sourceHash"])

    def test_invalid_constants_and_browser_root_fail_before_emit(self):
        for value in [
            {"window": False},
            {"__STATE_BUILD_X__": []},
            {"__STATE_BUILD_X__": 1},
            [],
        ]:
            self.config["buildConstants"] = value
            self.fixture.save()
            self.assertIn(
                "buildConstants",
                json.loads(self.fixture.cli("build", ok=False).stderr)["error"],
            )
        self.config["buildConstants"] = {}
        for path in ["../outside", "src/main.ts", "/tmp", "out"]:
            self.config["browserRoot"] = path
            self.fixture.save()
            self.fixture.cli("build", ok=False)
        (self.root / "config").mkdir()
        self.config["browserRoot"] = "config"
        self.fixture.save()
        self.assertIn(
            "inside sourceRoot",
            json.loads(self.fixture.cli("build", ok=False).stderr)["error"],
        )

    def test_bad_root_import_does_not_replace_previous_output(self):
        self.fixture.cli("build")
        before = (self.root / "out/app.js").read_bytes()
        (self.root / "outside.js").write_text("export default 99")
        (self.root / "src/main.ts").write_text(
            "import value from '/../outside.js';export const run=()=>value"
        )
        failure = self.fixture.cli("build", ok=False)
        self.assertIn("browserRoot", json.loads(failure.stderr)["error"])
        self.assertEqual(before, (self.root / "out/app.js").read_bytes())

    def test_nested_sources_keep_resolvable_source_map_paths(self):
        (self.root / "src/nested").mkdir()
        (self.root / "src/nested/part.ts").write_text(
            "export const part = (x: number) => x + 1;"
        )
        (self.root / "src/main.ts").write_text(
            "import {part} from './nested/part';export const run = x => part(x);"
        )
        self.fixture.cli("build")
        out = self.root / "out"
        sources = json.loads((out / "app.js.map").read_text())["sources"]
        self.assertIn("../src/nested/part.ts", sources)
        for source in sources:
            self.assertTrue((out / source).resolve().is_file(), source)

    def test_dynamic_entry_preserves_package_metadata_and_drops_unused_class(self):
        (self.root / "src/pkg").mkdir()
        (self.root / "src/pkg/package.json").write_text(
            '{"type":"module","sideEffects":false}'
        )
        (self.root / "src/pkg/engine.ts").write_text(
            'export class Engine { run(x) {return {value:x+1,source:"ENGINE_MUST_DISAPPEAR"}} }'
        )
        (self.root / "src/choice.ts").write_text("""
import {Engine} from '/pkg/engine.ts';
export function run(x) {
 if (typeof __STATE_BUILD_BASELINE__ === 'boolean' ? __STATE_BUILD_BASELINE__ : false) {return {value:x+1,source:'direct'};}
 return new Engine().run(x);
}
""")
        (self.root / "src/main.ts").write_text(
            "export async function run(x){return (await import('/choice.ts')).run(x)}"
        )
        self.config["buildConstants"]["__STATE_BUILD_BASELINE__"] = True
        self.fixture.save()
        manifest = self.fixture.cli("build")
        self.assertEqual(self.run_output(), {"value": 8, "source": "direct"})
        self.assertNotIn(
            "ENGINE_MUST_DISAPPEAR", (self.root / "out/app.js").read_text()
        )
        self.assertFalse(
            any(
                name.endswith("engine.ts") and value["bytesInOutput"]
                for name, value in manifest["contributions"].items()
            )
        )

    def test_live_side_effects_are_not_dropped_by_specialization(self):
        (self.root / "src/effects.ts").write_text("globalThis.testEffect=41;")
        (self.root / "src/main.ts").write_text(
            "import '/effects.ts';export const run=()=>({value:globalThis.testEffect+1})"
        )
        self.fixture.cli("build")
        self.assertEqual(self.run_output(), {"value": 42})

    def test_string_constant_is_data_not_executable_code(self):
        value = '";globalThis.unexpected=true;//'
        self.config["buildConstants"] = {"__STATE_BUILD_LABEL__": value}
        self.fixture.save()
        (self.root / "src/main.ts").write_text(
            "export const run=()=>({value:__STATE_BUILD_LABEL__,safe:globalThis.unexpected!==true})"
        )
        self.fixture.cli("build")
        self.assertEqual(self.run_output(), {"value": value, "safe": True})

    def test_browser_sources_cannot_reach_an_unhashed_parent_via_relative_import(self):
        (self.root / "outside.ts").write_text("export default 99")
        (self.root / "src/main.ts").write_text(
            "import value from '../outside.ts';export const run=()=>value"
        )
        self.fixture.cli("build", ok=False)

    def test_browser_root_preserves_normal_extension_resolution(self):
        (self.root / "src/main.ts").write_text(
            "import {current} from './current';export const run=x=>current(x)"
        )
        self.fixture.cli("build")
        self.assertEqual(
            self.run_output(), {"value": 8, "source": "CURRENT_EXECUTOR_MARKER"}
        )
        (self.root / "src/main.ts").write_text(
            "import {current} from '/current';export const run=x=>current(x)"
        )
        self.fixture.cli("build")
        self.assertEqual(
            self.run_output(), {"value": 8, "source": "CURRENT_EXECUTOR_MARKER"}
        )

    def test_prelink_specialization_preserves_inherited_ts_class_field_semantics(self):
        (self.root / "src/base.tsconfig.json").write_text(
            json.dumps({"compilerOptions": {"useDefineForClassFields": False}})
        )
        (self.root / "src/tsconfig.json").write_text(
            json.dumps({"extends": "./base.tsconfig.json"})
        )
        (self.root / "src/main.ts").write_text("""
class Parent { set value(next) { globalThis.recorded = next; } }
class Child extends Parent { value = 9; }
export function run() { new Child(); return {recorded: globalThis.recorded ?? null}; }
""")
        self.config["buildConstants"] = {}
        self.fixture.save()
        self.fixture.cli("build")
        reference = self.run_output()
        self.assertEqual(reference, {"recorded": 9})
        self.config["buildConstants"] = {"__STATE_BUILD_BASELINE__": False}
        self.fixture.save()
        self.fixture.cli("build")
        self.assertEqual(self.run_output(), reference)

    def test_prelink_specialization_preserves_project_jsx_factory(self):
        (self.root / "src/tsconfig.json").write_text(
            json.dumps({"compilerOptions": {"jsx": "react", "jsxFactory": "element"}})
        )
        (self.root / "src/view.tsx").write_text("""
const element = (tag, props, text) => ({tag, text});
export const view = () => <span>kept</span>;
""")
        (self.root / "src/main.ts").write_text(
            "import {view} from './view';export const run=()=>view();"
        )
        self.fixture.cli("build")
        self.assertEqual(self.run_output(), {"tag": "span", "text": "kept"})

    def test_root_typescript_options_participate_in_profile_identity(self):
        (self.root / "tsconfig.json").write_text(
            json.dumps({"compilerOptions": {"useDefineForClassFields": False}})
        )
        first = self.fixture.cli("doctor")["sourceHash"]
        (self.root / "tsconfig.json").write_text(
            json.dumps({"compilerOptions": {"useDefineForClassFields": True}})
        )
        self.assertNotEqual(first, self.fixture.cli("doctor")["sourceHash"])

    def test_prelink_preserves_the_production_environment_choice(self):
        (self.root / "src/main.ts").write_text(
            "export const run=()=>({mode:process.env.NODE_ENV});"
        )
        self.config["buildConstants"] = {}
        self.fixture.save()
        self.fixture.cli("build")
        self.assertEqual(self.run_output(), {"mode": "production"})
        self.config["buildConstants"] = {"__STATE_BUILD_BASELINE__": False}
        self.fixture.save()
        self.fixture.cli("build")
        self.assertEqual(self.run_output(), {"mode": "production"})

    def test_nested_jsx_factories_preserve_ordinary_linker_semantics(self):
        (self.root / "src/tsconfig.json").write_text(
            json.dumps(
                {
                    "compilerOptions": {
                        "jsx": "react",
                        "jsxFactory": "h",
                        "jsxFragmentFactory": "Fragment",
                    }
                }
            )
        )
        cases = [
            "namespace Example { class Box {} const h=(tag)=>tag.name; export const view=<Box/>; } export const run=()=>Example.view;",
            "export function run(){const h=(tag)=>tag;const Fragment='fragment';return <><span/></>;}",
        ]
        for source in cases:
            with self.subTest(source=source):
                (self.root / "src/view.tsx").write_text(source)
                (self.root / "src/main.ts").write_text("export {run} from './view';")
                self.config["buildConstants"] = {}
                self.fixture.save()
                self.fixture.cli("build")
                expected = self.run_output()
                self.config["buildConstants"] = {"__STATE_BUILD_BASELINE__": False}
                self.fixture.save()
                self.fixture.cli("build")
                self.assertEqual(self.run_output(), expected)

    def test_browser_entry_must_start_inside_its_declared_browser_root(self):
        (self.root / "src/browser").mkdir()
        self.config["browserRoot"] = "src/browser"
        (self.root / "src/main.ts").write_text(
            "import {current} from './current';export const run=current;"
        )
        self.fixture.save()
        result = self.fixture.cli("build", ok=False)
        self.assertIn("browserRoot", result.stderr)

    def test_inherited_config_outside_source_root_invalidates_profile(self):
        (self.root / "config").mkdir()
        base = self.root / "config/base.json"
        base.write_text('{"compilerOptions":{"useDefineForClassFields":false}}')
        (self.root / "tsconfig.json").write_text('{"extends":"./config/base.json"}')
        before = self.fixture.cli("doctor")["sourceHash"]
        base.write_text('{"compilerOptions":{"useDefineForClassFields":true}}')
        after = self.fixture.cli("doctor")
        self.assertNotEqual(before, after["sourceHash"])
        self.assertIn("config/base.json", json.dumps(after["compilerInputs"]))

    def test_escaping_config_inheritance_rejects_before_replacing_output(self):
        import tempfile

        with tempfile.TemporaryDirectory() as other:
            outside = Path(other) / "base.json"
            outside.write_text('{"compilerOptions":{"useDefineForClassFields":false}}')
            self.fixture.cli("build")
            before = (self.root / "out/app.js").read_bytes()
            (self.root / "tsconfig.json").write_text(
                json.dumps({"extends": str(outside)})
            )
            result = self.fixture.cli("build", ok=False)
            self.assertIn("configuration", result.stderr.lower())
            self.assertEqual(before, (self.root / "out/app.js").read_bytes())

    def test_jsonc_multiple_and_package_config_dependencies_are_fingerprinted(self):
        package = self.root / "node_modules/@example/config"
        package.mkdir(parents=True)
        (package / "package.json").write_text(
            '{"name":"@example/config","tsconfig":"base.json"}'
        )
        inherited = package / "base.json"
        inherited.write_text(
            '{/* inherited */ "compilerOptions":{"useDefineForClassFields":false,},}'
        )
        (self.root / "other.json").write_text(
            '{"compilerOptions":{"jsxFactory":"element"}}'
        )
        (self.root / "tsconfig.json").write_text(
            '{"extends":["@example/config", "./other.json"]}'
        )
        first = self.fixture.cli("doctor")
        dependencies = {entry["path"] for entry in first["compilerInputs"]["files"]}
        self.assertTrue(
            {"tsconfig.json", "other.json", "node_modules/@example/config/base.json"}
            <= dependencies
        )
        inherited.write_text('{"compilerOptions":{"useDefineForClassFields":true}}')
        self.assertNotEqual(
            first["sourceHash"], self.fixture.cli("doctor")["sourceHash"]
        )

    def test_configuration_symlink_cannot_escape_project(self):
        import tempfile

        with tempfile.TemporaryDirectory() as other:
            outside = Path(other) / "outside.json"
            outside.write_text("{}")
            (self.root / "base.json").symlink_to(outside)
            (self.root / "tsconfig.json").write_text('{"extends":"./base.json"}')
            self.assertIn(
                "configuration", self.fixture.cli("doctor", ok=False).stderr.lower()
            )

    def test_fixed_entry_lowers_many_modules_in_one_prelink_build(self):
        for index in range(12):
            (self.root / f"src/part{index}.ts").write_text(
                f"export const value{index} = __STATE_BUILD_BASELINE__ ? 0 : {index};"
            )
        (self.root / "src/main.ts").write_text(
            "\n".join(f"import {{value{i}}} from './part{i}';" for i in range(12))
            + "\nexport const run=()=>"
            + "+".join(f"value{i}" for i in range(12))
            + ";"
        )
        plan = self.fixture.cli("build")
        self.assertEqual(self.run_output(), 66)
        self.assertEqual(plan["prelink"]["builds"], 1)
        self.assertGreaterEqual(plan["prelink"]["files"], 13)
        self.assertGreaterEqual(plan["prelink"]["pathResolutions"], 13)
        self.assertLessEqual(plan["prelink"]["pathResolutions"], 14)

    def test_path_alias_cannot_bypass_browser_source_boundary(self):
        (self.root / "src/browser").mkdir()
        (self.root / "src/browser/main.ts").write_text(
            "import value from '@server';export const run=()=>value;"
        )
        (self.root / "src/server.ts").write_text('export default "server-only";')
        (self.root / "tsconfig.json").write_text(
            '{"compilerOptions":{"baseUrl":".","paths":{"@server":["src/server.ts"]}}}'
        )
        self.config.update(entry="src/browser/main.ts", browserRoot="src/browser")
        self.fixture.save()
        self.assertIn("browserRoot", self.fixture.cli("build", ok=False).stderr)

    def test_json_alias_cannot_embed_nonbrowser_data(self):
        (self.root / "src/browser").mkdir()
        (self.root / "src/browser/main.ts").write_text(
            "import value from '@private';export const run=()=>value;"
        )
        (self.root / "private.json").write_text('{"private":"fixture-only"}')
        (self.root / "tsconfig.json").write_text(
            '{"compilerOptions":{"baseUrl":".","paths":{"@private":["private.json"]}}}'
        )
        self.config.update(entry="src/browser/main.ts", browserRoot="src/browser")
        self.fixture.save()
        self.assertIn("browserRoot", self.fixture.cli("build", ok=False).stderr)

    def _browser_fixture(self, main):
        (self.root / "src/browser").mkdir()
        (self.root / "src/browser/main.ts").write_text(main)
        self.config.update(entry="src/browser/main.ts", browserRoot="src/browser")

    def test_alias_into_nonbrowser_node_modules_directory_is_rejected(self):
        # A `node_modules` segment under the source tree is author code, not a dependency.
        target = self.root / "src/node_modules/local-only"
        target.mkdir(parents=True)
        (target / "server.ts").write_text(
            'export default "synthetic-outside-browser-boundary";'
        )
        self._browser_fixture("import value from '@server';export const run=()=>value;")
        (self.root / "tsconfig.json").write_text(
            '{"compilerOptions":{"baseUrl":".","paths":{"@server":["src/node_modules/local-only/server.ts"]}}}'
        )
        self.fixture.save()
        self.assertIn("browserRoot", self.fixture.cli("build", ok=False).stderr)

    def test_json_alias_into_nonbrowser_node_modules_directory_is_rejected(self):
        target = self.root / "src/node_modules/local-only"
        target.mkdir(parents=True)
        (target / "data.json").write_text('{"v":"synthetic-outside-browser-boundary"}')
        self._browser_fixture("import value from '@data';export const run=()=>value;")
        (self.root / "tsconfig.json").write_text(
            '{"compilerOptions":{"baseUrl":".","paths":{"@data":["src/node_modules/local-only/data.json"]}}}'
        )
        self.fixture.save()
        self.assertIn("browserRoot", self.fixture.cli("build", ok=False).stderr)

    def test_baseurl_bare_import_of_nonbrowser_node_modules_directory_is_rejected(self):
        target = self.root / "src/node_modules/local-only"
        target.mkdir(parents=True)
        (target / "server.ts").write_text(
            'export default "synthetic-outside-browser-boundary";'
        )
        self._browser_fixture(
            "import value from 'node_modules/local-only/server';export const run=()=>value;"
        )
        (self.root / "tsconfig.json").write_text(
            '{"compilerOptions":{"baseUrl":"src"}}'
        )
        self.fixture.save()
        self.assertIn("browserRoot", self.fixture.cli("build", ok=False).stderr)

    def test_symlink_into_nonbrowser_node_modules_directory_is_rejected(self):
        target = self.root / "src/node_modules/local-only"
        target.mkdir(parents=True)
        (target / "server.ts").write_text(
            'export default "synthetic-outside-browser-boundary";'
        )
        self._browser_fixture("import value from './link';export const run=()=>value;")
        (self.root / "src/browser/link.ts").symlink_to(target / "server.ts")
        self.fixture.save()
        self.assertIn("browserRoot", self.fixture.cli("build", ok=False).stderr)

    def test_alias_to_symlink_into_nonbrowser_node_modules_directory_is_rejected(self):
        # The alias skips onResolve's relative checks; only the loaded real path is validated.
        target = self.root / "src/node_modules/local-only"
        target.mkdir(parents=True)
        (target / "server.ts").write_text(
            'export default "synthetic-outside-browser-boundary";'
        )
        (self.root / "src/links").mkdir()
        (self.root / "src/links/server.ts").symlink_to(target / "server.ts")
        self._browser_fixture("import value from '@link';export const run=()=>value;")
        (self.root / "tsconfig.json").write_text(
            '{"compilerOptions":{"baseUrl":".","paths":{"@link":["src/links/server.ts"]}}}'
        )
        self.fixture.save()
        self.assertIn("browserRoot", self.fixture.cli("build", ok=False).stderr)

    def _relocate_project(self, *parts):
        """Move the project under a nested directory of its own temp directory.

        The destination must stay inside the original TemporaryDirectory so tearDown still
        removes it, and a directory cannot be renamed into its own subtree, hence the copy.
        """
        nested = self.root.joinpath(*parts)
        staging = self.root.parent / (self.root.name + "-moved")
        shutil.copytree(self.root, staging, symlinks=True)
        shutil.rmtree(self.root)
        self.root.mkdir()
        nested.parent.mkdir(parents=True)
        shutil.move(staging, nested)
        self.fixture.root = self.root = nested
        return nested

    def test_rejected_alias_keeps_previous_output(self):
        self._browser_fixture("export const run=()=>'ok';")
        self.fixture.save()
        self.fixture.cli("build")
        before = (self.root / "out/app.js").read_bytes()
        target = self.root / "src/node_modules/local-only"
        target.mkdir(parents=True)
        (target / "server.ts").write_text('export default "synthetic-outside";')
        (self.root / "src/browser/main.ts").write_text(
            "import value from '@server';export const run=()=>value;"
        )
        (self.root / "tsconfig.json").write_text(
            '{"compilerOptions":{"baseUrl":".","paths":{"@server":["src/node_modules/local-only/server.ts"]}}}'
        )
        result = self.fixture.cli("build", ok=False)
        self.assertIn("browserRoot", result.stderr)
        self.assertEqual(before, (self.root / "out/app.js").read_bytes())

    def test_root_node_modules_package_with_transitive_relative_imports_is_allowed(
        self,
    ):
        package = self.root / "node_modules/legal-package"
        (package / "lib").mkdir(parents=True)
        (package / "package.json").write_text(
            '{"name":"legal-package","version":"1.0.0","type":"module","main":"index.js"}'
        )
        (package / "index.js").write_text(
            "import {inner} from './lib/inner.js';export default inner;"
        )
        (package / "lib/inner.js").write_text(
            'export const inner = "legal-package-value";'
        )
        self._browser_fixture(
            "import value from 'legal-package';export const run=()=>value;"
        )
        self.fixture.save()
        self.fixture.cli("build")
        self.assertIn("legal-package-value", (self.root / "out/app.js").read_text())

    def test_hoisted_ancestor_node_modules_package_is_allowed(self):
        project = self._relocate_project("workspace", "packages", "app")
        package = project.parents[1] / "node_modules/hoisted-package"
        package.mkdir(parents=True)
        (package / "package.json").write_text(
            '{"name":"hoisted-package","version":"1.0.0","type":"module","main":"index.js"}'
        )
        (package / "index.js").write_text('export default "hoisted-package-value";')
        self._browser_fixture(
            "import value from 'hoisted-package';export const run=()=>value;"
        )
        self.fixture.save()
        self.fixture.cli("build")
        self.assertIn("hoisted-package-value", (project / "out/app.js").read_text())

    def test_installed_package_cannot_reach_authored_source_when_root_is_under_node_modules(
        self,
    ):
        # Under a node_modules project root the old first-segment owner test made every
        # authored file look like a dependency. A package reaching back into src/ must be checked.
        project = self._relocate_project("node_modules", "installed-app")
        (project / "src/server").mkdir()
        (project / "src/server/secret.js").write_text(
            'export default "synthetic-outside-browser-boundary";'
        )
        package = project / "node_modules/reach-back"
        package.mkdir(parents=True)
        (package / "package.json").write_text(
            '{"name":"reach-back","version":"1.0.0","type":"module","main":"index.js"}'
        )
        (package / "index.js").write_text(
            "import secret from '../../src/server/secret.js';export default secret;"
        )
        self._browser_fixture(
            "import value from 'reach-back';export const run=()=>value;"
        )
        self.fixture.save()
        self.assertIn("browserRoot", self.fixture.cli("build", ok=False).stderr)
        self.assertFalse((project / "out/app.js").exists())

    def test_effective_native_bundler_is_part_of_toolchain_identity(self):
        plan = self.fixture.cli("doctor")
        inputs = plan["compilerInputs"]["toolchain"]
        self.assertTrue(
            any(
                entry["module"].startswith("@esbuild/") and len(entry["sha256"]) == 64
                for entry in inputs
            )
        )

    def test_ambient_bundler_override_is_rejected_before_execution(self):
        import os

        original = dict(os.environ)
        try:
            os.environ["ESBUILD_BINARY_PATH"] = "/nonexistent/not-an-authorized-bundler"
            result = self.fixture.cli("doctor", ok=False)
            self.assertIn("ESBUILD_BINARY_PATH", result.stderr)
        finally:
            os.environ.clear()
            os.environ.update(original)

    def test_baseline_and_qualified_candidate_share_one_prelink_pass(self):
        probe = test_cli.CompilerContracts()
        probe.setUp()
        try:
            probe.config["buildConstants"] = {"__STATE_BUILD_BASELINE__": False}
            probe.save()
            probe.profile()
            result = probe.cli("build", "--profile", str(probe.root / "profile.json"))
            self.assertEqual(result["decisions"][0]["selected"], "fast")
            self.assertEqual(result["prelink"]["builds"], 1)
            self.assertEqual(result["prelink"]["linkBuilds"], 2)
            self.assertEqual(result["prelink"]["reusedByLinks"], True)
        finally:
            probe.tearDown()


if __name__ == "__main__":
    unittest.main()
