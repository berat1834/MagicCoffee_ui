import type { CartLine, Catalog, Fulfillment } from './types';

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? 'https://magiccoffee-api.onrender.com').replace(/\/$/, '');
const apiUrl = (path: string) => `${API_BASE_URL}${path}`;
const REQUEST_TIMEOUT_MS = 10000;

async function fetchWithTimeout(url: string, options?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
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
  }
}

export function assetUrl(path?: string) {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
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

export async function fetchCatalog(language: 'tr' | 'en' = 'tr'): Promise<Catalog> {
  const response = await fetchWithTimeout(apiUrl(`/api/catalog?lang=${encodeURIComponent(language)}`), undefined, 20000);
  if (!response.ok) throw new Error('Menü şu anda yüklenemiyor.');
  return response.json() as Promise<Catalog>;
}

export async function startPosPayment(args: {
  clientRequestId: string;
  paymentMethod: 'card' | 'meal-card';
  amount: number;
  lines: CartLine[];
}): Promise<PosPaymentResult> {
  const response = await fetchWithTimeout(apiUrl('/api/pos/payments'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || 'Ödeme POS cihazına gönderilemedi.');
  }
  return response.json() as Promise<PosPaymentResult>;
}

export async function pollPosPayment(transactionId: string): Promise<PosPaymentResult> {
  const response = await fetchWithTimeout(apiUrl(`/api/pos/payments/${encodeURIComponent(transactionId)}`), undefined, 25000);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || 'POS ödeme durumu alınamadı.');
  }
  return response.json() as Promise<PosPaymentResult>;
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
    headers: { 'Content-Type': 'application/json' },
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Fiş durumu kaydedilemedi.');
  return response.json() as Promise<{ status: string; alreadyRecorded: boolean }>;
}
