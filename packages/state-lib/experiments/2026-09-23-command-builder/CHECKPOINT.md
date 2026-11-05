# Published command-builder checkpoint — 23 September 2026

Canonical implementation commit: `dbdfc07d0b25fa12f6f395305a25d88b6b838052`, branch `research/state-build-20260918`, PR802. The push succeeded; a subsequent SSH readback failed authentication, so the remote HEAD was independently verified through the authorized GitHub connector. No credentials or permissions were changed.

Boards adoption: `9ebf080da4cdb96deb13b80f5faf5775850be67a`, branch `research/state-cow-HYP-1500`, PR10. Remote HEAD and PR body were verified. Both helper copies are byte-identical and pinned to the canonical source. The default backend is unchanged; declared commands are available through the research controller's apply API, not automatically substituted into every UI callback.

All47 Node COW/command tests,6 canonical-Runtime publication tests,44 compiler tests,125 ordinary app tests,19 original COW adapter contracts and6 Chromium/WebKit lifecycle combinations passed. Root types, Ruff, clippy, knip and normal Git hooks passed. Code review completed for both branches.

Final recorded Node run:2520 cross-backend comparisons;42/42 better medians;26/42 strict max/min cells pass. Chromium/Firefox/WebKit each checked1260 outcomes; tiny browser timings include genuine adverse/inconclusive cases and clock-resolution zeros. Therefore automatic admission remains reference-selected. Full entry catalogues at1/16/128/512commands decrease raw/gzip/Brotli bytes after extracting shared publication. Both variants expose the same command-publication/history API. Earlier larger dual-lab entry results remain in raw-results.zip.

Review findings were checked rather than blindly applied. Own **proto** data fields are already present after spread, so writes do not call the inherited prototype setter; scalar and nested checks passed. Aliased array moves preserve sharing; copyJsonRoot on a graph creates a new clone. A pure command may intentionally return another owned JSON value (including an owned subtree): ownership is not application-schema validation. dispose must set closed after Runtime.dispose succeeds so rejected cleanup during notifications stays retryable. Tests were not weakened.
