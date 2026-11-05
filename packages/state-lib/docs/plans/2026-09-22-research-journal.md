# Research journal and evidence-linked learning implementation plan

**Goal:** Make ongoing state research understandable and discoverable on the existing public site without separating product storytelling from measured evidence or the canonical specification.

**Architecture:** One typed article/concept catalogue references one sanitized, source-pinned evidence dataset. Blog, Concepts and Bench render shared figures/evidence components. The existing router, search, glossary, diagram viewer, semantic Markdown exporter and static prerenderer remain the delivery system; no CMS or new renderer is introduced.

**Base:** main b3af90fb9 in isolated worktree state-research-journal-20260922. The compiler research branch and other active worktrees are untouched. Source observations are pinned to research commit 1a6d084, not relabeled as measurements of current main.

**Spec:** canonical master specification plus R28/R34/R54/R55/R65/R86/R93/R97/R101 and the new research-publication requirement. Production API claims remain separate from compiler-preview and research results.

## Deliverables and gates

- [x] Add failing catalogue/evidence tests: unique article routes; real concept IDs; complete 21-case coverage; finite raw samples; recomputed medians/pass counts; emitted-byte totals; no internal paths or personal data in public JSON.
- [x] Import only synthetic observation fields from pinned Git source, preserving raw samples and SHA256 provenance. Render both baselines and losing cases; no private app names on the public site.
- [x] Add two complete articles: generation instead of handwritten specialization; why a faster point edit does not qualify an entire store. Each has an illustration, evidence, limitations, related links and a next experiment.
- [x] Add three concept explainers for build-time qualification, historical snapshot ownership and command-shaped optimization. Reuse contextual vecli diagrams and DiagramViewer. Label interactive walkthroughs as explanations, not browser runs of Rust.
- [x] Link Blog from navigation and homepage; index articles in search, metadata, static HTML/Markdown, sitemap and llms exports. Unknown article slugs render not-found.
- [x] Add the published experiment panel to Bench without mixing it with locally run prototype suites. Workload selection never hides the global failed-promotion status.
- [x] Update canonical requirements/spec with the publishing contract and implemented boundary, then refresh site mirrors through the existing generation path.
- [x] Run unit/static tests, all site gates, desktop/mobile/reduced-motion browser checks, real anchor/download checks and screenshot critique. Record bundle delta rather than assuming content is free.
- [ ] Complete exact-index review, normal hooks, source push and PR with visual proof. Publish a checked preview. Production promotion still follows normal visual and release gates.

## Review focus

A dated microbenchmark is not a general product speed claim. A generated projection is not a generated dense updater. Mutable baseline and immutable Runtime are different contracts. Public downloads must not expose adopter data. Cold links, article headings, Markdown and search must agree. Mobile figures and tables stay legible without shrinking body text.

Publication checkpoint: implementation, review, source push and checked preview are complete; embedded PR proof and production visual/release acceptance remain outstanding. See [publication status](../research/2026-09-22-publication-status.md).
