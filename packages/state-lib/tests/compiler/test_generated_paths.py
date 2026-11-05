"""Generated ownership follows the resolved module identity used by bundling."""

import json
import unittest
import test_generated


class GeneratedCanonicalPathContracts(unittest.TestCase):
    def setUp(self):
        self.fixture = test_generated.GeneratedProjectionContracts()
        self.fixture.setUp()

    def tearDown(self):
        self.fixture.tearDown()

    def add_variant(self, entry):
        variants = self.fixture.config["units"][0]["variants"]
        candidate = json.loads(json.dumps(variants[0]))
        candidate.update(id="other", entry=entry)
        candidate["generate"]["fields"] = ["text"]
        variants[:] = [variants[0], candidate]
        self.fixture.fixture.save()

    def assert_collision(self):
        for command in ["doctor", "build"]:
            with self.subTest(command=command):
                result = self.fixture.cli(command, ok=False)
                self.assertIn("generated path collides", result.stderr)

    def test_dot_and_parent_aliases_cannot_share_generated_destination(self):
        for entry in [
            "src/generated/./project.mjs",
            "src/generated/../generated/project.mjs",
        ]:
            with self.subTest(entry=entry):
                self.add_variant(entry)
                self.assert_collision()

    def test_in_root_symlink_cannot_alias_another_generated_destination(self):
        source = self.fixture.root / "src"
        (source / "generated").mkdir()
        (source / "alias").symlink_to(source / "generated", target_is_directory=True)
        self.add_variant("src/alias/project.mjs")
        self.assert_collision()

    def test_distinct_generated_destinations_remain_supported(self):
        self.add_variant("src/generated/other.mjs")
        plan = self.fixture.cli("doctor")
        modules = plan["generatedModules"]
        self.assertEqual(len(modules), 2)
        paths = {(self.fixture.root / item["path"]).resolve() for item in modules}
        self.assertEqual(len(paths), 2)
        self.assertIn('["id"]', modules[0]["content"])
        self.assertIn('["text"]', modules[1]["content"])

    def test_authored_roles_cannot_borrow_an_aliased_virtual_destination(self):
        units = self.fixture.config["units"]
        for role in ["baseline", "facade", "variant"]:
            with self.subTest(role=role):
                other = {
                    "id": "other",
                    "facade": "src/strategy.ts",
                    "baseline": "src/baseline.ts",
                    "timing": "sync",
                    "contract": "number-double-v1",
                    "variants": [],
                }
                (self.fixture.root / "src/other.ts").write_text(
                    'export {calc} from "./baseline.ts";'
                )
                other["facade"] = "src/other.ts"
                alias = "src/generated/../generated/project.mjs"
                if role == "variant":
                    other["variants"] = [
                        {
                            "id": "borrowed",
                            "entry": alias,
                            "executor": "js-main",
                            "contract": "number-double-v1",
                        }
                    ]
                else:
                    other[role] = alias
                units[:] = [units[0], other]
                self.fixture.fixture.save()
                for command in ["doctor", "build"]:
                    with self.subTest(command=command):
                        result = self.fixture.cli(command, ok=False)
                        self.assertIn(
                            "generated path used by an authored role", result.stderr
                        )


if __name__ == "__main__":
    unittest.main()
