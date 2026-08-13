declare module 'txml';
declare module 'harfbuzzjs';

declare module 'opentype.js' {
  // Minimal surface used by vector-engine/text-to-path; opentype.js ships no .d.ts.
  export type PathCommand =
    | { type: 'M'; x: number; y: number }
    | { type: 'L'; x: number; y: number }
    | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: 'Q'; x1: number; y1: number; x: number; y: number }
    | { type: 'Z' };

  export interface Path {
    commands: PathCommand[];
  }

  export interface Font {
    getPath(text: string, x: number, y: number, fontSize: number): Path;
  }

  // Tests pull in additional shapes loosely; widening to any keeps strict mode happy.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opentype: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const load: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const parse: any;
  export default opentype;
}
