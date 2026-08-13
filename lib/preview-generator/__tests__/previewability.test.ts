import { describe, expect, it } from 'bun:test';
import {
  classifyNonPreviewable,
  hasRenderableComponentExport,
  hasRenderableDefaultExport,
  isEntryBootstrap,
  rankComponentRecommendations,
} from '../previewability';

// The bug this module fixes: opening a ReactDOM entry file (main.tsx) in the Hyper
// Canvas spun "Generating sample…" forever. main.tsx has no renderable export — it
// only boots the app — so it must classify as non-previewable ('entry-file'), and the
// host then surfaces an error + recommendations instead of spinning.
const MAIN_TSX = `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)`;

const APP_TSX = `import Sidebar from './components/Sidebar';
export default function App() {
  return <div><Sidebar /></div>;
}`;

describe('classifyNonPreviewable', () => {
  it('flags a ReactDOM entry file (main.tsx) as a non-previewable entry-file', () => {
    expect(classifyNonPreviewable(MAIN_TSX)).toBe('entry-file');
  });

  it('flags hydrateRoot / ReactDOM.render bootstraps as entry-file', () => {
    expect(classifyNonPreviewable('import {hydrateRoot} from "react-dom/client"; hydrateRoot(el, <App/>);')).toBe(
      'entry-file',
    );
    expect(classifyNonPreviewable('import ReactDOM from "react-dom"; ReactDOM.render(<App/>, el);')).toBe('entry-file');
  });

  it('flags a file with no renderable export and no bootstrap as no-renderable-export', () => {
    expect(classifyNonPreviewable('/// <reference types="vite/client" />')).toBe('no-renderable-export');
    expect(classifyNonPreviewable('export const API_URL = "https://x";')).toBe('no-renderable-export');
    expect(classifyNonPreviewable('export default { theme: "dark" };')).toBe('no-renderable-export');
  });

  it('returns null (previewable) for a component with a default export', () => {
    expect(classifyNonPreviewable(APP_TSX)).toBeNull();
  });

  it('returns null (previewable) for a component with a named export', () => {
    expect(classifyNonPreviewable('export const Button = () => <button/>;')).toBeNull();
    expect(classifyNonPreviewable('export function Card() { return <div/>; }')).toBeNull();
  });

  it('returns null for memo/forwardRef default exports (still renderable)', () => {
    expect(classifyNonPreviewable('import {memo} from "react"; const X=()=>null; export default memo(X);')).toBeNull();
  });
});

describe('hasRenderableComponentExport / hasRenderableDefaultExport', () => {
  it('detects renderable default and named exports', () => {
    expect(hasRenderableDefaultExport(APP_TSX)).toBe(true);
    expect(hasRenderableComponentExport(APP_TSX)).toBe(true);
    expect(hasRenderableComponentExport('export const Hero = () => <h1/>;')).toBe(true);
  });

  it('does not treat data-literal default exports as renderable', () => {
    expect(hasRenderableDefaultExport('export default { a: 1 };')).toBe(false);
    expect(hasRenderableDefaultExport('export default [1, 2, 3];')).toBe(false);
    expect(hasRenderableDefaultExport('export default "hello";')).toBe(false);
  });

  it('reports no renderable export for an entry bootstrap', () => {
    expect(hasRenderableComponentExport(MAIN_TSX)).toBe(false);
    expect(isEntryBootstrap(MAIN_TSX)).toBe(true);
  });
});

describe('rankComponentRecommendations', () => {
  const files = [
    { path: 'src/components/Feed.tsx', name: 'Feed' },
    { path: 'src/App.tsx', name: 'App' },
    { path: 'src/components/Sidebar.tsx', name: 'Sidebar' },
    { path: 'src/main.tsx', name: 'Main' },
  ];

  it('sorts App/index roots first and excludes the opened file', () => {
    const ranked = rankComponentRecommendations(files, { excludePath: 'src/main.tsx' });
    expect(ranked.map((r) => r.path)).toEqual(['src/App.tsx', 'src/components/Feed.tsx', 'src/components/Sidebar.tsx']);
  });

  it('caps the list at the requested limit', () => {
    expect(rankComponentRecommendations(files, { limit: 2 })).toHaveLength(2);
  });

  it('de-duplicates by path (Windows separators normalized)', () => {
    const dup = [
      { path: 'src/App.tsx', name: 'App' },
      { path: 'src\\App.tsx', name: 'App' },
    ];
    expect(rankComponentRecommendations(dup)).toHaveLength(1);
  });
});
