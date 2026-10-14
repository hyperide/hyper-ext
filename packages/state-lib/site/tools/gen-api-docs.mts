import { isPublicApiMember, apiTypeDefinition } from './api-public-surface.mts';
import { apiSymbolName } from './api-symbol-name.mts';
/**
 * Generate the editor's hover/completion index from the prototype's REAL types.
 *
 *   tsx tools/gen-api-docs.mts            # writes src/lib/api-docs.generated.ts
 *   tsx tools/gen-api-docs.mts --check    # exit 1 if the committed file is stale
 *
 * The hover used to read a hand-typed index of signatures. This is the honest
 * version of "types in the hover": the TypeScript compiler runs over
 * src/lib/proto.ts at BUILD time, and what it emits — the declared signature
 * of every export, every method on the store, every member of TaskContext,
 * Scope, Task and Field, plus each one's JSDoc — is what the page shows. The
 * compiler itself never ships; the reader gets its output.
 *
 * Why not a language service in the browser: it is several megabytes and a
 * worker pool against a single-file site that opens from disk. Running it once
 * here gives the same signatures for free, and a gate keeps them fresh.
 */
import ts from 'typescript';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PROTO = resolve(here, '../src/lib/proto.ts');
const OUT = resolve(here, '../src/lib/api-docs.generated.ts');

type Entry = { sig: string; doc: string; kind: string };
const entries: Record<string, Entry> = {};

const program = ts.createProgram([PROTO], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
});
const checker = program.getTypeChecker();
const source = program.getSourceFile(PROTO);
if (!source) throw new Error(`could not load ${PROTO}`);

const FLAGS = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

/** Keep the full JSDoc for the API reference; individual hover cards may constrain their viewport. */
function docOf(sym: ts.Symbol): string {
  const text = ts.displayPartsToString(sym.getDocumentationComment(checker)).trim();
  return text;
}

/** `name(a: T, b: U): R` for a callable, `name: T` otherwise. Overloads are joined. */
function sigOf(name: string, sym: ts.Symbol, at: ts.Node): string {
  const type = checker.getTypeOfSymbolAtLocation(sym, at);
  const calls = type.getCallSignatures();
  // The checker retains generic constraints, defaults, rest parameters and every overload.
  return calls.length
    ? calls.map((c) => name + checker.signatureToString(c, at, FLAGS, ts.SignatureKind.Call)).join('\n')
    : `${name}: ${checker.typeToString(type, at, FLAGS)}`;
}

function add(key: string, sym: ts.Symbol, at: ts.Node, kind: string, label = key.split('.').pop()!) {
  const sig = sigOf(label, sym, at);
  entries[key] = { sig: tidy(sig), doc: docOf(sym), kind };
}

/** Never truncate the reference data. The code block, not the signature, scrolls. */
function tidy(sig: string): string {
  return sig;
}

const moduleSym = checker.getSymbolAtLocation(source);
if (!moduleSym) throw new Error('no module symbol');
const exports = checker.getExportsOfModule(moduleSym);

for (const exported of exports) {
  const name = exported.getName();
  const sym = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  const decl = sym.valueDeclaration ?? sym.declarations?.[0];
  if (!decl) continue;
  const isType = !(sym.flags & ts.SymbolFlags.Value);
  if (isType) {
    // Interfaces and object type aliases: emit each member as Name.member.
    const t = checker.getDeclaredTypeOfSymbol(sym);
    const props = t.getProperties().filter((member) => isPublicApiMember(member, program));
    entries[name] = { sig: apiTypeDefinition(name, decl, t, checker), doc: docOf(sym), kind: 'type' };
    if (!(sym.flags & ts.SymbolFlags.TypeParameter)) {
      for (const p of props) {
        const member = apiSymbolName(p);
        add(`${name}.${member}`, p, decl, 'member', member);
      }
    }
    continue;
  }
  add(name, sym, decl, sym.flags & ts.SymbolFlags.Function ? 'function' : 'value');

  if (name === 'region') {
    const type = checker.getTypeOfSymbolAtLocation(sym, decl);
    for (const p of type.getProperties().filter((member) => isPublicApiMember(member, program))) {
      const member = apiSymbolName(p);
      add(`region.${member}`, p, decl, 'method', member);
    }
  }

  // The store's methods live on createStore's return type: surface them as store.<name>
  // so hovering `store.undo` finds `undo` with its real signature.
  if (name === 'createStore') {
    const t = checker.getTypeOfSymbolAtLocation(sym, decl);
    const ret = t.getCallSignatures()[0]?.getReturnType();
    for (const p of (ret?.getProperties() ?? []).filter((member) => isPublicApiMember(member, program))) {
      const member = apiSymbolName(p);
      add(`store.${member}`, p, decl, 'method', member);
    }
  }
}

const body = `/* GENERATED by tools/gen-api-docs.mts from src/lib/proto.ts — do not edit.
 * Regenerate: tsx tools/gen-api-docs.mts. A gate fails the build when this is stale. */
export type GeneratedDoc = { sig: string; doc: string; kind: string };
export const GENERATED_API: Record<string, GeneratedDoc> = ${JSON.stringify(entries, null, 2)};
`;

/**
 * Compare CONTENT, not bytes. The repo's pre-commit formatter rewrites the
 * generated file (unquoted keys, single quotes), so a byte comparison against
 * what is committed fails on quote style while every signature is identical —
 * a red gate that says nothing. The gate exists to catch a signature the code
 * no longer has, so it evaluates the committed module and compares entries.
 */
if (process.argv.includes('--check')) {
  let committed: Record<string, Entry> | null = null;
  try {
    const mod = await import(`${OUT}?t=${process.pid}`);
    committed = mod.GENERATED_API;
  } catch {
    /* missing or unparsable counts as stale */
  }
  const same = committed !== null && JSON.stringify(committed) === JSON.stringify(entries);
  if (!same) {
    const a = new Set(Object.keys(committed ?? {})),
      b = new Set(Object.keys(entries));
    const added = [...b].filter((k) => !a.has(k)),
      removed = [...a].filter((k) => !b.has(k));
    const changed = [...b].filter((k) => a.has(k) && JSON.stringify(committed![k]) !== JSON.stringify(entries[k]));
    console.log(`STALE: ${OUT} does not match src/lib/proto.ts — run: tsx tools/gen-api-docs.mts`);
    if (added.length) console.log(`  new in proto.ts:      ${added.slice(0, 8).join(', ')}`);
    if (removed.length) console.log(`  gone from proto.ts:   ${removed.slice(0, 8).join(', ')}`);
    if (changed.length) console.log(`  signature changed:    ${changed.slice(0, 8).join(', ')}`);
    process.exit(1);
  }
  console.log(`fresh — ${Object.keys(entries).length} entries match proto.ts`);
} else {
  writeFileSync(OUT, body);
  console.log(`wrote ${Object.keys(entries).length} entries → ${OUT}`);
}
