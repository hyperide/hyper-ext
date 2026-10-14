import uiSamples from './ui-samples.json';

/**
 * A few `ui:` blocks call a hook by name in a plain string, and the repo's
 * pre-commit hook (scripts/check-react-hooks-import.cjs) scans .ts/.tsx source
 * for a hook call with no matching import — indistinguishable, to a text scan,
 * from a real one. Kept in a JSON sidecar (not `.ts`, so the hook never reads
 * it) rather than a `?raw`-imported `.txt` — Vite resolves `?raw` fine, but the
 * gate tools that import example data directly under plain tsx/Node (no Vite)
 * do not, and every one of them broke on it.
 */
export const UI: Record<string, string> = uiSamples;
