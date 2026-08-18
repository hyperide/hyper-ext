/**
 * @file Tests for ColorTokenProvider and StyleAdapter abstractions
 */
import { describe, expect, it } from 'bun:test';
import type { AstService } from '../../../services/AstService';
import {
  type ColorTokenProvider,
  getColorTokenProvider,
  getStyleAdapter,
  parseAnyColorToHex,
} from '../color-token-provider';

describe('parseAnyColorToHex', () => {
  it('should parse 6-digit hex', () => {
    expect(parseAnyColorToHex('#ff0000')).toBe('#ff0000');
  });

  it('should expand 3-digit hex', () => {
    expect(parseAnyColorToHex('#f00')).toBe('#ff0000');
  });

  it('should parse rgb()', () => {
    expect(parseAnyColorToHex('rgb(255, 0, 0)')).toBe('#ff0000');
  });

  it('should return null for invalid input', () => {
    expect(parseAnyColorToHex('not-a-color')).toBeNull();
  });

  it('should clamp out-of-range RGB channels to 0-255', () => {
    expect(parseAnyColorToHex('rgb(300, 0, 0)')).toBe('#ff0000');
    expect(parseAnyColorToHex('rgb(0, -10, 0)')).toBe('#000000');
    expect(parseAnyColorToHex('rgb(256, 256, 256)')).toBe('#ffffff');
  });

  it('should strip Tailwind arbitrary value brackets', () => {
    expect(parseAnyColorToHex('[#ff0000]')).toBe('#ff0000');
    expect(parseAnyColorToHex('[rgb(255, 0, 0)]')).toBe('#ff0000');
  });

  it('should handle whitespace', () => {
    expect(parseAnyColorToHex('  #ff0000  ')).toBe('#ff0000');
    expect(parseAnyColorToHex('  rgb( 255 , 0 , 0 )  ')).toBe('#ff0000');
  });

  it('should be case-insensitive for hex', () => {
    expect(parseAnyColorToHex('#FF0000')).toBe('#ff0000');
    expect(parseAnyColorToHex('#AbCdEf')).toBe('#abcdef');
  });

  it('should return null for empty string', () => {
    expect(parseAnyColorToHex('')).toBeNull();
  });

  it('should return null for hsl (unsupported)', () => {
    expect(parseAnyColorToHex('hsl(0, 100%, 50%)')).toBeNull();
  });
});

describe('getColorTokenProvider', () => {
  it('should return TailwindColorTokenProvider for "tailwind"', () => {
    const provider = getColorTokenProvider('tailwind');
    expect(provider.systemName).toBe('Tailwind');
  });

  it('should return TailwindColorTokenProvider for undefined', () => {
    const provider = getColorTokenProvider(undefined);
    expect(provider.systemName).toBe('Tailwind');
  });

  it('should return TailwindColorTokenProvider for "none"', () => {
    const provider = getColorTokenProvider('none');
    expect(provider.systemName).toBe('Tailwind');
  });

  it('should return TamaguiColorTokenProvider for "tamagui"', () => {
    const provider = getColorTokenProvider('tamagui');
    expect(provider.systemName).toBe('Tamagui');
  });
});

describe('TailwindColorTokenProvider', () => {
  let provider: ColorTokenProvider;

  it('should list all colors including white and black', () => {
    provider = getColorTokenProvider('tailwind');
    const colors = provider.listColors();
    expect(colors.length).toBeGreaterThan(100);
    expect(colors.find((c) => c.token === 'white')).toBeTruthy();
    expect(colors.find((c) => c.token === 'black')).toBeTruthy();
  });

  it('should filter by family', () => {
    provider = getColorTokenProvider('tailwind');
    const reds = provider.listColors('red');
    expect(reds.length).toBeGreaterThan(0);
    for (const c of reds) {
      expect(c.token).toMatch(/^red/);
    }
  });

  it('should return empty for unknown family', () => {
    provider = getColorTokenProvider('tailwind');
    const result = provider.listColors('nonexistent');
    expect(result).toEqual([]);
  });

  it('should list families', () => {
    provider = getColorTokenProvider('tailwind');
    const families = provider.getFamilies();
    expect(families).toContain('red');
    expect(families).toContain('blue');
    expect(families).toContain('white');
    expect(families).toContain('black');
  });

  it('should find nearest color token', () => {
    provider = getColorTokenProvider('tailwind');
    // Pure red should match red-500 or similar
    const nearest = provider.findNearest('#ff0000', 3);
    expect(nearest).toHaveLength(3);
    expect(nearest[0].distance).toBeDefined();
    expect(nearest[0].token).toBeTruthy();
    // Results should be sorted by distance ascending
    expect(nearest[0].distance).toBeLessThanOrEqual(nearest[1].distance);
    expect(nearest[1].distance).toBeLessThanOrEqual(nearest[2].distance);
  });

  it('should return exact match with distance 0', () => {
    provider = getColorTokenProvider('tailwind');
    const nearest = provider.findNearest('#ffffff', 1);
    expect(nearest[0].token).toBe('white');
    expect(nearest[0].distance).toBe(0);
  });

  it('should include transparent, current, inherit in palette', () => {
    provider = getColorTokenProvider('tailwind');
    const colors = provider.listColors();
    expect(colors.find((c) => c.token === 'transparent')).toBeTruthy();
    expect(colors.find((c) => c.token === 'current')).toBeTruthy();
    expect(colors.find((c) => c.token === 'inherit')).toBeTruthy();
  });

  it('should include transparent/current/inherit in families', () => {
    provider = getColorTokenProvider('tailwind');
    const families = provider.getFamilies();
    expect(families).toContain('transparent');
    expect(families).toContain('current');
    expect(families).toContain('inherit');
  });

  it('should exclude non-hex colors from nearest search results', () => {
    provider = getColorTokenProvider('tailwind');
    const nearest = provider.findNearest('#000000', 5);
    // transparent/current/inherit have Infinity distance — never in top results
    for (const n of nearest) {
      expect(n.token).not.toBe('transparent');
      expect(n.token).not.toBe('current');
      expect(n.token).not.toBe('inherit');
    }
  });
});

describe('TamaguiColorTokenProvider', () => {
  let provider: ColorTokenProvider;

  it('should list all Tamagui colors', () => {
    provider = getColorTokenProvider('tamagui');
    const colors = provider.listColors();
    expect(colors.length).toBeGreaterThan(50);
    // Tamagui uses number shades (1-12)
    expect(colors.find((c) => c.token === 'blue9')).toBeTruthy();
    expect(colors.find((c) => c.token === 'red9')).toBeTruthy();
  });

  it('should filter by family', () => {
    provider = getColorTokenProvider('tamagui');
    const blues = provider.listColors('blue');
    expect(blues).toHaveLength(12); // Tamagui has shades 1-12
    for (const c of blues) {
      expect(c.token).toMatch(/^blue/);
    }
  });

  it('should list families', () => {
    provider = getColorTokenProvider('tamagui');
    const families = provider.getFamilies();
    expect(families).toContain('blue');
    expect(families).toContain('red');
    expect(families).toContain('green');
  });

  it('should find nearest Tamagui color token', () => {
    provider = getColorTokenProvider('tamagui');
    // Blue (#0090ff) is exactly blue9 in Tamagui
    const nearest = provider.findNearest('#0090ff', 3);
    expect(nearest).toHaveLength(3);
    expect(nearest[0].token).toBe('blue9');
    expect(nearest[0].distance).toBe(0);
  });

  it('should include semantic families in getFamilies()', () => {
    provider = getColorTokenProvider('tamagui');
    const families = provider.getFamilies();
    expect(families).toContain('color');
    expect(families).toContain('background');
  });

  it('should list semantic color tokens by family', () => {
    provider = getColorTokenProvider('tamagui');
    const colorTokens = provider.listColors('color');
    expect(colorTokens).toHaveLength(12);
    for (const c of colorTokens) {
      expect(c.token).toMatch(/^color\d+$/);
    }

    const bgTokens = provider.listColors('background');
    expect(bgTokens).toHaveLength(12);
    for (const c of bgTokens) {
      expect(c.token).toMatch(/^background\d+$/);
    }
  });

  it('should include semantic tokens in full listing', () => {
    provider = getColorTokenProvider('tamagui');
    const colors = provider.listColors();
    expect(colors.find((c) => c.token === 'color1')).toBeTruthy();
    expect(colors.find((c) => c.token === 'background12')).toBeTruthy();
    expect(colors).toHaveLength(144);
  });

  it('should prefer palette token over semantic in findNearest for shared hex', () => {
    provider = getColorTokenProvider('tamagui');
    // #8d8d8d is gray9, color9, background9
    const nearest = provider.findNearest('#8d8d8d', 3);
    expect(nearest[0].token).toBe('gray9');
  });
});

describe('getStyleAdapter', () => {
  it('should return TailwindStyleAdapter for "tailwind"', () => {
    const adapter = getStyleAdapter('tailwind');
    expect(adapter).toBeTruthy();
  });

  it('should return TailwindStyleAdapter for undefined', () => {
    const adapter = getStyleAdapter(undefined);
    expect(adapter).toBeTruthy();
  });

  it('should return TamaguiStyleAdapter for "tamagui"', () => {
    const adapter = getStyleAdapter('tamagui');
    expect(adapter).toBeTruthy();
  });
});

describe('TailwindStyleAdapter', () => {
  describe('resolveStyles', () => {
    it('should parse className into CSS properties', () => {
      const adapter = getStyleAdapter('tailwind');
      // space-y-4 implies flex + column + gap via parseTailwindClasses
      const result = adapter.resolveStyles({ className: 'flex flex-col space-y-4' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.styles.display).toBe('flex');
        expect(result.styles.flexDirection).toBe('column');
        expect(result.styles.gap).toBe('1rem');
      }
    });

    it('should reject styleProps with actionable error', () => {
      const adapter = getStyleAdapter('tailwind');
      const result = adapter.resolveStyles({ styleProps: { backgroundColor: 'red' } });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Tailwind');
        expect(result.error).toContain('className');
      }
    });

    it('should reject empty input', () => {
      const adapter = getStyleAdapter('tailwind');
      const result = adapter.resolveStyles({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('className');
      }
    });
  });

  it('should call astService.updateStyles for Tailwind', async () => {
    const adapter = getStyleAdapter('tailwind');
    const mockAstService = {
      updateStyles: async () => ({ success: true, className: 'flex flex-col' }),
      updateProps: async () => ({ success: true }),
    };

    const result = await adapter.applyStyles(mockAstService as unknown as AstService, 'src/App.tsx', 'elem-1', {
      display: 'flex',
      flexDirection: 'column',
    });

    expect(result.success).toBe(true);
    expect(result.result).toContain('flex');
  });

  it('HYP-987 P1 (codex) — surfaces the non-forwarding warning instead of reporting "Styles updated"', async () => {
    const adapter = getStyleAdapter('tailwind');
    // updateStyles returns success:true WITH a warning when the write was rolled back (the
    // component does not forward style/className and no safe wrapper landed).
    const mockAstService = {
      updateStyles: async () => ({
        success: true,
        warning: { componentName: 'HostRoutePage', message: "<HostRoutePage> doesn't forward this prop to the DOM." },
      }),
      updateProps: async () => ({ success: true }),
    };

    const result = await adapter.applyStyles(mockAstService as unknown as AstService, 'src/App.tsx', 'elem-1', {
      'bg-red-500': '',
    });

    expect(result.success).toBe(true);
    // Must NOT claim the style was applied.
    expect(result.result).not.toContain('Styles updated');
    expect(result.result).toContain('not applied');
    expect(result.warning).toContain("doesn't forward");
  });

  it('HYP-990 (codex full panel) — a KEPT (unverifiable) warning reports applied:true, not a failure', async () => {
    const adapter = getStyleAdapter('tailwind');
    const mockAstService = {
      // A keep-report: the wrapper WAS applied but could not be verified. MCP must not report failure,
      // or an agent would retry a source change that already landed.
      updateStyles: async () => ({
        success: true,
        warning: { componentName: 'Icon', kept: true, message: 'applied but could not verify' },
      }),
      updateProps: async () => ({ success: true }),
    };
    const result = await adapter.applyStyles(mockAstService as unknown as AstService, 'src/App.tsx', 'elem-1', {
      'bg-red-500': '',
    });
    expect(result.success).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.result).toContain('applied');
    expect(result.warning).toContain('could not verify');
  });

  it('should normalize Tailwind prefix inputs', async () => {
    const adapter = getStyleAdapter('tailwind');
    let capturedStyles: Record<string, string> = {};
    const mockAstService = {
      updateStyles: async (_: string, __: string, styles: Record<string, string>) => {
        capturedStyles = styles;
        return { success: true, className: 'bg-red-500' };
      },
      updateProps: async () => ({ success: true }),
    };

    await adapter.applyStyles(mockAstService as unknown as AstService, 'src/App.tsx', 'elem-1', {
      'bg-red-500': '',
    });

    // Should normalize "bg-red-500" key to backgroundColor: "red-500"
    expect(capturedStyles.backgroundColor).toBe('red-500');
  });

  it('should warn about arbitrary color values', async () => {
    const adapter = getStyleAdapter('tailwind');
    const mockAstService = {
      updateStyles: async () => ({ success: true, className: 'bg-[rgb(127,29,29)]' }),
      updateProps: async () => ({ success: true }),
    };

    const result = await adapter.applyStyles(mockAstService as unknown as AstService, 'src/App.tsx', 'elem-1', {
      backgroundColor: 'rgb(127,29,29)',
    });

    expect(result.warning).toBeTruthy();
    expect(result.warning).toContain('hyper_suggest_color_token');
  });
});

describe('TamaguiStyleAdapter', () => {
  describe('resolveStyles', () => {
    it('should resolve $token values to hex', () => {
      const adapter = getStyleAdapter('tamagui');
      const result = adapter.resolveStyles({ styleProps: { backgroundColor: '$blue9' } });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.styles.backgroundColor).toBe('#0090ff');
      }
    });

    it('should pass through non-token values', () => {
      const adapter = getStyleAdapter('tamagui');
      const result = adapter.resolveStyles({ styleProps: { padding: '16px' } });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.styles.padding).toBe('16px');
      }
    });

    it('should reject className with actionable error', () => {
      const adapter = getStyleAdapter('tamagui');
      const result = adapter.resolveStyles({ className: 'flex gap-4' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Tamagui');
        expect(result.error).toContain('styleProps');
      }
    });

    it('should reject empty input', () => {
      const adapter = getStyleAdapter('tamagui');
      const result = adapter.resolveStyles({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('styleProps');
      }
    });

    it('should warn about unknown CSS properties', () => {
      const adapter = getStyleAdapter('tamagui');
      const result = adapter.resolveStyles({
        styleProps: { backgroundColor: '$blue9', foo: 'bar', baz: '123' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.styles.backgroundColor).toBe('#0090ff');
        expect(result.warning).toContain('foo');
        expect(result.warning).toContain('baz');
      }
    });
  });

  it('should call astService.updateProps for Tamagui', async () => {
    const adapter = getStyleAdapter('tamagui');
    let capturedProps: Record<string, unknown> = {};
    const mockAstService = {
      updateStyles: async () => ({ success: true }),
      updateProps: async (_: string, __: string, props: Record<string, unknown>) => {
        capturedProps = props;
        return { success: true };
      },
    };

    await adapter.applyStyles(mockAstService as unknown as AstService, 'src/App.tsx', 'elem-1', {
      display: 'flex',
      backgroundColor: '#0090ff',
    });

    expect(capturedProps.display).toBe('flex');
    // Should convert hex to nearest Tamagui token
    expect(capturedProps.backgroundColor).toBe('$blue9');
  });

  it('should pass through non-color values as-is', async () => {
    const adapter = getStyleAdapter('tamagui');
    let capturedProps: Record<string, unknown> = {};
    const mockAstService = {
      updateStyles: async () => ({ success: true }),
      updateProps: async (_: string, __: string, props: Record<string, unknown>) => {
        capturedProps = props;
        return { success: true };
      },
    };

    await adapter.applyStyles(mockAstService as unknown as AstService, 'src/App.tsx', 'elem-1', {
      padding: '16px',
    });

    expect(capturedProps.padding).toBe('16px');
  });
});
