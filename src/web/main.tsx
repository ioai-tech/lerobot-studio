import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import App from './App.tsx';

window.onerror = (message, source, lineno, colno, error) => {
  console.error('[Global Error]:', { message, source, lineno, colno, error });
};

window.onunhandledrejection = (event) => {
  console.error('[Unhandled Rejection]:', event.reason);
};

function renderApp() {
  const container = document.getElementById('lerobot-root') || document.getElementById('root');
  if (!container) {
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', renderApp);
    } else {
      console.error('Target container #lerobot-root not found. Please check index.html.');
    }
    return;
  }

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  requestAnimationFrame(() => {
    window.__APP_LOADER_DONE__?.();
  });
}

renderApp();
