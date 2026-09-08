import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { KioskLanguageProvider } from './i18n/KioskLanguage';
import './styles.css';

function syncKioskViewport() {
  const root = document.documentElement;
  const logicalWidth = 430;
  const viewportWidth = Math.floor(Math.min(
    window.innerWidth,
    window.visualViewport?.width ?? window.innerWidth,
    root.clientWidth || window.innerWidth,
  ));
  const viewportHeight = Math.floor(Math.min(
    window.innerHeight,
    window.visualViewport?.height ?? window.innerHeight,
    root.clientHeight || window.innerHeight,
  ));
  const isPortraitLayout = viewportHeight >= viewportWidth;
  const isAndroidDevice = /Android/i.test(navigator.userAgent) || window.location.protocol === 'capacitor:';
  const usesLargeKioskLayout = isAndroidDevice
    && isPortraitLayout
    && viewportWidth >= 900
    && viewportHeight / viewportWidth >= 1.45;

  root.classList.toggle('android-kiosk', usesLargeKioskLayout);
  root.style.setProperty('--viewport-height', `${viewportHeight}px`);

  if (!isPortraitLayout) {
    root.classList.remove('portrait-kiosk');
    root.classList.remove('short-viewport');
    root.style.removeProperty('--kiosk-scale');
    root.style.removeProperty('--kiosk-width');
    root.style.removeProperty('--kiosk-height');
    root.style.removeProperty('--logical-kiosk-scale');
    root.style.removeProperty('--logical-kiosk-height');
    return;
  }

  const scale = usesLargeKioskLayout ? 1 : viewportWidth / logicalWidth;
  const logicalScale = viewportWidth / logicalWidth;
  const logicalHeight = viewportHeight / (usesLargeKioskLayout ? logicalScale : scale);
  root.classList.add('portrait-kiosk');
  root.classList.toggle('short-viewport', logicalHeight < 650);
  root.style.setProperty('--kiosk-scale', String(scale));
  root.style.setProperty('--kiosk-width', `${usesLargeKioskLayout ? viewportWidth : logicalWidth}px`);
  root.style.setProperty('--kiosk-height', `${viewportHeight / scale}px`);
  root.style.setProperty('--logical-kiosk-scale', String(logicalScale));
  root.style.setProperty('--logical-kiosk-height', `${logicalHeight}px`);
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
