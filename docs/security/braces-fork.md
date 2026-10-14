# Braces security fork

Part of [HYP-1687](https://tasks-ultrabricks.vercel.app/issues/b71e3a11-6b4e-4e15-bddc-1ee46c5fd068).

The root override pins `braces` to **`npm:@zklogic/braces@3.0.7`**, an independent
MIT-licensed fork maintained by Arfan Khalil Mughal (`arfanmirza` on npm), not an
official micromatch release. The exact pin deliberately limits trust to the audited
artifact; any update requires another source and compatibility review.

## Source and trust

- [Release source](https://github.com/ArfanKhalilMughal/braces/tree/77ed7dda9f3f6c9aa22798a36acfc5b544506717)
  matches `v3.0.7`, npm `gitHead`, and every file in the ten-file npm tarball.
- [Upstream PR 79](https://github.com/micromatch/braces/pull/79) describes the depth
  guard. It was open and unmerged when checked on 2026-10-14.
- The tarball's SHA-512 matches npm integrity and the lockfile. Both registry
  signatures verify against npm's HTTPS-served signing keys. The SLSA subject,
  source commit, workflow tag and DSSE payload signature also match. Full Sigstore
  certificate-chain and transparency-log policy validation was not performed.
- There are no install/lifecycle scripts. The sole runtime dependency remains
  `fill-range ^7.1.1`. The fork adds a maintainer and publishing-account trust
  boundary; provenance identifies the artifact's origin, not its safety.

Audited tarball SHA-256:
`a707d83150885287eacb2b378a7ffc034fe3698df76ab1d0d62d43d98d9c3491`.
The exact SHA-512 integrity is retained in `bun.lock`; raw metadata, signature
verification and file-by-file hashes are in the HYP-1687 security evidence.

## Runtime audit and compatibility

All seven JavaScript files were read and compared against upstream 3.0.3.
`index.js`, `compile.js`, `expand.js`, `stringify.js`, and `utils.js` are byte-identical.
`constants.js` adds `MAX_DEPTH = 256`; `parse.js` bounds brace/parenthesis nesting
and preserves deeper text literally. Invalid, negative, infinite and excessively
large `maxDepth` options cannot increase the cap. Parser-produced ASTs therefore
remain bounded for all three recursive walkers.

The parser also contains two changes beyond the security guard: unmatched quotes
are preserved instead of consuming the rest of the pattern as quoted text, and
a comma clears an invalid range flag. For example, `'{a,b}` expands to `["'a", "'b"]`
(each value starts with a literal apostrophe), and `{1..2..3..4,x}` expands to
`1..2..3..4` and `x`. These are deliberate differences from 3.0.3, not evidence
of strict equivalence for malformed syntax.

The retained Node subprocess regression fails on upstream with stack exhaustion
and passes on this fork. It exercises deeply nested braces, parentheses, mixed
and escaped patterns, unclosed patterns, malicious depth options, parsed ASTs,
lower depth limits, and normal length/range limits. A deterministic corpus of
1,820 pattern/option pairs produced 5,460 identical compile/expand/stringify
results. Real micromatch matching, chokidar glob watching and Tailwind content
compilation also pass. Tests live under `server/**/__tests__`, which the root
workspace runner includes.

The corpus generator lives in `server/lib/__tests__/fixtures/braces-security.cjs`;
`braces-compatibility.json` beside it retains the upstream 3.0.3 expected results.
The root test compares all 1,820 rows, rather than relying on an external evidence
file or fetching upstream during CI. Resolution follows Tailwind's fast-glob and
micromatch dependencies to exercise the installed consumer copy.

## Security boundary

This addresses string-pattern stack exhaustion in
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
It does not make arbitrary caller-built or cyclic AST objects safe: passing a
hand-built 10,000-level AST directly to a walker still overflows. Consumers here
pass strings or ASTs produced by the bounded parser. Do not accept external ASTs.
The inherited `maxLength: NaN` behavior can disable the string-length check;
options must be application-controlled. The depth cap still holds in that case.
Combinatorial expansion and regular-expression complexity are separate limits;
this fork is not a universal resource-budget mechanism.

A fresh root `bun audit --audit-level=high` on 2026-10-14 exits zero with **zero
high/critical findings**, and 41 findings below that threshold. No advisory
suppression is used. Independent security review and integration gates remain
required; the scanner result alone does not establish the fork's safety.
