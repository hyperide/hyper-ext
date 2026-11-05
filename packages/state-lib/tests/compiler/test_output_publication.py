"""I/O faults must never publish new JS with an old manifest/source map."""

import argparse
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

import test_cli

spec = importlib.util.spec_from_file_location(
    "state_cli_publication_test", test_cli.ROOT / "cli/state_cli/main.py"
)
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


class OutputPublicationContracts(unittest.TestCase):
    def setUp(self):
        self.fixture = test_cli.CompilerContracts()
        self.fixture.setUp()
        self.fixture.cli("build")
        self.out = self.fixture.root / "out"
        self.previous = {p.name: p.read_bytes() for p in self.out.iterdir()}
        (self.fixture.root / "src/baseline.ts").write_text(
            "export const calc=(n:number)=>n*3;"
        )
        self.args = argparse.Namespace(
            command="build",
            config=str(self.fixture.root / "state.config.json"),
            profile=None,
            mode="auto",
            require_improvement=False,
        )

    def tearDown(self):
        self.fixture.tearDown()

    def unchanged(self):
        self.assertEqual(
            {p.name: p.read_bytes() for p in self.out.iterdir()}, self.previous
        )

    def test_staged_map_write_failure_keeps_the_whole_previous_generation(self):
        original = cli.os.replace

        def replace(source, target):
            if Path(target).name == "app.js.map":
                raise OSError("synthetic disk full")
            return original(source, target)

        with (
            patch.object(cli.os, "replace", side_effect=replace),
            self.assertRaisesRegex(OSError, "synthetic disk full"),
        ):
            cli.build(self.args)
        self.unchanged()

    def test_failed_directory_publication_restores_the_previous_generation(self):
        original = cli.os.replace

        def replace(source, target):
            if Path(source).name == "next" and Path(target) == self.out:
                raise OSError("synthetic rename failure")
            return original(source, target)

        with (
            patch.object(cli.os, "replace", side_effect=replace),
            self.assertRaisesRegex(OSError, "synthetic rename failure"),
        ):
            cli.build(self.args)
        self.unchanged()

    def test_failed_restore_keeps_the_recovery_copy_and_names_it(self):
        original = cli.os.replace

        def replace(source, target):
            if Path(source).name in ("next", "previous") and Path(target) == self.out:
                raise OSError("synthetic repeated rename failure")
            return original(source, target)

        with (
            patch.object(cli.os, "replace", side_effect=replace),
            self.assertRaisesRegex(OSError, "preserved") as error,
        ):
            cli.build(self.args)
        candidates = list(self.out.parent.glob(".state-publish-*/previous"))
        self.assertEqual(len(candidates), 1)
        self.assertIn(str(candidates[0]), str(error.exception))
        self.assertEqual(
            {p.name: p.read_bytes() for p in candidates[0].iterdir()}, self.previous
        )

    def test_post_commit_cleanup_failure_does_not_report_a_failed_build(self):
        with patch.object(
            cli.shutil, "rmtree", side_effect=OSError("synthetic cleanup failure")
        ):
            result = cli.build(self.args)
        self.assertEqual(result["phase"], "emitted-and-size-checked")
        self.assertNotEqual((self.out / "app.js").read_bytes(), self.previous["app.js"])
        self.assertFalse(
            (self.out.parent / ("." + self.out.name + ".state-publish.lock")).exists()
        )

    def test_unowned_file_in_a_marked_output_is_not_deleted(self):
        (self.out / "keep.txt").write_text("keep caller data")
        with self.assertRaisesRegex(ValueError, "unowned"):
            cli.build(self.args)
        self.assertEqual((self.out / "keep.txt").read_text(), "keep caller data")
        for name, value in self.previous.items():
            self.assertEqual((self.out / name).read_bytes(), value)

    def test_directory_at_a_generated_file_name_is_not_deleted(self):
        (self.out / "app.js").unlink()
        (self.out / "app.js").mkdir()
        (self.out / "app.js/keep.txt").write_text("keep caller data")
        with self.assertRaisesRegex(ValueError, "unowned"):
            cli.build(self.args)
        self.assertEqual(
            (self.out / "app.js/keep.txt").read_text(), "keep caller data"
        )

    def test_concurrent_publication_lock_preserves_existing_generation(self):
        lock = self.out.parent / ("." + self.out.name + ".state-publish.lock")
        lock.write_text("owned by another builder")
        with self.assertRaisesRegex(OSError, "Another publication"):
            cli.build(self.args)
        self.unchanged()
        self.assertEqual(lock.read_text(), "owned by another builder")

    def test_lock_cleanup_failure_reports_committed_output_and_names_the_lock(self):
        original = cli.Path.unlink

        def unlink(path, *args, **kwargs):
            if path.name.endswith(".state-publish.lock"):
                raise OSError("synthetic lock cleanup failure")
            return original(path, *args, **kwargs)

        import io
        import json
        from contextlib import redirect_stderr

        warnings = io.StringIO()
        with patch.object(cli.Path, "unlink", new=unlink), redirect_stderr(warnings):
            result = cli.build(self.args)
        warning = json.loads(warnings.getvalue())
        self.assertEqual(warning["warning"], "Publication lock cleanup required")
        self.assertEqual(
            warning["path"], str(self.out.parent / ".out.state-publish.lock")
        )
        self.assertEqual(result["phase"], "emitted-and-size-checked")
        self.assertNotEqual((self.out / "app.js").read_bytes(), self.previous["app.js"])
        with self.assertRaisesRegex(OSError, "Another publication"):
            cli.build(self.args)

    def test_lock_cleanup_cannot_mask_the_original_failed_installation(self):
        import io
        import json
        from contextlib import redirect_stderr

        original_replace = cli.os.replace
        original_unlink = cli.Path.unlink

        def replace(source, target):
            if Path(source).name == "next" and Path(target) == self.out:
                raise OSError("synthetic original installation failure")
            return original_replace(source, target)

        def unlink(path, *args, **kwargs):
            if path.name.endswith(".state-publish.lock"):
                raise OSError("synthetic subsequent lock cleanup failure")
            return original_unlink(path, *args, **kwargs)

        warnings = io.StringIO()
        with (
            patch.object(cli.os, "replace", new=replace),
            patch.object(cli.Path, "unlink", new=unlink),
            redirect_stderr(warnings),
            self.assertRaisesRegex(OSError, "original installation failure"),
        ):
            cli.build(self.args)
        self.unchanged()
        self.assertEqual(
            json.loads(warnings.getvalue())["warning"],
            "Publication lock cleanup required",
        )

    def test_source_inventory_is_walked_only_for_initial_and_final_identity(self):
        original = cli.Path.rglob
        walks = []

        def rglob(path, pattern):
            if path == self.fixture.root / "src":
                walks.append(pattern)
            return original(path, pattern)

        with patch.object(cli.Path, "rglob", new=rglob):
            cli.build(self.args)
        self.assertEqual(walks, ["*", "*"])


if __name__ == "__main__":
    unittest.main()
