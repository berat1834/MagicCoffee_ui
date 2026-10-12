const TERMINAL_SERIAL_KEY = 'magiccoffee.posTerminalSerial';

/** Bu kioskun ödeme göndereceği Castles cihazının seri numarası (panelde tanımlı listeden seçilir). */
export function getKioskTerminalSerial(): string | null {
  try {
    const value = window.localStorage.getItem(TERMINAL_SERIAL_KEY);
    const serial = value?.trim() ?? '';
    return serial || null;
  } catch {
    return null;
  }
}

export function setKioskTerminalSerial(serial: string | null): void {
  try {
    const value = serial?.trim() ?? '';
    if (value) window.localStorage.setItem(TERMINAL_SERIAL_KEY, value);
    else window.localStorage.removeItem(TERMINAL_SERIAL_KEY);
  } catch {
    /* Depolama kullanılamıyorsa seçim yalnızca bu oturumda geçerli olur. */
  }
}
