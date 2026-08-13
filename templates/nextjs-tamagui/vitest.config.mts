import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/.next/**'],
    // Run test files sequentially. The dev-server and build integration
    // tests spawn real Next.js processes that must not run concurrently.
    // Replaces Vitest 3's `poolOptions.threads.singleThread`, removed in v4.
    fileParallelism: false,
  },
});
