import type { CartLine, Catalog, Fulfillment, KioskConfig, KioskProfileStatus } from './types';
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
  // POS onay bilgileri (API ödeme kaydında varsa). Tam kart numarası gelmez/yazdırılmaz.
  authCode?: string | null;
  approvalCode?: string | null;
  cardLast4?: string | null;
  maskedPan?: string | null;
  rrn?: string | null;
};

/** Ödeme sonucundan fişe basılabilecek onay bilgilerini çıkarır (yalnız son 4 hane). */
export function paymentApproval(result: PosPaymentResult | null | undefined) {
  if (!result) return undefined;
  const digits = String(result.cardLast4 ?? result.maskedPan ?? '').replace(/[^0-9]/g, '');
  const approval = {
    authCode: String(result.authCode ?? result.approvalCode ?? '').trim() || undefined,
    cardLast4: digits ? digits.slice(-4) : undefined,
    rrn: String(result.rrn ?? '').trim() || undefined,
  };
  return approval.authCode || approval.cardLast4 || approval.rrn ? approval : undefined;
}

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

/** Kurulum ekranı için 17 kioskun özeti (POS atanmış mı, seri numarasının son 4 hanesi). */
export async function fetchKioskProfiles(): Promise<KioskProfileStatus[]> {
  const response = await fetchWithTimeout(apiUrl('/api/kiosk/profiles'), undefined, 15000);
  if (!response.ok) throw new Error(await errorDetail(response, 'Kiosk listesi alınamadı.'));
  return response.json() as Promise<KioskProfileStatus[]>;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const POS_SAVE_FALLBACKS: Record<number, string> = {
  400: 'POS seri numarası 12 haneli olmalıdır.',
  403: 'PIN hatalı.',
  404: 'Kiosk bulunamadı.',
  409: 'Bu POS cihazı başka bir kioska atanmış.',
  429: 'Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.',
};

/** Seçilen kioskun Castles POS seri numarasını yönetici PIN'iyle kaydeder. */
export async function saveKioskPos(kioskId: string, adminPin: string, posSerial: string): Promise<void> {
  const response = await fetchWithTimeout(apiUrl('/api/kiosk/pos'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Kiosk-Id': kioskId, 'X-Kiosk-Admin-Pin': adminPin },
    body: JSON.stringify({ posSerial }),
  }, 20000);
  if (!response.ok) {
    const fallback = POS_SAVE_FALLBACKS[response.status] ?? 'POS cihazı kaydedilemedi. Lütfen tekrar deneyin.';
    throw new ApiError(await errorDetail(response, fallback), response.status);
  }
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
