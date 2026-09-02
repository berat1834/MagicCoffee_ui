export type Screen = 'intro' | 'order-type' | 'catalog' | 'payment' | 'success';
export type Fulfillment = 'restaurant' | 'package';
export type ProductKind = 'coffee' | 'cold-coffee' | 'simple';

export type Category = {
  id: string;
  name: string;
  eyebrow: string;
};

export type ModifierOption = {
  id: string;
  name: string;
  priceDelta?: number;
  defaultSelected?: boolean;
  enabled?: boolean;
  available?: boolean;
  unavailableReason?: string | null;
};

export type CustomizationStep = {
  enabled: boolean;
  title: string;
  required?: boolean;
  minSelect?: number;
  maxSelect?: number;
  options: ModifierOption[];
};

export type Product = {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  kind: ProductKind;
  image?: string;
  emoji?: string;
  customizable?: boolean;
  popular?: boolean;
  available?: boolean;
  unavailableReason?: string | null;
  stockQuantity?: number | null;
  stockTrackingEnabled?: boolean;
  customization?: Record<string, CustomizationStep>;
};

export type Catalog = {
  brand: { name: string; currency: string; version: string };
  categories: Category[];
  products: Product[];
};

export type Selection = {
  choices: Record<string, string[]>;
};

export type CartLine = {
  key: string;
  product: Product;
  quantity: number;
  unitPrice: number;
  selection?: Selection;
};
