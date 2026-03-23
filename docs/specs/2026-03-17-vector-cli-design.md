# vecli — Vector Engine CLI

## Overview

Interactive and batch CLI for the headless vector engine. Two modes:
TUI (full-screen curses with panels) and batch (pipe/exec/inline).
Uses JS eval in sandboxed scope — the command language IS JavaScript
with pre-injected vector API functions.

## Modes

### TUI Mode (`vecli`)

Full-screen terminal UI (ink-based):

- **Left panel**: Node list (tree view, type + id + muted state)
- **Center panel**: ASCII graph visualization (DAG connections)
- **Right panel**: Properties (selected node params, editable)
- **Bottom**: REPL input line + command history
- **Status bar**: graph name, node count, edge count, execution time

Navigation: Tab between panels, arrow keys within panels, Enter to edit.
Hotkeys: Ctrl+Z undo, Ctrl+Y redo, Ctrl+S save, Ctrl+E export SVG, Ctrl+Q quit.

### Batch Mode

Auto-detected when `!process.stdout.isTTY` or when args provided:

```bash
vecli 'rect(100,100).fill("#f00").export("svg")'   # inline expression
vecli -e script.js                                   # execute file
echo 'rect(100,50).fill("#f00")' | vecli             # pipe stdin
vecli -e script.js -o output.svg                     # output to file
vecli -e script.js --format json                     # output format
```

Flags:

- `-e <file>` — execute script file
- `-o <file>` — output file (default: stdout)
- `-i <file>` — input file (open .graph/.svg/.fig before executing)
- `--format svg|json|graph|png` — output format (svg default)
- `--silent` — suppress info output, only emit result
- `--verbose` — debug execution info
- `--canvas <WxH>` — set canvas size (default: 100x100)

## Command Language

JavaScript subset with pre-injected API. No `import`/`require` — all API
available as globals. `eval()` in isolated scope with frozen prototype chain.

### Generators (return ChainableNode)

```js
rect(width, height)              // rectangle at origin
rect(width, height, x, y)       // positioned
ellipse(rx, ry)                  // ellipse
ellipse(rx, ry, cx, cy)         // positioned
circle(r)                        // shorthand for ellipse(r, r)
polygon(sides, radius)           // regular polygon
star(points, outer, inner)       // star
line(x1, y1, x2, y2)            // line segment
arc(radius, startAngle, endAngle)
spiral(spirals, radius)
arrow(length, width)
path("M 0 0 L 100 0 Z")        // raw SVG path
text("Hello", fontSize)          // text to path (requires font)
mesh(rows, cols)                 // gradient mesh grid
mesh(rows, cols, w, h)           // sized gradient mesh
meshFrom(node, rows, cols)       // fit mesh to path bounds
```

### Chaining (.method returns ChainableNode)

```js
// Style
.fill(color)                     // solid fill
.fill(type, ...args)             // gradient: .fill("linear", stops, from, to)
.stroke(color, width)            // stroke
.stroke(color, width, cap, join) // full stroke
.opacity(value)                  // 0..1
.blend(mode)                     // "multiply", "screen", etc.
.shadow(color, dx, dy, blur)     // drop shadow
.blur(radius)                    // gaussian blur

// Transform
.translate(dx, dy)
.rotate(angle)                   // degrees
.rotate(angle, cx, cy)           // around point
.scale(sx, sy)
.scale(s)                        // uniform
.skew(sx, sy)

// Path operations
.roundCorners(radius)
.chamfer(distance)
.smooth(smoothness)              // 0..1
.offset(distance)                // inflate/deflate
.trim(start, end)                // 0..1 trim path
.reverse()
.close()
.dash(on, off)
.strokeToPath()
.roughen(size, detail)
.zigzag(size, ridges)
.puckerBloat(amount)             // -100..100
.twist(angle)
.warp(type, bend)                // "arc", "wave", "flag", "bulge"
.variableStroke(profile)         // [{offset, width}, ...]
.envelopeDistort(mesh)
.subdivide(segIndex, t)          // split segment at parameter
.addPoint(segIndex, t)           // add anchor point
.removePoint(index)              // remove anchor point
.convertPoint(index, type)       // "smooth" | "corner" | "symmetric"
.splitPath(offset)               // split into two paths (returns [a, b])
.enforceWinding(dir)             // "cw" | "ccw"
.removeSelfIntersections()

// Export (terminal — returns string or writes file)
.export(format)                  // "svg" | "json" | "graph"
.export(format, filename)        // writes to file
.bounds()                        // returns {x, y, width, height}
.length()                        // arc length
.area()                          // signed area
.svg()                           // shorthand for .export("svg")
```

### Multi-Node Operations

```js
// Boolean (take 2 nodes)
union(a, b)                      // combine shapes
subtract(a, b)                   // cut b from a
intersect(a, b)                  // keep overlap only
xor(a, b)                       // exclude overlap

// Structural
clip(content, mask)              // clip content to mask shape
group(a, b, ...)                 // group into compound path

// Join
join(a, b)                       // connect open path endpoints
```

**Not yet implemented — next phase:**
- `divide(a, b)` — split at all intersections, keep all fragments
- `cutPath(a, b)` — like divide but strokes only
- `combine(a, b, ...)` — compound path preserving subpaths
- `fracture(a, b, ...)` — all non-overlapping fragments
- `simplify(tolerance)` — reduce node count (backend exists, node missing)
- `patternAlongPath(pattern, path)` — repeat element along path
- `mirrorSymmetry(axis)`, `rotateCopies(count, center)`

### Graph Operations (imperative)

```js
// Variables
const r = rect(100, 50)
const c = circle(30).translate(50, 25)
const logo = subtract(r, c).fill("#ff0000")

// Multi-shape document
const bg = rect(200, 200).fill("#eee")
const icon = star(5, 40, 20).fill("#333").translate(100, 100)
group(bg, icon).export("svg", "badge.svg")

// Loops
for (let i = 0; i < 10; i++) {
  circle(5).translate(i * 15, 0).fill(`hsl(${i * 36}, 80%, 50%)`)
}
export("svg")  // exports entire canvas

// Conditionals
const shape = debug ? rect(100,100).stroke("#f00",1) : rect(100,100)
```

### File Operations

```js
open("icon.graph")               // load .graph file
open("icon.svg")                 // import SVG → graph
open("design.fig")               // import Figma file
save()                           // save to current file (.graph)
save("icon.graph")               // save as
save("icon.graph.json")          // save as JSON
export("svg", "icon.svg")        // export SVG
export("graph", "icon.graph")    // export binary
```

### History & DAG Manipulation

```js
// Undo/Redo
undo()                           // undo last operation
undo(3)                          // undo 3 steps
redo()                           // redo last
redo(3)                          // redo 3 steps

// History inspection
history()                        // full history list with timestamps
history(10)                      // last 10 entries
diff(entry)                      // show what changed in entry
replay(n)                        // replay from base to entry n
compact()                        // compact old history into base state

// Mute/unmute — disable node without removing it
mute(node)                       // skip during execution (passthrough)
unmute(node)                     // re-enable
toggle(node)                     // toggle mute state

// DAG manipulation — reorder by remove + insert
remove(node)                     // remove node from graph (edges severed)
insert(node, after)              // insert node into edge chain after target
reorder(node, before)            // shorthand: remove + insert before target
```

### Inspection

```js
nodes()                          // list all nodes (table)
edges()                          // list all edges
info(node)                       // show node details
tree()                           // ASCII DAG tree
scene()                          // show scene graph
stats()                          // execution stats
```

### Canvas

```js
canvas(width, height)            // set canvas size
canvas()                         // show current size
background(color)                // set background
```

### Network Operations

```js
const net = toNetwork(path)      // path → vector network
const paths = toPaths(network)   // network → paths
findRegions(network)             // find fillable regions
splitIntersections(network)      // resolve crossings
```

### Hit Testing & Geometry

```js
hitTest(x, y)                    // what's at this point?
nearest(x, y)                    // nearest point on any shape
pointAt(node, 0.5)              // point at 50% along path
```

## Architecture

```
packages/vector-cli/
├── package.json
├── bin/
│   └── vecli.ts                 # entry point, mode detection
├── src/
│   ├── cli.ts                   # arg parsing (minimist or built-in)
│   ├── eval-context.ts          # sandboxed eval scope setup
│   ├── chainable.ts             # ChainableNode fluent API
│   ├── globals.ts               # global function bindings (rect, circle, etc.)
│   ├── repl.ts                  # REPL loop for TUI bottom panel
│   ├── tui/
│   │   ├── app.tsx              # ink root component
│   │   ├── node-list.tsx        # left panel
│   │   ├── graph-view.tsx       # center panel (ASCII DAG)
│   │   ├── properties.tsx       # right panel
│   │   └── status-bar.tsx       # bottom bar
│   ├── formatters/
│   │   ├── table.ts             # tabular output for nodes/edges
│   │   ├── tree.ts              # ASCII tree for DAG
│   │   └── svg-preview.ts       # inline SVG preview (sixel/kitty if supported)
│   └── commands/
│       ├── file.ts              # open/save/export
│       ├── history.ts           # undo/redo/history
│       └── inspect.ts           # nodes/edges/info/tree/scene/stats
└── test/
    ├── chainable.test.ts
    ├── eval-context.test.ts
    ├── globals.test.ts
    └── commands.test.ts
```

### Dependencies

- `ink` + `ink-text-input` — TUI rendering (React for terminal)
- `minimist` or bun built-in — arg parsing
- `chalk` — colored output in batch mode
- `vector-engine` — the SDK
- `vector-wasm` — WASM backends

### ChainableNode

Core abstraction. Wraps a graph node ID + reference to the graph context.
Each method adds a new node to the graph, connects edges, returns new
ChainableNode pointing to the latest node.

```typescript
class ChainableNode {
  constructor(
    private ctx: EvalContext,  // shared graph + registry + executor
    private nodeId: string,    // current terminal node
  ) {}

  fill(color: string): ChainableNode {
    const fillId = this.ctx.graph.addNode({ type: 'fill', params: { type: 'solid', color } });
    this.ctx.graph.addEdge(this.nodeId, 'path', fillId, 'path');
    return new ChainableNode(this.ctx, fillId);
  }

  export(format: string, filename?: string): string {
    const result = this.ctx.executor.execute(this.ctx.graph);
    const svg = sceneToSvg(result.scene);
    if (filename) writeFileSync(filename, svg);
    return svg;
  }
  // ... all other methods
}
```

### EvalContext

Shared state for one CLI session:

```typescript
interface EvalContext {
  graph: VectorGraphModel;
  registry: NodeRegistry;
  executor: GraphExecutor;
  history: HistoryManager;
  currentFile?: string;
}
```

### Sandbox

```typescript
function createSandbox(ctx: EvalContext): Record<string, unknown> {
  return {
    // Generators
    rect: (w, h, x, y) => { /* add node, return ChainableNode */ },
    circle: (r) => { /* ... */ },
    ellipse: (rx, ry, cx, cy) => { /* ... */ },
    // ... all generators

    // Boolean ops
    union: (a, b) => { /* ... */ },
    subtract: (a, b) => { /* ... */ },

    // File ops
    open: (path) => { /* ... */ },
    save: (path?) => { /* ... */ },

    // History
    undo: () => ctx.history.undo(ctx.graph),
    redo: () => ctx.history.redo(ctx.graph),

    // Inspection
    nodes: () => { /* print table */ },
    tree: () => { /* print ASCII DAG */ },

    // Canvas
    canvas: (w, h) => { /* ... */ },

    // Console
    console,
    Math,
  };
}
```

Eval:

```typescript
const sandbox = createSandbox(ctx);
const fn = new Function(...Object.keys(sandbox), code);
fn(...Object.values(sandbox));
```

No raw `eval()` — `new Function()` with explicit scope. No access to
`process`, `require`, `import`, `globalThis`, `Bun`, `fetch`, file system
(except through our `open`/`save`/`export` functions).

## TUI Layout

```
┌─ Nodes ──────────┬─ Graph ──────────────────┬─ Properties ──────┐
│ ▶ n1 rectangle   │                          │ type: rectangle   │
│   n2 fill        │   [n1:rect] ──→ [n2:fill]│ width: 100        │
│   n3 stroke      │       └──→ [n3:stroke]   │ height: 50        │
│   n4 translate   │              └──→ [n4:tr] │ x: 0              │
│                  │                          │ y: 0              │
├──────────────────┴──────────────────────────┴───────────────────┤
│ vecli> r = rect(100, 50).fill("#ff0000")                       │
├─────────────────────────────────────────────────────────────────┤
│ icon.graph | 4 nodes | 3 edges | exec: 0.3ms      Ctrl+H help │
└─────────────────────────────────────────────────────────────────┘
```

## Live SVG Preview

In TUI mode, every graph mutation triggers:
1. Execute graph → `sceneToSvg()`
2. Write SVG to preview file
3. External viewer (browser, VS Code, Quick Look) auto-reloads via file watch

```bash
vecli --preview preview.svg       # enable live preview on start
```

```js
// In REPL
preview("preview.svg")           // start live preview to file
preview(false)                   // stop preview
preview()                        // show current preview path
```

The preview file is overwritten on every change — debounced at 100ms to avoid
thrashing during rapid edits. In batch mode, `--preview` writes once after
script completes.

## Error Handling

- Syntax errors → show line/column, don't crash REPL
- Node type not found → suggest similar (`did you mean "rectangle"?`)
- Cycle detection → "Cannot connect: would create cycle"
- File not found → clear error message with path
- WASM not loaded → "Boolean operations unavailable. Run with --wasm to enable."

## Examples

### Create icon from scratch

```js
// icon.js
canvas(24, 24)
const bg = rect(24, 24).fill("#4A90D9").roundCorners(4)
const arrow = path("M 7 12 L 12 7 L 17 12 M 12 7 L 12 17").stroke("#fff", 2, "round", "round")
group(bg, arrow).export("svg", "up-arrow.svg")
```

```bash
vecli -e icon.js
```

### Batch process SVGs

```js
// batch.js
const files = ["icon1.svg", "icon2.svg", "icon3.svg"]
for (const f of files) {
  open(f)
  nodes().filter(n => n.type === "fill").forEach(n => {
    set(n.id, "color", "#333333")  // rebrand all fills to dark gray
  })
  export("svg", f.replace(".svg", "-dark.svg"))
}
```

### Interactive exploration

```
vecli icon.graph

vecli> tree()
  n1 (rectangle 100×50)
    └→ n2 (fill #ff0000)
        └→ n3 (stroke #000 2px)
            └→ n4 (translate 10,20)

vecli> info(n2)
  Node: n2 (fill)
  Params: type=solid, color=#ff0000
  Inputs: path ← n1
  Outputs: path → n3, style → n3

vecli> set(n2, "color", "#00ff00")
vecli> undo()
vecli> export("svg")
  <svg xmlns="http://www.w3.org/2000/svg" ...>
```
