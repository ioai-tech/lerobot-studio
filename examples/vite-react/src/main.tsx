import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@ioai/lerobot-studio/style.css';
import { App } from './App';
import './styles.css';

declare global {
  interface Window {
    __LEROBOT_CONSUMER__: {
      infoRead: boolean;
      wasmFetched: boolean;
      workerConstructed: boolean;
    };
  }
}

window.__LEROBOT_CONSUMER__ = {
  infoRead: false,
  wasmFetched: false,
  workerConstructed: false,
};
const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const input = args[0];
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const isWasm = url.startsWith('data:')
    ? url.includes('wasm')
    : new URL(url).pathname.endsWith('.wasm');
  const response = await nativeFetch(...args);
  if (isWasm && response.ok) window.__LEROBOT_CONSUMER__.wasmFetched = true;
  return response;
};
window.Worker = new Proxy(window.Worker, {
  construct(Target, args) {
    window.__LEROBOT_CONSUMER__.workerConstructed = true;
    return Reflect.construct(Target, args);
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
