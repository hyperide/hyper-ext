/**
 * @file Error type for the "New component" flow (HYP-1184).
 *
 * Hosts (SaaS route, extension host) distinguish CreateComponentUserError —
 * whose message is plain-language and SAFE to surface verbatim in the dialog —
 * from unexpected fs/system errors, which must map to a generic server error
 * (their messages embed absolute server paths).
 */
export class CreateComponentUserError extends Error {}
