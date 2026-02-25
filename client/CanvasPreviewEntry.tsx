/**
 * Separate entry point for preview mode
 * Used when HyperIDE runs inside itself (preview iframe)
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ComponentMetaProvider } from '@/contexts/ComponentMetaContext';
import { CanvasEngine, CanvasEngineProvider } from '@/lib/canvas-engine';
import { htmlComponents } from '@/lib/htmlComponents';
import CanvasPreview from './__canvas_preview__';

const queryClient = new QueryClient();

const previewEngine = new CanvasEngine({ debug: false });
htmlComponents.forEach((comp) => {
  previewEngine.registerComponent(comp as Parameters<typeof previewEngine.registerComponent>[0]);
});

// biome-ignore lint/style/noNonNullAssertion: root element is guaranteed by index.html
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <ComponentMetaProvider>
        <CanvasEngineProvider engine={previewEngine}>
          <CanvasPreview />
        </CanvasEngineProvider>
      </ComponentMetaProvider>
    </TooltipProvider>
  </QueryClientProvider>,
);
