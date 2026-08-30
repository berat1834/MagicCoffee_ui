export type Screen = 'intro' | 'order-type' | 'catalog' | 'payment' | 'success';
export type Fulfillment = 'restaurant' | 'package';
export type ProductKind = 'burger' | 'menu' | 'bundle' | 'simple';

export type Category = {
  id: string;
  name: string;
  eyebrow: string;
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
  protein?: string;
  patties?: number;
  serves?: number;
  customizable?: boolean;
  popular?: boolean;
};

export type ModifierOption = {
  id: string;
  name: string;
  priceDelta?: number;
};

export type Catalog = {
  brand: { name: string; currency: string; version: string };
  categories: Category[];
  products: Product[];
  modifiers: {
    ingredients: ModifierOption[];
    fries: ModifierOption[];
    drinks: ModifierOption[];
  };
};

export type Selection = {
  ingredients: string[];
  fries?: string;
  drink?: string;
};

export type CartLine = {
  key: string;
  product: Product;
  quantity: number;
  unitPrice: number;
  selection?: Selection;
};

