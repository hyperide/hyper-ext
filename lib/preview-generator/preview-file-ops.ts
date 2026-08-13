import { dirname, join, relative } from 'node:path';
import type { FileIO } from '../ast/file-io';

const GIT_EXCLUDE_ENTRIES = [
  '# HyperIDE — generated preview files',
  '__canvas_preview__.tsx',
  '__canvas_preview_standalone__.tsx',
  '__canvas_samples__.tsx',
  '*.samples.tsx',
  '.hyperide/',
  '**/test-preview/',
  '**/test-preview.tsx',
  '**/test-preview.astro',
];

export async function ensureGitExclude(
  io: FileIO,
  projectRoot: string,
  findGitRoot: (dir: string) => Promise<string | null>,
): Promise<void> {
  const gitRoot = await findGitRoot(projectRoot);
  if (!gitRoot) return;

  const excludePath = join(gitRoot, '.git/info/exclude');

  let existing = '';
  try {
    existing = await io.readFile(excludePath);
  } catch {
    // .git/info/exclude may not exist yet — we'll create it
  }

  const toAdd = GIT_EXCLUDE_ENTRIES.filter((line) => !existing.includes(line));
  if (toAdd.length === 0) return;

  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  try {
    await io.writeFile(excludePath, `${existing}${separator}${toAdd.join('\n')}\n`);
  } catch {
    // .git is a file in linked worktrees — silently skip
  }
}

export async function ensureStandaloneEntry(
  io: FileIO,
  projectRoot: string,
  previewPath: string,
  ensureGitExcludeFn: () => Promise<void>,
): Promise<void> {
  const previewDir = dirname(previewPath);
  const standaloneEntryPath = join(previewDir, '__canvas_preview_standalone__.tsx');

  let baseContent: string;
  try {
    baseContent = await io.readFile(previewPath);
  } catch {
    return; // __canvas_preview__.tsx not generated yet
  }

  // Relative path from src/__canvas_preview_standalone__.tsx to .hyperide/preview
  const wrapperImportPath = join(relative(previewDir, projectRoot), '.hyperide/preview').replace(/\\/g, '/');

  // Detect the app's root element ID from index.html. Many projects use 'app-root',
  // 'main', or similar instead of the React default 'root'. Fall back to 'root' if
  // index.html is absent or doesn't contain a recognizable mount point.
  let rootElementId = 'root';
  try {
    const indexHtml = await io.readFile(join(projectRoot, 'index.html'));
    const divMatch = indexHtml.match(/<div\s+id="([^"]+)"/);
    if (divMatch?.[1]) rootElementId = divMatch[1];
  } catch {
    // index.html not present — keep 'root'
  }

  const bootstrap = [
    '',
    '// @hyperide-managed',
    "import { createRoot } from 'react-dom/client';",
    `import { PreviewWrapper } from '${wrapperImportPath}';`,
    '',
    `const _rootEl = document.getElementById('${rootElementId}');`,
    'if (_rootEl) {',
    '  // Reuse root across HMR to avoid calling createRoot on the same container twice.',
    '  // Cast to any so TypeScript in Webpack/Parcel projects (no Vite types) does not error.',
    '  const _hot = (import.meta as any).hot as { data: Record<string, unknown>; accept: () => void } | undefined;',
    '  const _existingRoot = _hot?.data?.root as ReturnType<typeof createRoot> | undefined;',
    '  const _root = _existingRoot ?? createRoot(_rootEl);',
    '  if (_hot) {',
    '    _hot.data.root = _root;',
    '    _hot.accept();',
    '  }',
    '  _root.render(',
    '    <PreviewWrapper>',
    '      <CanvasPreview />',
    '    </PreviewWrapper>',
    '  );',
    '}',
    '',
  ].join('\n');

  const newContent = `${baseContent.trimEnd()}\n${bootstrap}`;

  // Skip write if content is identical — prevents unnecessary HMR full-reload
  // (this file has side effects: createRoot().render(), so Vite always does a
  // full page reload when it changes, killing iframe state).
  try {
    const existing = await io.readFile(standaloneEntryPath);
    if (existing === newContent) return;
  } catch {
    // File doesn't exist yet — proceed with write
  }

  await io.mkdir?.(previewDir);
  await io.writeFile(standaloneEntryPath, newContent);
  // Ensure __canvas_preview_standalone__.tsx is git-excluded for all frameworks.
  await ensureGitExcludeFn();
}
