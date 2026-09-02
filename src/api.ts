import type { CartLine, Catalog, Fulfillment } from './types';

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? 'https://magiccoffee-api.onrender.com').replace(/\/$/, '');
const apiUrl = (path: string) => `${API_BASE_URL}${path}`;

export function assetUrl(path?: string) {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith('/uploads/')) return apiUrl(path);
  return path;
}

export async function fetchCatalog(): Promise<Catalog> {
  const response = await fetch(apiUrl('/api/catalog'));
  if (!response.ok) throw new Error('Menü şu anda yüklenemiyor.');
  return response.json() as Promise<Catalog>;
}

export async function submitOrder(args: {
  fulfillment: Fulfillment;
  paymentMethod: 'card' | 'meal-card';
  total: number;
  lines: CartLine[];
}): Promise<{ number: string }> {
  const response = await fetch(apiUrl('/api/orders'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fulfillment: args.fulfillment,
      paymentMethod: args.paymentMethod,
      total: args.total,
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
  return response.json() as Promise<{ number: string }>;
}
