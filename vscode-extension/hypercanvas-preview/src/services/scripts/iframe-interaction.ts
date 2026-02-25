/**
 * Iframe interaction script — injected into user's preview iframe by PreviewProxy.
 *
 * Built as IIFE by esbuild, runs inside the preview iframe (not the VS Code webview).
 * Handles click/hover/context menu, keyboard shortcuts, overlay rects, design CSS.
 * Communicates with parent webview via postMessage.
 */

import { attachClickHandler } from '@shared/canvas-interaction/click-handler';
import { createDesignKeydownHandler } from '@shared/canvas-interaction/keyboard-handler';

// === State (synced from parent webview via postMessage) ===
const state = {
	selectedIds: [] as string[],
	hoveredId: null as string | null,
	hoveredItemIndex: null as number | null,
	selectedItemIndices: {} as Record<string, number | null>,
	engineMode: 'design' as string,
};
let activeInstanceId: string | null = null;

// === Shared click handler ===
attachClickHandler(
	document,
	{
		onElementClick: (id, _el, _e, itemIndex) =>
			window.parent.postMessage(
				{
					type: 'hypercanvas:elementClick',
					elementId: id,
					itemIndex,
				},
				'*',
			),
		onElementHover: (id, _el, itemIndex) =>
			window.parent.postMessage(
				{
					type: 'hypercanvas:elementHover',
					elementId: id,
					itemIndex,
				},
				'*',
			),
		onEmptyClick: () =>
			window.parent.postMessage(
				{ type: 'hypercanvas:emptyClick' },
				'*',
			),
		getMode: () => state.engineMode as 'design' | 'interact',
	},
	{ activeInstanceId },
);

// === Shared keyboard handler ===
const { handler: keydownHandler } = createDesignKeydownHandler({
	getState: () => ({
		selectedIds: state.selectedIds,
		activeInstanceId,
	}),
	getDocument: () => document,
	callbacks: {
		onSelectElement: (id) =>
			window.parent.postMessage(
				{
					type: 'hypercanvas:elementClick',
					elementId: id,
					itemIndex: null,
				},
				'*',
			),
		onSelectMultiple: (ids) =>
			window.parent.postMessage(
				{
					type: 'hypercanvas:selectMultiple',
					elementIds: ids,
				},
				'*',
			),
		onClearSelection: () =>
			window.parent.postMessage(
				{ type: 'hypercanvas:emptyClick' },
				'*',
			),
		onDeleteElements: (ids) =>
			window.parent.postMessage(
				{
					type: 'hypercanvas:deleteElements',
					elementIds: ids,
				},
				'*',
			),
	},
	isDesignMode: () => state.engineMode === 'design',
});
document.addEventListener('keydown', keydownHandler, true);

// === Context menu handler ===
document.addEventListener(
	'contextmenu',
	function (e: MouseEvent) {
		if (state.engineMode !== 'design') return;
		e.preventDefault();
		e.stopPropagation();

		const target = e.target as HTMLElement;
		const element = target.closest('[data-uniq-id]') as HTMLElement | null;
		const elementId = element?.dataset.uniqId ?? null;

		// Inline item index calculation (avoid importing getItemIndex just for this)
		let itemIndex: number | null = null;
		if (element && elementId) {
			let selector = `[data-uniq-id="${elementId}"]`;
			if (activeInstanceId) {
				selector = `[data-canvas-instance-id="${activeInstanceId}"] ${selector}`;
			}
			const all = document.querySelectorAll(selector);
			if (all.length > 1) {
				itemIndex = Array.prototype.indexOf.call(all, element);
			}
		}

		window.parent.postMessage(
			{
				type: 'hypercanvas:contextMenu',
				elementId,
				itemIndex,
				x: e.clientX,
				y: e.clientY,
			},
			'*',
		);
	},
	true,
);

// === Focus prevention in design mode (mousedown, not focusin) ===
document.addEventListener(
	'mousedown',
	function (e: MouseEvent) {
		if (state.engineMode !== 'design') return;
		const target = e.target as HTMLElement;
		if (
			target.tagName === 'INPUT' ||
			target.tagName === 'TEXTAREA' ||
			target.tagName === 'SELECT' ||
			target.isContentEditable
		) {
			e.preventDefault(); // Actually prevents focus on mousedown
		}
	},
	true,
);

// === RAF loop: send bounding rects for overlays ===
let prevRectsJSON = '';
function sendOverlayRects(): void {
	const rects: Array<{
		key: string;
		left: number;
		top: number;
		width: number;
		height: number;
		type: string;
	}> = [];

	// Selection rects
	for (let i = 0; i < state.selectedIds.length; i++) {
		const id = state.selectedIds[i];
		let selector = `[data-uniq-id="${id}"]`;
		if (activeInstanceId) {
			selector = `[data-canvas-instance-id="${activeInstanceId}"] ${selector}`;
		}
		const elements = document.querySelectorAll(selector);
		const itemIdx = state.selectedItemIndices[id];

		if (itemIdx !== null && itemIdx !== undefined && elements[itemIdx]) {
			const rect = elements[itemIdx].getBoundingClientRect();
			rects.push({
				key: `select-${id}-${itemIdx}`,
				left: rect.left,
				top: rect.top,
				width: rect.width,
				height: rect.height,
				type: 'selection',
			});
		} else {
			for (let j = 0; j < elements.length; j++) {
				const rect = elements[j].getBoundingClientRect();
				rects.push({
					key: `select-${id}-${j}`,
					left: rect.left,
					top: rect.top,
					width: rect.width,
					height: rect.height,
					type: 'selection',
				});
			}
		}
	}

	// Hover rect
	if (state.hoveredId) {
		let hSelector = `[data-uniq-id="${state.hoveredId}"]`;
		if (activeInstanceId) {
			hSelector = `[data-canvas-instance-id="${activeInstanceId}"] ${hSelector}`;
		}
		const hElements = document.querySelectorAll(hSelector);
		const hEl =
			state.hoveredItemIndex !== null && hElements[state.hoveredItemIndex]
				? hElements[state.hoveredItemIndex]
				: hElements[0];
		if (hEl) {
			const hRect = hEl.getBoundingClientRect();
			rects.push({
				key: `hover-${state.hoveredId}`,
				left: hRect.left,
				top: hRect.top,
				width: hRect.width,
				height: hRect.height,
				type: 'hover',
			});
		}
	}

	const rectsJSON = JSON.stringify(rects);
	if (rectsJSON !== prevRectsJSON) {
		prevRectsJSON = rectsJSON;
		window.parent.postMessage(
			{ type: 'hypercanvas:overlayRects', rects },
			'*',
		);
	}

	requestAnimationFrame(sendOverlayRects);
}
requestAnimationFrame(sendOverlayRects);

// === Design mode CSS ===
function updateDesignStyles(mode: string): void {
	const styleId = 'hyper-canvas-dynamic-styles';
	let style = document.getElementById(styleId) as HTMLStyleElement | null;
	if (!style) {
		style = document.createElement('style');
		style.id = styleId;
		document.head.appendChild(style);
	}
	if (mode !== 'interact') {
		style.textContent =
			'body.design-mode, body.design-mode * { cursor: default !important; }\n' +
			'div[data-uniq-id]:empty { min-height: 120px; border: 2px dashed #cbd5e1; background-color: #f8fafc; border-radius: 8px; position: relative; transition: all 0.2s ease; }\n' +
			'div[data-uniq-id]:empty::after { content: "Drop elements here"; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #94a3b8; font-size: 14px; font-weight: 500; pointer-events: none; }\n' +
			'div[data-uniq-id]:empty:hover { border-color: #94a3b8; background-color: #f1f5f9; }';
		if (document.body) document.body.classList.add('design-mode');
	} else {
		style.textContent = '';
		if (document.body) document.body.classList.remove('design-mode');
	}
}

// === Receive messages from parent webview ===
window.addEventListener('message', function (event: MessageEvent) {
	const msg = event.data;
	if (!msg || !msg.type) return;

	if (msg.type === 'hypercanvas:stateUpdate') {
		if (msg.selectedIds !== undefined) state.selectedIds = msg.selectedIds;
		if (msg.hoveredId !== undefined) state.hoveredId = msg.hoveredId;
		if (msg.hoveredItemIndex !== undefined)
			state.hoveredItemIndex = msg.hoveredItemIndex;
		if (msg.selectedItemIndices !== undefined)
			state.selectedItemIndices = msg.selectedItemIndices;
		if (msg.engineMode !== undefined) {
			state.engineMode = msg.engineMode;
			updateDesignStyles(state.engineMode);
		}
		return;
	}

	// Go to Visual: select element and scroll to it
	if (msg.type === 'hypercanvas:goToVisual') {
		state.selectedIds = [msg.elementId];
		state.selectedItemIndices = {};
		const el = document.querySelector(
			`[data-uniq-id="${msg.elementId}"]`,
		);
		if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
		return;
	}

	// Content extraction requests from extension (Copy Text / Copy as HTML)
	if (msg.type === 'hypercanvas:getElementText') {
		const el = document.querySelector(
			`[data-uniq-id="${msg.elementId}"]`,
		) as HTMLElement | null;
		window.parent.postMessage(
			{
				type: 'hypercanvas:elementContentResult',
				requestId: msg.requestId,
				text: el ? el.innerText : null,
				html: null,
			},
			'*',
		);
		return;
	}
	if (msg.type === 'hypercanvas:getElementHTML') {
		const el = document.querySelector(
			`[data-uniq-id="${msg.elementId}"]`,
		) as HTMLElement | null;
		window.parent.postMessage(
			{
				type: 'hypercanvas:elementContentResult',
				requestId: msg.requestId,
				text: null,
				html: el ? el.outerHTML : null,
			},
			'*',
		);
		return;
	}
});

// Initialize design mode
updateDesignStyles(state.engineMode);
