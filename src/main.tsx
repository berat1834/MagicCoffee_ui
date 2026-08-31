import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const KIOSK_LOGICAL_WIDTH = 430;

function syncKioskViewport() {
  const root = document.documentElement;
  const isPortraitKiosk = window.innerHeight / window.innerWidth >= 1.45;

  if (!isPortraitKiosk) {
    root.classList.remove('portrait-kiosk');
    root.style.removeProperty('--kiosk-scale');
    root.style.removeProperty('--kiosk-height');
    return;
  }

  const scale = window.innerWidth / KIOSK_LOGICAL_WIDTH;
  root.classList.add('portrait-kiosk');
  root.style.setProperty('--kiosk-scale', String(scale));
  root.style.setProperty('--kiosk-height', `${window.innerHeight / scale}px`);
}

syncKioskViewport();
window.addEventListener('resize', syncKioskViewport);
window.addEventListener('orientationchange', syncKioskViewport);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
