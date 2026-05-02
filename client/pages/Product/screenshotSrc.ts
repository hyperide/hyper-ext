const SCREENSHOT_VERSION = '2026-05-02-hyperide-bulka';

export function screenshotSrc(path: string) {
  return `${path}?v=${SCREENSHOT_VERSION}`;
}
