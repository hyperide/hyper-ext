import { createRoot } from 'react-dom/client';
import { RightPanelApp } from './RightPanelApp';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<RightPanelApp />);
}
