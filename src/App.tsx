import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Coffee, Cpu, CreditCard, Hand, Languages, Minus, Package, Plus, RotateCcw, ShoppingBag, Trash2, Undo2, UtensilsCrossed, Volume2, VolumeX, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, assetUrl, cancelPosPayment, fetchCastlesDevices, fetchCatalog, fetchOrderVend, pollPosPayment, recordReceiptStatus, startPosPayment, submitOrder, uniqueRequestId, type CastlesDeviceOption, type PosPaymentStatus, type VendJob, type VendTracking } from './api';
import { getKioskTerminalSerial, setKioskTerminalSerial } from './kioskSettings';
import { customizationOptionLabel, customizationStepLabel } from './i18n/catalogLocalization';
import { SUPPORTED_LANGUAGES, useKioskLanguage, type KioskLanguage } from './i18n/KioskLanguage';
import { prepareOrderPrinter, printOrderReceiptOnce, type ReceiptLineMark, type ReceiptPrintStatus } from './printing/orderReceiptPrinter';
import { machineVariantsOf, matchVariant, parseVariantKey, selectionLabel, variantCompatible, variantKeyOf } from './machineVariants';
import type { CartLine, Catalog, CustomizationStep, Fulfillment, Product, Screen, Selection } from './types';

const money = (amount: number) => `${amount.toFixed(2)} TL`;
const AUDIO_BASE = '/audio/kiosk/';
const CUSTOMIZER_HERO_IMAGES: Record<string, string> = {
  'latte': '/images/products/heroes/latte-hero.webp',
  'americano': '/images/products/heroes/americano-hero.webp',
  'flat-white': '/images/products/heroes/flat-white-hero.webp',
  'batch-brew': '/images/products/heroes/batch-brew-hero.webp',
  'cold-brew': '/images/products/heroes/cold-brew-hero.webp',
  'caramel-frappe': '/images/products/heroes/caramel-frappe-hero.webp',
  'espresso': '/images/products/heroes/espresso-hero.webp',
  'cappuccino': '/images/products/heroes/cappuccino-hero.webp',
  'mocha': '/images/products/heroes/mocha-hero.webp',
  'caramel-macchiato': '/images/products/heroes/caramel-macchiato-hero.webp',
  'iced-latte': '/images/products/heroes/iced-latte-hero.webp',
  'turkish-coffee': '/images/products/heroes/turkish-coffee-hero.webp',
  'v60': '/images/products/heroes/v60-hero.webp',
  'chemex': '/images/products/heroes/v60-hero.webp',
  'iced-americano': '/images/products/heroes/iced-americano-hero.webp',
  'mocha-frappe': '/images/products/heroes/mocha-frappe-hero.webp',
  'chai-tea-latte': '/images/products/heroes/chai-tea-latte-hero.webp',
  'hot-chocolate': '/images/products/heroes/hot-chocolate-hero.webp',
  'menengic-kahvesi': '/images/products/heroes/menengic-kahvesi-hero.webp',
  'dibek-kahvesi': '/images/products/heroes/dibek-kahvesi-hero.webp',
};

function useKioskAudio(enabled: boolean, language: KioskLanguage) {
  const current = useRef<HTMLAudioElement | null>(null);
  const queue = useRef(Promise.resolve());

  const stop = useCallback(() => {
    current.current?.pause();
    if (current.current) current.current.currentTime = 0;
    current.current = null;
    queue.current = Promise.resolve();
  }, []);

  const localizedFile = useCallback((file: string) => {
    if (language !== 'en') return file;
    const english: Record<string, string> = {
      'card-reader-prompt.mp3': 'card-reader-prompt-en.mp3',
      'order-created.mp3': 'order-created-en.mp3',
      'payment-failed-prompt.mp3': 'payment-failed-prompt-en.mp3',
      'payment-method-selection.mp3': 'payment-method-selection-en.mp3',
      'product-selection-prompt.mp3': 'product-selection-prompt-en.mp3',
    };
    return english[file] ?? file;
  }, [language]);

  const play = useCallback((file: string) => {
    if (!enabled) return Promise.resolve();
    const audio = new Audio(`${AUDIO_BASE}${localizedFile(file)}`);
    current.current?.pause();
    current.current = audio;
    return audio.play().catch(() => undefined);
  }, [enabled, localizedFile]);

  const playSequence = useCallback((files: string[]) => {
    if (!enabled) return;
    queue.current = queue.current.then(async () => {
      for (const file of files) {
        if (!enabled) return;
        await new Promise<void>((resolve) => {
          const audio = new Audio(`${AUDIO_BASE}${localizedFile(file)}`);
          current.current?.pause();
          current.current = audio;
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          audio.play().catch(() => resolve());
        });
      }
    });
  }, [enabled, localizedFile]);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  return useMemo(() => ({ play, playSequence, stop }), [play, playSequence, stop]);
}

function preloadCatalogImages(catalog: Catalog) {
  const urls = new Set(catalog.products.map((product) => assetUrl(product.image)).filter(Boolean));
  catalog.products.forEach((product) => {
    const heroImage = CUSTOMIZER_HERO_IMAGES[product.id];
    if (heroImage) urls.add(assetUrl(heroImage));
  });
  for (const url of urls) {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = url;
    document.head.appendChild(link);

    const image = new Image();
    image.loading = 'eager';
    image.decoding = 'async';
    image.src = url;
    image.decode?.().catch(() => undefined);
  }
}

function productCartQuantity(cart: CartLine[], productId: string) {
  return cart.filter((line) => line.product.id === productId).reduce((sum, line) => sum + line.quantity, 0);
}

function addToCartNotice(product: Product, nextCartQuantity: number, t: ReturnType<typeof useKioskLanguage>['t']) {
  if (!product.stockTrackingEnabled || product.stockQuantity == null) return null;
  const remaining = product.stockQuantity - nextCartQuantity;
  if (remaining <= 0) return t('notice.addedSoldOut', { name: product.name });
  if (remaining === 1) return t('notice.lastOne', { name: product.name });
  return null;
}

function BrandMark({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return <div className={`brand-mark ${light ? 'brand-mark--light' : ''} ${compact ? 'brand-mark--compact' : ''}`}>
    <span className="brand-mark__star"><Coffee /></span><span className="brand-mark__copy"><b>MAGIC</b><em>COFFEE</em></span>
  </div>;
}

const SETTINGS_TAP_COUNT = 5;
const SETTINGS_TAP_WINDOW_MS = 3000;

function KioskSettingsModal({ onClose }: { onClose: () => void }) {
  const [devices, setDevices] = useState<CastlesDeviceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(() => getKioskTerminalSerial());
  const [selected, setSelected] = useState<string | null>(saved);
  useEffect(() => {
    let cancelled = false;
    fetchCastlesDevices()
      .then((list) => { if (!cancelled) setDevices(list); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Castles cihaz listesi alınamadı.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const save = () => { setKioskTerminalSerial(selected); setSaved(selected); onClose(); };
  const savedDevice = devices.find((device) => device.serial === saved);
  return createPortal(<div className="kiosk-settings-backdrop" onMouseDown={onClose} onClick={(event) => event.stopPropagation()}>
    <section className="kiosk-settings page-enter" role="dialog" aria-modal="true" aria-label="Kiosk ayarları" onMouseDown={(event) => event.stopPropagation()}>
      <button className="icon-button" onClick={onClose} aria-label="Kapat"><X /></button>
      <span className="kiosk-settings__icon"><Cpu /></span>
      <small>KİOSK AYARLARI</small>
      <h2>Castles POS cihazı</h2>
      <p>Bu kioskun ödemeleri göndereceği cihazı seçin. Şu an: <b>{saved ? `${savedDevice?.name ?? 'Cihaz'} (${saved})` : 'Seçili değil'}</b></p>
      {error && <div className="payment__error">{error}</div>}
      <div className="kiosk-settings__options" role="radiogroup" aria-label="Castles cihazı">
        <button type="button" role="radio" aria-checked={selected === null} className={selected === null ? 'selected' : ''} onClick={() => setSelected(null)}><b>Seçili değil</b><small>Sunucudaki varsayılan cihaz kullanılır</small>{selected === null && <i><Check /></i>}</button>
        {loading && <div className="kiosk-settings__hint"><RotateCcw className="spin" /> Cihazlar yükleniyor...</div>}
        {!loading && !error && !devices.length && <div className="kiosk-settings__hint">Panelde tanımlı aktif Castles cihazı yok.</div>}
        {devices.map((device) => <button type="button" key={device.serial} role="radio" aria-checked={selected === device.serial} className={selected === device.serial ? 'selected' : ''} onClick={() => setSelected(device.serial)}><b>{device.name}</b><small>{device.serial}</small>{selected === device.serial && <i><Check /></i>}</button>)}
        {!loading && saved && !savedDevice && selected === saved && <div className="kiosk-settings__hint">Kayıtlı cihaz ({saved}) artık listede yok; yeni bir cihaz seçin.</div>}
      </div>
      <div className="kiosk-settings__actions">
        <button className="secondary-button" onClick={onClose}>Kapat</button>
        <button className="primary-button" onClick={save}><Check /> Kaydet</button>
      </div>
    </section>
  </div>, document.body);
}

function Intro({ onStart, loading }: { onStart: () => void; loading: boolean }) {
  const { t } = useKioskLanguage();
  return <button type="button" className="intro" onClick={onStart} aria-label={t('intro.startAria')}>
    <div className="intro__grain" />
    <header className="intro__header"><BrandMark light /></header>
    <img className="intro__burger intro__coffee-art" src="/images/products/cappuccino.png" alt="Magic Coffee Cappuccino" />
    <div className="intro__copy"><p>{t('intro.eyebrow')}</p><h1>{t('intro.title')}<br /><i>{t('intro.magic')}</i> {t('intro.titleEnd')}</h1><span>{t('intro.subtitle')}</span></div>
    <div className="intro__touch"><span>{loading ? t('intro.loading') : t('intro.touch')}</span><ArrowRight /></div>
  </button>;
}

function OrderType({ soundOn, onToggleSound, onContinue }: { soundOn: boolean; onToggleSound: () => void; onContinue: (type: Fulfillment) => void }) {
  const { language, setLanguage, t } = useKioskLanguage();
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
  return <main className="order-type page-enter">
    <div className="order-type__actions">
      <div className="language-control">
        <button type="button" className={`utility-button utility-button--language ${languagePickerOpen ? 'utility-button--open' : ''}`} onClick={() => setLanguagePickerOpen((open) => !open)} aria-haspopup="menu" aria-expanded={languagePickerOpen} aria-controls="language-picker" aria-label={t('language.choose')}><span><Languages /></span><small>{t('language.title')}</small><b>{t('language.current')}</b></button>
        {languagePickerOpen && <><button type="button" className="language-picker__backdrop" onClick={() => setLanguagePickerOpen(false)} aria-label={t('common.close')} tabIndex={-1} /><section id="language-picker" className="language-picker" role="menu" aria-label={t('language.choose')}><header className="language-picker__header"><span><Languages /></span><div><small>{t('language.title')}</small><b>{t('language.choose')}</b></div></header><div className="language-picker__options">{SUPPORTED_LANGUAGES.map((option) => { const selected = option === language; return <button type="button" role="menuitemradio" aria-checked={selected} key={option} className={selected ? 'selected' : ''} onClick={() => { setLanguage(option); setLanguagePickerOpen(false); }}><span>{option.toUpperCase()}</span><b>{option === 'tr' ? t('language.turkish') : t('language.english')}</b>{selected && <i><Check /></i>}</button>; })}</div></section></>}
      </div>
      <button className="utility-button utility-button--sound" onClick={onToggleSound}><span className={soundOn ? 'green' : 'red'}>{soundOn ? <Volume2 /> : <VolumeX />}</span><small>{t('audio.title')}</small><b>{soundOn ? t('audio.on') : t('audio.off')}</b></button>
    </div>
    <section className="order-type__content">
      <h1>{t('orderType.title')}</h1><p>{t('orderType.subtitle')}</p>
      <div className="order-type__grid">
        <button onClick={() => onContinue('restaurant')}><span><UtensilsCrossed /></span><b>{t('orderType.restaurant')}</b><small>{t('orderType.restaurantHint')}</small></button>
        <button onClick={() => onContinue('package')}><span><ShoppingBag /></span><b>{t('orderType.package')}</b><small>{t('orderType.packageHint')}</small></button>
      </div>
    </section>
  </main>;
}

/** Kioskun kahve otomatından verilen ürün (katalogda otomat ürün numarası ya da varyantı olan). */
const isMachineProduct = (product: Product) => product.machineSelection != null || machineVariantsOf(product) !== null;

function ProductCard({ product, quantity, onClick }: { product: Product; quantity: number; onClick: () => void }) {
  const { t } = useKioskLanguage();
  const disabled = product.available === false;
  return <button type="button" className={`product-card ${disabled ? 'product-card--disabled' : ''}`} data-product-id={product.id} data-clickable="product" disabled={disabled}>
    {product.popular && <span className="product-card__popular">{t('product.popular')}</span>}{quantity > 0 && <span className="product-card__quantity">{quantity}</span>}
    <div className={`product-card__visual ${product.image ? '' : 'product-card__visual--emoji'}`}>{product.image ? <img src={assetUrl(product.image)} alt={product.name} draggable={false} loading="eager" decoding="async" fetchPriority="high" /> : <span>{product.emoji || '☕'}</span>}{isMachineProduct(product) && <small className="product-card__machine"><Coffee aria-hidden="true" />{t('product.fromMachine')}</small>}</div>
    <div className="product-card__body"><small>{disabled ? product.unavailableReason : product.categoryId}</small><h3>{product.name}</h3><p>{product.description}</p><b>{money(product.price)}</b></div>
  </button>;
}

function CatalogScreen({ catalog, cart, onProduct, onHeaderCart, onBottomCart }: { catalog: Catalog; cart: CartLine[]; onProduct: (product: Product) => void; onHeaderCart: () => void; onBottomCart: () => void }) {
  const { t } = useKioskLanguage();
  const [activeCategory, setActiveCategory] = useState('all');
  const [categoryScroll, setCategoryScroll] = useState({ left: false, right: false });
  const categoriesRef = useRef<HTMLElement>(null);
  const productsRef = useRef<HTMLElement>(null);
  const lastPointerHandledRef = useRef(0);
  // Logoya 3 saniye içinde 5 kez dokunulunca gizli kiosk ayarları açılır.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const brandTapsRef = useRef<number[]>([]);
  const handleBrandTap = (event: MouseEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    const now = Date.now();
    brandTapsRef.current = [...brandTapsRef.current.filter((at) => now - at <= SETTINGS_TAP_WINDOW_MS), now];
    if (brandTapsRef.current.length >= SETTINGS_TAP_COUNT) {
      brandTapsRef.current = [];
      setSettingsOpen(true);
    }
  };
  const visibleCategories = activeCategory === 'all' ? catalog.categories : catalog.categories.filter((item) => item.id === activeCategory);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const selectCategory = (categoryId: string) => { setActiveCategory(categoryId); productsRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); };
  const scrollCategories = (direction: -1 | 1) => {
    const categories = categoriesRef.current;
    if (!categories) return;
    categories.scrollBy({ left: direction * categories.clientWidth * 0.75, behavior: 'smooth' });
  };
  useEffect(() => {
    const categories = categoriesRef.current;
    if (!categories) return;
    const syncCategoryArrows = () => {
      const maxScroll = Math.max(0, categories.scrollWidth - categories.clientWidth);
      setCategoryScroll({ left: categories.scrollLeft > 2, right: categories.scrollLeft < maxScroll - 2 });
    };
    syncCategoryArrows();
    const frame = window.requestAnimationFrame(syncCategoryArrows);
    const timer = window.setTimeout(syncCategoryArrows, 150);
    categories.addEventListener('scroll', syncCategoryArrows, { passive: true });
    window.addEventListener('resize', syncCategoryArrows);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      categories.removeEventListener('scroll', syncCategoryArrows);
      window.removeEventListener('resize', syncCategoryArrows);
    };
  }, [catalog.categories.length]);
  useEffect(() => {
    const handleNativePress = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const now = Date.now();
      if (event.type === 'click' && now - lastPointerHandledRef.current < 700) {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        return;
      }

      const cartButton = target.closest<HTMLButtonElement>('[data-clickable="cart"]');
      if (cartButton && !cartButton.disabled) {
        if (event.type === 'pointerup') lastPointerHandledRef.current = now;
        if (event.cancelable) event.preventDefault();
        if (cartButton.classList.contains('header-cart')) onHeaderCart();
        else onBottomCart();
        return;
      }

      const productButton = target.closest<HTMLButtonElement>('.product-card');
      if (productButton && !productButton.disabled) {
        const product = catalog.products.find((item) => item.id === productButton.dataset.productId);
        if (!product) return;
        if (event.type === 'pointerup') lastPointerHandledRef.current = now;
        if (event.cancelable) event.preventDefault();
        onProduct(product);
        return;
      }

    };

    document.addEventListener('pointerup', handleNativePress, { capture: true });
    document.addEventListener('click', handleNativePress, { capture: true });
    return () => {
      document.removeEventListener('pointerup', handleNativePress, { capture: true });
      document.removeEventListener('click', handleNativePress, { capture: true });
    };
  }, [catalog.products, onBottomCart, onHeaderCart, onProduct]);
  return <main className="catalog page-enter">
    <header className="catalog__header"><span className="catalog__brand-tap" onClick={handleBrandTap}><BrandMark light compact /></span><button className="header-cart" data-clickable="cart" onClick={onHeaderCart}><span><ShoppingBag />{itemCount > 0 && <i>{itemCount}</i>}</span><span><b>{t('cart.myCart')}</b><small>{itemCount ? money(total) : t('cart.empty')}</small></span></button></header>
    <div className="category-menu"><div className="category-menu__label"><small>{t('catalog.menu')}</small><b>{t('catalog.chooseCategory')}</b></div><div className="categories-wrap">{categoryScroll.left && <button type="button" className="categories-wrap__hint categories-wrap__hint--prev" onClick={() => scrollCategories(-1)} aria-label={t('catalog.moreCategories')}><ArrowLeft /></button>}<nav ref={categoriesRef} className="categories" aria-label={t('catalog.categoriesAria')}><button className={activeCategory === 'all' ? 'active' : ''} onClick={() => selectCategory('all')}>{t('catalog.all')}</button>{catalog.categories.map((item) => <button key={item.id} className={item.id === activeCategory ? 'active' : ''} onClick={() => selectCategory(item.id)}>{item.name}</button>)}</nav>{categoryScroll.right && <button type="button" className="categories-wrap__hint categories-wrap__hint--next" onClick={() => scrollCategories(1)} aria-label={t('catalog.moreCategories')}><ArrowRight /></button>}</div></div>
    <section ref={productsRef} className={`products ${activeCategory === 'all' ? 'products--all' : ''}`}>{visibleCategories.map((category) => {
      const categoryProducts = catalog.products.filter((product) => product.categoryId === category.id);
      return <section className="category-section" key={category.id}><div className="section-heading"><h1>{category.name}</h1><span /><small>{categoryProducts.length} {t(categoryProducts.length === 1 ? 'catalog.product' : 'catalog.products')}</small></div><div className="product-grid">{categoryProducts.map((product) => <ProductCard key={product.id} product={product} quantity={cart.filter((line) => line.product.id === product.id).reduce((sum, line) => sum + line.quantity, 0)} onClick={() => onProduct(product)} />)}</div></section>;
    })}</section>
    <button className={`cart-bar ${itemCount ? 'cart-bar--ready' : ''}`} data-clickable="cart" onClick={onBottomCart}><span className="cart-bar__icon"><ShoppingBag />{itemCount > 0 && <i>{itemCount}</i>}</span>{itemCount ? <><b>{t('cart.go')}</b><strong>{money(total)}</strong></> : <span>{t('cart.placeholder')}</span>}</button>
    {settingsOpen && <KioskSettingsModal onClose={() => setSettingsOpen(false)} />}
  </main>;
}



function hasActiveCustomization(product: Product) {
  return Object.values(product.customization ?? {}).some((step) => step.enabled && step.options.some((option) => option.enabled !== false));
}

function maxSelections(stepId: string, step: CustomizationStep) {
  return stepId === 'shot' ? 1 : Math.max(1, step.maxSelect ?? 1);
}

function normalizeChoices(choices: Record<string, string[]>, steps: [string, CustomizationStep][]) {
  const normalized: Record<string, string[]> = {};
  for (const [stepId, step] of steps) {
    const allowed = new Set(step.options.filter((option) => option.enabled !== false && option.available !== false).map((option) => option.id));
    const maxSelect = maxSelections(stepId, step);
    const selected = (choices[stepId] ?? []).filter((optionId, index, optionIds) => allowed.has(optionId) && optionIds.indexOf(optionId) === index);
    normalized[stepId] = selected.slice(0, maxSelect);
  }
  return normalized;
}

function cartLineKey(product: Product, selection?: Selection) {
  if (!selection) return product.id;
  const normalized = Object.fromEntries(
    Object.entries(selection.choices)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([stepId, optionIds]) => [stepId, [...optionIds].sort()]),
  );
  return `${product.id}-${JSON.stringify(normalized)}`;
}

function Customizer({ product, initial, onClose, onSave }: { product: Product; initial?: Selection; onClose: () => void; onSave: (selection: Selection, unitPrice: number) => void }) {
  const { language, t } = useKioskLanguage();
  const steps = Object.entries(product.customization ?? {}).filter(([, step]) => step.enabled && step.options.some((option) => option.enabled !== false));
  // Otomat kioskunda yalnız makinenin yapabildiği kombinasyonlar (varyantlar) seçilebilir.
  const variants = machineVariantsOf(product);
  const [choices, setChoices] = useState<Record<string, string[]>>(() => {
    const defaults = normalizeChoices(initial?.choices ?? Object.fromEntries(steps.map(([id, step]) => [id, step.required ? [] : step.options.filter((option) => option.defaultSelected && option.enabled !== false && option.available !== false).map((option) => option.id)])), steps);
    if (!variants || matchVariant(product, { choices: defaults })) return defaults;
    const base = variants.find((variant) => !variantKeyOf(parseVariantKey(variant.optionKey))) ?? variants[0];
    return normalizeChoices(parseVariantKey(base.optionKey), steps);
  });
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const current = steps[index];
  const requiredSelectionsComplete = steps.every(([id, step]) => !step.required || (choices[id] ?? []).length >= (step.minSelect ?? 1));
  const variant = variants ? matchVariant(product, { choices }) : null;
  const variantMissing = Boolean(variants) && !variant;
  const unitPrice = useMemo(() => {
    // Otomat eşlemesinde fiyat tanımlıysa satış fiyatı odur (API ödeme tutarını aynı fiyatla doğrular).
    if (variant?.price != null) return Number(variant.price);
    return product.price + steps.reduce((sum, [id, step]) => sum + (choices[id] ?? []).reduce((optionSum, optionId) => optionSum + (step.options.find((option) => option.id === optionId)?.priceDelta ?? 0), 0), 0);
  }, [choices, product.price, steps, variant]);
  const nextChoices = (currentChoices: Record<string, string[]>, stepId: string, optionId: string, max: number) => {
    const selected = currentChoices[stepId] ?? [];
    if (selected.includes(optionId)) return { ...currentChoices, [stepId]: selected.filter((id) => id !== optionId) };
    return { ...currentChoices, [stepId]: max === 1 ? [optionId] : [...selected, optionId].slice(0, max) };
  };
  /** Varyant modunda seçenek, en az bir makine varyantıyla uyumlu kalıyorsa seçilebilir. */
  const optionAllowed = (stepId: string, optionId: string, max: number) => {
    if (!variants || (choices[stepId] ?? []).includes(optionId)) return true;
    return variantCompatible(variants, nextChoices(choices, stepId, optionId, max));
  };
  const toggle = (stepId: string, optionId: string, max = 1) => setChoices((currentChoices) => nextChoices(currentChoices, stepId, optionId, max));
  const next = () => {
    const [stepId, step] = current;
    if (step.required && (choices[stepId] ?? []).length < (step.minSelect ?? 1)) { setError(t('customizer.requiredError', { title: customizationStepLabel(language, stepId, step) })); return; }
    setError('');
    if (index < steps.length - 1) { setIndex(index + 1); return; }
    if (variantMissing) { setError(t('customizer.variantUnavailable')); return; }
    onSave({ choices: normalizeChoices(choices, steps) }, unitPrice);
  };
  if (!current) return null;
  const [stepId, step] = current;
  const heroImage = CUSTOMIZER_HERO_IMAGES[product.id] ?? product.image;
  return <main className="customizer page-enter" role="dialog" aria-modal="true">
    <header><button className="icon-button" onClick={onClose} aria-label={t('common.close')}><X /></button><div><small>{t('customizer.prepare')}</small><h2>{product.name}</h2></div><b>{money(unitPrice)}</b></header>
    <div className="customizer__hero">{heroImage && <img src={assetUrl(heroImage)} alt={product.name} draggable={false} loading="eager" decoding="async" fetchPriority="high" />}<div><span>MAGIC COFFEE</span><b>{customizationStepLabel(language, stepId, step)}</b></div></div>
    <nav className="steps">{steps.map(([id, item], stepIndex) => <button key={id} className={stepIndex === index ? 'active' : ''} onClick={() => setIndex(stepIndex)}><i>{stepIndex + 1}</i>{customizationStepLabel(language, id, item)}</button>)}</nav>
    <div className="customizer__content"><div className="customizer__title"><span><small>{t('customizer.selection')}</small><h3>{customizationStepLabel(language, stepId, step)}</h3></span><p>{step.required ? t('customizer.required') : t('customizer.optional')}</p></div>
      <div className="option-list">{step.options.filter((option) => option.enabled !== false).map((option) => {
        const selected = (choices[stepId] ?? []).includes(option.id);
        const allowed = optionAllowed(stepId, option.id, maxSelections(stepId, step));
        // Otomat kioskunda fiyat farkı yerine seçimin toplam fiyatı varyanttan gelir; desteklenmeyen seçenekler kapalıdır.
        const hint = option.available === false ? t('product.soldOut') : !allowed ? t('customizer.notOnMachine') : variants ? (selected ? t('product.included') : '') : option.priceDelta ? `+${money(option.priceDelta)}` : t('product.included');
        return <button key={option.id} className={selected ? 'selected' : ''} disabled={option.available === false || !allowed} onClick={() => toggle(stepId, option.id, maxSelections(stepId, step))}><span>{selected && <Check />}</span><b>{customizationOptionLabel(language, stepId, option)}</b><small>{hint}</small></button>;
      })}</div>{error && <div className="payment__error">{error}</div>}{!error && variantMissing && index === steps.length - 1 && <div className="payment__error">{t('customizer.variantUnavailable')}</div>}</div>
    <footer><button className="secondary-button" onClick={onClose}>{t('common.cancel')}</button><button className="primary-button" disabled={index === steps.length - 1 && (!requiredSelectionsComplete || variantMissing)} onClick={next}>{index === steps.length - 1 ? t('common.addToCart') : t('common.continue')}</button></footer>
  </main>;
}

function CartDrawer({ cart, onClose, onQuantity, onDelete, onEdit, onCheckout }: { cart: CartLine[]; onClose: () => void; onQuantity: (key: string, delta: number) => void; onDelete: (key: string) => void; onEdit: (line: CartLine) => void; onCheckout: () => void }) {
  const { t } = useKioskLanguage();
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  return <main className="cart-drawer page-enter">
    <header><span><ShoppingBag /></span><div><h2>{t('cart.myCart')}</h2><small>{t('cart.lineCount', { count: itemCount })}</small></div><button className="icon-button" onClick={onClose} aria-label={t('common.close')}><X /></button></header>
    <div className="cart-drawer__items">{!cart.length && <div className="empty-cart"><ShoppingBag /><h3>{t('cart.emptyLong')}</h3><p>{t('cart.emptyHint')}</p></div>}{cart.map((line) => <article className="cart-line" key={line.key}><div className="cart-line__image">{line.product.image ? <img src={assetUrl(line.product.image)} alt="" draggable={false} loading="eager" decoding="async" fetchPriority="high" /> : <span>{line.product.emoji || '☕'}</span>}</div><div className="cart-line__main"><small>MAGIC COFFEE</small><h3>{line.product.name}</h3><p>{Object.values(line.selection?.choices ?? {}).flat().length ? t('cart.customized') : t('cart.standard')}</p><div><button disabled={line.quantity === 1} onClick={() => onQuantity(line.key, -1)}><Minus /></button><b>{line.quantity}</b><button className="plus" onClick={() => onQuantity(line.key, 1)}><Plus /></button>{hasActiveCustomization(line.product) && <button className="edit" onClick={() => onEdit(line)}>{t('cart.edit')}</button>}<button className="delete" onClick={() => onDelete(line.key)}><Trash2 /> {t('cart.delete')}</button></div></div><strong>{money(line.unitPrice * line.quantity)}</strong></article>)}</div>
    <footer><div><small>{t('cart.total')}</small><b>{money(total)}</b><span>{itemCount} {t('cart.items')}</span></div><button className="primary-button" disabled={!cart.length} onClick={onCheckout}>{t('cart.checkout')}</button></footer>
  </main>;
}

/**
 * Ödemesi alınmış, ürünleri kahve otomatında hazırlanan sipariş: vend sonuçları bitene kadar izlenir,
 * fiş sonuçlar gelince basılır. Uygulama yeniden başlarsa izleme kaldığı yerden sürdürülür.
 */
type PendingVend = {
  orderNumber: string;
  createdAt: string;
  method: 'card' | 'meal-card';
  fulfillment: Fulfillment;
  paymentReference: string;
  language: KioskLanguage;
  cart: CartLine[];
  total: number;
  startedAt: string;
};
const PENDING_VEND_KEY = 'magiccoffee.pendingVend';
const PENDING_VEND_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function readPendingVend(): PendingVend | null {
  try {
    const raw = window.localStorage.getItem(PENDING_VEND_KEY);
    const parsed = raw ? JSON.parse(raw) as PendingVend : null;
    return parsed && typeof parsed.orderNumber === 'string' && parsed.orderNumber && Array.isArray(parsed.cart) ? parsed : null;
  } catch {
    return null;
  }
}

function savePendingVend(vend: PendingVend) {
  try { window.localStorage.setItem(PENDING_VEND_KEY, JSON.stringify(vend)); } catch { /* Depolama yoksa izleme yalnız bu oturumda sürer. */ }
}

function clearPendingVend() {
  try { window.localStorage.removeItem(PENDING_VEND_KEY); } catch { /* Depolama kullanılamıyor. */ }
}

const pendingVendFresh = (vend: PendingVend) => {
  const startedAt = Date.parse(vend.startedAt);
  return Number.isFinite(startedAt) && Date.now() - startedAt < PENDING_VEND_MAX_AGE_MS;
};

const isMachineLine = (line: CartLine) => isMachineProduct(line.product);

const POS_SUCCESS = new Set<PosPaymentStatus>(['COMPLETED', 'PAID', 'SUCCESS', 'SUCCEEDED']);
const POS_FAILURE = new Set<PosPaymentStatus>(['FAILED', 'ERROR', 'CANCELLED', 'CANCELED', 'DECLINED']);
const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function Payment({ cart, fulfillment, vendEnabled, onBack, onBeginPayment, onPaymentFailed, onSuccess, onVendStart, onReceiptStatus }: { cart: CartLine[]; fulfillment: Fulfillment; vendEnabled: boolean; onBack: () => void; onBeginPayment: () => void; onPaymentFailed: () => void; onSuccess: (orderNumber: string) => void; onVendStart: (vend: PendingVend) => void; onReceiptStatus: (status: ReceiptPrintStatus) => void }) {
  const { language, t } = useKioskLanguage();
  const [method, setMethod] = useState<'card' | 'meal-card' | null>(null);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<'idle' | 'starting' | 'waiting' | 'saving' | 'error'>('idle');
  const processingRef = useRef(false);
  const paymentRequestIdRef = useRef('');
  const orderRequestIdRef = useRef('');
  const transactionRef = useRef('');
  const paymentReferenceRef = useRef('');
  const paidResultRef = useRef<PosPaymentStatus | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  const finishPaidOrder = async (selectedMethod: 'card' | 'meal-card') => {
    if (!orderRequestIdRef.current) orderRequestIdRef.current = uniqueRequestId('order');
    setPhase('saving');
    const order = await submitOrder({
      clientRequestId: orderRequestIdRef.current,
      fulfillment,
      paymentMethod: selectedMethod,
      total,
      lines: cart,
      paymentReference: paymentReferenceRef.current,
      posTransactionId: transactionRef.current,
      language,
    });
    if (order.vendStatus || (vendEnabled && cart.some(isMachineLine))) {
      // Kahve otomatı ürünleri: fiş vend sonuçları bitince basılır; izleme kaydı yeniden başlatmaya karşı saklanır.
      const vend: PendingVend = {
        orderNumber: order.number,
        createdAt: order.created_at ?? new Date().toISOString(),
        method: selectedMethod,
        fulfillment,
        paymentReference: paymentReferenceRef.current,
        language,
        cart,
        total,
        startedAt: new Date().toISOString(),
      };
      savePendingVend(vend);
      onVendStart(vend);
      return;
    }
    onSuccess(order.number);
    const receipt = await printOrderReceiptOnce({
      orderNumber: order.number,
      createdAt: order.created_at ?? new Date().toISOString(),
      fulfillment,
      paymentMethod: selectedMethod,
      paymentReference: paymentReferenceRef.current,
      language,
      total,
      lines: cart,
    });
    onReceiptStatus(receipt.status);
    recordReceiptStatus(order.number, receipt).catch((receiptError) => {
      console.warn('Fiş durumu API tarafına kaydedilemedi.', receiptError);
    });
  };

  const checkUntilComplete = async (initial: Awaited<ReturnType<typeof startPosPayment>>, signal: AbortSignal) => {
    let result = initial;
    let temporaryErrors = 0;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (POS_SUCCESS.has(result.status) || POS_FAILURE.has(result.status)) return result;
      await wait(2000);
      if (signal.aborted) throw new DOMException('Payment request aborted', 'AbortError');
      try {
        result = await pollPosPayment(transactionRef.current, signal);
        temporaryErrors = 0;
      } catch (pollError) {
        temporaryErrors += 1;
        if (temporaryErrors >= 5) throw pollError;
      }
    }
    if (transactionRef.current) void cancelPosPayment(transactionRef.current);
    throw new Error(t('payment.posTimeout'));
  };

  const complete = async (selectedMethod: 'card' | 'meal-card') => {
    if (processingRef.current) return;
    processingRef.current = true;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setMethod(selectedMethod);
    setError('');
    try {
      if (paidResultRef.current && transactionRef.current && paymentReferenceRef.current) {
        await finishPaidOrder(selectedMethod);
        return;
      }
      setPhase(transactionRef.current ? 'waiting' : 'starting');
      onBeginPayment();
      if (!paymentRequestIdRef.current) paymentRequestIdRef.current = uniqueRequestId('payment');
      const started = transactionRef.current
        ? await pollPosPayment(transactionRef.current, controller.signal)
        : await startPosPayment({ clientRequestId: paymentRequestIdRef.current, paymentMethod: selectedMethod, amount: total, lines: cart, signal: controller.signal, terminalSerial: getKioskTerminalSerial() ?? undefined });
      if (controller.signal.aborted) return;
      transactionRef.current = started.id || started.externalId || transactionRef.current;
      paymentReferenceRef.current = started.paymentReference || started.externalId || paymentReferenceRef.current;
      if (!transactionRef.current || !paymentReferenceRef.current) throw new Error(t('payment.posMissingTransaction'));
      setPhase('waiting');
      const result = await checkUntilComplete(started, controller.signal);
      if (controller.signal.aborted) return;
      if (POS_FAILURE.has(result.status)) {
        transactionRef.current = '';
        paymentReferenceRef.current = '';
        paymentRequestIdRef.current = '';
        throw new Error(result.message || t('payment.posFailed'));
      }
      paidResultRef.current = result.status;
      await finishPaidOrder(selectedMethod);
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
      if (!transactionRef.current && !paidResultRef.current) paymentRequestIdRef.current = '';
      console.error('Payment could not be completed.', err);
      setError(t('payment.posFailed'));
      setPhase('error');
      onPaymentFailed();
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
      processingRef.current = false;
    }
  };

  const busy = phase === 'starting' || phase === 'waiting' || phase === 'saving';
  const backDisabled = phase === 'saving' || Boolean(paidResultRef.current);
  const handleBack = () => {
    if (backDisabled) return;
    requestControllerRef.current?.abort();
    if (transactionRef.current && !paidResultRef.current) {
      void cancelPosPayment(transactionRef.current);
      transactionRef.current = '';
      paymentReferenceRef.current = '';
      paymentRequestIdRef.current = '';
    }
    processingRef.current = false;
    onBack();
  };
  const statusText = phase === 'starting' ? t('payment.sendingToPos') : phase === 'waiting' ? t('payment.waitingForCard') : phase === 'saving' ? t('payment.savingOrder') : '';
  return <main className="payment page-enter"><section className="payment__methods"><header><button className="icon-button" onClick={handleBack} disabled={backDisabled} aria-label={t('common.back')}><ArrowLeft /></button><div><h1>{t('payment.title')}</h1><p>{t('payment.hint')}</p></div></header><div className="payment-options"><button className={method === 'card' ? 'selected' : ''} disabled={busy} onClick={() => complete('card')}><span><CreditCard /></span><b>{t('payment.card')}</b><small>{t('payment.cardHint')}</small></button><button className={method === 'meal-card' ? 'selected' : ''} disabled={busy} onClick={() => complete('meal-card')}><span className="dark"><UtensilsCrossed /></span><b>{t('payment.mealCard')}</b><small>{t('payment.mealCardHint')}</small></button></div>{statusText && <div className="payment__status" role="status" aria-live="polite"><span className="spin" />{statusText}</div>}{error && <div className="payment__error">{error}<button onClick={() => method && complete(method)}>{t('payment.retryPos')}</button></div>}</section><aside className="payment__summary"><div className="amount"><small>{t('payment.amount')}</small><b>{money(total)}</b></div><div className="summary-card"><header><b>{t('payment.summary')}</b><span>{itemCount} {t(itemCount === 1 ? 'cart.item' : 'cart.items')}</span></header><div className="summary-card__lines">{cart.map((line) => <div key={line.key}><span><b>{line.product.name}</b><small>{line.quantity} {t('cart.quantityUnit')}</small></span><strong>{money(line.unitPrice * line.quantity)}</strong></div>)}</div><div className="summary-total"><span>{t('payment.total')}</span><b>{money(total)}</b></div><p className="order-type-mini"><UtensilsCrossed /> {fulfillment === 'restaurant' ? t('orderType.restaurant') : t('orderType.package')}</p></div></aside></main>;
}

function Success({ orderNumber, receiptStatus, onRestart }: { orderNumber: string; receiptStatus: ReceiptPrintStatus | 'printing'; onRestart: () => void }) {
  const { t } = useKioskLanguage();
  return <main className="success page-enter"><BrandMark /><span className="success__check"><CheckCircle2 /></span><p>{t('success.received')}</p><h1>{t('success.thanks')}</h1><h2>{t('success.preparing')}</h2><div><small>{t('success.number')}</small><b>{orderNumber}</b></div>{receiptStatus === 'printing' && <p className="success__receipt">{t('payment.printingReceipt')}</p>}{receiptStatus === 'printed' && <p className="success__receipt">{t('success.receiptPrinted')}</p>}{receiptStatus === 'failed' && <p className="success__receipt success__receipt--error">{t('success.receiptFailed')}</p>}<button className="primary-button" onClick={onRestart}><RotateCcw /> {t('success.newOrder')}</button></main>;
}

// ---------------------------------------------------------------- Kahve otomatı (vend) izleme

const VEND_POLL_MS = 1500;
/** Kredi modunda müşterinin makinede ürün düğmesine basması için süre (API ile aynı). */
const VEND_CREDIT_WAIT_S = 120;
/** İş başına üst sınır (kuyruk + köprü + hazırlama). */
const VEND_JOB_LIMIT_MS = 4 * 60_000;
/** İade (kart okutma dahil) için ek bekleme süresi. */
const VEND_REFUND_LIMIT_MS = 4 * 60_000;
const VEND_RESTART_MS = 20_000;
const VEND_FINAL = new Set<VendJob['status']>(['SUCCESS', 'REFUNDED', 'REFUND_FAILED']);
/** Makinede başarısız / zaman aşımı: iade sonucu bekleniyor. */
const VEND_REFUND_PENDING = new Set<VendJob['status']>(['FAILED', 'EXPIRED']);
const VEND_ACTIVE = new Set<VendJob['status']>(['QUEUED', 'SENT', 'WAITING_SELECTION', 'DISPENSING']);

/** İşleri sepet satırlarına eşler (ürün kimliği > ad > otomat numarası); satır adedi kadar iş alınır. */
function vendLineOf(cart: CartLine[], jobs: VendJob[]) {
  const used = new Map<string, number>();
  const result = new Map<string, CartLine | undefined>();
  const machineLines = cart.filter(isMachineLine);
  for (const job of jobs) {
    const free = (line: CartLine) => (used.get(line.key) ?? 0) < line.quantity;
    const line = machineLines.find((item) => free(item) && job.productId && item.product.id === job.productId)
      ?? machineLines.find((item) => free(item) && job.productName && item.product.name === job.productName)
      ?? machineLines.find((item) => free(item) && job.selectionNo != null && item.product.machineSelection === job.selectionNo)
      ?? machineLines.find(free);
    if (line) used.set(line.key, (used.get(line.key) ?? 0) + 1);
    result.set(job.id, line);
  }
  return result;
}

/** Fişte işaretlenecek adetler: makinede hazırlanamayan işler satır bazında toplanır. */
function vendReceiptMarks(cart: CartLine[], jobs: VendJob[]): ReceiptLineMark[] {
  const lineOf = vendLineOf(cart, jobs);
  const marks = new Map<string, ReceiptLineMark>();
  for (const job of jobs) {
    const status: ReceiptLineMark['status'] | null = job.status === 'REFUNDED' ? 'refunded' : job.status === 'REFUND_FAILED' ? 'refund-failed' : VEND_REFUND_PENDING.has(job.status) ? 'refunding' : null;
    const line = lineOf.get(job.id);
    if (!status || !line) continue;
    const key = `${line.key}|${status}`;
    const current = marks.get(key);
    marks.set(key, { lineKey: line.key, status, quantity: (current?.quantity ?? 0) + 1 });
  }
  return [...marks.values()];
}

function VendScreen({ vend, onFinished, onRestart }: { vend: PendingVend; onFinished: (allSucceeded: boolean) => void; onRestart: () => void }) {
  const { t } = useKioskLanguage();
  const [tracking, setTracking] = useState<VendTracking | null>(null);
  const [finished, setFinished] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [receiptStatus, setReceiptStatus] = useState<ReceiptPrintStatus | 'printing'>('printing');
  const [now, setNow] = useState(() => Date.now());
  const waitingSinceRef = useRef(new Map<string, number>());
  const finishedRef = useRef(false);
  const lastRef = useRef<VendTracking | null>(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const machineCount = vend.cart.filter(isMachineLine).reduce((sum, line) => sum + line.quantity, 0);

  const finish = useCallback(async (result: VendTracking | null, expired: boolean) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setFinished(true);
    setTimedOut(expired);
    const jobs = result?.jobs ?? [];
    onFinishedRef.current(jobs.length > 0 ? jobs.every((job) => job.status === 'SUCCESS') : !expired);
    const receipt = await printOrderReceiptOnce({
      orderNumber: vend.orderNumber,
      createdAt: vend.createdAt,
      fulfillment: vend.fulfillment,
      paymentMethod: vend.method,
      paymentReference: vend.paymentReference,
      language: vend.language,
      total: vend.total,
      lines: vend.cart,
      marks: vendReceiptMarks(vend.cart, jobs),
    });
    setReceiptStatus(receipt.status);
    clearPendingVend();
    recordReceiptStatus(vend.orderNumber, receipt).catch((receiptError) => {
      console.warn('Fiş durumu API tarafına kaydedilemedi.', receiptError);
    });
  }, [vend]);

  useEffect(() => {
    if (finishedRef.current) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    let emptyResponses = 0;
    let notFound = 0;
    const started = Date.parse(vend.startedAt);
    const deadline = (Number.isFinite(started) ? started : Date.now()) + Math.max(1, machineCount) * VEND_JOB_LIMIT_MS + VEND_REFUND_LIMIT_MS;
    const tick = async () => {
      try {
        const next = await fetchOrderVend(vend.orderNumber);
        if (cancelled) return;
        notFound = 0;
        lastRef.current = next;
        setTracking(next);
        const jobs = next.jobs;
        emptyResponses = jobs.length ? 0 : emptyResponses + 1;
        // FAILED/EXPIRED "iade sürüyor" ara durumudur: ekran yalnız tüm işler SUCCESS/REFUNDED/REFUND_FAILED olunca
        // veya API siparişin vend sonucunu (vendStatus) bildirince biter.
        const allFinal = jobs.length > 0 && jobs.every((job) => VEND_FINAL.has(job.status));
        // İş oluşmadıysa (otomat pasif / eşleme yok) sipariş normal tamamlanmış sayılır.
        if (allFinal || (jobs.length > 0 && next.vendStatus) || emptyResponses >= 3) { void finish(next, false); return; }
        if (Date.now() >= deadline) { void finish(next, true); return; }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404 && ++notFound >= 3 && !lastRef.current?.jobs.length) { void finish(null, false); return; }
        if (Date.now() >= deadline) { void finish(lastRef.current, true); return; }
      }
      timer = window.setTimeout(() => { void tick(); }, VEND_POLL_MS);
    };
    void tick();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [finish, machineCount, vend]);

  useEffect(() => {
    if (finished) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [finished]);

  useEffect(() => {
    if (!finished || receiptStatus === 'printing') return undefined;
    const timeout = window.setTimeout(onRestart, VEND_RESTART_MS);
    return () => window.clearTimeout(timeout);
  }, [finished, onRestart, receiptStatus]);

  const jobs = tracking?.jobs ?? [];
  jobs.forEach((job) => { if (job.status === 'WAITING_SELECTION' && !waitingSinceRef.current.has(job.id)) waitingSinceRef.current.set(job.id, Date.now()); });
  const lineOf = vendLineOf(vend.cart, jobs);
  const amountOf = (job: VendJob) => job.amount ?? lineOf.get(job.id)?.unitPrice ?? 0;
  const waiting = jobs.find((job) => job.status === 'WAITING_SELECTION');
  /** "Latte · Büyük · Yulaf sütü": API varyant adı, yoksa sepet satırındaki seçimler. */
  const jobName = (job: VendJob) => {
    const line = lineOf.get(job.id);
    const name = job.productName || line?.product.name || '-';
    const variantName = job.variantLabel ?? (line ? selectionLabel(line.product, line.selection) : '');
    return variantName ? `${name} · ${variantName}` : name;
  };
  const waitingName = waiting ? jobName(waiting) : '';
  const secondsLeft = waiting ? Math.max(0, VEND_CREDIT_WAIT_S - Math.floor((now - (waitingSinceRef.current.get(waiting.id) ?? now)) / 1000)) : 0;
  const doneCount = jobs.filter((job) => VEND_FINAL.has(job.status)).length;
  /** İade POS'ta kart okutmayı bekliyor (CasPro Refund / Pavo kısmi iade). */
  const cardRefunds = jobs.filter((job) => job.refund?.needsCard && !VEND_FINAL.has(job.status));
  const cardRefundAmount = cardRefunds.reduce((sum, job) => sum + (job.refund?.amount ?? amountOf(job)), 0);
  const allSucceeded = jobs.length > 0 && jobs.every((job) => job.status === 'SUCCESS');
  const anyFailed = jobs.some((job) => job.status !== 'SUCCESS' && !VEND_ACTIVE.has(job.status));
  const offline = tracking && !tracking.machineOnline && jobs.some((job) => VEND_ACTIVE.has(job.status));
  const happy = allSucceeded || (!jobs.length && !timedOut);
  const title = !finished ? t('vend.title') : timedOut ? t('vend.titleUnknown') : happy ? t('vend.titleDone') : anyFailed && jobs.some((job) => job.status === 'SUCCESS') ? t('vend.titlePartial') : t('vend.titleFailed');
  const jobText = (job: VendJob) => {
    const amount = money(amountOf(job));
    switch (job.status) {
      case 'QUEUED': return t('vend.queued');
      case 'SENT':
      case 'DISPENSING': return t('vend.preparing');
      case 'WAITING_SELECTION': return job.wrongSelection ? t('vend.wrongSelection', { selection: job.selectionNo ?? '-' }) : t('vend.pressShort', { selection: job.selectionNo ?? '-' });
      case 'SUCCESS': return t('vend.ready');
      case 'FAILED':
      case 'EXPIRED': return job.refund?.needsCard ? t('vend.refundingCard', { amount }) : t('vend.refunding', { amount });
      case 'REFUNDED': return t('vend.refunded', { amount });
      case 'REFUND_FAILED': return t('vend.refundFailed');
      default: return '';
    }
  };
  const jobTone = (job: VendJob) => job.status === 'SUCCESS' ? 'ok' : job.status === 'REFUND_FAILED' ? 'alert' : VEND_ACTIVE.has(job.status) ? (job.status === 'QUEUED' ? 'queued' : 'active') : 'refund';
  const jobIcon = (job: VendJob) => job.status === 'SUCCESS' ? <CheckCircle2 /> : job.status === 'REFUND_FAILED' ? <AlertTriangle /> : job.status === 'WAITING_SELECTION' ? <Hand /> : VEND_ACTIVE.has(job.status) ? (job.status === 'QUEUED' ? <Coffee /> : <RotateCcw className="spin" />) : <Undo2 />;

  return <main className={`vend page-enter ${finished ? 'vend--finished' : ''}`} aria-live="polite">
    <BrandMark />
    <span className={`vend__hero ${finished ? (happy ? 'vend__hero--ok' : 'vend__hero--warn') : ''}`}>{finished ? (happy ? <CheckCircle2 /> : <AlertTriangle />) : <Coffee />}</span>
    <h1>{title}</h1>
    {!finished && waiting && tracking?.mode !== 'REMOTE' && <section className="vend__press" role="alert">
      <p>{t('vend.pressLead')}</p>
      <b>{waiting.selectionNo ?? '-'}</b>
      <p>{t('vend.pressTail')}</p>
      {waitingName && <p className="vend__press-item">{waitingName}</p>}
      {waiting.wrongSelection && <p className="vend__press-wrong">{t('vend.wrongSelection', { selection: waiting.selectionNo ?? '-' })}</p>}
      <small>{t('vend.countdown', { seconds: secondsLeft })}</small>
    </section>}
    {!finished && cardRefunds.length > 0 && <section className="vend__press vend__press--refund" role="alert">
      <CreditCard className="vend__press-icon" />
      <p>{t('vend.refundCardTitle')}</p>
      <b className="vend__press-amount">{money(cardRefundAmount)}</b>
      <p className="vend__press-item">{t('vend.refundCardHint')}</p>
    </section>}
    {!finished && !waiting && cardRefunds.length === 0 && jobs.length > 0 && !jobs.some((job) => VEND_ACTIVE.has(job.status)) && jobs.some((job) => VEND_REFUND_PENDING.has(job.status)) && <p className="vend__status"><RotateCcw className="spin" /> {t('vend.refundInProgress')}</p>}
    {!finished && !waiting && (!tracking || jobs.length === 0 || jobs.some((job) => VEND_ACTIVE.has(job.status))) && <p className="vend__status"><RotateCcw className="spin" /> {tracking ? t('vend.machinePreparing') : t('vend.connecting')}</p>}
    {offline && <p className="vend__note"><AlertTriangle /> {t('vend.machineOffline')}</p>}
    {timedOut && <p className="vend__note vend__note--alert"><AlertTriangle /> {t('vend.unknown')}</p>}
    {jobs.length > 0 && <>
      {!finished && <small className="vend__progress">{t('vend.progress', { done: doneCount, total: jobs.length })}</small>}
      <ol className="vend__jobs">{jobs.map((job) => <li key={job.id} className={`vend-job vend-job--${jobTone(job)}`}>
        <span className="vend-job__icon">{jobIcon(job)}</span>
        <span className="vend-job__copy"><b>{jobName(job)}</b><small>{jobText(job)}</small></span>
        {job.selectionNo != null && <em>#{job.selectionNo}</em>}
      </li>)}</ol>
    </>}
    <div className="vend__order"><small>{t('success.number')}</small><b>{vend.orderNumber}</b></div>
    {finished && receiptStatus === 'printing' && <p className="vend__receipt">{t('payment.printingReceipt')}</p>}
    {finished && receiptStatus === 'printed' && <p className="vend__receipt">{t('success.receiptPrinted')}</p>}
    {finished && receiptStatus === 'failed' && <p className="vend__receipt vend__receipt--error">{t('success.receiptFailed')}</p>}
    {finished && receiptStatus !== 'printing' && <button className="primary-button" onClick={onRestart}><RotateCcw /> {t('success.newOrder')}</button>}
  </main>;
}

export default function App() {
  const { language, setLanguage, t } = useKioskLanguage();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [fulfillment, setFulfillment] = useState<Fulfillment>('restaurant');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customizing, setCustomizing] = useState<Product | null>(null);
  const [editing, setEditing] = useState<CartLine | null>(null);
  const [cartOpen, setCartOpen] = useState<'full' | 'sheet' | null>(null);
  const [orderNumber, setOrderNumber] = useState('');
  const [receiptStatus, setReceiptStatus] = useState<ReceiptPrintStatus | 'printing'>('printing');
  const [notice, setNotice] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [startPending, setStartPending] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  // Yarım kalmış (24 saatten yeni) otomat siparişi varsa izleme ve fiş kaldığı yerden sürdürülür.
  const [vend, setVend] = useState<PendingVend | null>(() => {
    const pending = readPendingVend();
    if (pending && pendingVendFresh(pending)) return pending;
    if (pending) clearPendingVend();
    return null;
  });
  const [screen, setScreen] = useState<Screen>(() => (vend ? 'vend' : 'intro'));
  const catalogRequestRef = useRef(0);
  const kioskAudio = useKioskAudio(soundOn, language);
  const loadCatalog = useCallback(() => {
    const requestId = ++catalogRequestRef.current;
    const requestedLanguage = language;
    setCatalogError('');
    setCatalogLoading(true);
    fetchCatalog(requestedLanguage).then((nextCatalog) => {
      if (requestId !== catalogRequestRef.current || nextCatalog.language !== requestedLanguage) return;
      setCatalog(nextCatalog);
      setCart((items) => items.map((line) => {
        const product = nextCatalog.products.find((candidate) => candidate.id === line.product.id);
        return product ? { ...line, product } : line;
      }));
      preloadCatalogImages(nextCatalog);
    }).catch((error: Error) => {
      if (requestId !== catalogRequestRef.current) return;
      setCatalogError(error.message);
      setStartPending(false);
    }).finally(() => {
      if (requestId === catalogRequestRef.current) setCatalogLoading(false);
    });
  }, [language]);
  useEffect(loadCatalog, [loadCatalog]);
  useEffect(() => {
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') loadCatalog();
    };
    document.addEventListener('visibilitychange', refreshOnVisible);
    return () => {
      document.removeEventListener('visibilitychange', refreshOnVisible);
    };
  }, [loadCatalog]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    prepareOrderPrinter();
  }, []);
  useEffect(() => {
    if (startPending && catalog) {
      setStartPending(false);
      kioskAudio.play('welcome.mp3');
      setScreen('order-type');
    }
  }, [catalog, kioskAudio, startPending]);
  const startOrder = () => {
    if (catalog) {
      kioskAudio.play('welcome.mp3');
      setScreen('order-type');
      return;
    }
    if (catalogError || catalogLoading) loadCatalog();
    setNotice(t('notice.menuWaiting'));
    setStartPending(true);
    if (!catalogLoading) loadCatalog();
  };
  const addProduct = (product: Product) => {
    if (product.available === false) return;
    if (product.stockTrackingEnabled && product.stockQuantity != null && productCartQuantity(cart, product.id) >= product.stockQuantity) {
      setNotice(t('notice.outOfStock', { name: product.name }));
      return;
    }
    if (product.customizable && hasActiveCustomization(product)) { setEditing(null); setCustomizing(product); return; }
    // Otomat kioskunda seçeneksiz ürünün fiyatı standart varyanttan gelir.
    const unitPrice = Number(matchVariant(product, null)?.price ?? product.price);
    const key = cartLineKey(product);
    const nextQuantity = productCartQuantity(cart, product.id) + 1;
    setCart((items) => items.some((line) => line.key === key) ? items.map((line) => line.key === key ? { ...line, quantity: line.quantity + 1 } : line) : [...items, { key, product, quantity: 1, unitPrice }]);
    const nextNotice = addToCartNotice(product, nextQuantity, t);
    if (nextNotice) setNotice(nextNotice);
  };
  const saveCustomized = (selection: Selection, unitPrice: number) => {
    if (!customizing) return;
    if (!editing && customizing.stockTrackingEnabled && customizing.stockQuantity != null && productCartQuantity(cart, customizing.id) >= customizing.stockQuantity) {
      setNotice(t('notice.outOfStock', { name: customizing.name }));
      setCustomizing(null);
      return;
    }
    const key = cartLineKey(customizing, selection);
    const nextQuantity = editing ? productCartQuantity(cart, customizing.id) : productCartQuantity(cart, customizing.id) + 1;
    setCart((items) => {
      if (!editing) {
        return items.some((line) => line.key === key) ? items.map((line) => line.key === key ? { ...line, quantity: line.quantity + 1, unitPrice } : line) : [...items, { key, product: customizing, quantity: 1, unitPrice, selection }];
      }
      const withoutEdited = items.filter((item) => item.key !== editing.key);
      return withoutEdited.some((line) => line.key === key)
        ? withoutEdited.map((line) => line.key === key ? { ...line, quantity: line.quantity + editing.quantity, unitPrice } : line)
        : [...withoutEdited, { key, product: customizing, quantity: editing.quantity, unitPrice, selection }];
    });
    const nextNotice = addToCartNotice(customizing, nextQuantity, t);
    if (nextNotice) setNotice(nextNotice);
    setCustomizing(null);
    setEditing(null);
  };
  const updateQuantity = (key: string, delta: number) => setCart((items) => {
    const target = items.find((line) => line.key === key);
    if (!target) return items;
    if (delta > 0 && target.product.stockTrackingEnabled && target.product.stockQuantity != null && productCartQuantity(items, target.product.id) >= target.product.stockQuantity) {
      setNotice(t('notice.outOfStock', { name: target.product.name }));
      return items;
    }
    const nextItems = items.map((line) => line.key === key ? { ...line, quantity: line.quantity + delta } : line).filter((line) => line.quantity > 0);
    if (delta > 0) {
      const nextNotice = addToCartNotice(target.product, productCartQuantity(nextItems, target.product.id), t);
      if (nextNotice) setNotice(nextNotice);
    }
    return nextItems;
  });
  const restart = useCallback(() => {
    kioskAudio.stop();
    setVend(null);
    setCart([]);
    setOrderNumber('');
    setReceiptStatus('printing');
    setCartOpen(null);
    setNotice('');
    setLanguage('tr');
    setScreen('intro');
  }, [kioskAudio, setLanguage]);
  useEffect(() => {
    if (screen !== 'success' || !orderNumber) return;
    const timeout = window.setTimeout(restart, 10000);
    return () => window.clearTimeout(timeout);
  }, [orderNumber, restart, screen]);
  const vendEnabled = Boolean(catalog?.products.some(isMachineProduct));
  return <div className="app-shell kiosk-no-focus-ring">
    {screen === 'intro' && <Intro onStart={startOrder} loading={catalogLoading} />}
    {screen === 'order-type' && <OrderType soundOn={soundOn} onToggleSound={() => setSoundOn((value) => !value)} onContinue={(type) => { kioskAudio.stop(); kioskAudio.play('product-selection-prompt.mp3'); setFulfillment(type); setScreen('catalog'); }} />}
    {notice && <div className="stock-toast">{notice}</div>}
    {customizing && <Customizer product={customizing} initial={editing?.selection} onClose={() => { setCustomizing(null); setEditing(null); }} onSave={saveCustomized} />}
    {!customizing && cartOpen !== 'full' && screen === 'catalog' && catalog && <CatalogScreen catalog={catalog} cart={cart} onProduct={addProduct} onHeaderCart={() => setCartOpen('full')} onBottomCart={() => setCartOpen('sheet')} />}
    {!customizing && cartOpen === 'full' && <CartDrawer cart={cart} onClose={() => setCartOpen(null)} onQuantity={updateQuantity} onDelete={(key) => setCart((items) => items.filter((line) => line.key !== key))} onEdit={(line) => { setEditing(line); setCustomizing(line.product); setCartOpen(null); }} onCheckout={() => { kioskAudio.play('payment-method-selection.mp3'); setCartOpen(null); setScreen('payment'); }} />}
    {!customizing && cartOpen === 'sheet' && <div className="cart-sheet-layer"><button type="button" className="cart-sheet-backdrop" onClick={() => setCartOpen(null)} aria-label={t('common.close')} /><CartDrawer cart={cart} onClose={() => setCartOpen(null)} onQuantity={updateQuantity} onDelete={(key) => setCart((items) => items.filter((line) => line.key !== key))} onEdit={(line) => { setEditing(line); setCustomizing(line.product); setCartOpen(null); }} onCheckout={() => { kioskAudio.play('payment-method-selection.mp3'); setCartOpen(null); setScreen('payment'); }} /></div>}
    {!customizing && !cartOpen && screen === 'payment' && <Payment cart={cart} fulfillment={fulfillment} vendEnabled={vendEnabled} onBack={() => { kioskAudio.stop(); setScreen('catalog'); setCartOpen('full'); }} onBeginPayment={() => kioskAudio.play('card-reader-prompt.mp3')} onPaymentFailed={() => kioskAudio.playSequence(['payment-failed-notice.mp3', 'payment-failed-prompt.mp3'])} onSuccess={(number) => { kioskAudio.playSequence(['order-complete-success.mp3', 'order-created.mp3']); setOrderNumber(number); setReceiptStatus('printing'); setCart([]); setScreen('success'); }} onVendStart={(next) => { kioskAudio.play('order-complete-success.mp3'); setVend(next); setCart([]); setScreen('vend'); }} onReceiptStatus={setReceiptStatus} />}
    {!customizing && !cartOpen && screen === 'vend' && vend && <VendScreen key={vend.orderNumber} vend={vend} onFinished={(allSucceeded) => { if (allSucceeded) kioskAudio.play('order-created.mp3'); }} onRestart={restart} />}
    {!customizing && !cartOpen && screen === 'success' && <Success orderNumber={orderNumber} receiptStatus={receiptStatus} onRestart={restart} />}
    {catalogError && !catalog && screen !== 'vend' && <div className="load-error"><BrandMark /><h2>{t('loading.catalogError')}</h2><p>{t('loading.catalogErrorHint')}</p><button className="primary-button" onClick={loadCatalog}>{t('common.retry')}</button></div>}
    {screen !== 'intro' && screen !== 'vend' && !catalog && !catalogError && <div className="loading"><BrandMark light /><span /><p>{t('loading.catalog')}</p></div>}
  </div>;
}
