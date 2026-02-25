import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import CanvasPreview from './__canvas_preview__';
import App from './App';
import './index.css';

const PreviewGuard = () => {
  if (process.env.NODE_ENV !== 'development') {
    return <div style={{ padding: '20px' }}>Preview not available in production</div>;
  }
  return <CanvasPreview />;
};

// Use conditional render instead of nested Routes to avoid BrowserRouter conflict
// App.tsx already has its own BrowserRouter, so we render App directly
const isPreviewPath = window.location.pathname.match(/^\/project-preview\/[^/]+\/test-preview$/);

const element = document.getElementById('root');
if (element) {
  createRoot(element).render(
    <StrictMode>
      {isPreviewPath ? <PreviewGuard /> : <App />}
    </StrictMode>
  );
}