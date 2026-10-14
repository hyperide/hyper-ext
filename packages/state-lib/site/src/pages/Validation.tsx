import React from 'react'

/** R29 — runtime type checking survey. typia direction adopted (decision #17). */
const ROWS: [string, string, string, string, string, string][] = [
  ['typia', 'compile-time codegen from TS types (transformer)', 'none at runtime — validators are generated code', 'claims up to 20 000× zod on some ops; no schema interpretation cost', 'requires build step / transformer', 'ADOPTED direction for our compiler (decision #17): action/collection validators generated at build'],
  ['ArkType 2', 'runtime, JIT-compiled set-theory engine', 'TS-syntax strings, full inference', 'claims ~100× zod', '~40 kB-class runtime', 'best runtime option; Standard Schema — plugs into our slices as-is'],
  ['TypeBox', 'JSON Schema + AOT compile (TypeCompiler)', 'JSON-Schema-native (OpenAPI interop)', 'top-tier in moltar benchmarks', 'schema objects, less inference-y', 'right choice when OpenAPI is the contract'],
  ['zod 4', 'runtime, interpreted (v4 much faster than v3)', 'the ecosystem default; everything integrates', 'baseline', 'slowest of the modern set', 'stays supported via Standard Schema'],
  ['valibot', 'runtime, modular/tree-shakable', 'zod-like API, ~10× smaller bundles', 'mid', 'smaller feature surface', 'best for size-critical client bundles'],
  ['ajv', 'JSON Schema, codegen at init', 'JSON-Schema standard', 'fast once compiled; init cost', 'not TS-first', 'legacy interop'],
]

export default function Validation() {
  return <div className="wrap wide">
    <header className="page">
      <p className="kicker">state · validation (R29)</p>
      <h1>Runtime type checking</h1>
      <p className="lead">Where validation runs decides what it costs. Three regimes: interpreted runtime schemas (zod/valibot), JIT/AOT-compiled runtime engines (ArkType/TypeBox/ajv), and compile-time generation from TS types (typia) — which fits our disappearing-framework thesis exactly and is the adopted direction (decision #17). Perf figures below are the projects' own claims until our R28 harness reproduces them — that's the next step here.</p>
    </header>
    <div className="tblwrap"><table>
      <thead><tr><th>Library</th><th>Regime</th><th>Authoring</th><th>Perf (claims)</th><th>Cost</th><th>Our stance</th></tr></thead>
      <tbody>{ROWS.map(r => <tr key={r[0]}>
        <td className="name">{r[0]}</td>{r.slice(1).map((c, i) => <td key={i} className={i === 4 ? 'traits' : undefined}>{c}</td>)}
      </tr>)}</tbody>
    </table></div>
    <div className="why-us"><b>How it lands in the toolkit:</b> slice/action schemas accept any Standard Schema library (interop); when the compiler runs, schemas declared as TS types are compiled typia-style into inline validators — dev builds validate everything, production keeps only boundary validation (sources, RPC), and the schema library itself disappears from the bundle.</div>
    <footer>Benchmarks to reproduce: moltar/typescript-runtime-type-benchmarks; ArkType and typia self-published numbers.</footer>
  </div>
}
