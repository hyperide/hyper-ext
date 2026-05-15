import { createRoot } from 'react-dom/client';
import { PreviewPanelApp } from './PreviewPanelApp';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<PreviewPanelApp />);
}
