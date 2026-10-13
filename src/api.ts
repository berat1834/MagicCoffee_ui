import type { CartLine, Catalog, Fulfillment, KioskConfig } from './types';
import { getActiveKioskId } from './kioskProfiles';

const FORBIDDEN_PROJECT_MARKER = ['full', 'moon'].join('');
const API_BASE_URL = (import.meta.env.VITE_API_URL ?? 'https://magickiosk-api.magicpay.ai').replace(/\/$/, '');
if (API_BASE_URL.toLowerCase().includes(FORBIDDEN_PROJECT_MARKER)) {
  throw new Error('Kiosk API adresi bu proje icin kullanilamaz.');
}
const apiUrl = (path: string) => `${API_BASE_URL}${path}`;
const REQUEST_TIMEOUT_MS = 10000;
/** Her kiosk isteğinde cihazda seçili kiosk kimliği gönderilir (API kiosk profilini buna göre bulur). */
function kioskHeaders(extra?: Record<string, string>): Record<string, string> {
  const kioskId = getActiveKioskId();
  return { ...(kioskId ? { 'X-Kiosk-Id': kioskId } : {}), ...extra };
}

async function errorDetail(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({}));
  return typeof body?.detail === 'string' && body.detail ? body.detail : fallback;
}

async function fetchWithTimeout(url: string, options?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  options?.signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (options?.signal?.aborted) controller.abort();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Internet baglantisini kontrol edip tekrar deneyin.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    options?.signal?.removeEventListener('abort', abortFromCaller);
  }
}

export function assetUrl(path?: string) {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path.toLowerCase().includes(FORBIDDEN_PROJECT_MARKER) ? '' : path;
  if (path.startsWith('/uploads/')) return apiUrl(path);
  return path;
}

export type PosPaymentStatus = 'STARTING' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'PAID' | 'SUCCESS' | 'SUCCEEDED' | 'FAILED' | 'ERROR' | 'CANCELLED' | 'CANCELED' | 'DECLINED';

export type PosPaymentResult = {
  id?: string;
  status: PosPaymentStatus;
  message?: string | null;
  externalId?: string;
  paymentReference?: string;
};

export function uniqueRequestId(prefix: string) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

export async function fetchKioskConfig(language: 'tr' | 'en' = 'tr'): Promise<KioskConfig> {
  const response = await fetchWithTimeout(apiUrl(`/api/kiosk/config?lang=${encodeURIComponent(language)}`), { headers: kioskHeaders() }, 20000);
  if (!response.ok) throw new Error(await errorDetail(response, 'Kiosk ayarları şu anda yüklenemiyor.'));
  return response.json() as Promise<KioskConfig>;
}

export async function fetchCatalog(language: 'tr' | 'en' = 'tr', sectionId?: string): Promise<Catalog> {
  const params = new URLSearchParams({ lang: language });
  if (sectionId) params.set('section', sectionId);
  const response = await fetchWithTimeout(apiUrl(`/api/catalog?${params.toString()}`), { headers: kioskHeaders() }, 20000);
  if (!response.ok) throw new Error(await errorDetail(response, 'Menü şu anda yüklenemiyor.'));
  return response.json() as Promise<Catalog>;
}

export async function startPosPayment(args: {
  clientRequestId: string;
  paymentMethod: 'card' | 'meal-card';
  amount: number;
  lines: CartLine[];
  signal?: AbortSignal;
}): Promise<PosPaymentResult> {
  const response = await fetchWithTimeout(apiUrl('/api/pos/payments'), {
    method: 'POST',
    signal: args.signal,
    headers: kioskHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      clientRequestId: args.clientRequestId,
      paymentMethod: args.paymentMethod,
      amount: args.amount,
      lines: args.lines.map((line) => ({
        productId: line.product.id,
        name: line.product.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        selection: line.selection,
      })),
    }),
  }, 35000);
  if (!response.ok) throw new Error(await errorDetail(response, 'Ödeme POS cihazına gönderilemedi.'));
  return response.json() as Promise<PosPaymentResult>;
}

export async function pollPosPayment(transactionId: string, signal?: AbortSignal): Promise<PosPaymentResult> {
  const response = await fetchWithTimeout(apiUrl(`/api/pos/payments/${encodeURIComponent(transactionId)}`), {
    signal,
    headers: kioskHeaders(),
  }, 25000);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || 'POS ödeme durumu alınamadı.');
  }
  return response.json() as Promise<PosPaymentResult>;
}

// Kiosk beklemekten vazgeçince (geri tuşu / süre dolması) cihazdaki bekleyen işlem kapatılır.
export async function cancelPosPayment(transactionId: string): Promise<void> {
  try {
    await fetchWithTimeout(apiUrl(`/api/pos/payments/${encodeURIComponent(transactionId)}/cancel`), {
      method: 'POST',
      headers: kioskHeaders(),
    }, 15000);
  } catch {
    // Iptal bildirimi ulasmazsa backend kendi zaman asimiyla islemi kapatir.
  }
}

export async function submitOrder(args: {
  clientRequestId: string;
  fulfillment: Fulfillment;
  paymentMethod: 'card' | 'meal-card';
  total: number;
  lines: CartLine[];
  paymentReference: string;
  posTransactionId: string;
  language: 'tr' | 'en';
}): Promise<{ number: string; created_at?: string }> {
  const response = await fetchWithTimeout(apiUrl('/api/orders'), {
    method: 'POST',
    headers: kioskHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      clientRequestId: args.clientRequestId,
      fulfillment: args.fulfillment,
      paymentMethod: args.paymentMethod,
      total: args.total,
      paymentReference: args.paymentReference,
      posTransactionId: args.posTransactionId,
      language: args.language,
      lines: args.lines.map((line) => ({
        productId: line.product.id,
        name: line.product.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        selection: line.selection,
      })),
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || 'Sipariş kaydedilemedi. Lütfen tekrar deneyin.');
  }
  return response.json() as Promise<{ number: string; created_at?: string }>;
}

export async function recordReceiptStatus(orderNumber: string, payload: {
  status: 'printed' | 'failed' | 'skipped';
  printAttemptId: string;
  deviceId?: string;
}) {
  const response = await fetchWithTimeout(apiUrl(`/api/orders/${encodeURIComponent(orderNumber)}/receipt`), {
    method: 'POST',
    headers: kioskHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Fiş durumu kaydedilemedi.');
  return response.json() as Promise<{ status: string; alreadyRecorded: boolean }>;
}
