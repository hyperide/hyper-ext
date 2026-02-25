/**
 * VSCode API accessor for webview.
 * acquireVsCodeApi() can only be called once per webview session.
 */

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

// acquireVsCodeApi is injected by VSCode into the webview global scope
declare function acquireVsCodeApi(): VsCodeApi;

export const vscode = acquireVsCodeApi();
