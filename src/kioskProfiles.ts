import {
  BookOpen, Beef, CakeSlice, Cookie, Coffee, Croissant, CupSoda, Flower2, Footprints, Gift, Headphones,
  IceCreamCone, Pizza, Salad, Sandwich, Shirt, Sparkles, Store, type LucideIcon,
} from 'lucide-react';

/** Spesifikasyondaki lucide ikon adları -> lucide-react bileşenleri (0.542.0'da hepsi mevcut). */
export const SECTION_ICONS: Record<string, LucideIcon> = {
  Coffee, Beef, Pizza, Sandwich, Salad, CakeSlice, IceCreamCone, Croissant, CupSoda, Cookie,
  Shirt, Footprints, Headphones, Sparkles, BookOpen, Gift, Flower2,
};

export function sectionIcon(name?: string | null): LucideIcon {
  return (name && SECTION_ICONS[name]) || Store;
}

export type SectionProfile = {
  id: string;
  name: string;
  nameEn: string;
  tagline: string;
  taglineEn: string;
  icon: string;
  accent: string;
};

/** 17 ana kategori (spesifikasyon tablosu). API asıl kaynaktır; bu liste kurulum ekranı ve yedek görünüm içindir. */
export const SECTION_PROFILES: SectionProfile[] = [
  { id: 'kahve', name: 'Kahve', nameEn: 'Coffee', tagline: 'Taze çekilmiş kahveler', taglineEn: 'Freshly ground coffee', icon: 'Coffee', accent: '#7a4a2a' },
  { id: 'burger', name: 'Burger', nameEn: 'Burgers', tagline: 'Izgara burger menüleri', taglineEn: 'Grilled burger menus', icon: 'Beef', accent: '#c2410c' },
  { id: 'pizza', name: 'Pizza', nameEn: 'Pizza', tagline: 'Taş fırın pizzalar', taglineEn: 'Stone-oven pizzas', icon: 'Pizza', accent: '#dc2626' },
  { id: 'doner', name: 'Döner & Dürüm', nameEn: 'Doner & Wraps', tagline: 'Döner, dürüm, porsiyon', taglineEn: 'Doner, wraps, plates', icon: 'Sandwich', accent: '#b45309' },
  { id: 'salata', name: 'Salata & Bowl', nameEn: 'Salads & Bowls', tagline: 'Hafif ve doyurucu', taglineEn: 'Light and filling', icon: 'Salad', accent: '#16a34a' },
  { id: 'tatli', name: 'Tatlı & Pasta', nameEn: 'Desserts', tagline: 'Pasta, cheesecake, tatlılar', taglineEn: 'Cakes, cheesecakes, sweets', icon: 'CakeSlice', accent: '#db2777' },
  { id: 'dondurma', name: 'Dondurma', nameEn: 'Ice Cream', tagline: 'Top dondurma, milkshake', taglineEn: 'Scoops and milkshakes', icon: 'IceCreamCone', accent: '#0ea5e9' },
  { id: 'firin', name: 'Fırın', nameEn: 'Bakery', tagline: 'Simit, poğaça, kruvasan', taglineEn: 'Simit, pastries, croissants', icon: 'Croissant', accent: '#a16207' },
  { id: 'icecek', name: 'Soğuk İçecek & Smoothie', nameEn: 'Drinks & Smoothies', tagline: 'Meyve suyu, smoothie, limonata', taglineEn: 'Juices, smoothies, lemonade', icon: 'CupSoda', accent: '#f59e0b' },
  { id: 'atistirmalik', name: 'Atıştırmalık & Market', nameEn: 'Snacks & Market', tagline: 'Cips, çikolata, su', taglineEn: 'Chips, chocolate, water', icon: 'Cookie', accent: '#ea580c' },
  { id: 'giyim', name: 'Giyim', nameEn: 'Clothing', tagline: 'Tişört, sweatshirt, şapka', taglineEn: 'T-shirts, sweatshirts, caps', icon: 'Shirt', accent: '#4f46e5' },
  { id: 'ayakkabi', name: 'Ayakkabı & Çanta', nameEn: 'Shoes & Bags', tagline: 'Sneaker, terlik, sırt çantası', taglineEn: 'Sneakers, slippers, backpacks', icon: 'Footprints', accent: '#334155' },
  { id: 'elektronik', name: 'Elektronik Aksesuar', nameEn: 'Electronics', tagline: 'Şarj aleti, kulaklık, kablo', taglineEn: 'Chargers, headphones, cables', icon: 'Headphones', accent: '#0f766e' },
  { id: 'kozmetik', name: 'Kozmetik & Bakım', nameEn: 'Beauty & Care', tagline: 'Parfüm, krem, bakım', taglineEn: 'Perfume, creams, care', icon: 'Sparkles', accent: '#c026d3' },
  { id: 'kirtasiye', name: 'Kitap & Kırtasiye', nameEn: 'Books & Stationery', tagline: 'Kitap, defter, kalem', taglineEn: 'Books, notebooks, pens', icon: 'BookOpen', accent: '#2563eb' },
  { id: 'oyuncak', name: 'Oyuncak & Hediyelik', nameEn: 'Toys & Gifts', tagline: 'Oyuncak, hediyelik eşya', taglineEn: 'Toys and gifts', icon: 'Gift', accent: '#9333ea' },
  { id: 'cicek', name: 'Çiçek', nameEn: 'Flowers', tagline: 'Buket, saksı çiçeği', taglineEn: 'Bouquets and potted plants', icon: 'Flower2', accent: '#e11d48' },
];

export type KioskProfile = { id: string; label: string; section: SectionProfile };

/** k01..k17: kNN'nin vitrin kategorisi tablodaki NN. kategoridir. */
export const KIOSK_PROFILES: KioskProfile[] = SECTION_PROFILES.map((section, index) => {
  const number = String(index + 1).padStart(2, '0');
  return { id: `k${number}`, label: `Kiosk ${number}`, section };
});

export function kioskProfile(kioskId: string | null | undefined) {
  return KIOSK_PROFILES.find((profile) => profile.id === kioskId) ?? null;
}

export function sectionProfile(sectionId: string | null | undefined) {
  return SECTION_PROFILES.find((section) => section.id === sectionId) ?? null;
}

const KIOSK_ID_KEY = 'magicpay.kioskId';
const ENV_KIOSK_ID = (import.meta.env.VITE_KIOSK_ID ?? '').trim();
export const KIOSK_ADMIN_PIN = String(import.meta.env.VITE_KIOSK_ADMIN_PIN ?? '1907').trim() || '1907';

/** Cihazda seçilmiş kiosk varyantı; yoksa (yalnız geliştirme için) VITE_KIOSK_ID; o da yoksa null -> kurulum ekranı. */
export function getActiveKioskId(): string | null {
  try {
    const stored = window.localStorage.getItem(KIOSK_ID_KEY)?.trim();
    if (stored && kioskProfile(stored)) return stored;
  } catch {
    /* Depolama kullanılamıyorsa ortam varsayılanına düşülür. */
  }
  return ENV_KIOSK_ID && kioskProfile(ENV_KIOSK_ID) ? ENV_KIOSK_ID : null;
}

export function setActiveKioskId(kioskId: string): boolean {
  try {
    window.localStorage.setItem(KIOSK_ID_KEY, kioskId);
    return true;
  } catch {
    return false;
  }
}
