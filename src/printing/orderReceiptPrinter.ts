import { Capacitor, registerPlugin } from '@capacitor/core';
import type { CartLine, Fulfillment } from '../types';
import { uniqueRequestId } from '../api';

const MASUNG_IP1000 = { vid: 0x0519, pid: 0x2013 } as const;

type ReceiptPrintStatus = 'printed' | 'skipped' | 'failed';
type ReceiptPrinterResponse = { success: boolean; vendorId?: number; productId?: number };
type ReceiptPrinterPlugin = {
  prepareReceiptPrinter(options: { vid: number; pid: number }): Promise<ReceiptPrinterResponse>;
  printOrderReceipt(options: {
    vid: number;
    pid: number;
    orderNumber: string;
    createdAt: string;
    fulfillment: string;
    paymentMethod: string;
    paymentReference: string;
    language: 'tr' | 'en';
    currency: string;
    subtotal: number;
    total: number;
    /** Otomatta hazırlanamayıp iade edilen toplam tutar (0 ise fişte gösterilmez). */
    refundTotal: number;
    /** mark: satırın altında kalın basılan durum etiketi (ör. İADE EDİLDİ). */
    items: Array<{ name: string; quantity: number; unitPrice: number; details: string; mark: string }>;
  }): Promise<ReceiptPrinterResponse>;
};

/** Otomatta hazırlanamayan adetler: fişte ayrı satır olarak işaretlenir. */
export type ReceiptLineMark = { lineKey: string; quantity: number; status: 'refunded' | 'refunding' | 'refund-failed' };

const MARK_LABELS: Record<ReceiptLineMark['status'], { tr: string; en: string }> = {
  refunded: { tr: 'İADE EDİLDİ', en: 'REFUNDED' },
  refunding: { tr: 'HAZIRLANAMADI · İADE EDİLİYOR', en: 'NOT DISPENSED · REFUND PENDING' },
  'refund-failed': { tr: 'HAZIRLANAMADI · İADE EDİLEMEDİ, GÖREVLİYE BAŞVURUN', en: 'NOT DISPENSED · REFUND FAILED, ASK STAFF' },
};

/** Sepet satırlarını fiş kalemlerine çevirir; işaretli adetler aynı satırdan ayrılıp etiketlenir. */
function receiptEntries(lines: CartLine[], marks: ReceiptLineMark[] | undefined, language: 'tr' | 'en') {
  return lines.flatMap((line) => {
    const own = (marks ?? []).filter((mark) => mark.lineKey === line.key && mark.quantity > 0);
    let remaining = line.quantity;
    const marked = own.flatMap((mark) => {
      const quantity = Math.min(remaining, mark.quantity);
      remaining -= quantity;
      return quantity > 0 ? [{ line, quantity, mark: MARK_LABELS[mark.status][language], refunded: mark.status === 'refunded' }] : [];
    });
    return [...(remaining > 0 ? [{ line, quantity: remaining, mark: '', refunded: false }] : []), ...marked];
  });
}

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
    await UsbPrinter.prepareReceiptPrinter(MASUNG_IP1000);
  } catch (error) {
    console.warn('Sipariş yazıcısı başlangıçta hazırlanamadı.', error);
  }
}

export async function printOrderReceiptOnce(args: {
  orderNumber: string;
  createdAt: string;
  fulfillment: Fulfillment;
  paymentMethod: 'card' | 'meal-card';
  paymentReference: string;
  language: 'tr' | 'en';
  total: number;
  lines: CartLine[];
  /** Otomatta hazırlanamayan (iade edilen / edilemeyen) adetler. */
  marks?: ReceiptLineMark[];
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
    const entries = receiptEntries(args.lines, args.marks, args.language);
    const refundTotal = entries.reduce((sum, entry) => sum + (entry.refunded ? entry.line.unitPrice * entry.quantity : 0), 0);
    const response = await UsbPrinter.printOrderReceipt({
      ...MASUNG_IP1000,
      orderNumber: args.orderNumber,
      createdAt: args.createdAt,
      fulfillment: args.fulfillment === 'restaurant'
        ? (args.language === 'tr' ? 'Burada' : 'Dine In')
        : (args.language === 'tr' ? 'Paket' : 'Takeaway'),
      paymentMethod: args.paymentMethod === 'card'
        ? (args.language === 'tr' ? 'Kredi / Banka Kartı' : 'Credit / Debit Card')
        : (args.language === 'tr' ? 'Yemek Kartı' : 'Meal Card'),
      paymentReference: args.paymentReference,
      language: args.language,
      currency: 'TL',
      subtotal: args.total,
      total: args.total,
      refundTotal,
      items: entries.map(({ line, quantity, mark }) => ({
        name: line.product.name,
        quantity,
        unitPrice: line.unitPrice,
        details: receiptDetails(line, args.language),
        mark,
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
