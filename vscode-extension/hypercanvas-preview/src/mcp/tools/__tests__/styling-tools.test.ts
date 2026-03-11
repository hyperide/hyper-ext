/**
 * @file Tests for universal styling MCP tools (replaces tailwind-tools.ts)
 */
import { describe, expect, it, mock } from 'bun:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StateHub } from '../../../StateHub';
import { registerStylingTools } from '../styling-tools';

function createMockStateHub(projectUIKit: string = 'tailwind'): StateHub {
  return {
    state: {
      selectedIds: [],
      hoveredId: null,
      currentComponent: { path: 'src/App.tsx', name: 'App' },
      canvasMode: 'select',
      engineMode: 'design',
      projectUIKit,
    },
    applyUpdate: mock(),
  } as unknown as StateHub;
}

type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

/**
 * Capture tool handlers during registration by wrapping both server.registerTool and server.tool.
 * Returns a getter that throws if the tool was not registered.
 */
function captureToolHandlers(stateHub: StateHub): (name: string) => ToolHandler {
  const server = new McpServer({ name: 'test', version: '0.0.1' });
  const handlers = new Map<string, ToolHandler>();

  // Capture registerTool calls (new API)
  const originalRegisterTool = server.registerTool.bind(server);
  server.registerTool = ((name: string, config: unknown, cb: ToolHandler) => {
    handlers.set(name, cb);
    return originalRegisterTool(name, config as Parameters<typeof originalRegisterTool>[1], cb);
  }) as typeof server.registerTool;

  // Capture server.tool calls (legacy, still used by suggest/list tools)
  const originalTool = server.tool.bind(server);
  server.tool = ((...args: unknown[]) => {
    const toolName = args[0] as string;
    const handler = args[args.length - 1] as ToolHandler;
    handlers.set(toolName, handler);
    return originalTool(...(args as Parameters<typeof originalTool>));
  }) as typeof server.tool;

  registerStylingTools(server, stateHub);

  return (name: string) => {
    const handler = handlers.get(name);
    if (!handler) throw new Error(`Tool "${name}" not registered`);
    return handler;
  };
}

describe('registerStylingTools', () => {
  it('should register 3 tools on the server', () => {
    const server = new McpServer({ name: 'test', version: '0.0.1' });
    const stateHub = createMockStateHub();
    const toolNames: string[] = [];

    const originalTool = server.tool.bind(server);
    server.tool = ((...args: unknown[]) => {
      toolNames.push(args[0] as string);
      return originalTool(...(args as Parameters<typeof originalTool>));
    }) as typeof server.tool;

    const originalRegisterTool = server.registerTool.bind(server);
    server.registerTool = ((name: string, ...rest: unknown[]) => {
      toolNames.push(name);
      return originalRegisterTool(
        name,
        ...(rest as [Parameters<typeof originalRegisterTool>[1], Parameters<typeof originalRegisterTool>[2]]),
      );
    }) as typeof server.registerTool;

    registerStylingTools(server, stateHub);

    expect(toolNames).toEqual(['hyper_get_element_styles', 'hyper_suggest_color_token', 'hyper_list_color_tokens']);
  });
});

describe('hyper_get_element_styles', () => {
  it('should parse Tailwind className', async () => {
    const getHandler = captureToolHandlers(createMockStateHub('tailwind'));
    const handler = getHandler('hyper_get_element_styles');

    const result = await handler({ className: 'flex flex-col gap-4' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.display).toBe('flex');
    expect(parsed.flexDirection).toBe('column');
  });

  it('should resolve Tamagui tokens to hex', async () => {
    const getHandler = captureToolHandlers(createMockStateHub('tamagui'));
    const handler = getHandler('hyper_get_element_styles');

    const result = await handler({ styleProps: { backgroundColor: '$blue9' } });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.backgroundColor).toBe('#0090ff');
  });

  it('should pass through non-token Tamagui values', async () => {
    const getHandler = captureToolHandlers(createMockStateHub('tamagui'));
    const handler = getHandler('hyper_get_element_styles');

    const result = await handler({ styleProps: { padding: '16px' } });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.padding).toBe('16px');
  });

  it('should reject styleProps for Tailwind project', async () => {
    const getHandler = captureToolHandlers(createMockStateHub('tailwind'));
    const handler = getHandler('hyper_get_element_styles');

    const result = await handler({ styleProps: { backgroundColor: 'red' } });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Tailwind');
    expect(result.content[0].text).toContain('className');
  });

  it('should reject className for Tamagui project', async () => {
    const getHandler = captureToolHandlers(createMockStateHub('tamagui'));
    const handler = getHandler('hyper_get_element_styles');

    const result = await handler({ className: 'flex gap-4' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Tamagui');
    expect(result.content[0].text).toContain('styleProps');
  });

  it('should warn about unknown Tamagui props', async () => {
    const getHandler = captureToolHandlers(createMockStateHub('tamagui'));
    const handler = getHandler('hyper_get_element_styles');

    const result = await handler({ styleProps: { backgroundColor: '$blue9', foo: 'bar' } });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('#0090ff');
    // Warning about unknown prop in second content block
    expect(result.content).toHaveLength(2);
    expect(result.content[1].text).toContain('foo');
  });
});

describe('hyper_suggest_color_token', () => {
  it('should return Tailwind tokens for hex color', async () => {
    const getHandler = captureToolHandlers(createMockStateHub('tailwind'));
    const handler = getHandler('hyper_suggest_color_token');

    const result = await handler({ color: '#ffffff' });

    expect(result.content[0].text).toContain('Exact match: white');
  });

  it('should return Tamagui tokens when projectUIKit is tamagui', async () => {
    const getHandler = captureToolHandlers(createMockStateHub('tamagui'));
    const handler = getHandler('hyper_suggest_color_token');

    const result = await handler({ color: '#0090ff' });

    expect(result.content[0].text).toContain('Exact match: blue9');
  });

  it('should return nearest tokens when no exact match', async () => {
    const getHandler = captureToolHandlers(createMockStateHub('tailwind'));
    const handler = getHandler('hyper_suggest_color_token');

    const result = await handler({ color: '#ff0001' });

    expect(result.content[0].text).toContain('No exact match');
    expect(result.content[0].text).toContain('distance');
  });

  it('should handle bracket-wrapped out-of-range rgb', async () => {
    const getHandler = captureToolHandlers(createMockStateHub('tailwind'));
    const handler = getHandler('hyper_suggest_color_token');

    const result = await handler({ color: '[rgb(300, 0, 0)]' });

    // rgb(300,0,0) clamps to #ff0000, brackets stripped → finds nearest red token
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/red/i);
  });

  it('should return error for invalid color', async () => {
    const getHandler = captureToolHandlers(createMockStateHub('tailwind'));
    const handler = getHandler('hyper_suggest_color_token');

    const result = await handler({ color: 'not-a-color' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Cannot parse');
  });
});

describe('hyper_list_color_tokens', () => {
  it('should list all Tailwind colors', async () => {
    const getHandler = captureToolHandlers(createMockStateHub('tailwind'));
    const handler = getHandler('hyper_list_color_tokens');

    const result = await handler({});
    const lines = result.content[0].text.split('\n');

    expect(lines.length).toBeGreaterThan(100);
    expect(result.content[0].text).toContain('white: #ffffff');
  });

  it('should filter by family', async () => {
    const getHandler = captureToolHandlers(createMockStateHub('tailwind'));
    const handler = getHandler('hyper_list_color_tokens');

    const result = await handler({ family: 'red' });
    const lines = result.content[0].text.split('\n');

    for (const line of lines) {
      expect(line).toMatch(/^red-/);
    }
  });

  it('should return Tamagui colors when projectUIKit is tamagui', async () => {
    const getHandler = captureToolHandlers(createMockStateHub('tamagui'));
    const handler = getHandler('hyper_list_color_tokens');

    const result = await handler({ family: 'blue' });

    expect(result.content[0].text).toContain('blue9: #0090ff');
  });

  it('should return error for unknown family', async () => {
    const getHandler = captureToolHandlers(createMockStateHub('tailwind'));
    const handler = getHandler('hyper_list_color_tokens');

    const result = await handler({ family: 'nonexistent' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown family');
    expect(result.content[0].text).toContain('Available:');
  });
});
