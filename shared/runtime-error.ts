/**
 * Runtime error detected from iframe (Next.js, Vite, Bun error overlays)
 */
export interface RuntimeError {
  framework: 'nextjs' | 'vite' | 'bun' | 'unknown';
  type: string; // "Build Error", "Runtime Error", "SyntaxError", etc.
  message: string; // "Module not found: Can't resolve..."
  file?: string; // "./apps/next/__canvas_preview__.tsx"
  line?: number; // 8
  codeframe?: string; // code snippet with error highlight
  fullText: string; // full error text for AI
}
