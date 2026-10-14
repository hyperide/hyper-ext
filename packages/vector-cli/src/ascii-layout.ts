/** Conservative layout repair for explicitly delimited ASCII/Unicode frames.
 * Labels and connectors remain text, not guessed diagram semantics. Ambiguous/open
 * shapes are left alone. No padding is allowed to overwrite neighbouring content. */
export type AsciiFrame = { top: number; bottom: number; left: number; edges: number[] };
type Grid = string[][];
const TOP_LEFT = '+┌┏╔╭';
const TOP_RIGHT = '+┐┓╗╮';
const BOTTOM_LEFT = '+└┗╚╰';
const BOTTOM_RIGHT = '+┘┛╝╯';
const LEFT_SIDE = '|│┃║├╠┣┠┝╟╞+';
const RIGHT_SIDE = '|│┃║┤╣┫┨┥╢╡+';
const HORIZONTAL = '-─━═_=';
const get = (rows: Grid, r: number, c: number) => rows[r]?.[c] ?? ' ';
const isHorizontal = (c: string) => HORIZONTAL.includes(c);
function endOfBorder(row: string[], left: number, rightSet: string): number {
  for (let end = left + 2; end < row.length; end++) {
    if (!rightSet.includes(row[end])) continue;
    if (row[end] === '+' && isHorizontal(row[end + 1] ?? ' ')) continue;
    const inside = row.slice(left + 1, end).join('');
    if (!/[-─━═_=]{2}/.test(inside) || /[│┃║|┌┏╔╭┐┓╗╮└┗╚╰┘┛╝╯]/.test(inside)) return -1;
    return end;
  }
  return -1;
}
function sideEnd(row: string[], left: number, expected: number, columns: number): number {
  const candidates = row.flatMap((c, i) => (i > left + 1 && RIGHT_SIDE.includes(c) ? [i] : []));
  if (columns > 1) return candidates[columns - 1] ?? -1;
  candidates.sort((a, b) => Math.abs(a - expected) - Math.abs(b - expected));
  return candidates[0] ?? -1;
}
function findAsciiFrames(rows: Grid): AsciiFrame[] {
  const frames: AsciiFrame[] = [];
  for (let top = 0; top < rows.length; top++)
    for (let left = 0; left < rows[top].length; left++) {
      if (!TOP_LEFT.includes(get(rows, top, left)) || (left > 0 && isHorizontal(get(rows, top, left - 1)))) continue;
      if (get(rows, top, left) === '+' && '|│┃║'.includes(get(rows, top - 1, left))) continue;
      const right = endOfBorder(rows[top], left, TOP_RIGHT);
      if (right < 0) continue;
      for (let bottom = top + 1; bottom < rows.length; bottom++) {
        const start = get(rows, bottom, left);
        if (BOTTOM_LEFT.includes(start)) {
          const end = endOfBorder(rows[bottom], left, BOTTOM_RIGHT);
          // A '+' row followed by more sides is a table divider, not its bottom.
          if (end >= 0 && !(start === '+' && '|│┃║'.includes(get(rows, bottom + 1, left)))) {
            const expected = Math.max(right, end);
            const columns = rows[top].slice(left + 1, right).filter((c) => '┬╦+'.includes(c)).length + 1;
            const edges = [right];
            for (let row = top + 1; row < bottom; row++) edges.push(sideEnd(rows[row], left, expected, columns));
            edges.push(end);
            if (edges.every((e) => e > left + 1)) frames.push({ top, bottom, left, edges });
            break;
          }
        }
        if (!LEFT_SIDE.includes(start)) break;
      }
    }
  return frames;
}
function borderPadding(value: string, border: boolean): string {
  if (!border) return ' ';
  return [...value].find(isHorizontal) ?? '-';
}
function repairFrame(rows: Grid, frame: AsciiFrame): boolean {
  const { top, bottom, left, edges } = frame;
  const originals = rows.slice(top, bottom + 1).map((row, i) => row.slice(left, edges[i] + 1));
  let target = Math.max(...edges);
  let replacements: string[][];
  const splitCells = (line: string[]) =>
    line
      .slice(1, -1)
      .join('')
      .split(/[|│┃║┬┴┼╦╩╬+]/);
  const columnCount = splitCells(originals[0]).length;
  const cells = originals.map(splitCells);
  if (columnCount > 1 && cells.every((row) => row.length === columnCount)) {
    const widths = Array.from({ length: columnCount }, (_, i) => Math.max(...cells.map((row) => [...row[i]].length)));
    target = left + widths.reduce((sum, width) => sum + width, 0) + columnCount;
    replacements = originals.map((line, i) => {
      const separators = line.slice(1, -1).filter((c) => '|│┃║┬┴┼╦╩╬+'.includes(c));
      const result = [line[0]];
      cells[i].forEach((value, column) => {
        const border = i === 0 || i === originals.length - 1 || [...value].every((c) => isHorizontal(c) || c === ' ');
        const padding = borderPadding(value, border);
        result.push(...value, ...Array(widths[column] - [...value].length).fill(padding));
        result.push(column < separators.length ? separators[column] : line[line.length - 1]);
      });
      return result;
    });
  } else {
    replacements = originals.map((line, i) => {
      const inside = line.slice(1, -1).join('');
      const border =
        i === 0 || i === originals.length - 1 || ('┤╣┫+'.includes(line[line.length - 1]) && /[-─━═_=]$/.test(inside));
      return [
        ...line.slice(0, -1),
        ...Array(target - edges[i]).fill(borderPadding(inside, border)),
        line[line.length - 1],
      ];
    });
  }
  if (target >= 400) throw new Error('Repaired ASCII diagram exceeds 400 columns');
  // Keep neighbouring frames/connectors at their own coordinates; never overwrite them.
  if (edges.some((edge, i) => rows[top + i].slice(edge + 1, target + 1).some((c) => c !== ' ' && !isHorizontal(c))))
    return false;
  let changed = false;
  replacements.forEach((replacement, i) => {
    const row = rows[top + i];
    const before = row.join('');
    while (row.length <= target) row.push(' ');
    row.splice(left, target - left + 1, ...replacement);
    if (row.join('') !== before) changed = true;
  });
  return changed;
}
export function layoutAscii(source: string): { grid: Grid; frames: AsciiFrame[] } {
  const grid = source
    .replace(/\r\n?/g, '\n')
    .replace(/^\n|\n$/g, '')
    .split('\n')
    .map((line) => {
      const row: string[] = [];
      for (const c of line) {
        if (c === '\t') row.push(...Array(4 - (row.length % 4)).fill(' '));
        else row.push(c);
      }
      return row;
    });
  if (grid.length > 250 || grid.some((row) => row.length > 400))
    throw new Error('ASCII diagram limit: 250 lines × 400 columns');
  const frames = findAsciiFrames(grid).sort((a, b) => a.bottom - a.top - (b.bottom - b.top) || a.left - b.left);
  for (const frame of frames) repairFrame(grid, frame);
  return { grid, frames: findAsciiFrames(grid) };
}
