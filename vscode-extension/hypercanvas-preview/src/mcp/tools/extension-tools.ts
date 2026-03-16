import { writeFile } from 'node:fs/promises';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { type HyperMcpServices, resolveFilePath } from '../types';

export function registerExtensionTools(server: McpServer, services: HyperMcpServices): void {
  server.tool(
    'hyper_get_selection',
    'Get current canvas state: selected element IDs, hovered element, current component path, canvas mode, and engine mode. IMPORTANT: Call this before every batch of AST operations to ensure you are targeting the correct component — the user may have switched components since your last call.',
    {},
    async () => {
      const state = services.stateHub.state;
      const result = {
        selectedIds: state.selectedIds ?? [],
        hoveredId: state.hoveredId ?? null,
        currentComponent: state.currentComponent ?? null,
        canvasMode: state.canvasMode ?? null,
        engineMode: state.engineMode ?? null,
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'hyper_select_elements',
    'Select elements in the canvas by their data-uniq-id. Pass an empty array to clear selection.',
    {
      elementIds: z.array(z.string()).describe('Array of data-uniq-id values to select'),
    },
    async ({ elementIds }) => {
      services.stateHub.applyUpdate({ selectedIds: elementIds });
      return { content: [{ type: 'text' as const, text: `Selected ${elementIds.length} element(s)` }] };
    },
  );

  server.tool(
    'hyper_get_diagnostics',
    'Get current diagnostic information: runtime errors, build status, recent server logs, and console output. Useful for understanding why the preview is broken.',
    {},
    async () => {
      const context = services.diagnosticHub.getAIContext();
      if (!context) {
        return { content: [{ type: 'text' as const, text: 'No diagnostic issues detected' }] };
      }
      return { content: [{ type: 'text' as const, text: context }] };
    },
  );

  server.tool(
    'hyper_navigate_to_element',
    'Navigate the VS Code editor to the source code location of a JSX element. Opens the file and scrolls to the element definition.',
    {
      filePath: z
        .string()
        .optional()
        .describe('Relative path to the component file (defaults to currently active component)'),
      elementId: z.string().describe('data-uniq-id of the element to navigate to'),
    },
    async ({ filePath, elementId }) => {
      const resolved = resolveFilePath(services.stateHub, filePath);
      if (!resolved) {
        return {
          content: [{ type: 'text' as const, text: 'Error: no filePath provided and no active component' }],
          isError: true,
        };
      }
      try {
        await services.onNavigate(resolved, elementId);
        return { content: [{ type: 'text' as const, text: `Navigated to element ${elementId} in ${resolved}` }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
      }
    },
  );

  server.tool('hyper_refresh_preview', 'Refresh the preview iframe to reflect recent code changes.', {}, async () => {
    services.onRefresh();
    return { content: [{ type: 'text' as const, text: 'Preview refreshed' }] };
  });

  server.tool(
    'hyper_open_component',
    'Open a React component in the HyperCanvas visual editor.',
    {
      componentPath: z.string().describe('Relative path to the component file'),
    },
    async ({ componentPath }) => {
      services.onOpenComponent(componentPath);
      return { content: [{ type: 'text' as const, text: `Opened ${componentPath} in canvas` }] };
    },
  );

  server.tool(
    'hyper_screenshot_preview',
    'Take a screenshot of the entire preview canvas. By default returns the image inline. Pass saveTo to save to a file and return the path instead. Requires the preview panel to be open with a running dev server.',
    {
      saveTo: z
        .string()
        .optional()
        .describe('File path to save the screenshot to. When set, returns the file path instead of inline image'),
    },
    async ({ saveTo }) => {
      return takeScreenshot(services, undefined, saveTo);
    },
  );

  server.tool(
    'hyper_screenshot_element',
    'Take a screenshot of a specific element in the preview by its data-uniq-id. By default returns the image inline. Pass saveTo to save to a file and return the path instead.',
    {
      elementId: z.string().describe('data-uniq-id of the element to screenshot'),
      saveTo: z
        .string()
        .optional()
        .describe('File path to save the screenshot to. When set, returns the file path instead of inline image'),
    },
    async ({ elementId, saveTo }) => {
      return takeScreenshot(services, elementId, saveTo);
    },
  );
}

async function takeScreenshot(
  services: HyperMcpServices,
  elementId: string | undefined,
  saveTo: string | undefined,
): Promise<{
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  isError?: boolean;
}> {
  const dataUrl = await services.onScreenshot(elementId);
  if (!dataUrl) {
    const target = elementId ? `element ${elementId}` : 'preview';
    return {
      content: [{ type: 'text' as const, text: `Screenshot failed — ${target} not found or preview not open` }],
      isError: true,
    };
  }

  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');

  if (saveTo) {
    await writeFile(saveTo, Buffer.from(base64, 'base64'));
  }

  return {
    content: [{ type: 'image' as const, data: base64, mimeType: 'image/png' }],
  };
}
