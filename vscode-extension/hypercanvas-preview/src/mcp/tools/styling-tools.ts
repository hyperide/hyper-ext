/**
 * @file Universal styling MCP tools — color tokens, style parsing, color suggestions
 *
 * Accessed via: MCP protocol (hyper_get_element_styles, hyper_suggest_color_token, hyper_list_color_tokens)
 * Assumptions: stateHub.state.projectUIKit determines which styling system is active
 * Architecture: delegates to ColorTokenProvider adapters for multi-framework support
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { StateHub } from '../../StateHub';
import { getColorTokenProvider, getStyleAdapter, parseAnyColorToHex } from './color-token-provider';

export function registerStylingTools(server: McpServer, stateHub: StateHub): void {
  // -----------------------------------------------------------------------
  // hyper_get_element_styles
  // -----------------------------------------------------------------------
  server.registerTool(
    'hyper_get_element_styles',
    {
      description:
        'Parse element styles into resolved CSS properties.\n' +
        "- Tailwind projects: pass className (e.g. {className: 'flex gap-4 bg-blue-500'})\n" +
        '- Tamagui projects: pass styleProps (e.g. {styleProps: {backgroundColor: "$blue9"}})\n' +
        'Use hyper_get_state to check the active framework if unsure.',
      // .strict() is required: without it, z.union() can't discriminate branches
      // (both would accept extra properties and match ambiguously)
      inputSchema: z.union([
        z.object({ className: z.string().describe('Tailwind className string to parse') }).strict(),
        z
          .object({
            styleProps: z.record(z.string(), z.string()).describe('Tamagui style props as key-value pairs'),
          })
          .strict(),
      ]),
    },
    async (args) => {
      // z.union() produces { className: string } | { styleProps: Record<string, string> }
      // Use runtime narrowing since TypeScript can't destructure across union branches
      const className = 'className' in args ? args.className : undefined;
      const styleProps = 'styleProps' in args ? args.styleProps : undefined;

      const adapter = getStyleAdapter(stateHub.state.projectUIKit);
      const result = adapter.resolveStyles({ className, styleProps });

      if (!result.success) {
        return { content: [{ type: 'text' as const, text: result.error }], isError: true };
      }

      const content: Array<{ type: 'text'; text: string }> = [
        { type: 'text' as const, text: JSON.stringify(result.styles, null, 2) },
      ];
      if (result.warning) {
        content.push({ type: 'text' as const, text: `Warning: ${result.warning}` });
      }
      return { content };
    },
  );

  // -----------------------------------------------------------------------
  // hyper_suggest_color_token
  // -----------------------------------------------------------------------
  server.registerTool(
    'hyper_suggest_color_token',
    {
      description:
        "Find the nearest design token colors for a given color value. Accepts hex (#ff0000) or rgb(r,g,b). Returns top 5 closest tokens with distance. Tokens depend on the project's styling system (Tailwind or Tamagui).",
      inputSchema: z.object({
        color: z.string().describe('Color value: hex (#ff0000) or rgb(127,29,29)'),
      }),
    },
    async ({ color }) => {
      const uiKit = stateHub.state.projectUIKit;
      const provider = getColorTokenProvider(uiKit);
      const hex = parseAnyColorToHex(color);

      if (!hex) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Cannot parse color "${color}". Use hex (#rrggbb) or rgb(r,g,b).`,
            },
          ],
          isError: true,
        };
      }

      const nearest = provider.findNearest(hex, 5);
      const lines = nearest.map((t, i) => `${i + 1}. ${t.token} (${t.hex}) — distance: ${t.distance.toFixed(1)}`);

      const exact = nearest[0]?.distance === 0;
      const header = exact
        ? `Exact match: ${nearest[0].token}`
        : `No exact match for ${hex}. Nearest ${provider.systemName} tokens:`;

      return { content: [{ type: 'text' as const, text: `${header}\n${lines.join('\n')}` }] };
    },
  );

  // -----------------------------------------------------------------------
  // hyper_list_color_tokens
  // -----------------------------------------------------------------------
  server.registerTool(
    'hyper_list_color_tokens',
    {
      description:
        'List available design token colors for the project\'s styling system. Optionally filter by color family (e.g. "red", "blue").',
      inputSchema: z.object({
        family: z.string().optional().describe('Color family to filter: red, blue, green, etc. Omit for all colors.'),
      }),
    },
    async ({ family }) => {
      const uiKit = stateHub.state.projectUIKit;
      const provider = getColorTokenProvider(uiKit);

      const filtered = provider.listColors(family);
      if (family && filtered.length === 0) {
        const families = provider.getFamilies();
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

      const lines = filtered.map((c) => `${c.token}: ${c.hex}`);
      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}
