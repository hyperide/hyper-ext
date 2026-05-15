import { createRoot } from 'react-dom/client';
import { PreviewPanelApp } from './PreviewPanelApp';

window.addEventListener('error', (e) => {
  console.error('[HyperIDE webview] Uncaught error:', e.message, e.filename, e.lineno, e.error?.stack);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[HyperIDE webview] Unhandled rejection:', e.reason);
});

const container = document.getElementById('root');
if (container) {
  try {
    createRoot(container).render(<PreviewPanelApp />);
  } catch (err) {
    console.error('[HyperIDE webview] React mount failed:', err);
    container.innerHTML = `<pre style="color:red;padding:12px;font-size:11px">[HyperIDE] Mount error: ${err}\n${(err as Error)?.stack ?? ''}</pre>`;
  }
}
