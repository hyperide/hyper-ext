import { createRoot } from 'react-dom/client';
import { RightPanelApp } from './RightPanelApp';

function syncDarkClass() {
  const isDark =
    document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
  document.documentElement.classList.toggle('dark', isDark);
}
syncDarkClass();
new MutationObserver(syncDarkClass).observe(document.body, { attributes: true, attributeFilter: ['class'] });

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<RightPanelApp />);
}
