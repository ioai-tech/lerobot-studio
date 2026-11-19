import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setParquetWasmUrl } from '@ioai/lerobot-studio';
import '@ioai/lerobot-studio/style.css';
import { App } from './App';
import './styles.css';

declare global {
  interface Window {
    __LEROBOT_CONSUMER__: {
      infoRead: boolean;
      workerConstructed: boolean;
    };
  }
}

window.__LEROBOT_CONSUMER__ = {
  infoRead: false,
  workerConstructed: false,
};
window.Worker = new Proxy(window.Worker, {
  construct(Target, args) {
    window.__LEROBOT_CONSUMER__.workerConstructed = true;
    return Reflect.construct(Target, args);
  },
});

// `?wasm=self-hosted`: serve the parquet WASM yourself (a copy next to the
// page) instead of the file your bundler emitted from the package.
if (new URLSearchParams(location.search).get('wasm') === 'self-hosted') {
  setParquetWasmUrl(new URL('self-hosted/parquet.wasm', document.baseURI));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
