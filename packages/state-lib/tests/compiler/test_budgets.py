import unittest
import test_cli


class AbsoluteOutputBudgets(unittest.TestCase):
    def setUp(self):
        self.fixture = test_cli.CompilerContracts()
        self.fixture.setUp()

    def tearDown(self):
        self.fixture.tearDown()

    def test_oversized_baseline_is_not_an_absolute_budget_exemption(self):
        self.fixture.config["budgets"] = {"maxRawBytes": 1}
        self.fixture.save()
        result = self.fixture.cli("build", ok=False)
        self.assertIn("Absolute bundle budget exceeded", result.stderr)
        self.assertFalse((self.fixture.root / "out").exists())

    def test_rejected_build_keeps_previous_output_unchanged(self):
        self.fixture.cli("build")
        old = (self.fixture.root / "out/app.js").read_bytes()
        self.fixture.config["budgets"] = {"maxGzipBytes": 1}
        self.fixture.save()
        self.fixture.cli("build", ok=False)
        self.assertEqual((self.fixture.root / "out/app.js").read_bytes(), old)

    def test_all_compression_sizes_are_reported_and_exact_caps_pass(self):
        first = self.fixture.cli("build")
        sizes = first["emitted"]["selected"]
        self.assertIn("brotli", sizes)
        self.fixture.config["budgets"] = {
            "maxRawBytes": sizes["raw"],
            "maxGzipBytes": sizes["gzip"],
            "maxBrotliBytes": sizes["brotli"],
        }
        self.fixture.save()
        final = self.fixture.cli("build")
        self.assertEqual(final["emitted"]["selected"], sizes)
        self.assertEqual(final["budgetCheck"]["scope"], "emitted-entry-javascript")
        self.assertTrue(final["budgetCheck"]["passed"])

    def test_invalid_or_misspelled_limits_are_not_silently_ignored(self):
        for limits in [
            {"maxRawBytes": True},
            {"maxRawBytes": -1},
            {"maxRawBytes": 0.5},
            {"maxRawBytes": "100"},
            {"maxRawByte": 100},
            None,
            [],
        ]:
            with self.subTest(limits=limits):
                self.fixture.config["budgets"] = limits
                self.fixture.save()
                self.fixture.cli("doctor", ok=False)

    def test_brotli_limit_applies_even_when_other_limits_are_absent(self):
        self.fixture.config["budgets"] = {"maxBrotliBytes": 1}
        self.fixture.save()
        result = self.fixture.cli("build", ok=False)
        self.assertIn("brotli", result.stderr.lower())


if __name__ == "__main__":
    unittest.main()
