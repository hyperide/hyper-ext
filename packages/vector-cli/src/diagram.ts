import { layoutAscii } from './ascii-layout';
/** Deterministic, dependency-free SVG primitives for specifications.
 * No DOM, CanvasKit, font download or arbitrary SVG/CSS injection required. */
export const DIAGRAM_PRESETS = {
  state: {
    paper: '#f5f8f7',
    panel: '#ffffff',
    ink: '#17211f',
    muted: '#5c6b68',
    line: '#c3d6d0',
    accent: '#0e7a6d',
    soft: '#e2f0ed',
  },
  blue: {
    paper: '#f5f8fb',
    panel: '#ffffff',
    ink: '#182a3b',
    muted: '#576a7a',
    line: '#cbdcea',
    accent: '#28618f',
    soft: '#e3edf5',
  },
  amber: {
    paper: '#fcf9f3',
    panel: '#ffffff',
    ink: '#352a1a',
    muted: '#77664f',
    line: '#e3d4b9',
    accent: '#a66a1f',
    soft: '#f6eddd',
  },
  dark: {
    paper: '#0e1413',
    panel: '#151d1b',
    ink: '#e4ece9',
    muted: '#9aada6',
    line: '#39534b',
    accent: '#65c9b5',
    soft: '#203d35',
  },
} as const;
/** Palette vocabulary consumed by the standalone state-lib site. @public */
export type DiagramPreset = keyof typeof DIAGRAM_PRESETS;
export type Point = readonly [number, number];
export type DiagramOptions = { preset?: DiagramPreset; padding?: number; title?: string; fontSize?: number };
export type FrameSpec = {
  type: 'frame';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  title?: string;
  text?: string;
};
export type TableSpec = {
  type: 'table';
  x?: number;
  y?: number;
  rows: readonly (readonly (string | number | boolean | null)[])[];
  header?: boolean;
  widths?: readonly number[];
};
export type ArrowSpec = {
  type: 'arrow';
  from: Point;
  to: Point;
  via?: readonly Point[];
  label?: string;
  both?: boolean;
};
type LabelSpec = { type: 'label'; x: number; y: number; text: string };
export type DiagramSpec = FrameSpec | TableSpec | ArrowSpec | LabelSpec;
type Part = { body: string; bounds: [number, number, number, number] };
type Theme = (typeof DIAGRAM_PRESETS)[DiagramPreset];
const MAX_SIDE = 16000,
  MAX_TEXT = 200000;
function escapeXml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"'\p{Cc}]/gu, (c) => {
    const code = c.charCodeAt(0);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return '';
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] ?? c;
  });
}
function finite(n: unknown, name: string, min = -MAX_SIDE, max = MAX_SIDE): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max)
    throw new Error(`${name} must be finite and between ${min} and ${max}`);
  return n;
}
const fmt = (n: number) => String(Math.round(n * 100) / 100);
function themeOf(options: DiagramOptions): Theme {
  const name = options.preset ?? 'state';
  if (!Object.hasOwn(DIAGRAM_PRESETS, name)) throw new Error(`Unknown preset: ${name}`);
  return DIAGRAM_PRESETS[name];
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Text must be a string');
  if (value.length > MAX_TEXT) throw new Error('Text is too large');
  return value;
}
function wrap(value: string, columns: number): string[] {
  columns = Math.max(1, Math.floor(columns));
  return value.split('\n').flatMap((line) => {
    const out: string[] = [];
    let remaining = [...line];
    while (remaining.length > columns) {
      let cut = remaining.slice(0, columns + 1).lastIndexOf(' ');
      if (cut < columns / 3) cut = columns;
      out.push(remaining.slice(0, cut).join(''));
      remaining = remaining.slice(cut);
      if (remaining[0] === ' ') remaining.shift();
    }
    out.push(remaining.join(''));
    return out;
  });
}
function linesSvg(
  lines: string[],
  x: number,
  y: number,
  size: number,
  fill: string,
  weight = 400,
  mono = false,
): string {
  return `<text xml:space="preserve" x="${fmt(x)}" y="${fmt(y)}" font-family="${mono ? 'ui-monospace, SFMono-Regular, Consolas, monospace' : 'system-ui, -apple-system, Segoe UI, sans-serif'}" font-size="${size}" font-weight="${weight}" fill="${fill}">${lines.map((line, i) => `<tspan x="${fmt(x)}" dy="${i ? fmt(size * 1.5) : 0}">${escapeXml(line)}</tspan>`).join('')}</text>`;
}
function framePart(spec: FrameSpec, theme: Theme, size: number): Part {
  const x = finite(spec.x ?? 0, 'x'),
    y = finite(spec.y ?? 0, 'y');
  const width = finite(spec.width ?? 280, 'frame width', 64);
  const title = text(spec.title ?? ''),
    body = text(spec.text ?? '');
  const titleLines = title ? wrap(title, (width - 36) / (size * 0.68)) : [];
  const bodyLines = body ? wrap(body, (width - 36) / (size * 0.61)) : [];
  const titleHeight = titleLines.length ? titleLines.length * size * 1.5 + 22 : 0;
  const needed = Math.max(52, 20 + titleHeight + bodyLines.length * size * 1.5 + (bodyLines.length ? 12 : 0));
  const height = finite(spec.height ?? needed, 'frame height', 32);
  if (height < needed) throw new Error(`Frame text requires height >= ${Math.ceil(needed)}`);
  let svg = `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}" rx="10" fill="${theme.panel}" stroke="${theme.line}" stroke-width="1.5"/>`;
  if (titleLines.length) {
    svg += `<path d="M ${fmt(x + 12)} ${fmt(y)} H ${fmt(x + width - 12)}" stroke="${theme.accent}" stroke-width="3"/>`;
    svg += linesSvg(titleLines, x + 18, y + size + 16, size, theme.accent, 650);
    if (bodyLines.length)
      svg += `<path d="M ${fmt(x + 16)} ${fmt(y + titleHeight + 6)} H ${fmt(x + width - 16)}" stroke="${theme.line}"/>`;
  }
  if (bodyLines.length) svg += linesSvg(bodyLines, x + 18, y + titleHeight + size + 20, size, theme.ink);
  return { body: svg, bounds: [x, y, x + width, y + height] };
}
function tablePart(spec: TableSpec, theme: Theme, size: number): Part {
  if (!Array.isArray(spec.rows) || !spec.rows.length || spec.rows.length > 1000)
    throw new Error('Table requires 1–1000 rows');
  const columns = spec.rows[0].length;
  if (!columns || columns > 100 || spec.rows.some((r) => !Array.isArray(r) || r.length !== columns))
    throw new Error('Table rows must be rectangular, with 1–100 columns');
  if (spec.widths && spec.widths.length !== columns) throw new Error('Column width count must match the table');
  const x = finite(spec.x ?? 0, 'x'),
    y = finite(spec.y ?? 0, 'y');
  const cells: string[][] = spec.rows.map((row: TableSpec['rows'][number]) =>
    row.map((cell: unknown) => {
      if (cell !== null && !['string', 'number', 'boolean'].includes(typeof cell))
        throw new Error('Table cells must be scalar text/number/boolean/null');
      return text(String(cell ?? ''));
    }),
  );
  const widths = Array.from({ length: columns }, (_, c) =>
    finite(
      spec.widths?.[c] ??
        Math.min(
          320,
          Math.max(72, ...cells.map((r) => Math.max(...r[c].split('\n').map((l) => [...l].length)) * size * 0.63 + 28)),
        ),
      'column width',
      36,
    ),
  );
  const wrapped = cells.map((row) => row.map((cell, c) => wrap(cell, (widths[c] - 24) / (size * 0.63))));
  const heights = wrapped.map((row) => Math.max(...row.map((lines) => lines.length)) * size * 1.5 + 22);
  const width = widths.reduce((a, b) => a + b, 0),
    height = heights.reduce((a, b) => a + b, 0);
  finite(width, 'table width', 1);
  finite(height, 'table height', 1);
  let svg = '',
    dy = y;
  wrapped.forEach((row, r) => {
    svg += `<rect x="${fmt(x)}" y="${fmt(dy)}" width="${fmt(width)}" height="${fmt(heights[r])}" fill="${r === 0 && spec.header !== false ? theme.soft : r % 2 ? theme.panel : theme.paper}"/>`;
    let dx = x;
    row.forEach((lines, c) => {
      svg += linesSvg(
        lines,
        dx + 12,
        dy + size + 10,
        size,
        r === 0 && spec.header !== false ? theme.accent : theme.ink,
        r === 0 && spec.header !== false ? 650 : 400,
      );
      dx += widths[c];
    });
    if (r) svg += `<path d="M ${fmt(x)} ${fmt(dy)} H ${fmt(x + width)}" stroke="${theme.line}"/>`;
    dy += heights[r];
  });
  let dx = x;
  for (const w of widths.slice(0, -1)) {
    dx += w;
    svg += `<path d="M ${fmt(dx)} ${fmt(y)} V ${fmt(y + height)}" stroke="${theme.line}"/>`;
  }
  svg += `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}" rx="2" fill="none" stroke="${theme.line}" stroke-width="1.5"/>`;
  return { body: svg, bounds: [x, y, x + width, y + height] };
}
function point(value: Point, name: string): Point {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${name} must be [x,y]`);
  return [finite(value[0], `${name} x`), finite(value[1], `${name} y`)];
}
function head(tip: Point, tail: Point, color: string): string {
  const angle = Math.atan2(tip[1] - tail[1], tip[0] - tail[0]),
    len = 9,
    wing = 4.5;
  const x = tip[0] - len * Math.cos(angle),
    y = tip[1] - len * Math.sin(angle);
  return `<polygon points="${fmt(tip[0])},${fmt(tip[1])} ${fmt(x - wing * Math.sin(angle))},${fmt(y + wing * Math.cos(angle))} ${fmt(x + wing * Math.sin(angle))},${fmt(y - wing * Math.cos(angle))}" fill="${color}"/>`;
}
function arrowPart(spec: ArrowSpec, theme: Theme, size: number): Part {
  if (spec.via && (!Array.isArray(spec.via) || spec.via.length > 100))
    throw new Error('At most 100 intermediate arrow points');
  const points = [point(spec.from, 'from'), ...(spec.via ?? []).map((p) => point(p, 'via')), point(spec.to, 'to')];
  if (points.every((p) => p[0] === points[0][0] && p[1] === points[0][1]))
    throw new Error('Arrow must have nonzero length');
  const clean = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  let svg = `<path d="${clean.map((p, i) => `${i ? 'L' : 'M'} ${fmt(p[0])} ${fmt(p[1])}`).join(' ')}" fill="none" stroke="${theme.accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  svg += head(clean.at(-1)!, clean.at(-2)!, theme.accent);
  if (spec.both) svg += head(clean[0], clean[1], theme.accent);
  const bounds: [number, number, number, number] = [
    Math.min(...clean.map((p) => p[0])) - 10,
    Math.min(...clean.map((p) => p[1])) - 10,
    Math.max(...clean.map((p) => p[0])) + 10,
    Math.max(...clean.map((p) => p[1])) + 10,
  ];
  if (spec.label) {
    const label = text(spec.label),
      w = Math.max(40, [...label].length * size * 0.63 + 18);
    const mid = clean[Math.floor((clean.length - 1) / 2)],
      end = clean[Math.ceil((clean.length - 1) / 2)];
    const x = (mid[0] + end[0]) / 2 - w / 2,
      y = (mid[1] + end[1]) / 2 - size - 7;
    svg += `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(size + 12)}" rx="4" fill="${theme.paper}"/>${linesSvg([label], x + 9, y + size + 2, size, theme.muted)}`;
    bounds[0] = Math.min(bounds[0], x);
    bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x + w);
    bounds[3] = Math.max(bounds[3], y + size + 12);
  }
  return { body: svg, bounds };
}
function svgDocument(parts: Part[], options: DiagramOptions): string {
  if (!parts.length) throw new Error('Diagram has no elements');
  const theme = themeOf(options),
    pad = finite(options.padding ?? 24, 'padding', 0, 500);
  const x = Math.min(...parts.map((p) => p.bounds[0])) - pad,
    y = Math.min(...parts.map((p) => p.bounds[1])) - pad;
  const width = Math.max(...parts.map((p) => p.bounds[2])) - x + pad,
    height = Math.max(...parts.map((p) => p.bounds[3])) - y + pad;
  finite(width, 'SVG width', 1);
  finite(height, 'SVG height', 1);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}" height="${fmt(height)}" viewBox="${fmt(x)} ${fmt(y)} ${fmt(width)} ${fmt(height)}" role="img"><title>${escapeXml(options.title ?? 'Specification diagram')}</title><rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}" rx="12" fill="${theme.paper}"/>${parts.map((p) => p.body).join('')}</svg>\n`;
}
export function renderDiagram(elements: readonly DiagramSpec[], options: DiagramOptions = {}): string {
  if (!Array.isArray(elements) || elements.length > 2000)
    throw new Error('Expected an array of at most 2000 diagram elements');
  const theme = themeOf(options),
    size = finite(options.fontSize ?? 14, 'font size', 8, 48);
  const parts = elements.map((spec): Part => {
    if (!spec || typeof spec !== 'object') throw new Error('Invalid diagram element');
    switch (spec.type) {
      case 'frame':
        return framePart(spec, theme, size);
      case 'table':
        return tablePart(spec, theme, size);
      case 'arrow':
        return arrowPart(spec, theme, size);
      case 'label': {
        const x = finite(spec.x, 'x'),
          y = finite(spec.y, 'y'),
          value = text(spec.text);
        return {
          body: linesSvg(value.split('\n'), x, y, size, theme.ink),
          bounds: [
            x,
            y - size,
            x + Math.max(...value.split('\n').map((l) => [...l].length)) * size * 0.65,
            y + (value.split('\n').length - 1) * size * 1.5 + size / 2,
          ],
        };
      }
      default:
        throw new Error(`Unknown diagram type: ${String((spec as { type?: unknown }).type)}`);
    }
  });
  return svgDocument(parts, options);
}
export const diagramFrame = (spec: Omit<FrameSpec, 'type'> = {}, options: DiagramOptions = {}) =>
  renderDiagram([{ ...spec, type: 'frame' }], options);
export const diagramTable = (
  rows: TableSpec['rows'],
  options: DiagramOptions & Omit<TableSpec, 'type' | 'rows'> = {},
) => renderDiagram([{ ...options, type: 'table', rows }], options);
export const diagramArrow = (
  from: Point,
  to: Point,
  options: DiagramOptions & Omit<ArrowSpec, 'type' | 'from' | 'to'> = {},
) => renderDiagram([{ ...options, type: 'arrow', from, to }], options);

/** Grid-based ASCII/Unicode box diagram renderer. Converts borders/connectors into
 * aligned paths and arrowheads, repairing unambiguous frame/table edges first. Not a terminal
 * emulator: tabs are expanded to four columns; wide/combined emoji layouts are not guaranteed. */
export function asciiToSvg(source: string, options: DiagramOptions = {}): string {
  source = text(source)
    .replace(/\r\n?/g, '\n')
    .replace(/^\n|\n$/g, '');
  if (!source.trim()) throw new Error('ASCII diagram is empty');
  const { grid, frames } = layoutAscii(source);
  const cols = Math.max(...grid.map((r) => r.length));
  if (grid.length > 250 || cols > 400) throw new Error('ASCII diagram limit: 250 lines × 400 columns');
  const theme = themeOf(options),
    size = finite(options.fontSize ?? 14, 'font size', 8, 32),
    cw = size * 0.64,
    ch = size * 1.65;
  const at = (r: number, c: number) => grid[r]?.[c] ?? ' ';
  const marked = new Set<string>(),
    key = (r: number, c: number) => `${r},${c}`;
  const hor = (v: string) => '-─━═_='.includes(v);
  const ver = (v: string) => '|│┃║'.includes(v);
  const corners = '╭╮╰╯┌┐└┘┏┓┗┛╔╗╚╝├┤┬┴┼╠╣╦╩╬+';
  const arrows = '<>^v←→↑↓';
  const dirs: Record<string, string> = {
    '─': 'lr',
    '━': 'lr',
    '═': 'lr',
    '│': 'ud',
    '┃': 'ud',
    '║': 'ud',
    '╭': 'rd',
    '╮': 'ld',
    '╰': 'ru',
    '╯': 'lu',
    '┌': 'rd',
    '┏': 'rd',
    '╔': 'rd',
    '┐': 'ld',
    '┓': 'ld',
    '╗': 'ld',
    '└': 'ru',
    '┗': 'ru',
    '╚': 'ru',
    '┘': 'lu',
    '┛': 'lu',
    '╝': 'lu',
    '├': 'udr',
    '╠': 'udr',
    '┤': 'udl',
    '╣': 'udl',
    '┬': 'lrd',
    '╦': 'lrd',
    '┴': 'lru',
    '╩': 'lru',
    '┼': 'udlr',
    '╬': 'udlr',
  };
  for (let r = 0; r < grid.length; r++)
    for (let c = 0; c < grid[r].length; c++) {
      const v = at(r, c);
      if (dirs[v]) marked.add(key(r, c));
      else if (
        hor(v) &&
        (hor(at(r, c - 1)) ||
          hor(at(r, c + 1)) ||
          corners.includes(at(r, c - 1)) ||
          corners.includes(at(r, c + 1)) ||
          '<>'.includes(at(r, c - 1)) ||
          '<>'.includes(at(r, c + 1)))
      )
        marked.add(key(r, c));
      else if (
        ver(v) &&
        (ver(at(r - 1, c)) || ver(at(r + 1, c)) || corners.includes(at(r - 1, c)) || corners.includes(at(r + 1, c)))
      )
        marked.add(key(r, c));
      else if (v === '+' && (hor(at(r, c - 1)) || hor(at(r, c + 1)) || ver(at(r - 1, c)) || ver(at(r + 1, c))))
        marked.add(key(r, c));
      else if (
        arrows.includes(v) &&
        (('><←→'.includes(v) && (hor(at(r, c - 1)) || hor(at(r, c + 1)))) ||
          ('^v↑↓'.includes(v) && (ver(at(r - 1, c)) || ver(at(r + 1, c)))))
      )
        marked.add(key(r, c));
    }
  let fills = '',
    path = '',
    heads = '',
    labels = '';
  // Repaired closed frames are semantic rectangles, including inline-title borders.
  for (const frame of frames) {
    const right = frame.edges[0];
    if (!frame.edges.every((edge) => edge === right)) continue;
    fills += `<rect data-ascii-frame="true" x="${fmt(frame.left * cw + cw / 2)}" y="${fmt(frame.top * ch + ch / 2)}" width="${fmt((right - frame.left) * cw)}" height="${fmt((frame.bottom - frame.top) * ch)}" rx="3" fill="${theme.panel}"/>`;
  }
  for (let r = 0; r < grid.length; r++) {
    let label = '',
      start = 0;
    const flush = () => {
      if (label.trim())
        labels += linesSvg([label.trimEnd()], start * cw, r * ch + ch / 2 + size * 0.34, size, theme.ink, 400, true);
      label = '';
    };
    for (let c = 0; c < cols; c++) {
      const v = at(r, c),
        x = c * cw + cw / 2,
        y = r * ch + ch / 2;
      if (!marked.has(key(r, c))) {
        if (!label) start = c;
        label += v;
        continue;
      }
      flush();
      if (arrows.includes(v)) {
        const d = '>→'.includes(v) ? [1, 0] : '<←'.includes(v) ? [-1, 0] : '^↑'.includes(v) ? [0, -1] : [0, 1];
        heads += head([x + d[0] * cw * 0.4, y + d[1] * ch * 0.3], [x - d[0] * cw, y - d[1] * ch], theme.accent);
        path += `M ${fmt(x - d[0] * cw * 0.5)} ${fmt(y - d[1] * ch * 0.5)} L ${fmt(x)} ${fmt(y)} `;
        continue;
      }
      let ds = dirs[v] ?? (hor(v) ? 'lr' : ver(v) ? 'ud' : '');
      if (v === '+')
        ds =
          (marked.has(key(r, c - 1)) ? 'l' : '') +
          (marked.has(key(r, c + 1)) ? 'r' : '') +
          (marked.has(key(r - 1, c)) ? 'u' : '') +
          (marked.has(key(r + 1, c)) ? 'd' : '');
      for (const d of ds) {
        const dx = d === 'l' ? -cw / 2 : d === 'r' ? cw / 2 : 0,
          dy = d === 'u' ? -ch / 2 : d === 'd' ? ch / 2 : 0;
        path += `M ${fmt(x)} ${fmt(y)} l ${fmt(dx)} ${fmt(dy)} `;
      }
    }
    flush();
  }
  const body = `${fills}<path d="${path}" stroke="${theme.accent}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>${heads}${labels}`;
  return svgDocument([{ body, bounds: [0, 0, cols * cw, grid.length * ch] }], options);
}

/** Normalize explicit frames/tables without rasterizing their text. @public */
export function normalizeAsciiDiagram(source: string): string {
  return layoutAscii(text(source))
    .grid.map((row) => row.join('').trimEnd())
    .join('\n');
}
