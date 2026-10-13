import { Capacitor, registerPlugin } from '@capacitor/core';
import type { CartLine, Fulfillment } from '../types';
import { uniqueRequestId } from '../api';

/**
 * Yazıcı otomatik seçilir (vid/pid = 0): yerel eklenti önce bilinen fiş yazıcılarını
 * (Masung IP1000 0519:2013, Brightek POS80 0416:5011, 0483:5743, 0fe6:811e, 1fc9:2016),
 * yoksa USB yazıcı sınıfında bulk OUT uç noktası olan ilk cihazı kullanır.
 */
const AUTO_PRINTER = { vid: 0, pid: 0 } as const;

type ReceiptPrintStatus = 'printed' | 'skipped' | 'failed';
type ReceiptPrinterResponse = { success: boolean; vendorId?: number; productId?: number; deviceName?: string };
type ReceiptPrinterPlugin = {
  prepareReceiptPrinter(options: { vid: number; pid: number }): Promise<ReceiptPrinterResponse>;
  printTestReceipt(options: { vid: number; pid: number; kioskName: string }): Promise<ReceiptPrinterResponse>;
  printOrderReceipt(options: {
    vid: number;
    pid: number;
    orderNumber: string;
    createdAt: string;
    fulfillment: string;
    kioskName: string;
    paymentMethod: string;
    paymentReference: string;
    authCode: string;
    cardLast4: string;
    rrn: string;
    language: 'tr' | 'en';
    currency: string;
    subtotal: number;
    total: number;
    items: Array<{ name: string; quantity: number; unitPrice: number; details: string; category: string }>;
  }): Promise<ReceiptPrinterResponse>;
};

/** POS onay bilgileri (yalnız API ödeme kaydında varsa; tam kart numarası asla). */
export type ReceiptApproval = { authCode?: string; cardLast4?: string; rrn?: string };

const UsbPrinter = registerPlugin<ReceiptPrinterPlugin>('UsbPrinter');
export type { ReceiptPrintStatus };

function receiptDetails(line: CartLine, language: 'tr' | 'en') {
  if (!line.selection) return language === 'tr' ? 'Standart' : 'Standard';
  const details: string[] = [];
  for (const [stepId, optionIds] of Object.entries(line.selection.choices)) {
    const step = line.product.customization?.[stepId];
    if (!step || !optionIds.length) continue;
    const selected = optionIds.flatMap((optionId) => {
      const option = step.options.find((candidate) => candidate.id === optionId);
      if (!option) return [];
      const price = Number(option.priceDelta || 0);
      return [`${option.name}${price ? ` (+${price.toFixed(2)} TL)` : ''}`];
    });
    if (selected.length) details.push(`${step.title}: ${selected.join(', ')}`);
  }
  return details.join(' | ') || (language === 'tr' ? 'Standart' : 'Standard');
}

export async function prepareOrderPrinter() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await UsbPrinter.prepareReceiptPrinter(AUTO_PRINTER);
  } catch (error) {
    console.warn('Sipariş yazıcısı başlangıçta hazırlanamadı.', error);
  }
}

export async function printOrderReceiptOnce(args: {
  orderNumber: string;
  createdAt: string;
  fulfillment: Fulfillment;
  kioskName: string;
  paymentMethod: 'card' | 'meal-card';
  paymentReference: string;
  approval?: ReceiptApproval;
  language: 'tr' | 'en';
  total: number;
  lines: CartLine[];
  /** Satırın kategori (ana kategori) adı; fişte satırlar bu ada göre gruplanır. */
  categoryOf?: (line: CartLine) => string;
}): Promise<{ status: ReceiptPrintStatus; printAttemptId: string; deviceId?: string }> {
  const storageKey = `magiccoffee-receipt:${args.orderNumber}`;
  const existing = localStorage.getItem(storageKey);
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as { status: ReceiptPrintStatus; printAttemptId: string; deviceId?: string };
      if (parsed.printAttemptId) return { ...parsed, status: 'skipped' };
    } catch {
      localStorage.removeItem(storageKey);
    }
  }

  const printAttemptId = uniqueRequestId('receipt');
  if (!Capacitor.isNativePlatform()) return { status: 'skipped', printAttemptId };
  localStorage.setItem(storageKey, JSON.stringify({ status: 'printing', printAttemptId }));
  try {
    const categoryOf = args.categoryOf ?? (() => '');
    const grouped = args.lines
      .map((line, index) => ({ line, index, category: categoryOf(line) }))
      .sort((left, right) => {
        const leftFirst = args.lines.findIndex((line) => categoryOf(line) === left.category);
        const rightFirst = args.lines.findIndex((line) => categoryOf(line) === right.category);
        return leftFirst - rightFirst || left.index - right.index;
      });
    const response = await UsbPrinter.printOrderReceipt({
      ...AUTO_PRINTER,
      kioskName: args.kioskName,
      authCode: args.approval?.authCode ?? '',
      cardLast4: args.approval?.cardLast4 ?? '',
      rrn: args.approval?.rrn ?? '',
      orderNumber: args.orderNumber,
      createdAt: args.createdAt,
      fulfillment: args.fulfillment === 'restaurant'
        ? (args.language === 'tr' ? 'Burada' : 'Dine In')
        : (args.language === 'tr' ? 'Paket' : 'Takeaway'),
      paymentMethod: args.paymentMethod === 'card'
        ? (args.language === 'tr' ? 'Kredi Kartı' : 'Credit Card')
        : (args.language === 'tr' ? 'Yemek Kartı' : 'Meal Card'),
      paymentReference: args.paymentReference,
      language: args.language,
      currency: 'TL',
      subtotal: args.total,
      total: args.total,
      items: grouped.map(({ line, category }) => ({
        name: line.product.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        details: receiptDetails(line, args.language),
        category,
      })),
    });
    const result = {
      status: 'printed' as const,
      printAttemptId,
      deviceId: response.vendorId && response.productId ? `${response.vendorId}:${response.productId}` : undefined,
    };
    localStorage.setItem(storageKey, JSON.stringify(result));
    return result;
  } catch (error) {
    console.error('Sipariş fişi yazdırılamadı.', error);
    const result = { status: 'failed' as const, printAttemptId };
    localStorage.setItem(storageKey, JSON.stringify(result));
    return result;
  }
}

/** Yönetici menüsü: satış yapmadan yazıcı algılamayı ve baskıyı doğrular. */
export async function printTestReceipt(kioskName: string): Promise<{ ok: boolean; message: string }> {
  if (!Capacitor.isNativePlatform()) return { ok: false, message: 'Test fişi yalnızca kiosk cihazında yazdırılabilir.' };
  try {
    const response = await UsbPrinter.printTestReceipt({ ...AUTO_PRINTER, kioskName });
    const hex = (value?: number) => (value ?? 0).toString(16).padStart(4, '0');
    return { ok: true, message: `Test fişi yazdırıldı (${response.deviceName || 'USB yazıcı'} ${hex(response.vendorId)}:${hex(response.productId)}).` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Test fişi yazdırılamadı.' };
  }
}
