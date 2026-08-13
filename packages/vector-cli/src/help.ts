/**
 * @file Help system — brief and detailed help for all vecli commands
 *
 * Accessed via: vecli --help, vecli --help <topic>
 */

export function getHelp(topic?: string): string {
  if (!topic) return briefHelp();
  const t = topic.toLowerCase();
  if (t === 'all') return allHelp();
  const section = TOPICS[t];
  if (!section) return `Unknown topic "${topic}". Run vecli --help for available topics.`;
  return section;
}

function briefHelp(): string {
  return `vecli — Vector Engine CLI

Usage:
  vecli                              Interactive TUI mode (input + live preview)
  vecli 'expression'                 Evaluate inline expression
  vecli -e script.js                 Execute script file
  echo 'expr' | vecli               Pipe stdin

Flags:
  -e, --exec <file>     Execute script file
  -o, --output <file>   Output file (default: stdout)
  --format <svg|png>    Output format (default: svg)
  --canvas <WxH>        Canvas size (default: 100x100)
  --preview <file>      Live SVG preview file
  -h, --help [topic]    Show help (optionally for a topic)
  -v, --version         Show version

Quick examples:
  vecli 'rect(100,50).fill("#f00").svg()'
  vecli -e icon.js -o icon.svg
  vecli --canvas 24x24 'circle(10).fill("#333").svg()'

Run vecli --help <topic> for details. Topics:
  generators  style  transform  ops  boolean  deformation
  history  files  helpers  wordart  examples  all`;
}

const TOPICS: Record<string, string> = {
  generators: `GENERATORS — Create shapes

  rect(w, h)                     Rectangle at origin
  rect(w, h, x, y)              Positioned rectangle
  ellipse(rx, ry)                Ellipse
  ellipse(rx, ry, cx, cy)       Positioned ellipse
  circle(r)                      Circle (shorthand for ellipse)
  circle(r, cx, cy)             Positioned circle
  polygon(sides, radius)         Regular polygon
  star(points, outer, inner)     Star
  line(x1, y1, x2, y2)          Line segment
  arc(radius, start, end)        Arc
  spiral(spirals, radius)        Spiral
  arrow(length, width)           Arrow
  path("M 0 0 L 100 0 Z")      Raw SVG path
  text("Hello", fontSize)        Text to path (needs font)
  mesh(rows, cols)               Gradient mesh
  mesh(rows, cols, w, h)         Sized gradient mesh

All generators return a ChainableNode — chain .fill(), .stroke(), etc.

Examples:
  rect(100, 50).fill("#ff0000")
  circle(30).translate(50, 50).fill("#333")
  star(5, 40, 20).fill("#gold").stroke("#000", 1)
  path("M 0 0 C 33 100 66 100 100 0").stroke("#00f", 2)`,

  style: `STYLE — Visual properties

  .fill(color)                   Solid fill: .fill("#ff0000")
  .fill("linear", stops, from, to)  Linear gradient
  .stroke(color, width)          Stroke: .stroke("#000", 2)
  .stroke(color, w, cap, join)   Full: .stroke("#000", 2, "round", "round")
  .opacity(value)                Opacity 0..1
  .blend(mode)                   Blend: "multiply", "screen", "overlay", etc.
  .shadow(color, dx, dy, blur)   Drop shadow
  .blur(radius)                  Gaussian blur

Caps: "butt", "round", "square"
Joins: "miter", "round", "bevel"
Blend modes: normal, multiply, screen, overlay, darken, lighten,
  colorDodge, colorBurn, hardLight, softLight, difference, exclusion

Examples:
  rect(100, 100).fill("#ff0000").opacity(0.5)
  circle(50).fill("#333").shadow("#000", 2, 4, 6)
  rect(200, 200).fill("#fff").blur(3)`,

  transform: `TRANSFORM — Position, rotation, scale

  .translate(dx, dy)             Move
  .rotate(angle)                 Rotate (degrees)
  .rotate(angle, cx, cy)         Rotate around point
  .scale(s)                      Uniform scale
  .scale(sx, sy)                 Non-uniform scale
  .skew(sx, sy)                  Skew (degrees)

Examples:
  rect(50, 50).translate(100, 100)
  star(5, 40, 20).rotate(36).translate(100, 100)
  circle(10).scale(3).translate(50, 50)`,

  ops: `PATH OPERATIONS — Modify path geometry

  .roundCorners(radius)          Round corners
  .chamfer(distance)             Chamfer corners
  .smooth(smoothness)            Smooth corners (0..1)
  .offset(distance)              Inflate (+) or deflate (-)
  .trim(start, end)              Trim path (0..1)
  .reverse()                     Reverse direction
  .close()                       Close open path
  .dash(on, off)                 Dashed path
  .strokeToPath()                Convert stroke to filled path
  .subdivide(segIndex, t)        Split segment at parameter t
  .addPoint(segIndex, t)         Add anchor point
  .removePoint(index)            Remove anchor point
  .convertPoint(index, type)     Convert: "smooth", "corner", "symmetric"
  .enforceWinding(dir)           Force "cw" or "ccw" direction
  .variableStroke(profile)       Variable width stroke

Variable stroke profile: [{offset: 0, width: 2}, {offset: 1, width: 10}]

Examples:
  rect(100, 100).roundCorners(10).fill("#f00")
  circle(50).offset(5).fill("#333")
  line(0, 0, 100, 0).dash(10, 5).stroke("#000", 1)
  rect(100, 50).trim(0, 0.5).stroke("#f00", 2)`,

  boolean: `BOOLEAN OPERATIONS — Combine shapes

  union(a, b)                    Combine shapes
  subtract(a, b)                 Cut b from a
  intersect(a, b)                Keep overlap only
  xor(a, b)                      Exclude overlap
  clip(content, mask)            Clip content to mask shape
  group(a, b, ...)               Group into compound path
  join(a, b)                     Connect open path endpoints

Examples:
  const r = rect(100, 100)
  const c = circle(40).translate(50, 50)
  union(r, c).fill("#ff0000")
  subtract(r, c).fill("#00ff00")
  intersect(r, c).fill("#0000ff")

  // Logo: rectangle with circle cutout
  const bg = rect(200, 100).fill("#333")
  const hole = circle(30).translate(100, 50)
  subtract(bg, hole).svg()`,

  deformation: `DEFORMATION — Distort path geometry

  .roughen(size, detail)         Random displacement
  .zigzag(size, ridges)          Zigzag pattern
  .puckerBloat(amount)           Pucker (+) or bloat (-), -100..100
  .twist(angle)                  Spiral rotation (degrees)
  .warp(type, bend)              Warp: "arc", "wave", "flag", "bulge"
  .envelopeDistort(mesh)         Mesh-based deformation

Examples:
  circle(50).roughen(5, 8).fill("#f00")
  line(0, 0, 200, 0).zigzag(10, 8).stroke("#333", 1)
  rect(100, 100).puckerBloat(30).fill("#00f")
  rect(100, 50).warp("arc", 50).fill("#0a0")
  rect(100, 100).twist(45).fill("#f0f")`,

  history: `HISTORY & DAG MANIPULATION

  undo()                         Undo last operation
  undo(n)                        Undo n steps
  redo()                         Redo last
  redo(n)                        Redo n steps
  history()                      Show full history
  history(n)                     Show last n entries

  mute(node)                     Skip node during execution
  unmute(node)                   Re-enable node
  toggle(node)                   Toggle mute state

  remove(node)                   Remove node from graph
  set(node, param, value)        Set node parameter

  nodes()                        List all nodes (table)
  edges()                        List all edges
  info(node)                     Show node details
  tree()                         ASCII DAG visualization

Examples:
  const r = rect(100, 50).fill("#f00")
  set(r, "width", 200)
  mute(r)                        // fill skipped, rect passes through
  unmute(r)
  undo()
  tree()`,

  files: `FILE OPERATIONS

  open("file.graph")             Open binary graph file
  open("file.graph.json")        Open JSON graph file
  open("file.svg")               Import SVG → graph
  open("file.fig")               Import Figma file
  save()                         Save to current file
  save("file.graph")             Save as binary
  save("file.graph.json")        Save as JSON
  export("svg")                  Export SVG to stdout
  export("svg", "out.svg")       Export SVG to file

  preview("preview.svg")         Start live SVG preview
  preview(false)                 Stop preview

CLI flags:
  vecli -e script.js             Execute script file
  vecli -o output.svg            Output to file
  vecli -e in.js -o out.svg      Execute and save
  vecli --canvas 24x24           Set canvas size

Examples:
  open("icon.graph")
  set(someNode, "color", "#00ff00")
  save()
  export("svg", "icon.svg")`,

  helpers: `HELPERS — Utility functions for elegant one-liners

  rainbow(i, total)              HSL rainbow color at position i of total
  palette(count)                 Array of rainbow colors
  hsl(h, s, l)                   HSL to hex: hsl(200, 80, 50) → "#1a8ccc"
  lerp(a, b, t)                  Linear interpolation
  random(min?, max?)             Seeded random number
  setSeed(n)                     Set random seed
  deg(degrees)                   Degrees to radians
  pointOnCircle(cx, cy, r, deg)  Point on circle at angle

  grid(cols, rows, spacing, fn)  Create grid of shapes
    fn(x, y, index) → ChainableNode

  radial(count, radius, fn)      Radial arrangement
    fn(angle, index, x, y) → ChainableNode

  repeat(n, fn)                  Repeat with index
    fn(index, t) → ChainableNode    (t = 0..1 normalized)

One-liners:
  grid(8, 8, 25, (x,y,i) => rect(20,20).translate(x,y).fill(rainbow(i,64)))
  radial(12, 80, (a,i,x,y) => star(5,12,6).translate(x+100,y+100).rotate(a).fill(rainbow(i,12)))
  repeat(20, (i,t) => circle(lerp(3,15,t)).translate(i*10,50).fill(hsl(t*360,80,50)))`,

  wordart: `WORD ART & DECORATIVE HELPERS

  arcText(str, radius, start?, spread?, size?)   Text along arc
  wavyText(str, amplitude?, frequency?, size?)    Wavy text
  ribbon(w, h, curvature?)                        Curved banner
  badge(w, h, notchSize?)                         Octagonal badge
  burst(rays, outerR, innerR)                     Starburst shape
  spiralPath(turns, maxR, points?)                Spiral path
  bubble(w, h, tailX?, tailY?)                    Speech bubble
  heart(size?)                                    Heart shape (cubic bezier)
  cowsay(message, fontSize?)                      Speech bubble with ASCII cow
  label(str, x, y, opts?)                         SVG text annotation (no font needed)

  .png(filename?, width?)                         Export as PNG

  input                           Stdin data (from pipe)

Note: arcText/wavyText use text() which requires a loaded font for path outlines.
      label/cowsay use SVG text elements — no font loading needed.

Usage:
  echo "Hello" | vecli 'text(input, 48).fill("#f00")'
  vecli 'burst(16, 50, 25).fill("#ff0")'
  vecli 'ribbon(120, 30, 15).fill("#e74c3c")'
  vecli 'bubble(150, 80).fill("#fff").stroke("#333", 2)'
  vecli 'heart(60).fill("#e74c3c")'
  vecli 'cowsay("Moo!").fill("#fff").stroke("#333", 1.5)'
  vecli --format png 'circle(50).fill("#f00")' > out.png`,

  examples: `EXAMPLES — Full scripts

# Create an up-arrow icon
  canvas(24, 24)
  const bg = rect(24, 24).fill("#4A90D9").roundCorners(4)
  const arrow = path("M 7 12 L 12 7 L 17 12").stroke("#fff", 2, "round", "round")
  group(bg, arrow).export("svg", "up-arrow.svg")

# Badge with cutout
  const badge = rect(120, 40).fill("#e74c3c").roundCorners(20)
  const notch = circle(8).translate(110, 0)
  subtract(badge, notch).export("svg", "badge.svg")

# Radial pattern with loop
  canvas(200, 200)
  for (let i = 0; i < 12; i++) {
    const angle = i * 30
    const x = 100 + 60 * Math.cos(angle * Math.PI / 180)
    const y = 100 + 60 * Math.sin(angle * Math.PI / 180)
    circle(8).translate(x, y).fill(\`hsl(\${i * 30}, 80%, 50%)\`)
  }
  export("svg", "radial.svg")

# Batch recolor SVGs
  const files = ["a.svg", "b.svg", "c.svg"]
  for (const f of files) {
    open(f)
    // ... modify nodes ...
    export("svg", f.replace(".svg", "-dark.svg"))
  }

# Inspect and modify existing graph
  open("logo.graph")
  tree()                         // see the DAG structure
  nodes()                        // tabular node list
  set(someNode, "color", "#new")
  save()

# Elegant one-liners:
  vecli 'grid(8,8,25,(x,y,i)=>rect(20,20).translate(x,y).fill(rainbow(i,64)))'
  vecli 'radial(12,80,(a,i,x,y)=>star(5,12,6).translate(x+100,y+100).rotate(a).fill(rainbow(i,12)))'
  vecli 'repeat(20,(i,t)=>circle(lerp(3,15,t)).translate(i*10,50).fill(hsl(t*360,80,50)))'
  vecli 'repeat(10,(i)=>rect(100-i*10,100-i*10).translate(i*5,i*5).fill(rainbow(i,10)))'`,
};

function allHelp(): string {
  return [briefHelp(), '', '═'.repeat(60), '', ...Object.entries(TOPICS).map(([, content]) => `${content}\n`)].join(
    '\n',
  );
}
