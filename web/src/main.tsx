import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app/App';
import { useStore, type BeforeInstallPromptEvent } from './lib/store';
import './styles/app.css';

registerSW({ immediate: true });

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  useStore.getState().setInstallPrompt(e as BeforeInstallPromptEvent);
});
window.addEventListener('appinstalled', () => {
  useStore.getState().setInstallPrompt(null);
  useStore.getState().toast('GigaChat wurde installiert', 'success');
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
