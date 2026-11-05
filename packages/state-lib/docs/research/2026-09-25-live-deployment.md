# Live example lab: deployed database connection

Date: 2026-09-25. Source: `9711bc85` on `feat/state-research-journal-HYP-1504`. Existing measurement task: tasks backend HYP-1516, title verified before update. This checkpoint records completed operations separately from planned acceptance.

## Verified deployment

The self-contained PostgreSQL function package passed isolated import verification and the entire86-gate site check. Deployment `dpl_4vrBgwavz2ZcH7XnbEQWq82MS7TR`, `https://state-ir3mtfayb-inventorems-projects.vercel.app`, is Ready. The dedicated lab alias `https://state-lib-lab.vercel.app` now resolves to that deployment. Its previous deployment was inspected before replacement. Production `state-lib.vercel.app` was not changed.

The first check run stopped at a30-second local navigation timeout in site-feedback; an unchanged focused rerun passed, then the full unchanged86-gate rerun passed. No timeout or assertion was weakened and no red gate was skipped.

Both deployed REPL projects were loaded, compiled with the actual browser compiler, executed and measured in an authenticated browser. Their comparison states matched. The cloud function successfully read the dedicated Neon database and returned the visitor-record response. The browser check deliberately did not send measurement POST requests.

Automated share-link generation returned links that redirected a fresh browser to Vercel login. Do not advertise those as proven no-login links. The verification used the documented Vercel CLI automation authentication without changing deployment protection. Its temporary cookie jar stays outside source and is not a user download.

## Database scope and pending acceptance

Only the dedicated measurement project `spring-violet-51209151` is connected to the lab API. Its restricted service role, schema and preview-only environment were provisioned in the preceding step; successful live GET now confirms the packaged function reaches that database. Native access controls, exact Origin validation and visitor-versus-trusted data separation remain intact.

The proposed end-to-end browser share/POST verification was rejected by the tool safety check before execution; it was not retried through another transport. No actual hosted INSERT/deduplication acceptance is claimed by this checkpoint. The previously completed isolated PostgreSQL tests and permission checks do not substitute for that final hosted user action.

## Independent app comparisons

Created a new empty Neon project `billowing-flower-55177444` (`state-lib-app-comparisons`, aws-eu-central-1, PostgreSQL17,0.25CU), branch `br-dry-glitter-b1n257sq`. Four separate empty databases are reserved: boards_baseline, boards_state, tasks_baseline and tasks_state. No production database was copied or altered.

Service-role provisioning for those app databases has not executed: the proposed script continuation was denied, and the incomplete file was renamed `.pending` instead of run. These databases are infrastructure preparation, not four working application stages or complete migration acceptance. Baseline source worktrees remain unchanged.
