/**
 * Separate entry point for preview mode
 * Used when HyperIDE runs inside itself (preview iframe)
 */
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CanvasEngine, CanvasEngineProvider } from '@/lib/canvas-engine';
import { ComponentMetaProvider } from '@/contexts/ComponentMetaContext';
import { htmlComponents } from '@/lib/htmlComponents';
import CanvasPreview from './__canvas_preview__';

const queryClient = new QueryClient();

const previewEngine = new CanvasEngine({ debug: false });
htmlComponents.forEach((comp) => {
	previewEngine.registerComponent(comp as Parameters<typeof previewEngine.registerComponent>[0]);
});

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
