import type { CartLine, Catalog, Fulfillment } from './types';
import { machineVariantsOf, variantKeyOf } from './machineVariants';

/** Sipariş/ödeme satırı: otomat kioskunda seçimin kanonik varyant anahtarı da gönderilir (API aynı anahtarı çözer). */
function orderLinePayload(line: CartLine) {
  return {
    productId: line.product.id,
    name: line.product.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    selection: line.selection,
    ...(machineVariantsOf(line.product) ? { machineOptionKey: variantKeyOf(line.selection?.choices) } : {}),
  };
}

/** HTTP durum kodunu taşıyan API hatası. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

const FORBIDDEN_PROJECT_MARKER = ['full', 'moon'].join('');
const API_BASE_URL = (import.meta.env.VITE_API_URL ?? 'https://magiccoffee-api.magicpay.ai').replace(/\/$/, '');
if (API_BASE_URL.toLowerCase().includes(FORBIDDEN_PROJECT_MARKER)) {
  throw new Error('Kiosk API adresi bu proje icin kullanilamaz.');
}
const apiUrl = (path: string) => `${API_BASE_URL}${path}`;
const REQUEST_TIMEOUT_MS = 10000;
const KIOSK_IDENTITY_HEADERS = { 'X-MagicCoffee-Kiosk-Fingerprint': 'TEST' };

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

export async function fetchCatalog(language: 'tr' | 'en' = 'tr'): Promise<Catalog> {
  const response = await fetchWithTimeout(apiUrl(`/api/catalog?lang=${encodeURIComponent(language)}`), undefined, 20000);
  if (!response.ok) throw new Error('Menü şu anda yüklenemiyor.');
  return response.json() as Promise<Catalog>;
}

export type CastlesDeviceOption = { serial: string; name: string };

export async function fetchCastlesDevices(): Promise<CastlesDeviceOption[]> {
  const response = await fetchWithTimeout(apiUrl('/api/pos/castles/devices'), { headers: KIOSK_IDENTITY_HEADERS }, 15000);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || 'Castles cihaz listesi alınamadı.');
  }
  return response.json() as Promise<CastlesDeviceOption[]>;
}

export async function startPosPayment(args: {
  clientRequestId: string;
  paymentMethod: 'card' | 'meal-card';
  amount: number;
  lines: CartLine[];
  signal?: AbortSignal;
  terminalSerial?: string;
}): Promise<PosPaymentResult> {
  const response = await fetchWithTimeout(apiUrl('/api/pos/payments'), {
    method: 'POST',
    signal: args.signal,
    headers: { 'Content-Type': 'application/json', ...KIOSK_IDENTITY_HEADERS },
    body: JSON.stringify({
      clientRequestId: args.clientRequestId,
      paymentMethod: args.paymentMethod,
      amount: args.amount,
      terminalSerial: args.terminalSerial ?? null,
      lines: args.lines.map(orderLinePayload),
    }),
  }, 35000);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || 'Ödeme POS cihazına gönderilemedi.');
  }
  return response.json() as Promise<PosPaymentResult>;
}

export async function pollPosPayment(transactionId: string, signal?: AbortSignal): Promise<PosPaymentResult> {
  const response = await fetchWithTimeout(apiUrl(`/api/pos/payments/${encodeURIComponent(transactionId)}`), {
    signal,
    headers: KIOSK_IDENTITY_HEADERS,
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
      headers: KIOSK_IDENTITY_HEADERS,
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
}): Promise<{ number: string; created_at?: string; vendStatus?: string | null }> {
  const response = await fetchWithTimeout(apiUrl('/api/orders'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...KIOSK_IDENTITY_HEADERS },
    body: JSON.stringify({
      clientRequestId: args.clientRequestId,
      fulfillment: args.fulfillment,
      paymentMethod: args.paymentMethod,
      total: args.total,
      paymentReference: args.paymentReference,
      posTransactionId: args.posTransactionId,
      language: args.language,
      lines: args.lines.map(orderLinePayload),
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || 'Sipariş kaydedilemedi. Lütfen tekrar deneyin.');
  }
  return response.json() as Promise<{ number: string; created_at?: string; vendStatus?: string | null }>;
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

export type VendJobStatus = 'QUEUED' | 'SENT' | 'WAITING_SELECTION' | 'DISPENSING' | 'SUCCESS' | 'FAILED' | 'EXPIRED' | 'REFUNDED' | 'REFUND_FAILED';

/** Otomat satış işi (ürün adedi başına bir iş). */
export type VendJob = {
  id: string;
  productId: string | null;
  productName: string;
  selectionNo: number | null;
  status: VendJobStatus;
  message: string | null;
  /** İşin (iade edilecek) tutarı; API göndermezse sepet satırından bulunur. */
  amount: number | null;
  /** Seçilen varyantın adı (ör. "Büyük · Yulaf sütü"); API göndermezse sepet satırından türetilir. */
  variantLabel: string | null;
  /** Kredi modunda müşteri makinede yanlış ürün düğmesine bastı. */
  wrongSelection: boolean;
  /** İade bilgisi; needsCard: iade için müşterinin kartını POS cihazına okutması gerekiyor. */
  refund: { state: string | null; amount: number | null; needsCard: boolean; message: string | null } | null;
};

/** GET /api/orders/{number}/vend yanıtı. */
export type VendTracking = {
  jobs: VendJob[];
  mode: 'AUTO' | 'REMOTE' | 'CREDIT' | null;
  machineOnline: boolean;
  /** Sipariş genel durumu: ALL_DONE | PARTIAL_REFUNDED | REFUNDED | NEEDS_ATTENTION (henüz bitmediyse null). */
  vendStatus: string | null;
};

const VEND_STATUSES: VendJobStatus[] = ['QUEUED', 'SENT', 'WAITING_SELECTION', 'DISPENSING', 'SUCCESS', 'FAILED', 'EXPIRED', 'REFUNDED', 'REFUND_FAILED'];

function parseVendJob(raw: unknown, index: number): VendJob {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = (item: unknown) => (typeof item === 'string' || typeof item === 'number') && String(item).trim() ? String(item).trim() : null;
  const number = (item: unknown) => { const parsed = Number(item); return item !== null && item !== undefined && item !== '' && Number.isFinite(parsed) ? parsed : null; };
  const status = String(value.status ?? '').trim().toUpperCase() as VendJobStatus;
  const selectionNo = number(value.selectionNo ?? value.selection_no);
  const pressedSelectionNo = number(value.pressedSelectionNo ?? value.pressed_selection_no);
  return {
    id: text(value.id) ?? `job-${index}`,
    productId: text(value.productId ?? value.product_id),
    productName: text(value.productName ?? value.product_name) ?? '',
    selectionNo,
    status: VEND_STATUSES.includes(status) ? status : 'QUEUED',
    message: text(value.message),
    amount: number(value.amount),
    variantLabel: text(value.variantLabel ?? value.variant_label ?? value.optionLabel ?? value.option_label),
    wrongSelection: value.wrongSelection === true || value.wrong_selection === true
      || (pressedSelectionNo !== null && pressedSelectionNo !== selectionNo)
      || /WRONG/i.test(String(value.detail ?? value.reason ?? '')),
    refund: value.refund && typeof value.refund === 'object' ? (() => {
      const refund = value.refund as Record<string, unknown>;
      return { state: text(refund.state), amount: number(refund.amount), needsCard: refund.needsCard === true || refund.needs_card === true, message: text(refund.message) };
    })() : null,
  };
}

/** Siparişin kahve otomatı satış işlerinin durumunu döndürür; HTTP hatasında ApiError fırlatır. */
export async function fetchOrderVend(orderNumber: string, signal?: AbortSignal): Promise<VendTracking> {
  const response = await fetchWithTimeout(apiUrl(`/api/orders/${encodeURIComponent(orderNumber)}/vend`), { signal, headers: KIOSK_IDENTITY_HEADERS }, 10000);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.detail || 'Otomat durumu alınamadı.', response.status);
  }
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  const mode = String(body.mode ?? '').trim().toUpperCase();
  const vendStatus = String(body.vendStatus ?? body.vend_status ?? '').trim().toUpperCase();
  return {
    jobs: Array.isArray(body.jobs) ? body.jobs.map(parseVendJob) : [],
    mode: mode === 'REMOTE' || mode === 'CREDIT' || mode === 'AUTO' ? mode : null,
    machineOnline: body.machineOnline !== false && body.machine_online !== false,
    vendStatus: vendStatus || null,
  };
}
