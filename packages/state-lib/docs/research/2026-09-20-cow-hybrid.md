# COW qualification and hybrid command generation

The [20 September report](../../experiments/2026-09-20-hybrid/REPORT.md) separates current selection from the proposed hybrid: Boards still requires explicit COW opt-in, while the compiler rejects whole-document COW on required timing cells. The historical-reference correction now passes all 21 focused expectations and the unchanged 19 app document contracts. Correctness does not authorize performance promotion.

The native compiler now generates known-field projections from declarations; 18 existing CLI and 11 generation contracts pass. This is not yet arbitrary callback or dense-updater generation. A separate direct dense-builder experiment is a restricted compiler-target prototype, with its excluded stages stated explicitly.

The report cross-checks canonical spec sections 4.4, 4.5 and 5, supplied GRC/Wasm research, and primary material on transients, CHAMP, RRB vectors, blocked leaves, reuse analysis, snapshotting, persistent amortisation and persistent iterators. It specifies the next command-level promotion matrix without presenting the synthesis as a theorem of universal speedup.

Raw measurements, source hashes and manifest evidence are under `experiments/2026-09-20-hybrid/results/`. No main or production promotion is requested.

Reviewed PDF: [REVIEWED-SUMMARY.pdf](../../experiments/2026-09-20-hybrid/REVIEWED-SUMMARY.pdf). Full measured data: [results/summary.json](../../experiments/2026-09-20-hybrid/results/summary.json).

Full report PDF: [REPORT.pdf](../../experiments/2026-09-20-hybrid/REPORT.pdf). It includes the complete methods and primary-source references, rather than only the executive summary. The source implementation is published as `1a6d08481ce82f5fc57998b092b117b420eba06b`; subsequent documentation-only commits do not change those measured source bytes.
