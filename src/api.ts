import type { CartLine, Catalog, Fulfillment } from './types';

export async function fetchCatalog(): Promise<Catalog> {
  const response = await fetch('/api/catalog');
  if (!response.ok) throw new Error('Menü şu anda yüklenemiyor.');
  return response.json() as Promise<Catalog>;
}

export async function submitOrder(args: {
  fulfillment: Fulfillment;
  paymentMethod: 'card' | 'meal-card';
  total: number;
  lines: CartLine[];
}): Promise<{ number: string }> {
  const response = await fetch('/api/orders', {
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
  if (!response.ok) throw new Error('Sipariş kaydedilemedi. Lütfen tekrar deneyin.');
  return response.json() as Promise<{ number: string }>;
}

