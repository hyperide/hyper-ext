import { createRoot } from 'react-dom/client';
import { AIChatApp } from './AIChatApp';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<AIChatApp />);
}
