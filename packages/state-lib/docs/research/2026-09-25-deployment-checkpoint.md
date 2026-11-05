# Continuation — isolated measurement database and checked preview

Base: `2f14dd814b7a91e833938484820fafe181cdeae8`, branch `feat/state-research-journal-HYP-1504`.
Approved scope: finish the independent state-lib preview and shared measurements after the owner completed Neon CLI authorization. Do not alter production or either original application baseline.

## Verified preflight

- Neon CLI authentication works with organization `org-sparkling-cloud-89564254`; explicit organization selection is required in non-interactive commands.
- The Neon connector still omits required `project_id` from its schema; its describe call returns validation error. Use the authorized CLI, not guessed connector arguments.
- Created one new empty project `spring-violet-51209151` (`state-lib-measurements`, PostgreSQL17, aws-us-east-1, 0.25 CU). Default branch `br-falling-scene-awp7fij1`. Existing projects/databases were not modified.
- Existing Vercel project: `prj_gEbM8LufIipHdykRB8vWLvMAReaF`, team `team_lKA0l5FGJudwmRlkdeF1h4VD`. Preview environment currently has no variables.
- The last deployment failed before readiness because pg dependencies were missing from the prebuilt function. The uncommitted package-server scripts are the continuation point; do not recreate the completed compiler/REPL.
- Tracker identity warning: current tasks backend HYP-1492 is an unrelated vector ticket. The previous measurement issue is Linear UUID `3ba17406-c416-495d-9c3b-bcd722c8afc9`; resolve by backend + UUID + title before updating.

## Next gates

1. Install schema only in the new empty measurement database; use a least-privileged service role and verify access. Never log credentials or put them in source.
2. Set preview-branch-only Vercel secret/config variables; keep production unchanged.
3. Wire self-contained server packaging into checked deployment, verify an isolated-copy import, review and commit with ordinary hooks.
4. Publish and exercise both REPLs and actual opt-in measurement POST/readback from a browser. Record deployment identity and exact source.
5. Resume the explicit Boards reset/resource and Tasks lifecycle review findings before publishing either migration branch.

No completed application migration, remote application staging or cloud dataset acceptance is claimed by this checkpoint.

## Provisioning and packaging completed

- The new database schema exists and service role `state_measurements_service` successfully connects and reads. Verified INSERT permitted, DELETE and schema CREATE denied; the database had zero measurement rows.
- Ruling: use preview-only environment variables rather than branch-specific ones. This Vercel project has no connected Git repository; its CLI rejects branch-targeted variables. Production variables/aliases are unchanged, and the explicit allowed Origin is the new `https://state-lib-lab.vercel.app` alias.
- All three measurement variables are saved through authorized Vercel stdin input; no credentials are written to source or evidence. TLS is explicitly `verify-full` for the service connection.
- The deployment wiring regression failed before the change, then passed. Packaging copied13 JavaScript dependency instances; importing the handler from an isolated temporary directory works and responds503 without configuration. The temporary test copy is removed after the check.
- Remaining gate: normal review/commit, checked preview deployment, new lab alias and real browser POST/readback. Provisioning alone does not establish hosted acceptance.
