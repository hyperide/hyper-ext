import { parseTailwindClasses } from '@lib/tailwind/parser';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import twColors from 'tailwindcss/colors';
import { z } from 'zod';

// Build color palette from tailwindcss/colors
const TW_COLOR_NAMES = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
] as const;

interface ColorEntry {
  token: string;
  hex: string;
}

const ALL_COLORS: ColorEntry[] = [
  { token: 'white', hex: '#ffffff' },
  { token: 'black', hex: '#000000' },
];

for (const name of TW_COLOR_NAMES) {
  const palette = twColors[name as keyof typeof twColors];
  if (palette && typeof palette === 'object') {
    for (const [shade, hex] of Object.entries(palette)) {
      if (typeof hex === 'string') {
        ALL_COLORS.push({ token: `${name}-${shade}`, hex: hex.toLowerCase() });
      }
    }
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return null;
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return { r, g, b };
}

function colorDistance(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return Infinity;
  return Math.sqrt((rgb1.r - rgb2.r) ** 2 + (rgb1.g - rgb2.g) ** 2 + (rgb1.b - rgb2.b) ** 2);
}

function parseAnyColorToHex(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('#') && (trimmed.length === 4 || trimmed.length === 7)) {
    if (trimmed.length === 4) {
      return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
    }
    return trimmed;
  }
  const rgbMatch = trimmed.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgbMatch) {
    const r = Number.parseInt(rgbMatch[1], 10);
    const g = Number.parseInt(rgbMatch[2], 10);
    const b = Number.parseInt(rgbMatch[3], 10);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  return null;
}

function findNearestTokens(hex: string, count: number): Array<{ token: string; hex: string; distance: number }> {
  return ALL_COLORS.map((c) => ({ ...c, distance: colorDistance(hex, c.hex) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count);
}

export function registerTailwindTools(server: McpServer): void {
  server.tool(
    'hyper_get_element_styles',
    'Parse a Tailwind CSS className string into structured style properties. Returns an object with CSS property names and their resolved values (e.g. {"display": "flex", "gap": "1rem"}).',
    {
      className: z.string().describe('The className string to parse, e.g. "flex flex-col gap-4 p-2"'),
    },
    async ({ className }) => {
      const styles = parseTailwindClasses(className);
      return { content: [{ type: 'text' as const, text: JSON.stringify(styles, null, 2) }] };
    },
  );

  server.tool(
    'hyper_suggest_color_token',
    'Find the nearest Tailwind color tokens for a given color value. Accepts hex (#ff0000), rgb(r,g,b), or Tailwind arbitrary values like [rgb(127,29,29)]. Returns top 5 closest tokens with distance.',
    {
      color: z.string().describe('Color value: hex (#ff0000), rgb(127,29,29), or arbitrary [rgb(127,29,29)]'),
    },
    async ({ color }) => {
      // Strip arbitrary value brackets
      const cleaned = color.replace(/^\[|\]$/g, '');
      const hex = parseAnyColorToHex(cleaned);
      if (!hex) {
        return {
          content: [{ type: 'text' as const, text: `Cannot parse color "${color}". Use hex (#rrggbb) or rgb(r,g,b).` }],
          isError: true,
        };
      }

      const nearest = findNearestTokens(hex, 5);
      const lines = nearest.map((t, i) => `${i + 1}. ${t.token} (${t.hex}) — distance: ${t.distance.toFixed(1)}`);

      const exact = nearest[0]?.distance === 0;
      const header = exact ? `Exact match: ${nearest[0].token}` : `No exact match for ${hex}. Nearest Tailwind tokens:`;

      return { content: [{ type: 'text' as const, text: `${header}\n${lines.join('\n')}` }] };
    },
  );

  server.tool(
    'hyper_list_tailwind_colors',
    'List all available Tailwind color tokens. Optionally filter by color family (e.g. "red", "blue", "emerald").',
    {
      family: z.string().optional().describe('Color family to filter: red, blue, green, etc. Omit for all colors.'),
    },
    async ({ family }) => {
      let filtered = ALL_COLORS;
      if (family) {
        const f = family.toLowerCase();
        filtered = ALL_COLORS.filter((c) => c.token === f || c.token.startsWith(`${f}-`));
        if (filtered.length === 0) {
          const families = [...new Set(ALL_COLORS.map((c) => c.token.split('-')[0]))];
          return {
            content: [
              {
                type: 'text' as const,
                text: `Unknown family "${family}". Available: ${families.join(', ')}`,
              },
            ],
            isError: true,
          };
        }
      }

      const lines = filtered.map((c) => `${c.token}: ${c.hex}`);
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
