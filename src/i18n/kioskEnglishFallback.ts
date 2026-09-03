import enTranslations from './locales/en.json';
import trTranslations from './locales/tr.json';

const UI_TRANSLATIONS = Object.fromEntries(
  Object.keys(trTranslations).map((key) => [
    trTranslations[key as keyof typeof trTranslations],
    enTranslations[key as keyof typeof enTranslations],
  ]),
) as Record<string, string>;

Object.assign(UI_TRANSLATIONS, {
  'MAGIC COFFEE': 'MAGIC COFFEE',
  'Menü': 'Menu',
  'Kategorini seç': 'Choose a category',
  'Fiyata dahil': 'Included',
  'Stokta yok': 'Out of stock',
  'Sipariş Alınıyor': 'Processing Payment',
  'Lütfen bekleyin.': 'Please wait.',
  'Hazırlanıyor...': 'Preparing...',
});

function translateDynamic(value: string): string | null {
  let match = value.match(/^(\d+) ürün$/i);
  if (match) return `${match[1]} ${match[1] === '1' ? 'product' : 'products'}`;
  match = value.match(/^(\d+) adet$/i);
  if (match) return `${match[1]} ${match[1] === '1' ? 'item' : 'items'}`;
  match = value.match(/^(\d+) satır ürün$/i);
  if (match) return `${match[1]} product lines`;
  match = value.match(/^(.+) stokta kalmadı\.$/i);
  if (match) return `${match[1]} is out of stock.`;
  match = value.match(/^(.+) seçimi zorunlu\.$/i);
  if (match) return `Please choose ${match[1]}.`;
  match = value.match(/^\+(\d+(?:\.\d{2})?) TL$/);
  if (match) return `+${match[1]} TRY`;
  return null;
}

export function translateKioskTextToEnglish(value: string): string {
  const leading = value.match(/^\s*/)?.[0] ?? '';
  const trailing = value.match(/\s*$/)?.[0] ?? '';
  const trimmed = value.trim();
  if (!trimmed) return value;
  const translated = UI_TRANSLATIONS[trimmed] ?? translateDynamic(trimmed);
  return translated ? `${leading}${translated}${trailing}` : value;
}
