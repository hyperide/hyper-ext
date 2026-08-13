const SCREENSHOT_VERSION = '2026-06-12-hyper-explorer';

export function screenshotSrc(path: string) {
  return `${path}?v=${SCREENSHOT_VERSION}`;
}
