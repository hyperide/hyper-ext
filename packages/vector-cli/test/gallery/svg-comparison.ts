/**
 * Test-only gallery comparison, called by SVG goldens and adversarial harness tests.
 * The serializer's SVG envelope and non-geometry bytes remain exact.
 * Bun/platform trig differences in burst/spiral can change the last coordinate bits.
 * Only M/L/C/Q/Z path coordinates in the corpus's flat SVG format are tolerant;
 * unfamiliar XML or path commands fall back to exact bytes (including arc flags).
 */
const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const GALLERY_SVG = /^<svg(?: [\w:-]+="[^"<>&]*")*>(?:<path(?: [\w:-]+="[^"<>&]*")*\/>)+<\/svg>$/;

function geometry(svg: string) {
  if (!GALLERY_SVG.test(svg)) return undefined;
  const coordinates: number[] = [];
  let supported = true;
  const structure = svg.replace(/<path [^<>]*\/>/g, (path) =>
    path.replace(/ d="([^"]*)"/g, (attribute, data: string) => {
      const commands = data.replace(NUMBER, '');
      if (!/^[MLCQZ\s,]+$/.test(commands)) {
        supported = false;
        return attribute;
      }
      return ` d="${data.replace(NUMBER, (token) => {
        coordinates.push(Number(token));
        return '#';
      })}"`;
    }),
  );
  return supported ? { structure, coordinates } : undefined;
}

export function gallerySvgMatches(actual: string, expected: string): boolean {
  if (actual === expected) return true;
  const a = geometry(actual);
  const b = geometry(expected);
  if (!a || !b || a.structure !== b.structure || a.coordinates.length !== b.coordinates.length) return false;
  return a.coordinates.every((value, index) => {
    const reference = b.coordinates[index];
    // Absolute allowance covers near-zero trig results; relative allowance is 1e-14
    // (about 45 binary64 epsilons). At the corpus's <=200 units this is <=2e-12 units.
    const budget = Math.max(1e-12, 1e-14 * Math.max(Math.abs(value), Math.abs(reference)));
    return Number.isFinite(value) && Number.isFinite(reference) && Math.abs(value - reference) <= budget;
  });
}
