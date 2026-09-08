import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { KioskLanguageProvider } from './i18n/KioskLanguage';
import './styles.css';

function syncKioskViewport() {
  const root = document.documentElement;
  const logicalWidth = 430;
  const viewportHeight = Math.floor(Math.min(
    window.innerHeight,
    window.visualViewport?.height ?? window.innerHeight,
    root.clientHeight || window.innerHeight,
  ));
  const isPortraitKiosk = window.innerHeight / window.innerWidth >= 1.45;
  const isAndroidDevice = /Android/i.test(navigator.userAgent) || window.location.protocol === 'capacitor:';
  const usesLargeKioskLayout = isAndroidDevice || (isPortraitKiosk && window.innerWidth >= 768);

  root.classList.toggle('android-kiosk', usesLargeKioskLayout);

  if (!isPortraitKiosk) {
    root.classList.remove('portrait-kiosk');
    root.style.removeProperty('--kiosk-scale');
    root.style.removeProperty('--kiosk-width');
    root.style.removeProperty('--kiosk-height');
    return;
  }

  const scale = usesLargeKioskLayout ? 1 : window.innerWidth / logicalWidth;
  root.classList.add('portrait-kiosk');
  root.style.setProperty('--kiosk-scale', String(scale));
  root.style.setProperty('--kiosk-width', `${usesLargeKioskLayout ? window.innerWidth : logicalWidth}px`);
  root.style.setProperty('--kiosk-height', `${viewportHeight / scale}px`);
}

function clearKioskFocus() {
  if (!document.documentElement.classList.contains('android-kiosk')) return;
  window.setTimeout(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, 0);
}

syncKioskViewport();
window.addEventListener('resize', syncKioskViewport);
window.addEventListener('orientationchange', syncKioskViewport);
window.visualViewport?.addEventListener('resize', syncKioskViewport);
window.addEventListener('pointerup', clearKioskFocus, true);
window.addEventListener('touchend', clearKioskFocus, true);
window.addEventListener('click', clearKioskFocus, true);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KioskLanguageProvider>
      <App />
    </KioskLanguageProvider>
  </StrictMode>,
);
