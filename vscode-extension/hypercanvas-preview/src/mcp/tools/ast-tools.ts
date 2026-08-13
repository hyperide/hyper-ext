import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { StateHub } from '../../StateHub';
import type { AstService } from '../../services/AstService';
import { resolveFilePath } from '../types';
import { getStyleAdapter } from './color-token-provider';

export function registerAstTools(server: McpServer, astService: AstService, stateHub: StateHub): void {
  server.tool(
    'hyper_insert_element',
    'Insert a JSX element into a React component. Omit filePath to use the currently active component.',
    {
      filePath: z
        .string()
        .optional()
        .describe('Relative path to component file (defaults to currently active component)'),
      parentId: z.string().nullable().describe('nodeRef of parent element, null for root insertion'),
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
        content: [{ type: 'text' as const, text: JSON.stringify({ index: result.index }) }],
      };
    },
  );

  server.tool(
    'hyper_delete_elements',
    'Delete one or more JSX elements by their nodeRef. Child elements are deleted with the parent.',
    {
      filePath: z
        .string()
        .optional()
        .describe('Relative path to component file (defaults to currently active component)'),
      elementIds: z.array(z.string()).min(1).describe('Array of nodeRef values to delete'),
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
    'Update styles on a JSX element. Provide CSS properties as key-value pairs (e.g. {"display": "flex", "backgroundColor": "#3b82f6", "gap": "1rem"}). Values are auto-converted to the project\'s design tokens. Use hyper_suggest_color_token to find the right token.',
    {
      filePath: z
        .string()
        .optional()
        .describe('Relative path to component file (defaults to currently active component)'),
      elementId: z.string().describe('nodeRef of the element'),
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

      const adapter = getStyleAdapter(stateHub.state.projectUIKit);
      const { success, result, warning, error } = await adapter.applyStyles(astService, resolved, elementId, styles);

      if (!success) {
        return { content: [{ type: 'text' as const, text: `Error: ${error}` }], isError: true };
      }

      const text = warning ? `${result}\n\nWarning: ${warning}` : (result ?? 'Styles updated');
      return { content: [{ type: 'text' as const, text }] };
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
      elementId: z.string().describe('nodeRef of the element'),
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
      elementId: z.string().describe('nodeRef of the element to duplicate'),
    },
    async ({ filePath, elementId }) => {
      const resolved = resolveFilePath(stateHub, filePath);
      if (!resolved) {
        console.log(
          `[hyper_duplicate_element] no active component — filePath=${filePath}, elementId=${elementId}, stateHub.currentComponent=${stateHub.state.currentComponent?.path}`,
        );
        return {
          content: [{ type: 'text' as const, text: 'Error: no filePath provided and no active component' }],
          isError: true,
        };
      }
      console.log(`[hyper_duplicate_element] resolved=${resolved}, elementId=${elementId}`);
      const result = await astService.duplicateElement(resolved, elementId);
      if (!result.success) {
        console.log(`[hyper_duplicate_element] error: ${result.error}`);
        return { content: [{ type: 'text' as const, text: `Error: ${result.error}` }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify({ duplicated: true }) }] };
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
      elementId: z.string().describe('nodeRef of the element to wrap'),
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
      return { content: [{ type: 'text' as const, text: JSON.stringify({ success: result.success }) }] };
    },
  );
}
