#!/usr/bin/env node
/**
 * Guard: this VS Code extension is **npm-only**. `@vscode/vsce` runs `npm list`
 * during packaging and a `bun.lock` breaks it; `bun test` also mis-resolves the
 * `vscode` external ("Cannot find package 'vscode'"). See AGENTS.md.
 *
 * Wired as the package's `preinstall`, so a `bun install` here fails fast with a
 * clear message. Note bun still writes `bun.lock` to disk BEFORE this preinstall runs,
 * so this is only the early human-facing warning — the durable stop against a committed
 * lockfile is the lefthook hook (`no-ext-bun-lock`) + CI (`ci.yml`) + `.gitignore`.
 * Fires ONLY when bun is detected — `npm ci` / `npm install` pass through.
 */
const ua = process.env.npm_config_user_agent || '';
const isBun = ua.startsWith('bun') || typeof process.versions.bun === 'string';

if (isBun) {
  console.error('\n[hypercanvas] This VS Code extension is npm-only — do not use bun here.');
  console.error('  Use:  npm ci  |  npm run build  |  npm test   (in vscode-extension/hypercanvas-preview)');
  console.error('  Why:  @vscode/vsce runs `npm list`; a bun.lock breaks `vsce package`, and `bun test`');
  console.error('        mis-resolves the `vscode` external ("Cannot find package vscode"). See AGENTS.md.\n');
  process.exit(1);
}
