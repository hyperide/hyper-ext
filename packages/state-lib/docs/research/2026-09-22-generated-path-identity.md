# Generated module identity: canonical paths, not spelling

**Date:** 2026-09-22. **Issue:** HYP-1487. This is a compiler correctness correction, not a new runtime performance measurement.

## Reproduction and consequence

The existing native projection fixture accepted two generating variants named `src/generated/project.mjs` and `src/generated/../generated/project.mjs`. A real `state doctor` invocation returned two generated modules with one resolved destination. A dot-segment spelling and a directory symlink contained inside the source root produced the same result.

Validation tracked the raw configuration string, while the emit layer keyed generated content by the resolved filesystem path. The later entry could therefore replace the earlier candidate's body. Different spelling is not different ownership, and a qualified variant must not silently execute another variant's implementation.

## Correction

The Python request validator now stores resolved destinations in its generated-owner set. Collision checks and authored-role checks use the same identity. Existing source-root containment, existing-file rejection, source inventory checks and the native syntax parser are unchanged. No filesystem permissions, hooks, source roots or allowed directories were widened.

The generated modules remain virtual: the fix does not create implementation files in the application's source tree. Two genuinely distinct destinations continue to return their separately generated field projections.

## Verification

The new `tests/compiler/test_generated_paths.py` first reproduced six negative subcases: doctor and build each accepted dot-segment, parent-segment and in-root symlink collisions. Those expectations now pass. A positive case verifies two distinct virtual modules and their different generated bodies. The new module runs four tests; the original 11 generator contracts and 18 CLI contracts also pass, for 33 distinct compiler tests.

The command `python3 tests/compiler/test_generated_paths.py` reproduces the new contract. Run `python3 tests/compiler/test_generated.py` and `python3 tests/compiler/test_cli.py` for the unchanged earlier suite. No previous expectation was weakened. Review added six authored-role alias checks: baseline, facade and ordinary variant, each through doctor and build. They assert the specific generated-ownership error, not merely any failure.

`cli/state_cli/main.py` already participates in the compiler source fingerprint. This correction therefore invalidates profiles built against the old implementation; it does not attach old timings to new source. The historical 20 September dataset remains an observation of that revision. The 13-of-21 COW timing result still does not authorize global COW promotion.

## Next boundary

Generated immutable point/dense updates and a shared publication interface remain separate work. This correction strengthens the identity boundary they must use; it does not claim to generate those commands, prove complete race freedom or establish a worst-case performance theorem.
