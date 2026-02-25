/**
 * VS Code Webview implementation of platform adapters
 *
 * All communication goes through VS Code's postMessage API.
 * The extension host handles:
 * - Editor operations (opening files, navigation)
 * - SSE proxying (CORS workaround)
 * - API proxying (CORS workaround)
 */

import type {
	ApiAdapter,
	CanvasAdapter,
	EditorAdapter,
	MessageOfType,
	PlatformMessage,
	SSEAdapter,
	ThemeAdapter,
} from './types';

// ============================================================================
// VS Code API type
// ============================================================================

interface VSCodeApi {
	postMessage(message: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
}

// Declare the global function that VS Code injects
declare function acquireVsCodeApi(): VSCodeApi;

// Singleton for VS Code API
let vscodeApi: VSCodeApi | null = null;

function getVSCodeApi(): VSCodeApi {
	if (!vscodeApi) {
		vscodeApi = acquireVsCodeApi();
	}
	return vscodeApi;
}

// ============================================================================
// Message handlers registry
// ============================================================================

type MessageHandler = (message: PlatformMessage) => void;
const messageHandlers = new Set<MessageHandler>();
let isMessageListenerAttached = false;

function attachMessageListener() {
	if (isMessageListenerAttached) return;
	isMessageListenerAttached = true;

	// nosemgrep: insufficient-postmessage-origin-validation -- message type is validated; origin varies between SaaS and VS Code webview contexts
	window.addEventListener('message', (event) => {
		const message = event.data as PlatformMessage;
		if (message?.type) {
			for (const handler of messageHandlers) {
				handler(message);
			}
		}
	});
}

// ============================================================================
// VS Code Editor Adapter
// ============================================================================

export function createVSCodeEditorAdapter(): EditorAdapter {
	const vscode = getVSCodeApi();

	return {
		async openFile(
			path: string,
			line?: number,
			column?: number,
		): Promise<void> {
			vscode.postMessage({
				type: 'editor:openFile',
				path,
				line,
				column,
			} satisfies PlatformMessage);
		},

		async getActiveFile(): Promise<string | null> {
			// Request active file from extension
			return new Promise((resolve) => {
				const requestId = crypto.randomUUID();

				const handler = (message: PlatformMessage) => {
					if (
						message.type === 'editor:activeFileChanged' &&
						// We don't have requestId in activeFileChanged, so just resolve with first response
						true
					) {
						messageHandlers.delete(handler);
						resolve(message.path);
					}
				};

				messageHandlers.add(handler);
				attachMessageListener();

				// Request current active file
				vscode.postMessage({
					type: 'editor:getActiveFile',
					requestId,
				});

				// Timeout after 1 second
				setTimeout(() => {
					messageHandlers.delete(handler);
					resolve(null);
				}, 1000);
			});
		},

		onActiveFileChange(callback: (path: string | null) => void): () => void {
			const handler = (message: PlatformMessage) => {
				if (message.type === 'editor:activeFileChanged') {
					callback(message.path);
				}
			};

			messageHandlers.add(handler);
			attachMessageListener();

			return () => {
				messageHandlers.delete(handler);
			};
		},

		async goToCode(path: string, line: number, column: number): Promise<void> {
			vscode.postMessage({
				type: 'editor:goToCode',
				path,
				line,
				column,
			} satisfies PlatformMessage);
		},
	};
}

// ============================================================================
// VS Code Canvas Adapter
// ============================================================================

export function createVSCodeCanvasAdapter(): CanvasAdapter {
	const vscode = getVSCodeApi();

	return {
		sendEvent<T extends PlatformMessage>(message: T): void {
			// Send to extension host
			vscode.postMessage(message);

			// Also dispatch locally for components within the webview
			window.dispatchEvent(
				new CustomEvent('platform:message', { detail: message }),
			);
		},

		onEvent<K extends PlatformMessage['type']>(
			type: K,
			callback: (message: MessageOfType<K>) => void,
		): () => void {
			// Listen for messages from extension
			const extensionHandler = (message: PlatformMessage) => {
				if (message.type === type) {
					callback(message as MessageOfType<K>);
				}
			};

			messageHandlers.add(extensionHandler);
			attachMessageListener();

			// Also listen for local events
			const localHandler = (event: Event) => {
				const customEvent = event as CustomEvent<PlatformMessage>;
				if (customEvent.detail?.type === type) {
					callback(customEvent.detail as MessageOfType<K>);
				}
			};

			window.addEventListener('platform:message', localHandler);

			return () => {
				messageHandlers.delete(extensionHandler);
				window.removeEventListener('platform:message', localHandler);
			};
		},
	};
}

// ============================================================================
// VS Code Theme Adapter
// ============================================================================

export function createVSCodeThemeAdapter(): ThemeAdapter {
	return {
		getTheme(): 'light' | 'dark' {
			// VS Code sets theme classes on body
			const body = document.body;
			if (
				body.classList.contains('vscode-dark') ||
				body.classList.contains('vscode-high-contrast')
			) {
				return 'dark';
			}
			return 'light';
		},

		onThemeChange(callback: (theme: 'light' | 'dark') => void): () => void {
			const observer = new MutationObserver(() => {
				const theme = document.body.classList.contains('vscode-dark')
					? 'dark'
					: 'light';
				callback(theme);
			});

			observer.observe(document.body, {
				attributes: true,
				attributeFilter: ['class'],
			});

			return () => observer.disconnect();
		},
	};
}

// ============================================================================
// VS Code SSE Adapter (proxied through extension)
// ============================================================================

export function createVSCodeSSEAdapter(): SSEAdapter {
	const vscode = getVSCodeApi();

	return {
		subscribe(
			url: string,
			callbacks: {
				onMessage: (event: string, data: unknown) => void;
				onError?: (error: string) => void;
				onConnected?: () => void;
			},
		): () => void {
			const subscriptionId = crypto.randomUUID();

			const handler = (message: PlatformMessage) => {
				if (
					message.type === 'sse:message' &&
					message.subscriptionId === subscriptionId
				) {
					callbacks.onMessage(message.event, message.data);
				} else if (
					message.type === 'sse:error' &&
					message.subscriptionId === subscriptionId
				) {
					callbacks.onError?.(message.error);
				} else if (
					message.type === 'sse:connected' &&
					message.subscriptionId === subscriptionId
				) {
					callbacks.onConnected?.();
				}
			};

			messageHandlers.add(handler);
			attachMessageListener();

			// Request SSE subscription from extension
			vscode.postMessage({
				type: 'sse:subscribe',
				url,
				subscriptionId,
			} satisfies PlatformMessage);

			return () => {
				messageHandlers.delete(handler);
				// Unsubscribe from SSE
				vscode.postMessage({
					type: 'sse:unsubscribe',
					subscriptionId,
				} satisfies PlatformMessage);
			};
		},
	};
}

// ============================================================================
// VS Code API Adapter (proxied through extension for CORS)
// ============================================================================

export function createVSCodeApiAdapter(): ApiAdapter {
	const vscode = getVSCodeApi();

	return {
		async fetch(url: string, options?: RequestInit): Promise<Response> {
			return new Promise((resolve, reject) => {
				const requestId = crypto.randomUUID();

				const handler = (message: PlatformMessage) => {
					if (
						message.type === 'api:response' &&
						message.requestId === requestId
					) {
						messageHandlers.delete(handler);

						// Reconstruct Response object
						const response = new Response(JSON.stringify(message.body), {
							status: message.status,
							statusText: message.statusText,
							headers: new Headers(message.headers),
						});

						// Override ok property based on actual status
						Object.defineProperty(response, 'ok', {
							get: () => message.ok,
						});

						resolve(response);
					} else if (
						message.type === 'api:error' &&
						message.requestId === requestId
					) {
						messageHandlers.delete(handler);
						reject(new Error(message.error));
					}
				};

				messageHandlers.add(handler);
				attachMessageListener();

				// Send fetch request to extension
				vscode.postMessage({
					type: 'api:fetch',
					requestId,
					url,
					options: options
						? {
								method: options.method,
								headers: options.headers
									? Object.fromEntries(new Headers(options.headers).entries())
									: undefined,
								body:
									typeof options.body === 'string' ? options.body : undefined,
							}
						: undefined,
				} satisfies PlatformMessage);

				// Timeout after 30 seconds
				setTimeout(() => {
					messageHandlers.delete(handler);
					reject(new Error('API request timeout'));
				}, 30000);
			});
		},
	};
}

// ============================================================================
// Combined VS Code Adapters
// ============================================================================

export function createVSCodeAdapters() {
	return {
		context: 'vscode-webview' as const,
		editor: createVSCodeEditorAdapter(),
		canvas: createVSCodeCanvasAdapter(),
		theme: createVSCodeThemeAdapter(),
		sse: createVSCodeSSEAdapter(),
		api: createVSCodeApiAdapter(),
	};
}
