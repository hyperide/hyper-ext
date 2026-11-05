# Same-origin measurement sharing

Date: 2026-09-26. Related issue: HYP-1492, verified by title in both the current task CLI and Linear. The older checkpoint's HYP-1516 identifier now resolves to an unrelated task, so it is not used for this update.

The isolated lab already has a working PostgreSQL function and dedicated Neon database. Its protected deployment requires the visitor's session on same-origin requests. The client explicitly set `credentials: 'omit'`, suppressing that session even though the endpoint was the relative `/api/measurements` URL.

A focused test bundles the actual exported client function and verifies its request at the network boundary. It first failed with `omit` instead of `same-origin`. The one-line correction keeps credentials restricted to this origin; it does not attach them to arbitrary hosts or modify deployment protection. Explicit sharing, refusal of divergent comparisons, server exact-Origin validation, request limits and visitor-data classification are unchanged.

The test also verifies that failed submission leaves the local-run recovery message intact. It is loaded by the regular site gate inventory. All 87 site gates passed after the change. The isolated PostgreSQL test script created and stopped its private Unix-socket-only cluster; 11 tests passed, including persisted readback on a new connection, repeat counting and retention of slower observations. No project database was used by that suite.

This correction is linked to [observation storage](/spec#benchmark-observation-storage). It is transport/session behavior, not a new performance measurement. A complete hosted UI Share/POST/GET check remains required after deployment; local tests alone are not that acceptance.

Read-only review found no production correctness/security blocker. The test also covers native network rejection and verifies the local result is not mutated; a 503 response and an offline rejection are tested as distinct failure paths.

## Hosted acceptance completed

The corrected source is `5da0e8350327bf8fd6089a57ae1dde82f36e9942`. The normal deployment script reran all 87 site gates, packaged and self-tested the standalone server function, and published READY deployment `dpl_8Qj3tUYzpnEFruuNSK4d1pQdCzmn`. The isolated `state-lib-lab.vercel.app` alias now points to it; the production domain was not promoted or changed.

An authorized fresh browser context compiled and ran both multi-file projects, clicked their actual Share buttons, verified successful PostgreSQL writes, repeated the exact results, and read their unchanged samples back by example/source. Repeats retained the record ID and increased the observation count. A separate genuine 300-row dense run then produced a distinct stored record while the prior 30-row move remained retrievable. These are visitor observations, not trusted compiler qualification inputs.

Hosted negative requests returned 403 for the wrong Origin, 403 for an absent Origin, and 400 for invalid measurements. No deployment protection or API guard was relaxed. Desktop/mobile screenshots were inspected; the 390px page had no document overflow or page exceptions. Raw measurements and exact identities are in [the verification record](2026-09-26-hosted-lab-verification.json); access tokens and cookies are not stored there.

The user-restored Neon authorization is working. The four application-comparison databases remain a separate unfinished staging task: a new service-role provisioning file was interrupted by a tool safety denial while being prepared and was parked as `.pending`, without execution or account changes. That is not another authentication failure. The earlier incomplete provisioning file and existing app data are untouched.
