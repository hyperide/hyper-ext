/**
 * Canvas Interaction — webview-side bridge for preview panel.
 *
 * Runs in the VS Code webview (NOT inside the iframe).
 * Communicates with the iframe-injected interaction script via postMessage.
 * Manages overlay divs in the webview overlay container.
 *
 * Bundled as IIFE with globalName '__canvasInteraction'.
 */

import {
	renderOverlayRects,
	clearOverlays,
} from '@shared/canvas-interaction/overlay-renderer';
import type { OverlayRect } from '@shared/canvas-interaction/types';

export interface CanvasInteractionInstance {
	updateState: (patch: Record<string, unknown>) => void;
	dispose: () => void;
}

type StateChangeCallback = (patch: Record<string, unknown>) => void;

/**
 * Initialize canvas interaction for a preview iframe.
 *
 * @param frame - The preview iframe element
 * @param overlayContainer - Container for overlay divs (position: absolute, covers iframe)
 * @param onStateChange - Called when user interacts with the preview (click, hover)
 */
export function init(
	frame: HTMLIFrameElement,
	overlayContainer: HTMLElement,
	onStateChange: StateChangeCallback,
): CanvasInteractionInstance {
	const overlayElements = new Map<string, HTMLDivElement>();
	let disposed = false;

	function handleMessage(event: MessageEvent) {
		if (disposed) return;

		// Only accept messages from our iframe
		if (event.source !== frame.contentWindow) return;

		const msg = event.data;
		if (!msg || typeof msg.type !== 'string') return;

		switch (msg.type) {
			case 'hypercanvas:elementClick': {
				const clickPatch: Record<string, unknown> = {
					selectedIds: [msg.elementId],
				};
				if (msg.itemIndex !== null && msg.itemIndex !== undefined) {
					clickPatch.selectedItemIndices = { [msg.elementId]: msg.itemIndex };
				}
				onStateChange(clickPatch);
				break;
			}

			case 'hypercanvas:elementHover':
				onStateChange({
					hoveredId: msg.elementId,
					hoveredItemIndex: msg.itemIndex,
				});
				break;

			case 'hypercanvas:emptyClick':
				onStateChange({ selectedIds: [] });
				break;

			case 'hypercanvas:overlayRects': {
				const rects = msg.rects as OverlayRect[];
				renderOverlayRects(overlayContainer, rects, overlayElements);
				break;
			}
		}
	}

	window.addEventListener('message', handleMessage); // nosemgrep: insufficient-postmessage-origin-validation -- VS Code webview, checks event.source against iframe

	return {
		/**
		 * Forward state updates to the iframe-injected script.
		 * Called when extension broadcasts state changes (e.g. tree selection).
		 */
		updateState(patch: Record<string, unknown>) {
			if (disposed) return;
			frame.contentWindow?.postMessage( // nosemgrep: wildcard-postmessage-configuration -- webview->iframe, same-origin VS Code context
				{ type: 'hypercanvas:stateUpdate', ...patch },
				'*',
			);
		},

		dispose() {
			disposed = true;
			window.removeEventListener('message', handleMessage);
			clearOverlays(overlayElements);
		},
	};
}
