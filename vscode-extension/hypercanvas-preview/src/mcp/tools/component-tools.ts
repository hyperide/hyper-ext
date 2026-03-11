import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { StateHub } from '../../StateHub';
import type { AstService } from '../../services/AstService';
import type { ComponentService } from '../../services/ComponentService';
import { resolveFilePath } from '../types';

export function registerComponentTools(
  server: McpServer,
  componentService: ComponentService,
  astService: AstService,
  stateHub: StateHub,
): void {
  server.tool(
    'hyper_get_component_tree',
    'Parse a React component file and return its JSX element tree with data-uniq-id attributes, tag names, and hierarchy. Use this to understand the component structure before making AST changes. Omit filePath to use the currently active component. Call hyper_get_selection first if unsure which component is active.',
    {
      filePath: z
        .string()
        .optional()
        .describe('Relative path to the component file (defaults to currently active component)'),
    },
    async ({ filePath }) => {
      const resolved = resolveFilePath(stateHub, filePath);
      if (!resolved) {
        return {
          content: [{ type: 'text' as const, text: 'Error: no filePath provided and no active component' }],
          isError: true,
        };
      }
      try {
        const tree = await componentService.parseStructure(resolved);
        return { content: [{ type: 'text' as const, text: JSON.stringify(tree, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.tool(
    'hyper_get_component_props',
    'Get the props interface of a React component — names, types, defaults, and whether required.',
    {
      filePath: z
        .string()
        .optional()
        .describe('Relative path to the component file (defaults to currently active component)'),
    },
    async ({ filePath }) => {
      const resolved = resolveFilePath(stateHub, filePath);
      if (!resolved) {
        return {
          content: [{ type: 'text' as const, text: 'Error: no filePath provided and no active component' }],
          isError: true,
        };
      }
      try {
        const info = await componentService.getComponent(resolved);
        if (!info) {
          return {
            content: [{ type: 'text' as const, text: 'Component not found or could not be parsed' }],
            isError: true,
          };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.tool(
    'hyper_inject_element_ids',
    'Inject data-uniq-id attributes into all JSX elements in a component file. Required before using AST manipulation tools. Returns the number of IDs added.',
    {
      filePath: z
        .string()
        .optional()
        .describe('Relative path to the component file (defaults to currently active component)'),
    },
    async ({ filePath }) => {
      const resolved = resolveFilePath(stateHub, filePath);
      if (!resolved) {
        return {
          content: [{ type: 'text' as const, text: 'Error: no filePath provided and no active component' }],
          isError: true,
        };
      }
      try {
        const result = await astService.injectUniqueIds(resolved);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );
}
