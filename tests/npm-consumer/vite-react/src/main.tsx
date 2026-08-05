import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@ioai/lerobot-studio/style.css';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
