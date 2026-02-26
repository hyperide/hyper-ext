import { DevServerLogsViewer } from './DevServerLogsViewer';

/**
 * Main webview app — dev server logs only.
 * AI chat has been moved to a separate webview (AI Chat panel).
 */
export function App() {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <DevServerLogsViewer />
    </div>
  );
}
