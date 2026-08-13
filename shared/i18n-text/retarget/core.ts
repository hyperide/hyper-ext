/**
 * @file Pure AST core of i18n key retargeting — ONE parser shared by read (scanBindings) and
 *   write (retargetBinding). No file I/O, no transport, no trust decisions: a string in, a
 *   classification or a rewritten string out.
 *
 * Accessed via: the orchestrator (write path) and the server read endpoint (scan path). Kept
 *   pure so it runs byte-identically on the Docker backend and (Phase 2) inside NodePod.
 *
 * Invariant "one parse": scanBindings and retargetBinding share the SAME recognition logic
 *   (detectI18nBinding from ../detect-i18n-binding, parsed by lib/ast/parser's recast wrapper).
 *   What scanBindings marks retargetable:true at a bindingLoc, retargetBinding locates by that
 *   loc; on a loc miss it falls back to the UNIQUE t(oldKey) in the file; multiple matches →
 *   'ambiguous-binding' (never a file-wide guess). retargetable:false ⇒ honest error code.
 *
 * Why not lib/ast/mutator: that module rewrites JSX *attributes* on JSXElements. A retarget
 *   swaps the first string-literal argument of a t(...) CallExpression. We mutate the
 *   StringLiteral in-place and splice ONLY that call's source range (spliceNodeSource), so
 *   recast preserves every other byte (HYP-575 lesson: whole-file reprint reformats siblings).
 */
import _traverse, { type NodePath } from '@babel/traverse';
import type * as t from '@babel/types';
import { parseCode, spliceNodeSource } from '../../../lib/ast/parser';
import { detectI18nBinding } from '../detect-i18n-binding';
import type { I18nLibrary } from '../types';
import type { BindingLocation, RetargetErrorCode } from './contract';

// @ts-expect-error - babel/traverse ESM/CJS interop (mirrors detect-i18n-binding.ts)
const traverse = _traverse.default || _traverse;

export interface ScanContext {
  /** Library hint forwarded to detectI18nBinding's callee-name acceptance. */
  library: I18nLibrary | null;
}

export interface ScannedBinding {
  /** The location of the t(...) call (Babel: 1-based line, 0-based column). Present iff retargetable. */
  bindingLoc?: BindingLocation;
  /** Static key when resolvable; the raw callee otherwise (diagnostics). */
  key: string | null;
  /** Resolved string value of the key, when the caller pre-resolved it. Populated by the read endpoint. */
  resolvedValue?: string | null;
  /** True only for a static-string t(key) call the write path can deterministically rewrite. */
  retargetable: boolean;
  /** Reason a binding is not retargetable (dynamic key, template, non-string id). Diagnostic only. */
  unretargetableReason?: string;
}

export interface RetargetCoreRequest {
  filePath: string;
  oldKey: string;
  newKey: string;
  bindingLoc: BindingLocation;
  library: I18nLibrary;
  namespace?: string;
}

export interface RetargetCoreResult {
  code: RetargetErrorCode;
  /** True when the source string changed (an actual rewrite, not a noop). */
  written: boolean;
  /** The (possibly unchanged) source. Equals the input on every non-ok / noop outcome. */
  source: string;
  /** The key bound at the call site after the operation. */
  resultingKey: string;
  reason?: string;
}

// SYNC: keep in lockstep with detect-i18n-binding.ts's KNOWN_CALL_NAMES. detectI18nBinding (which
// we delegate the *recognition* to) owns the authoritative set; this local copy only PRE-FILTERS
// which CallExpressions to bother classifying, so a drift here can at worst skip a call detect
// would have recognized — never recognize one detect rejects. Not exported there, so we mirror it.
const KNOWN_CALL_NAMES = new Set(['t', 'translate', 'msg', 'i18n', 'formatMessage']);

function extractCalleeName(callee: t.Expression | t.V8IntrinsicIdentifier): string | null {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return null;
}

/**
 * The ONE parser, used by both scanBindings and retargetBinding (the "one parse" invariant): the
 * recast-wrapped babel parser from lib/ast/parser. Recast wraps the same @babel/parser with the
 * same { typescript, jsx } plugins, so node `loc.start` (what bindingLoc keys on) is byte-identical
 * to what the writer sees — the scanner's loc and the writer's lookup can never diverge by parser.
 */
function parseShared(source: string): t.File | null {
  try {
    return parseCode(source);
  } catch {
    return null;
  }
}

/**
 * Read pass: enumerate every recognized i18n call in the source and classify each as
 * retargetable (static t(key)) or not. Reuses detectI18nBinding at each call's own location so
 * the capability flag is computed by the SAME logic the write path will trust.
 */
export function scanBindings(source: string, ctx: ScanContext): ScannedBinding[] {
  const ast = parseShared(source);
  if (!ast) return [];

  const out: ScannedBinding[] = [];

  traverse(ast, {
    CallExpression(path: NodePath<t.CallExpression>) {
      const loc = path.node.loc;
      if (!loc) return;
      const calleeName = extractCalleeName(path.node.callee);
      if (!calleeName || !KNOWN_CALL_NAMES.has(calleeName)) return;

      const detection = detectI18nBinding({
        source,
        filePath: '',
        location: { line: loc.start.line, column: loc.start.column },
        library: ctx.library,
      });

      // CAPABILITY ↔ LOCATE invariant (the core reason this module exists): scan must only
      // promise `retargetable:true` for a shape the write path can actually locate and rewrite.
      // detectI18nBinding recognizes MORE shapes as kind:'i18n' than the writer handles — notably
      // object-style `formatMessage({ id })` (an ObjectExpression first arg) and dynamic/template
      // keys. But retargetBinding (locateByLoc / locateByKey) only ever rewrites a first-argument
      // StringLiteral, `t('key')`-style. So a kind:'i18n' detection is the NECESSARY but not the
      // SUFFICIENT condition for retargetable — we additionally require the first arg to be the
      // string literal the writer will splice. Anything else is reported retargetable:false with
      // an honest reason, so the inspector never offers a retarget the server cannot perform.
      const firstArg = path.node.arguments[0];
      const writable = detection.kind === 'i18n' && firstArg?.type === 'StringLiteral';

      if (writable) {
        out.push({
          bindingLoc: { line: loc.start.line, column: loc.start.column },
          key: detection.key,
          retargetable: true,
        });
      } else {
        // Prefer detect's reason; when detect accepted it but the writer can't locate it
        // (object-style id), say so explicitly rather than emit a misleading 'unknown-wrapper'.
        const reason = detection.kind === 'i18n' ? 'non-string-arg' : detection.reason;
        out.push({
          key: calleeName,
          retargetable: false,
          unretargetableReason: reason,
        });
      }
    },
  });

  return out;
}

/** A located t(...) call: its NodePath plus the string-literal argument we'd rewrite. */
interface LocatedCall {
  path: NodePath<t.CallExpression>;
  arg: t.StringLiteral;
}

/** Find the t(...) call whose start position equals bindingLoc and whose first arg is a string literal. */
function locateByLoc(ast: t.File, loc: BindingLocation): LocatedCall | null {
  let hit: LocatedCall | null = null;
  traverse(ast, {
    CallExpression(path: NodePath<t.CallExpression>) {
      if (hit) return;
      const nodeLoc = path.node.loc;
      if (!nodeLoc || nodeLoc.start.line !== loc.line || nodeLoc.start.column !== loc.column) return;
      const calleeName = extractCalleeName(path.node.callee);
      if (!calleeName || !KNOWN_CALL_NAMES.has(calleeName)) return;
      const first = path.node.arguments[0];
      if (first && first.type === 'StringLiteral') {
        hit = { path, arg: first };
      }
    },
  });
  return hit;
}

/** Find ALL t(...) calls whose first string-literal arg equals `key`. Used for the loc-miss fallback. */
function locateByKey(ast: t.File, key: string): LocatedCall[] {
  const hits: LocatedCall[] = [];
  traverse(ast, {
    CallExpression(path: NodePath<t.CallExpression>) {
      const calleeName = extractCalleeName(path.node.callee);
      if (!calleeName || !KNOWN_CALL_NAMES.has(calleeName)) return;
      const first = path.node.arguments[0];
      if (first && first.type === 'StringLiteral' && first.value === key) {
        hits.push({ path, arg: first });
      }
    },
  });
  return hits;
}

/**
 * Write pass: deterministically locate the binding and swap oldKey→newKey in the JSX source.
 *
 * Locate order (design INVARIANT):
 *   1. by bindingLoc (the loc scanBindings emitted);
 *   2. on a loc miss, fall back to the UNIQUE t(oldKey) in the file;
 *   3. >1 such call → 'ambiguous-binding' (never guess).
 *
 * Conflict policy (key = truth): the located node's current key must be oldKey or newKey.
 *   - current === oldKey → rewrite (written:true).
 *   - current === newKey → idempotent noop (ok, written:false).
 *   - current ∉ {oldKey,newKey} → 'hard-conflict' (someone moved it).
 */
export function retargetBinding(source: string, req: RetargetCoreRequest): RetargetCoreResult {
  // Same parser as scanBindings (the "one parse" invariant) — format-preserving recast, so
  // spliceNodeSource can reprint just the one call node.
  const ast = parseShared(source);
  if (!ast) {
    return { code: 'unsupported', written: false, source, resultingKey: req.oldKey };
  }

  // 1) Primary locate by loc.
  let located = locateByLoc(ast, req.bindingLoc);

  // 2) Loc miss → fall back to the unique t(oldKey).
  if (!located) {
    const byOld = locateByKey(ast, req.oldKey);
    if (byOld.length === 1) {
      located = byOld[0] ?? null;
    } else if (byOld.length > 1) {
      return {
        code: 'ambiguous-binding',
        written: false,
        source,
        resultingKey: req.oldKey,
        reason: `bindingLoc missed and ${byOld.length} calls bind "${req.oldKey}"; refusing to guess`,
      };
    } else {
      // No loc match and no t(oldKey): nothing retargetable here.
      // Confirm via detectI18nBinding whether the loc points at a dynamic/template call so we
      // surface 'not-retargetable' rather than a vague miss.
      const detection = detectI18nBinding({
        source,
        filePath: req.filePath,
        location: req.bindingLoc,
        library: req.library,
      });
      if (detection.kind === 'unsupported') {
        return {
          code: 'not-retargetable',
          written: false,
          source,
          resultingKey: req.oldKey,
          reason: detection.reason,
        };
      }
      return {
        code: 'not-retargetable',
        written: false,
        source,
        resultingKey: req.oldKey,
        reason: `no t("${req.oldKey}") found and bindingLoc did not match a static call`,
      };
    }
  }

  const current = located.arg.value;

  // Conflict policy: key is truth.
  if (current === req.newKey) {
    // Idempotent noop — already at the target.
    return { code: 'ok', written: false, source, resultingKey: req.newKey };
  }
  if (current !== req.oldKey) {
    return {
      code: 'hard-conflict',
      written: false,
      source,
      resultingKey: current,
      reason: `located node binds "${current}", expected "${req.oldKey}" or "${req.newKey}"`,
    };
  }

  // current === oldKey → rewrite. Mutate the string literal and splice ONLY this call's range.
  const callNode = located.path.node;
  const start = callNode.start;
  const end = callNode.end;
  if (start == null || end == null) {
    // No usable source range — refuse rather than risk a whole-file reprint.
    return {
      code: 'unsupported',
      written: false,
      source,
      resultingKey: req.oldKey,
      reason: 'located call has no source range',
    };
  }

  located.arg.value = req.newKey;
  // A reprinted StringLiteral whose `.value` changed must NOT reuse its stale `.extra.raw` (the
  // original quoted source) — recast would print the old key verbatim. Drop `extra` so recast
  // emits a fresh single-quoted literal from `.value`.
  delete (located.arg as { extra?: unknown }).extra;

  const rewritten = spliceNodeSource(source, callNode, start, end);
  if (rewritten == null) {
    return {
      code: 'unsupported',
      written: false,
      source,
      resultingKey: req.oldKey,
      reason: 'spliceNodeSource returned null (no usable range)',
    };
  }

  return { code: 'ok', written: true, source: rewritten, resultingKey: req.newKey };
}
