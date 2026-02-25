/**
 * Error detection script injected into user's preview iframe by PreviewProxy.
 *
 * Built as IIFE by esbuild, runs inside the preview iframe.
 * Polls for framework error overlays via Shadow DOM every 2 seconds.
 * Sends postMessage to parent window when error state changes.
 */

let lastErrorStr = '';

interface FrameworkError {
	framework: string;
	type: string;
	message: string;
	fullText: string;
	file?: string;
	line?: number;
	codeframe?: string;
}

function checkErrors(): void {
	let error: FrameworkError | null = null;

	// Next.js error overlay (nextjs-portal -> shadowRoot)
	const nextPortal = document.querySelector('nextjs-portal');
	if (nextPortal && nextPortal.shadowRoot) {
		const overlay = nextPortal.shadowRoot.querySelector(
			'[data-nextjs-dialog-overlay]',
		);
		if (overlay) {
			const body = nextPortal.shadowRoot.querySelector(
				'[data-nextjs-dialog-body]',
			);
			const header = nextPortal.shadowRoot.querySelector(
				'[data-nextjs-dialog-header]',
			);
			error = {
				framework: 'nextjs',
				type: header
					? (header.textContent ?? '').trim()
					: 'Build Error',
				message: body
					? (body.textContent ?? '').trim().substring(0, 500)
					: 'Unknown error',
				fullText: (overlay.textContent ?? '').trim().substring(0, 2000),
			};
			const fileEl = nextPortal.shadowRoot.querySelector(
				'[data-nextjs-codeframe] p',
			);
			if (fileEl) {
				const match = (fileEl.textContent ?? '').match(
					/(.+?):(\d+)/,
				);
				if (match) {
					error.file = match[1];
					error.line = Number.parseInt(match[2]);
				}
			}
			const codeEl = nextPortal.shadowRoot.querySelector(
				'[data-nextjs-codeframe] pre',
			);
			if (codeEl) {
				error.codeframe = (codeEl.textContent ?? '').substring(0, 1000);
			}
		}
	}

	// Vite error overlay
	if (!error) {
		const viteOverlay = document.querySelector('vite-error-overlay');
		if (viteOverlay && viteOverlay.shadowRoot) {
			const msgEl =
				viteOverlay.shadowRoot.querySelector('.message-body');
			const fileEl = viteOverlay.shadowRoot.querySelector('.file');
			const frameEl = viteOverlay.shadowRoot.querySelector('.frame');
			if (msgEl) {
				error = {
					framework: 'vite',
					type: 'Build Error',
					message: (msgEl.textContent ?? '').trim().substring(0, 500),
					fullText: (viteOverlay.shadowRoot.textContent ?? '')
						.trim()
						.substring(0, 2000),
				};
				if (fileEl) {
					const match = (fileEl.textContent ?? '').match(
						/(.+?):(\d+)/,
					);
					if (match) {
						error.file = match[1];
						error.line = Number.parseInt(match[2]);
					}
				}
				if (frameEl) {
					error.codeframe = (frameEl.textContent ?? '').substring(
						0,
						1000,
					);
				}
			}
		}
	}

	// Bun HMR error overlay
	if (!error) {
		const bunOverlay = document.querySelector('bun-hmr');
		if (bunOverlay && bunOverlay.shadowRoot) {
			const contentEl =
				bunOverlay.shadowRoot.querySelector('.error-content');
			if (contentEl) {
				error = {
					framework: 'bun',
					type: 'Build Error',
					message: (contentEl.textContent ?? '')
						.trim()
						.substring(0, 500),
					fullText: (bunOverlay.shadowRoot.textContent ?? '')
						.trim()
						.substring(0, 2000),
				};
			}
		}
	}

	// Only send if error state changed
	const errorStr = error ? JSON.stringify(error) : '';
	if (errorStr !== lastErrorStr) {
		lastErrorStr = errorStr;
		try {
			window.parent.postMessage(
				{
					type: 'hypercanvas:runtimeError',
					error,
				},
				'*',
			);
		} catch {
			// Ignore postMessage errors
		}
	}
}

// Poll every 2 seconds
setInterval(checkErrors, 2000);
// Also check on load and after brief delay (for overlays that appear after render)
checkErrors();
setTimeout(checkErrors, 1000);
