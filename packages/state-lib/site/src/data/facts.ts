import specMd from '../content/spec.md?raw';
import requirementsMd from '../content/requirements.md?raw';
import decisionsMd from '../content/decisions.md?raw';
import * as protoSrcModule from '../lib/proto.ts?raw';
const protoSrc = protoSrcModule.default;

/**
 * Every number and version string the site quotes about itself is derived here,
 * from the source it describes, so it cannot drift (R64). Nothing in this file
 * is written by hand; if a fact needs updating, update the document.
 */

/** "v0.6" — read from the spec's own status line, not typed twice. */
export const SPEC_VERSION = specMd.match(/\*\*Status:\*\*\s*draft\s*(v[\d.]+)/)?.[1] ?? 'v?';

/** Highest requirement id defined in REQUIREMENTS.md. */
export const REQ_IDS = [...requirementsMd.matchAll(/^- \*\*(R\d+)/gm)].map((m) => m[1]);
export const REQ_COUNT = new Set(REQ_IDS).size;
export const REQ_MAX = Math.max(...REQ_IDS.map((r) => Number(r.slice(1))));

/** Rows in the decisions table. */
export const DECISION_COUNT = [...decisionsMd.matchAll(/^\|\s*\d+\s*\|/gm)].length;

/** Size of the prototype the Playground runs, rounded down to the nearest 50. */
export const PROTO_LINES = Math.floor(protoSrc.split('\n').length / 50) * 50;

/** Numbered sections in the spec, as a rough measure of its depth. */
export const SPEC_SECTIONS = [...specMd.matchAll(/^#{2,3} \d/gm)].length;
