/** Minimal webview mock for StateHub tests */
export function createMockWebview() {
  const messages: unknown[] = [];
  return {
    postMessage: (msg: unknown) => {
      messages.push(msg);
      return Promise.resolve(true);
    },
    messages,
  };
}
