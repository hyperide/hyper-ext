import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { StateHub } from '../../StateHub';
import type { AstService } from '../../services/AstService';
import { resolveFilePath } from '../types';

// Map of Tailwind class prefixes to CSS property names
const TW_PREFIX_TO_CSS: Record<string, string> = {
  bg: 'backgroundColor',
  text: 'color',
  border: 'borderColor',
  ring: 'ringColor',
  shadow: 'shadowColor',
  p: 'padding',
  px: 'paddingLeft',
  py: 'paddingTop',
  pt: 'paddingTop',
  pr: 'paddingRight',
  pb: 'paddingBottom',
  pl: 'paddingLeft',
  m: 'margin',
  mx: 'marginLeft',
  my: 'marginTop',
  mt: 'marginTop',
  mr: 'marginRight',
  mb: 'marginBottom',
  ml: 'marginLeft',
  w: 'width',
  h: 'height',
  gap: 'gap',
  rounded: 'borderRadius',
  opacity: 'opacity',
};

/**
 * Normalize styles input from AI agents that may pass Tailwind classes
 * instead of CSS properties, or mix formats in creative ways.
 */
function normalizeStylesInput(raw: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(raw)) {
    // Case 1: AI passed "className" with full Tailwind string — skip, not a style property
    if (key === 'className' || key === 'class') continue;

    // Case 2: Key looks like a Tailwind class (e.g. "bg-red-500": "" or "flex": "")
    // Detect: key contains a dash and matches known TW prefix, or is a known utility
    const twPrefixMatch = key.match(
      /^(bg|text|border|ring|shadow|rounded|opacity|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|w|h|gap)-(.+)$/,
    );
    if (twPrefixMatch && (!value || value === 'true')) {
      const cssKey = TW_PREFIX_TO_CSS[twPrefixMatch[1]];
      if (cssKey) {
        result[cssKey] = twPrefixMatch[2];
        continue;
      }
    }

    // Case 3: Value looks like a Tailwind class (e.g. {"backgroundColor": "bg-red-500"})
    const valueTwMatch = value.match(/^(bg|text|border|ring|shadow)-(.+)$/);
    if (valueTwMatch) {
      const cssKey = TW_PREFIX_TO_CSS[valueTwMatch[1]] ?? key;
      result[cssKey] = valueTwMatch[2];
      continue;
    }

    // Case 4: Normal CSS property — pass through
    result[key] = value;
  }

  return result;
}

export function registerAstTools(server: McpServer, astService: AstService, stateHub: StateHub): void {
  server.tool(
    'hyper_insert_element',
    'Insert a JSX element into a React component. Elements must have data-uniq-id attributes — run hyper_inject_element_ids first if needed. Omit filePath to use the currently active component.',
    {
      filePath: z
        .string()
        .optional()
        .describe('Relative path to component file (defaults to currently active component)'),
      parentId: z.string().nullable().describe('data-uniq-id of parent element, null for root insertion'),
      componentType: z.string().describe('Tag name: div, span, Button, MyComponent, etc.'),
      props: z.record(z.string(), z.unknown()).default({}).describe('Props to set on the new element'),
      index: z.number().optional().describe('Insertion index among siblings (0-based)'),
    },
    async ({ filePath, parentId, componentType, props, index }) => {
      const resolved = resolveFilePath(stateHub, filePath);
      if (!resolved) {
        return {
          content: [{ type: 'text' as const, text: 'Error: no filePath provided and no active component' }],
          isError: true,
        };
      }
      const result = await astService.insertElement(resolved, parentId, componentType, props, index);
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ newId: result.newId, index: result.index }) }],
      };
    },
  );

  server.tool(
    'hyper_delete_elements',
    'Delete one or more JSX elements by their data-uniq-id. Child elements are deleted with the parent.',
    {
      filePath: z
        .string()
        .optional()
        .describe('Relative path to component file (defaults to currently active component)'),
      elementIds: z.array(z.string()).min(1).describe('Array of data-uniq-id values to delete'),
    },
    async ({ filePath, elementIds }) => {
      const resolved = resolveFilePath(stateHub, filePath);
      if (!resolved) {
        return {
          content: [{ type: 'text' as const, text: 'Error: no filePath provided and no active component' }],
          isError: true,
        };
      }
      const result = await astService.deleteElements(resolved, elementIds);
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  server.tool(
    'hyper_update_styles',
    'Update Tailwind CSS classes on a JSX element. Provide CSS properties as key-value pairs (e.g. {"display": "flex", "backgroundColor": "#3b82f6", "gap": "1rem"}). Values are auto-converted to Tailwind tokens. Use color names/hex — avoid arbitrary values like rgb(). Use hyper_suggest_color_token to find the right token.',
    {
      filePath: z
        .string()
        .optional()
        .describe('Relative path to component file (defaults to currently active component)'),
      elementId: z.string().describe('data-uniq-id of the element'),
      styles: z
        .record(z.string(), z.string())
        .describe('Style properties to set, e.g. {"display": "flex", "flexDirection": "column"}'),
    },
    async ({ filePath, elementId, styles }) => {
      const resolved = resolveFilePath(stateHub, filePath);
      if (!resolved) {
        return {
          content: [{ type: 'text' as const, text: 'Error: no filePath provided and no active component' }],
          isError: true,
        };
      }
      const normalizedStyles = normalizeStylesInput(styles);
      const result = await astService.updateStyles(resolved, elementId, normalizedStyles);
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
      }

      const mainText = result.className ? `className="${result.className}"` : 'Styles updated';

      // Warn about arbitrary color values — recommend using hyper_suggest_color_token
      const arbitraryColors = (result.className ?? '').match(
        /(?:bg|text|border|ring|shadow)-\[[^\]]*(?:rgb|hsl|#)[^\]]*\]/g,
      );
      if (arbitraryColors) {
        const warning =
          `\n\nWarning: arbitrary color values detected (${arbitraryColors.join(', ')}). ` +
          'These may not match the project design system. ' +
          'Use hyper_suggest_color_token to find the nearest Tailwind token.';
        return { content: [{ type: 'text' as const, text: mainText + warning }] };
      }

      return { content: [{ type: 'text' as const, text: mainText }] };
    },
  );

  server.tool(
    'hyper_update_props',
    'Update JSX props on an element. Existing props with the same name are overwritten. Use null to remove a prop.',
    {
      filePath: z
        .string()
        .optional()
        .describe('Relative path to component file (defaults to currently active component)'),
      elementId: z.string().describe('data-uniq-id of the element'),
      props: z.record(z.string(), z.unknown()).describe('Props to set or update'),
    },
    async ({ filePath, elementId, props }) => {
      const resolved = resolveFilePath(stateHub, filePath);
      if (!resolved) {
        return {
          content: [{ type: 'text' as const, text: 'Error: no filePath provided and no active component' }],
          isError: true,
        };
      }
      const result = await astService.updateProps(resolved, elementId, props);
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: 'Props updated' }] };
    },
  );

  server.tool(
    'hyper_duplicate_element',
    'Duplicate a JSX element. The duplicate is inserted as a sibling after the original with new UUIDs.',
    {
      filePath: z
        .string()
        .optional()
        .describe('Relative path to component file (defaults to currently active component)'),
      elementId: z.string().describe('data-uniq-id of the element to duplicate'),
    },
    async ({ filePath, elementId }) => {
      const resolved = resolveFilePath(stateHub, filePath);
      if (!resolved) {
        return {
          content: [{ type: 'text' as const, text: 'Error: no filePath provided and no active component' }],
          isError: true,
        };
      }
      const result = await astService.duplicateElement(resolved, elementId);
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ newId: result.newId }) }] };
    },
  );

  server.tool(
    'hyper_wrap_element',
    'Wrap a JSX element in a new container element (e.g. wrap in a div with flex layout).',
    {
      filePath: z
        .string()
        .optional()
        .describe('Relative path to component file (defaults to currently active component)'),
      elementId: z.string().describe('data-uniq-id of the element to wrap'),
      wrapperType: z.string().default('div').describe('Tag name for the wrapper element'),
      wrapperProps: z.record(z.string(), z.unknown()).optional().describe('Props for the wrapper element'),
    },
    async ({ filePath, elementId, wrapperType, wrapperProps }) => {
      const resolved = resolveFilePath(stateHub, filePath);
      if (!resolved) {
        return {
          content: [{ type: 'text' as const, text: 'Error: no filePath provided and no active component' }],
          isError: true,
        };
      }
      const result = await astService.wrapElement(resolved, elementId, wrapperType, wrapperProps);
      if (!result.success) {
        return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ wrapperId: result.wrapperId }) }] };
    },
  );
}
