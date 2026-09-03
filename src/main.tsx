import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const KIOSK_LOGICAL_WIDTH = 430;

function syncKioskViewport() {
  const root = document.documentElement;
  const viewportHeight = Math.floor(Math.min(
    window.innerHeight,
    window.visualViewport?.height ?? window.innerHeight,
    root.clientHeight || window.innerHeight,
  ));
  const isPortraitKiosk = window.innerHeight / window.innerWidth >= 1.45;
  const isAndroidKiosk = /Android/i.test(navigator.userAgent) || window.location.protocol === 'capacitor:';

  root.classList.toggle('android-kiosk', isAndroidKiosk);

  if (!isPortraitKiosk) {
    root.classList.remove('portrait-kiosk');
    root.style.removeProperty('--kiosk-height');
    return;
  }

  root.classList.add('portrait-kiosk');
  const kioskWidth = isAndroidKiosk ? window.innerWidth : Math.min(window.innerWidth, KIOSK_LOGICAL_WIDTH);
  root.style.setProperty('--kiosk-width', `${kioskWidth}px`);
  root.style.setProperty('--kiosk-height', `${viewportHeight}px`);
}

syncKioskViewport();
window.addEventListener('resize', syncKioskViewport);
window.addEventListener('orientationchange', syncKioskViewport);
window.visualViewport?.addEventListener('resize', syncKioskViewport);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
