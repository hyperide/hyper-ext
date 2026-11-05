# Research publication: one record, several reading paths

This site update implements R102 and decision 37. It presents existing measured research; it does not introduce a new runtime algorithm or relabel older measurements as a new benchmark run.

## Canonical inputs

`datasets/2026-09-20-public-evidence.json` contains an explicit allowlist of synthetic observations from source revision `1a6d08481ce82f5fc57998b092b117b420eba06b`: controller trial values, the generated projection's emitted bytes and source, and the conformance/admission result. Each original input has a SHA256 in the public provenance record. Absolute paths, account/workspace fields, adopter names and unrelated report content are not copied into the public dataset.

The controller has three backends, three sizes and seven operation classes: 63 rows of 17 observations. The public gate recomputes each median and the 13-of-21 strict timing result from those samples. The current immutable Runtime and original mutable baseline remain distinct contracts. Projection bytes are for one declared function, not for the entire package or application.

The site catalogue in `site/src/data/research.ts` is shared by two blog articles, three concepts, search and route discovery. The evidence component is reused by both articles and `/bench`; there is no second hand-entered numeric table. The static build also writes the same dataset to `/research/2026-09-20-evidence.json`.

## Reading paths

- `/blog/generate-less-ship-less`: why native generation removes a handwritten candidate, what the exact projection contract preserves, and what it does not yet generate.
- `/blog/a-faster-edit-is-not-a-faster-product`: point-edit improvement, historical snapshot ownership, losing workloads and why whole-document COW is still not admitted.
- `/concepts#compile-time-qualification`, `#snapshot-ownership`, `#command-shaped-optimization`: contextual vecli figures, captions, editable text source and linked explanations.
- `/bench#published-research`: all recorded workload classes and the projection output, separate from live prototype suites.
- `/spec#s23`: the publication contract. Existing §21/§22 anchors remain unchanged.

The illustrations explain recorded behavior or a labeled proposal. Their controls do not invoke a native Rust compiler in the browser. New concepts retain the original diagram text and work with the site's existing expand/zoom viewer.

## Verification

The new catalogue gate checks route identity, substantive article content, evidence completeness, sample arithmetic and public-data boundaries. The browser gate checks static and hydrated article reading, real search destinations, concept links, caption changes, workload selection, downloaded JSON, sitemap/Markdown discovery, dark mobile rendering and document overflow. The ordinary anchor-integrity gate caught a draft collision with the existing §21; the new section uses §23 instead of moving or weakening old anchors.

Publishing results is not feature promotion. Generated immutable updaters, a common ownership/commit interface, normalized ordering and keyed-rendering qualification remain the next implementation research. Future articles must use new measured records rather than overwrite this historical dataset.

## Review follow-up

The full review identified an avoidable delivery cost: importing every trial into the shared client catalogue shipped raw samples even on unrelated routes. `tools/gen-research-evidence.mts` now derives the compact display data during development, checks and builds. The browser receives median/minimum/maximum/count summaries; the separate public JSON download retains all 1,071 observations. The independent test recomputes every median and summary from the canonical raw file, checks its digest and refuses raw sample arrays in the client dataset. No winning or losing cell was removed.

Before this correction, the new largest index JavaScript asset was 533.70 kB gzip; after it, 527.29 kB. The same asset on the unmodified main baseline was 514.06 kB. New content and UI still add about 13.23 kB gzip plus 1.40 kB gzip CSS; this is a build-asset comparison, not an initial-route or field-performance claim. The other reported index chunks did not change.

The review also queried whether the glossary search anchors were missing. They are rendered by the existing glossary map in `Concepts.tsx`, separately from the fuller concept sections. The browser gate now verifies both destinations, rather than deleting valid glossary links. The first visual review accepted the rendered journal; an earlier stranded diagram connector was reproduced by a dedicated SVG-label assertion and fixed in the diagram source, not by hiding it with CSS.

All three public provenance hashes were checked directly against the pinned Git revision. Generated summaries are not another hand-maintained set of performance claims: changing the raw record regenerates them and the gate independently checks the result.
