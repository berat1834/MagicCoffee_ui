import type { CustomizationStep, ModifierOption } from '../types';
import type { KioskLanguage } from './KioskLanguage';

const TURKISH_STEP_LABELS: Record<string, string> = {
  content: 'Ürün Notları',
  cream: 'Krema',
  ice: 'Buz Miktarı',
  milk: 'Süt Seçimi',
  pairing: 'Yanına Tatlı',
  shot: 'İlave Espresso',
  sides: 'Boyut Seçimi',
  size: 'Boyut Seçimi',
  sugar: 'Şeker',
  syrup: 'Şurup Seçimi',
  temperature: 'Sıcaklık',
};

const TURKISH_OPTION_LABELS: Record<string, Record<string, string>> = {
  content: {
    'no-foam': 'Köpüksüz',
    'extra-foam': 'Ekstra köpük',
    'less-sweet': 'Az tatlı',
    decaf: 'Kafeinsiz seçenek',
  },
  cream: { cream: 'Krema ekle' },
  ice: {
    'no-ice': 'Buzsuz',
    'light-ice': 'Az buzlu',
    normal: 'Normal',
    'extra-ice': 'Ekstra buzlu',
  },
  milk: {
    'whole-milk': 'Tam yağlı süt',
    'semi-skimmed': 'Yarım yağlı süt',
    'lactose-free': 'Laktozsuz süt',
    almond: 'Badem sütü',
    oat: 'Yulaf sütü',
    coconut: 'Hindistan cevizi sütü',
  },
  pairing: {
    'brownie-bite': 'Mini çikolatalı kek',
    cookie: 'Çikolatalı kurabiye',
    croissant: 'Tereyağlı kruvasan',
  },
  shot: {
    'single-shot': '1 ilave espresso',
    'double-shot': '2 ilave espresso',
  },
  sides: { small: 'Küçük', medium: 'Orta', large: 'Büyük' },
  size: { small: 'Küçük', medium: 'Orta', large: 'Büyük' },
  sugar: {
    none: 'Şekersiz',
    one: '1 şeker',
    two: '2 şeker',
    sweetener: 'Tatlandırıcı',
    plain: 'Sade',
    'medium-sugar': 'Orta şekerli',
    sweet: 'Şekerli',
  },
  syrup: {
    vanilla: 'Vanilya',
    caramel: 'Karamel',
    hazelnut: 'Fındık',
    chocolate: 'Çikolata',
    'white-chocolate': 'Beyaz çikolata',
  },
  temperature: { hot: 'Sıcak', warm: 'Ilık', 'extra-hot': 'Ekstra sıcak' },
};

export function customizationStepLabel(language: KioskLanguage, stepId: string, step: CustomizationStep) {
  return language === 'tr' ? TURKISH_STEP_LABELS[stepId] ?? step.title : step.title;
}

export function customizationOptionLabel(language: KioskLanguage, stepId: string, option: ModifierOption) {
  return language === 'tr' ? TURKISH_OPTION_LABELS[stepId]?.[option.id] ?? option.name : option.name;
}
