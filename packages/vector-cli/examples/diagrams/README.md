# Specification diagrams with vecli

Run from the repository root:

```sh
bun packages/vector-cli/bin/vecli.ts diagram ascii -i packages/vector-cli/examples/diagrams/architecture.txt -o architecture.svg --preset state
bun packages/vector-cli/bin/vecli.ts diagram table '[["Phase","Result"],["Validate","Accepted writes"],["Publish","New snapshot"]]' --preset blue -o transaction-table.svg
```

The ASCII converter repairs unambiguous closed frames before drawing. Unequal right-edge padding and uneven table cells become aligned vector borders. Box titles and labels remain editable SVG text. Adjacent arrow endpoints stay at their original coordinates; a frame may shorten an intervening horizontal connector but must not overwrite a label, arrowhead or neighbouring frame.

ASCII `+---+`, Unicode single/double/heavy borders, rounded corners, nested frames, titled frames and ordinary tables are covered by regression tests. Tabs expand to four cells. The result is deterministic and normalization is idempotent for supported inputs. Wide/combining terminal glyph metrics, arbitrary broken/open graphs and ambiguous overlapping boxes are not inferred. Use the `scene`, `frame`, `table` and `arrow` primitives for explicit geometry in those cases.

The state-lib site renders diagram fences beside their explanations through the same vecli renderer. There is no dedicated diagram playground page. The original text remains available in each figure and in Markdown exports.

`normalizeAsciiDiagram` exposes the repaired text for tooling; `asciiToSvg` produces the SVG. Input limits and XML escaping still apply. This is layout repair, not execution of diagram input.
