# R34 — illustration comprehension protocol: method, first run, and results

**Date:** 2026-09-04 · **Requirement:** R34 · **Harness:** `site/tools/render-figures.mts`

R34 asks that illustrations be _validated for comprehensibility_ rather than assumed
comprehensible: show a figure to another model with minimal context, see what it actually
understands, add hints, iterate. This document is the method plus the first round-trip.

## Method

1. **Render each figure in isolation.** `site/tools/render-figures.mts` extracts every
   `<figure>` from `src/content/concepts-fragment.html` and screenshots it alone with the
   site's own stylesheet. Isolation is the point: inside the full page a figure is propped up
   by the prose around it and always looks clearer than it is.
2. **Read it cold.** Hand the PNGs to a subagent told only "these are figures from the
   documentation of a software library" — not what the library does, not what the figure
   depicts.
3. **Add context in rounds.** Round 2 reveals the domain (client-side state management).
   Round 3 reveals the figure's topic and asks the decisive question: _does the picture teach
   the mechanism, or does it merely illustrate one you had to know already?_
4. **Demand concreteness.** "The arrows are confusing" is useless. "The arrow from the orange
   box to the grey box has no label so I could not tell whether it means data flow or
   causation" is actionable. Ask for a score and one highest-value fix per figure.
5. **Fix, re-render, re-run cold** with a fresh reader who has not seen the earlier version.

## Round 1 — the honest result

Only **5 of the 10** concept sections had a figure at all (`hamt`, `runes`,
`signals-streams`, `shapes`, `redux-form` were prose-only, despite being described elsewhere
as illustrated). The five that existed scored, out of 10 for standalone comprehensibility:

| Figure          | Score | Verdict in one line                                                                                     |
| --------------- | ----- | ------------------------------------------------------------------------------------------------------- |
| `cow`           | 4     | Recognisable if you know structural sharing; the shared-reference arrow's meaning was guessed, not read |
| `push-pull`     | 3     | Colour states never defined; the two panels appeared to be different graphs                             |
| `livestore-git` | 3     | Legible only to a reader who already knows git rebase                                                   |
| `two-phase`     | 2     | Showed three boxes; nothing showed what batching prevents                                               |
| `resumability`  | 2     | Two lists of steps; no reason why either sequence exists                                                |

**Average 2.8/10.** The reader's summary judgement was the same for every figure: they
illustrate a mechanism you must already know; they do not teach it.

Four failure modes, shared across all five:

1. **No legend.** Colour carried meaning nowhere defined — dirty vs check, local vs remote,
   newly-allocated vs reused. The reader guessed each one, and said so.
2. **No contrast.** Every figure showed only the good case, so the problem being solved was
   invisible. Without seeing three notifications you cannot see why one is better.
3. **Unlabelled arrows.** Data flow, causation, and "points at the same object" were all drawn
   as the same arrow.
4. **The panels were not the same subject.** In `push-pull` the left and right graphs had
   different shapes, so the reader could not tell whether they were two moments of one graph
   or two different graphs. They were meant to be the former.

## What was changed

Every figure was rebuilt against those four findings:

- **A legend wherever colour means something** (`push-pull` now defines dirty / check / ran-and-changed / clean / "arrow = feeds into").
- **The bad case is drawn next to the good one.** `two-phase` now shows three unbatched
  write→pull→notify cycles _and_ the window in which a subscriber reads `a=1, b=2, c=0` — a
  state that never logically existed — above the batched version. `resumability` shows the
  hydration row with the interval in which the page "looks finished · clicks do nothing".
- **The same subject in both panels.** `push-pull` draws one five-node graph twice, at two
  moments, with concrete values (`double = a×2` recomputes to 4 and its consumer re-runs;
  `isPos = a>0` recomputes to the same `true` and its consumer is skipped) — which is the
  actual mechanism, not an illustration of it.
- **Identity stated, not implied.** `cow` labels the shared edge `root′.a IS v1.root.a — same
object`, and adds the cost line: 2 allocated, 1000-item list reused, a deep copy would
  allocate 1003.
- **Prose moved out of the SVG into `<figcaption>`.** The site renders `svg text` in a
  monospace face, so long sentences inside an SVG overflow and overlap — the first rebuild did
  exactly that and was caught by re-rendering. Diagrams now carry short labels only; the
  argument lives in the caption, where it wraps.

## Standing rules for figures in this package

- Colour that carries meaning needs a legend **inside the figure**.
- Show the failure the mechanism prevents, next to the mechanism.
- Label an arrow whenever the reader could plausibly read it as flow, causation or identity.
- Put no sentence inside an `<svg>`; SVG text is monospace here and will not wrap. Short
  labels in the diagram, prose in the `<figcaption>`.
- When two panels are the same subject at different times, say so in the figure and keep the
  layout identical between them.
- Re-render after every edit (`tsx tools/render-figures.mts`) and look at the PNG. Overlap and
  clipping are invisible in the source.

## Round 2 — the rebuilt figures, read cold by a fresh reader

Same protocol, same minimal context, a reader who had not seen round 1.

| Figure          | Round 1 | Round 2 | What still needed fixing                         |
| --------------- | ------- | ------- | ------------------------------------------------ |
| `push-pull`     | 3       | **9**   | nothing named                                    |
| `two-phase`     | 2       | **9**   | enlarge the dashed box on the impossible state   |
| `cow`           | 4       | **8**   | object/reference boundaries could be crisper     |
| `livestore-git` | 3       | **8**   | say explicitly that one circle is one event      |
| `resumability`  | 2       | **7**   | the dashed span read as a loop back to the start |

**Average 2.8 → 8.2.** The verdict flipped: from "they illustrate a mechanism you must
already know" to "these teach more than they illustrate — none are reference-only
decorations". The reader could state each mechanism in its own words and, for every figure,
pointed at the specific element that landed it — for `push-pull`, the caption's "work stops
at the node where the value stopped changing, not at the node where the write happened";
for `two-phase`, the visible `a=1 b=2 c=0`.

Both round-2 defects were then fixed: the hydration span is now drawn as a measured interval
with end ticks and a knocked-out label instead of a U-shaped path that read as a loop, and
the event log carries a "= one immutable event" key. Not re-scored — the changes are small
and the defects were named precisely.

## What generalises

The fix that moved the numbers most was not visual polish. It was **drawing the failure the
mechanism prevents, next to the mechanism**. Every figure that scored 2–3 showed only the
working case; the reader could see what happened but not why anyone would want it. Second
most valuable: **using real values rather than abstract nodes**, so a step like "recomputed to
the same value, therefore its consumer never runs" is visible in the picture instead of
asserted in the prose.

Also worth recording: the protocol caught a defect no human review had — a whole panel of
`push-pull` failed to render (an omitted variable in the generator) and the earlier rebuild
overflowed its text, because SVG text here is monospace and does not wrap. Rendering each
figure and _looking at the PNG_ is not optional.

## Open

- ~~Five concepts still have no figure at all.~~ **Done 2026-09-04**: `hamt`, `runes`,
  `signals-streams`, `shapes` and `redux-form` now have figures, built to the standing rules
  above from the start — each shows the alternative next to the mechanism (three units of cost
  for HAMT; the diamond glitch for streams; authored source beside compiled output for runes;
  the five redux-form failures beside their five mechanism answers), and each carries its
  argument in the caption rather than inside the SVG. All ten concepts are now illustrated.
  They have **not** yet been through a cold read — that is the next protocol run, and until it
  happens their scores are unknown rather than good.
- The interactive push-pull demo (`PushPullDemo.tsx`) has never been through it; the protocol
  currently covers static figures only.
