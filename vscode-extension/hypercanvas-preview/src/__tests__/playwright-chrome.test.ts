import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';

mock.module('node:fs', () => ({
  existsSync: mock(() => false),
  readdirSync: mock(() => []),
}));

const { CHROME_PATHS, CHROMIUM_PATHS, detectBrowserForPlaywright, hasPlaywrightBundledChromium, playwrightCacheDir } =
  await import('../playwright-chrome');

const existsSyncMock = existsSync as ReturnType<typeof mock>;
const readdirSyncMock = readdirSync as unknown as ReturnType<typeof mock>;

describe('playwright-chrome', () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    readdirSyncMock.mockReset();
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    delete process.env.XDG_CACHE_HOME;
  });

  afterEach(() => {
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    delete process.env.XDG_CACHE_HOME;
  });

  describe('path constants', () => {
    it('has Chrome paths for darwin, linux, and win32', () => {
      expect(Object.keys(CHROME_PATHS)).toEqual(expect.arrayContaining(['darwin', 'linux', 'win32']));
    });

    it('has Chromium paths for darwin and linux', () => {
      expect(CHROMIUM_PATHS.darwin.length).toBeGreaterThan(0);
      expect(CHROMIUM_PATHS.linux.length).toBeGreaterThan(0);
    });

    it('Chrome paths do not include Chromium binaries', () => {
      for (const paths of Object.values(CHROME_PATHS)) {
        for (const p of paths) {
          expect(p.toLowerCase()).not.toContain('chromium');
        }
      }
    });

    it('Chromium paths do not include Chrome binaries', () => {
      for (const paths of Object.values(CHROMIUM_PATHS)) {
        for (const p of paths) {
          expect(p.toLowerCase()).not.toContain('google');
        }
      }
    });
  });

  describe('playwrightCacheDir', () => {
    it('returns path containing ms-playwright', () => {
      expect(playwrightCacheDir()).toContain('ms-playwright');
    });

    it('uses XDG_CACHE_HOME on linux when set', () => {
      if (process.platform !== 'linux') return;
      process.env.XDG_CACHE_HOME = '/custom/cache';
      expect(playwrightCacheDir()).toBe('/custom/cache/ms-playwright');
    });

    it('falls back to ~/.cache when XDG_CACHE_HOME is empty string', () => {
      if (process.platform !== 'linux') return;
      process.env.XDG_CACHE_HOME = '';
      expect(playwrightCacheDir()).toContain('.cache/ms-playwright');
    });
  });

  describe('hasPlaywrightBundledChromium', () => {
    it('returns false when cache does not exist', () => {
      readdirSyncMock.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      expect(hasPlaywrightBundledChromium()).toBe(false);
    });

    it('returns false when cache has no chromium entries', () => {
      readdirSyncMock.mockReturnValue(['firefox-1234', 'webkit-5678']);
      expect(hasPlaywrightBundledChromium()).toBe(false);
    });

    it('returns true when cache has chromium entry', () => {
      readdirSyncMock.mockReturnValue(['chromium-1140', 'firefox-1234']);
      expect(hasPlaywrightBundledChromium()).toBe(true);
    });

    it('respects PLAYWRIGHT_BROWSERS_PATH', () => {
      process.env.PLAYWRIGHT_BROWSERS_PATH = '/custom/browsers';
      readdirSyncMock.mockReturnValue(['chromium-1140']);
      hasPlaywrightBundledChromium();
      expect(readdirSyncMock).toHaveBeenCalledWith('/custom/browsers');
    });
  });

  describe('detectBrowserForPlaywright', () => {
    it('returns found with empty extraArgs when system Chrome exists', () => {
      const chromePaths = CHROME_PATHS[process.platform] ?? [];
      if (chromePaths.length === 0) return;
      existsSyncMock.mockImplementation((p: string) => p === chromePaths[0]);
      const result = detectBrowserForPlaywright();
      expect(result).toEqual({ found: true, extraArgs: [] });
    });

    it('returns --browser chromium when only bundled chromium exists', () => {
      existsSyncMock.mockReturnValue(false);
      readdirSyncMock.mockReturnValue(['chromium-1140']);
      const result = detectBrowserForPlaywright();
      expect(result).toEqual({ found: true, extraArgs: ['--browser', 'chromium'] });
    });

    it('returns --executable-path when only system Chromium exists', () => {
      const chromiumPaths = CHROMIUM_PATHS[process.platform] ?? [];
      if (chromiumPaths.length === 0) return;
      existsSyncMock.mockImplementation((p: string) => p === chromiumPaths[0]);
      readdirSyncMock.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      const result = detectBrowserForPlaywright();
      expect(result).toEqual({ found: true, extraArgs: ['--executable-path', chromiumPaths[0]] });
    });

    it('returns found:false when nothing is available', () => {
      existsSyncMock.mockReturnValue(false);
      readdirSyncMock.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      expect(detectBrowserForPlaywright()).toEqual({ found: false });
    });

    it('prefers system Chrome over bundled chromium', () => {
      const chromePaths = CHROME_PATHS[process.platform] ?? [];
      if (chromePaths.length === 0) return;
      existsSyncMock.mockImplementation((p: string) => p === chromePaths[0]);
      readdirSyncMock.mockReturnValue(['chromium-1140']);
      const result = detectBrowserForPlaywright();
      expect(result).toEqual({ found: true, extraArgs: [] });
    });
  });
});
