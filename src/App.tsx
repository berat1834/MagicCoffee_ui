import { ArrowLeft, ArrowRight, Check, CheckCircle2, Coffee, CreditCard, Languages, Minus, Package, Plus, RotateCcw, ShoppingBag, Trash2, UtensilsCrossed, Volume2, VolumeX, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { assetUrl, fetchCatalog, pollPosPayment, recordReceiptStatus, startPosPayment, submitOrder, uniqueRequestId, type PosPaymentStatus } from './api';
import { customizationOptionLabel, customizationStepLabel } from './i18n/catalogLocalization';
import { SUPPORTED_LANGUAGES, useKioskLanguage, type KioskLanguage } from './i18n/KioskLanguage';
import { prepareOrderPrinter, printOrderReceiptOnce, type ReceiptPrintStatus } from './printing/orderReceiptPrinter';
import type { CartLine, Catalog, CustomizationStep, Fulfillment, Product, Screen, Selection } from './types';

const money = (amount: number) => `${amount.toFixed(2)} TL`;
const AUDIO_BASE = '/audio/kiosk/';

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

function usePress(action: () => void) {
  const lastPress = useRef(0);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const readTouch = (event: { changedTouches: { item: (index: number) => { clientX: number; clientY: number } | null } }) => {
    const touch = event.changedTouches.item(0);
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const run = () => {
    const now = Date.now();
    if (now - lastPress.current < 300) return;
    lastPress.current = now;
    action();
  };
  return {
    onPointerDown: (event: { clientX: number; clientY: number }) => {
      startPoint.current = { x: event.clientX, y: event.clientY };
    },
    onPointerUp: (event: { clientX: number; clientY: number; preventDefault: () => void }) => {
      const start = startPoint.current;
      startPoint.current = null;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) return;
      event.preventDefault();
      run();
    },
    onTouchStart: (event: { changedTouches: { item: (index: number) => { clientX: number; clientY: number } | null } }) => {
      startPoint.current = readTouch(event);
    },
    onTouchEnd: (event: { changedTouches: { item: (index: number) => { clientX: number; clientY: number } | null }; preventDefault: () => void }) => {
      const end = readTouch(event);
      const start = startPoint.current;
      startPoint.current = null;
      if (start && end && Math.hypot(end.x - start.x, end.y - start.y) > 12) return;
      event.preventDefault();
      run();
    },
    onClick: () => {
      run();
    },
  };
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

function Intro({ onStart, loading }: { onStart: () => void; loading: boolean }) {
  const { t } = useKioskLanguage();
  const press = usePress(onStart);
  return <button type="button" className="intro" {...press} aria-label={t('intro.startAria')}>
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
      <button className="utility-button" onClick={() => setLanguagePickerOpen((open) => !open)} aria-haspopup="menu" aria-expanded={languagePickerOpen} aria-label={t('language.choose')}><span><Languages /></span><small>{t('language.title')}</small><b>{t('language.current')}</b></button>
      {languagePickerOpen && <><button type="button" className="language-picker__dismiss" onClick={() => setLanguagePickerOpen(false)} aria-label={t('common.close')} /><section className="language-picker" role="menu" aria-label={t('language.choose')}><div className="language-picker__options">{SUPPORTED_LANGUAGES.map((option) => { const selected = option === language; return <button type="button" role="menuitemradio" aria-checked={selected} key={option} className={selected ? 'selected' : ''} onClick={() => { setLanguage(option); setLanguagePickerOpen(false); }}><small>{option.toUpperCase()}</small><b>{option === 'tr' ? t('language.turkish') : t('language.english')}</b>{selected && <i><Check /></i>}</button>; })}</div></section></>}
      <button className="utility-button" onClick={onToggleSound}><span className={soundOn ? 'green' : 'red'}>{soundOn ? <Volume2 /> : <VolumeX />}</span><small>{t('audio.title')}</small><b>{soundOn ? t('audio.on') : t('audio.off')}</b></button>
    </div>
    <section className="order-type__content">
      <h1>{t('orderType.title')}</h1><p>{t('orderType.subtitle')}</p>
      <div className="order-type__grid">
        <button onClick={() => onContinue('restaurant')}><span><UtensilsCrossed /></span><b>{t('orderType.restaurant')}</b><small>{t('orderType.restaurantHint')}</small></button>
        <button onClick={() => onContinue('package')}><span><Package /></span><b>{t('orderType.package')}</b><small>{t('orderType.packageHint')}</small></button>
      </div>
    </section>
  </main>;
}

function ProductCard({ product, quantity, onClick }: { product: Product; quantity: number; onClick: () => void }) {
  const { t } = useKioskLanguage();
  const disabled = product.available === false;
  return <button type="button" className={`product-card ${disabled ? 'product-card--disabled' : ''}`} data-product-id={product.id} data-clickable="product" disabled={disabled}>
    {product.popular && <span className="product-card__popular">{t('product.popular')}</span>}{quantity > 0 && <span className="product-card__quantity">{quantity}</span>}
    <div className={`product-card__visual ${product.image ? '' : 'product-card__visual--emoji'}`}>{product.image ? <img src={assetUrl(product.image)} alt={product.name} draggable={false} loading="eager" decoding="async" fetchPriority="high" /> : <span>{product.emoji || '☕'}</span>}</div>
    <div className="product-card__body"><small>{disabled ? product.unavailableReason : product.categoryId}</small><h3>{product.name}</h3><p>{product.description}</p><b>{money(product.price)}</b></div>
  </button>;
}

function CatalogScreen({ catalog, cart, onProduct, onCart }: { catalog: Catalog; cart: CartLine[]; onProduct: (product: Product) => void; onCart: () => void }) {
  const { t } = useKioskLanguage();
  const [activeCategory, setActiveCategory] = useState('all');
  const categoriesRef = useRef<HTMLElement>(null);
  const productsRef = useRef<HTMLElement>(null);
  const lastPointerHandledRef = useRef(0);
  const visibleCategories = activeCategory === 'all' ? catalog.categories : catalog.categories.filter((item) => item.id === activeCategory);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const selectCategory = (categoryId: string) => { setActiveCategory(categoryId); productsRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); };
  const revealMoreCategories = () => {
    const categories = categoriesRef.current;
    if (!categories) return;
    const maxScroll = Math.max(0, categories.scrollWidth - categories.clientWidth);
    const reachedEnd = categories.scrollLeft >= maxScroll - 2;
    categories.scrollTo({
      left: reachedEnd ? 0 : Math.min(maxScroll, categories.scrollLeft + categories.clientWidth * 0.75),
      behavior: 'smooth',
    });
  };
  useEffect(() => {
    const handleNativePress = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const now = Date.now();
      if (event.type === 'click' && now - lastPointerHandledRef.current < 700) return;

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
  }, [catalog.products, onProduct]);
  return <main className="catalog page-enter">
    <header className="catalog__header"><BrandMark light compact /><button className="header-cart" data-clickable="cart" onClick={onCart}><span><ShoppingBag />{itemCount > 0 && <i>{itemCount}</i>}</span><span><b>{t('cart.myCart')}</b><small>{itemCount ? money(total) : t('cart.empty')}</small></span></button></header>
    <div className="category-menu"><div className="category-menu__label"><small>{t('catalog.menu')}</small><b>{t('catalog.chooseCategory')}</b></div><div className="categories-wrap"><nav ref={categoriesRef} className="categories" aria-label={t('catalog.categoriesAria')}><button className={activeCategory === 'all' ? 'active' : ''} onClick={() => selectCategory('all')}>{t('catalog.all')}</button>{catalog.categories.map((item) => <button key={item.id} className={item.id === activeCategory ? 'active' : ''} onClick={() => selectCategory(item.id)}>{item.name}</button>)}</nav><button type="button" className="categories-wrap__hint" onClick={revealMoreCategories} aria-label={t('catalog.moreCategories')}><ArrowRight /></button></div></div>
    <section ref={productsRef} className={`products ${activeCategory === 'all' ? 'products--all' : ''}`}>{visibleCategories.map((category) => {
      const categoryProducts = catalog.products.filter((product) => product.categoryId === category.id);
      return <section className="category-section" key={category.id}><div className="section-heading"><h1>{category.name}</h1><span /><small>{categoryProducts.length} {t(categoryProducts.length === 1 ? 'catalog.product' : 'catalog.products')}</small></div><div className="product-grid">{categoryProducts.map((product) => <ProductCard key={product.id} product={product} quantity={cart.filter((line) => line.product.id === product.id).reduce((sum, line) => sum + line.quantity, 0)} onClick={() => onProduct(product)} />)}</div></section>;
    })}</section>
    <button className={`cart-bar ${itemCount ? 'cart-bar--ready' : ''}`} data-clickable="cart" onClick={onCart}><span className="cart-bar__icon"><ShoppingBag />{itemCount > 0 && <i>{itemCount}</i>}</span>{itemCount ? <><b>{t('cart.go')}</b><strong>{money(total)}</strong></> : <span>{t('cart.placeholder')}</span>}</button>
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
  const [choices, setChoices] = useState<Record<string, string[]>>(() => normalizeChoices(initial?.choices ?? Object.fromEntries(steps.map(([id, step]) => [id, step.required ? [] : step.options.filter((option) => option.defaultSelected && option.enabled !== false && option.available !== false).map((option) => option.id)])), steps));
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const current = steps[index];
  const requiredSelectionsComplete = steps.every(([id, step]) => !step.required || (choices[id] ?? []).length >= (step.minSelect ?? 1));
  const unitPrice = useMemo(() => product.price + steps.reduce((sum, [id, step]) => sum + (choices[id] ?? []).reduce((optionSum, optionId) => optionSum + (step.options.find((option) => option.id === optionId)?.priceDelta ?? 0), 0), 0), [choices, product.price, steps]);
  const toggle = (stepId: string, optionId: string, max = 1) => setChoices((currentChoices) => {
    const selected = currentChoices[stepId] ?? [];
    if (selected.includes(optionId)) return { ...currentChoices, [stepId]: selected.filter((id) => id !== optionId) };
    return { ...currentChoices, [stepId]: max === 1 ? [optionId] : [...selected, optionId].slice(0, max) };
  });
  const next = () => {
    const [stepId, step] = current;
    if (step.required && (choices[stepId] ?? []).length < (step.minSelect ?? 1)) { setError(t('customizer.requiredError', { title: customizationStepLabel(language, stepId, step) })); return; }
    setError('');
    if (index < steps.length - 1) setIndex(index + 1); else onSave({ choices: normalizeChoices(choices, steps) }, unitPrice);
  };
  if (!current) return null;
  const [stepId, step] = current;
  return <main className="customizer page-enter" role="dialog" aria-modal="true">
    <header><button className="icon-button" onClick={onClose} aria-label={t('common.close')}><X /></button><div><small>{t('customizer.prepare')}</small><h2>{product.name}</h2></div><b>{money(unitPrice)}</b></header>
    <div className="customizer__hero">{product.image ? <img src={assetUrl(product.image)} alt="" draggable={false} loading="eager" decoding="async" fetchPriority="high" /> : <span className="customizer__emoji">{product.emoji || '☕'}</span>}<div><span>MAGIC COFFEE</span><b>{customizationStepLabel(language, stepId, step)}</b></div></div>
    <nav className="steps">{steps.map(([id, item], stepIndex) => <button key={id} className={stepIndex === index ? 'active' : ''} onClick={() => setIndex(stepIndex)}><i>{stepIndex + 1}</i>{customizationStepLabel(language, id, item)}</button>)}</nav>
    <div className="customizer__content"><div className="customizer__title"><span><small>{t('customizer.selection')}</small><h3>{customizationStepLabel(language, stepId, step)}</h3></span><p>{step.required ? t('customizer.required') : t('customizer.optional')}</p></div>
      <div className="option-list">{step.options.filter((option) => option.enabled !== false).map((option) => {
        const selected = (choices[stepId] ?? []).includes(option.id);
        return <button key={option.id} className={selected ? 'selected' : ''} disabled={option.available === false} onClick={() => toggle(stepId, option.id, maxSelections(stepId, step))}><span>{selected && <Check />}</span><b>{customizationOptionLabel(language, stepId, option)}</b><small>{option.priceDelta ? `+${money(option.priceDelta)}` : option.available === false ? t('product.soldOut') : t('product.included')}</small></button>;
      })}</div>{error && <div className="payment__error">{error}</div>}</div>
    <footer><button className="secondary-button" onClick={onClose}>{t('common.cancel')}</button><button className="primary-button" disabled={index === steps.length - 1 && !requiredSelectionsComplete} onClick={next}>{index === steps.length - 1 ? t('common.addToCart') : <>{t('common.continue')} <ArrowRight /></>}</button></footer>
  </main>;
}

function CartDrawer({ cart, onClose, onQuantity, onDelete, onEdit, onCheckout }: { cart: CartLine[]; onClose: () => void; onQuantity: (key: string, delta: number) => void; onDelete: (key: string) => void; onEdit: (line: CartLine) => void; onCheckout: () => void }) {
  const { t } = useKioskLanguage();
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  return <main className="cart-drawer page-enter">
    <header><span><ShoppingBag /></span><div><h2>{t('cart.myCart')}</h2><small>{t('cart.lineCount', { count: cart.length })}</small></div><button className="icon-button" onClick={onClose} aria-label={t('common.close')}><X /></button></header>
    <div className="cart-drawer__items">{!cart.length && <div className="empty-cart"><ShoppingBag /><h3>{t('cart.emptyLong')}</h3><p>{t('cart.emptyHint')}</p></div>}{cart.map((line) => <article className="cart-line" key={line.key}><div className="cart-line__image">{line.product.image ? <img src={assetUrl(line.product.image)} alt="" draggable={false} loading="eager" decoding="async" fetchPriority="high" /> : <span>{line.product.emoji || '☕'}</span>}</div><div className="cart-line__main"><small>MAGIC COFFEE</small><h3>{line.product.name}</h3><p>{Object.values(line.selection?.choices ?? {}).flat().length ? t('cart.customized') : t('cart.standard')}</p><div><button onClick={() => onQuantity(line.key, -1)}><Minus /></button><b>{line.quantity}</b><button className="plus" onClick={() => onQuantity(line.key, 1)}><Plus /></button>{hasActiveCustomization(line.product) && <button className="edit" onClick={() => onEdit(line)}>{t('cart.edit')}</button>}<button className="delete" onClick={() => onDelete(line.key)}><Trash2 /> {t('cart.delete')}</button></div></div><strong>{money(line.unitPrice * line.quantity)}</strong></article>)}</div>
    <footer><div><small>{t('cart.total')}</small><b>{money(total)}</b><span>{cart.reduce((sum, line) => sum + line.quantity, 0)} {t('cart.items')}</span></div><button className="primary-button" disabled={!cart.length} onClick={onCheckout}>{t('cart.checkout')}</button></footer>
  </main>;
}

const POS_SUCCESS = new Set<PosPaymentStatus>(['COMPLETED', 'PAID', 'SUCCESS', 'SUCCEEDED']);
const POS_FAILURE = new Set<PosPaymentStatus>(['FAILED', 'ERROR', 'CANCELLED', 'CANCELED', 'DECLINED']);
const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function Payment({ cart, fulfillment, onBack, onEdit, onBeginPayment, onPaymentFailed, onSuccess, onReceiptStatus }: { cart: CartLine[]; fulfillment: Fulfillment; onBack: () => void; onEdit: (line: CartLine) => void; onBeginPayment: () => void; onPaymentFailed: () => void; onSuccess: (orderNumber: string) => void; onReceiptStatus: (status: ReceiptPrintStatus) => void }) {
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

  const checkUntilComplete = async (initial: Awaited<ReturnType<typeof startPosPayment>>) => {
    let result = initial;
    let temporaryErrors = 0;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (POS_SUCCESS.has(result.status) || POS_FAILURE.has(result.status)) return result;
      await wait(2000);
      try {
        result = await pollPosPayment(transactionRef.current);
        temporaryErrors = 0;
      } catch (pollError) {
        temporaryErrors += 1;
        if (temporaryErrors >= 5) throw pollError;
      }
    }
    throw new Error(t('payment.posTimeout'));
  };

  const complete = async (selectedMethod: 'card' | 'meal-card') => {
    if (processingRef.current) return;
    processingRef.current = true;
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
        ? await pollPosPayment(transactionRef.current)
        : await startPosPayment({ clientRequestId: paymentRequestIdRef.current, paymentMethod: selectedMethod, amount: total, lines: cart });
      transactionRef.current = started.id || started.externalId || transactionRef.current;
      paymentReferenceRef.current = started.paymentReference || started.externalId || paymentReferenceRef.current;
      if (!transactionRef.current || !paymentReferenceRef.current) throw new Error(t('payment.posMissingTransaction'));
      setPhase('waiting');
      const result = await checkUntilComplete(started);
      if (POS_FAILURE.has(result.status)) {
        transactionRef.current = '';
        paymentReferenceRef.current = '';
        paymentRequestIdRef.current = '';
        throw new Error(result.message || t('payment.posFailed'));
      }
      paidResultRef.current = result.status;
      await finishPaidOrder(selectedMethod);
    } catch (err) {
      if (!transactionRef.current && !paidResultRef.current) paymentRequestIdRef.current = '';
      setError(err instanceof Error ? err.message : t('payment.genericError'));
      setPhase('error');
      onPaymentFailed();
    } finally {
      processingRef.current = false;
    }
  };

  const busy = phase === 'starting' || phase === 'waiting' || phase === 'saving';
  const statusText = phase === 'starting' ? t('payment.sendingToPos') : phase === 'waiting' ? t('payment.waitingForCard') : phase === 'saving' ? t('payment.savingOrder') : '';
  return <main className="payment page-enter"><section className="payment__methods"><header><button className="icon-button" onClick={onBack} disabled={busy || Boolean(paidResultRef.current)} aria-label={t('common.back')}><ArrowLeft /></button><div><h1>{t('payment.title')}</h1><p>{t('payment.hint')}</p></div></header><div className="payment-options"><button className={method === 'card' ? 'selected' : ''} disabled={busy} onClick={() => complete('card')}><span><CreditCard /></span><b>{t('payment.card')}</b><small>{t('payment.cardHint')}</small></button><button className={method === 'meal-card' ? 'selected' : ''} disabled={busy} onClick={() => complete('meal-card')}><span className="dark"><UtensilsCrossed /></span><b>{t('payment.mealCard')}</b><small>{t('payment.mealCardHint')}</small></button></div>{statusText && <div className="payment__status" role="status" aria-live="polite"><span className="spin" />{statusText}</div>}{error && <div className="payment__error">{error}<button onClick={() => method && complete(method)}>{t('payment.retryPos')}</button></div>}</section><aside className="payment__summary"><div className="amount"><small>{t('payment.amount')}</small><b>{money(total)}</b></div><div className="summary-card"><header><b>{t('payment.summary')}</b><span>{itemCount} {t(itemCount === 1 ? 'cart.item' : 'cart.items')}</span></header><div className="summary-card__lines">{cart.map((line) => <article className="summary-line" key={line.key}><div className="summary-line__image">{line.product.image ? <img src={assetUrl(line.product.image)} alt="" loading="eager" decoding="async" fetchPriority="high" /> : <span>{line.product.emoji || '☕'}</span>}</div><span><b>{line.product.name}</b><small>{line.quantity} {t('cart.quantityUnit')}</small>{hasActiveCustomization(line.product) && <button className="summary-line__edit" disabled={busy} onClick={() => onEdit(line)}>{t('cart.edit')}</button>}</span><strong>{money(line.unitPrice * line.quantity)}</strong></article>)}</div><div className="summary-total"><span>{t('payment.total')}</span><b>{money(total)}</b></div><p className="order-type-mini"><UtensilsCrossed /> {fulfillment === 'restaurant' ? t('orderType.restaurant') : t('orderType.package')}</p><button className="primary-button" disabled={busy || !method} onClick={() => method && complete(method)}>{busy ? statusText : method ? t('payment.retryPos') : t('payment.hint')} <ArrowRight /></button></div></aside></main>;
}

function Success({ orderNumber, receiptStatus, onRestart }: { orderNumber: string; receiptStatus: ReceiptPrintStatus | 'printing'; onRestart: () => void }) {
  const { t } = useKioskLanguage();
  return <main className="success page-enter"><BrandMark /><span className="success__check"><CheckCircle2 /></span><p>{t('success.received')}</p><h1>{t('success.thanks')}</h1><h2>{t('success.preparing')}</h2><div><small>{t('success.number')}</small><b>{orderNumber}</b></div>{receiptStatus === 'printing' && <p className="success__receipt">{t('payment.printingReceipt')}</p>}{receiptStatus === 'printed' && <p className="success__receipt">{t('success.receiptPrinted')}</p>}{receiptStatus === 'failed' && <p className="success__receipt success__receipt--error">{t('success.receiptFailed')}</p>}<button className="primary-button" onClick={onRestart}><RotateCcw /> {t('success.newOrder')}</button></main>;
}

export default function App() {
  const { language, setLanguage, t } = useKioskLanguage();
  const [screen, setScreen] = useState<Screen>('intro');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [fulfillment, setFulfillment] = useState<Fulfillment>('restaurant');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customizing, setCustomizing] = useState<Product | null>(null);
  const [editing, setEditing] = useState<CartLine | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');
  const [receiptStatus, setReceiptStatus] = useState<ReceiptPrintStatus | 'printing'>('printing');
  const [notice, setNotice] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [startPending, setStartPending] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
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
    const interval = window.setInterval(loadCatalog, 30000);
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') loadCatalog();
    };
    document.addEventListener('visibilitychange', refreshOnVisible);
    return () => {
      window.clearInterval(interval);
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
    const key = cartLineKey(product);
    const nextQuantity = productCartQuantity(cart, product.id) + 1;
    setCart((items) => items.some((line) => line.key === key) ? items.map((line) => line.key === key ? { ...line, quantity: line.quantity + 1 } : line) : [...items, { key, product, quantity: 1, unitPrice: product.price }]);
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
    setCart([]);
    setOrderNumber('');
    setReceiptStatus('printing');
    setCartOpen(false);
    setNotice('');
    setLanguage('tr');
    setScreen('intro');
  }, [kioskAudio, setLanguage]);
  useEffect(() => {
    if (screen !== 'success' || !orderNumber) return;
    const timeout = window.setTimeout(restart, 10000);
    return () => window.clearTimeout(timeout);
  }, [orderNumber, restart, screen]);
  return <div className="app-shell kiosk-no-focus-ring">
    {screen === 'intro' && <Intro onStart={startOrder} loading={catalogLoading} />}
    {screen === 'order-type' && <OrderType soundOn={soundOn} onToggleSound={() => setSoundOn((value) => !value)} onContinue={(type) => { kioskAudio.stop(); kioskAudio.play('product-selection-prompt.mp3'); setFulfillment(type); setScreen('catalog'); }} />}
    {notice && <div className="stock-toast">{notice}</div>}
    {customizing && <Customizer product={customizing} initial={editing?.selection} onClose={() => { setCustomizing(null); setEditing(null); }} onSave={saveCustomized} />}
    {!customizing && cartOpen && <CartDrawer cart={cart} onClose={() => setCartOpen(false)} onQuantity={updateQuantity} onDelete={(key) => setCart((items) => items.filter((line) => line.key !== key))} onEdit={(line) => { setEditing(line); setCustomizing(line.product); setCartOpen(false); }} onCheckout={() => { kioskAudio.play('payment-method-selection.mp3'); setCartOpen(false); setScreen('payment'); }} />}
    {!customizing && !cartOpen && screen === 'catalog' && catalog && <CatalogScreen catalog={catalog} cart={cart} onProduct={addProduct} onCart={() => setCartOpen(true)} />}
    {!customizing && !cartOpen && screen === 'payment' && <Payment cart={cart} fulfillment={fulfillment} onBack={() => setScreen('catalog')} onEdit={(line) => { setEditing(line); setCustomizing(line.product); }} onBeginPayment={() => kioskAudio.play('card-reader-prompt.mp3')} onPaymentFailed={() => kioskAudio.playSequence(['payment-failed-notice.mp3', 'payment-failed-prompt.mp3'])} onSuccess={(number) => { kioskAudio.playSequence(['order-complete-success.mp3', 'order-created.mp3']); setOrderNumber(number); setReceiptStatus('printing'); setCart([]); setScreen('success'); }} onReceiptStatus={setReceiptStatus} />}
    {!customizing && !cartOpen && screen === 'success' && <Success orderNumber={orderNumber} receiptStatus={receiptStatus} onRestart={restart} />}
    {catalogError && !catalog && <div className="load-error"><BrandMark /><h2>{t('loading.catalogError')}</h2><p>{t('loading.catalogErrorHint')}</p><button className="primary-button" onClick={loadCatalog}>{t('common.retry')}</button></div>}
    {screen !== 'intro' && !catalog && !catalogError && <div className="loading"><BrandMark light /><span /><p>{t('loading.catalog')}</p></div>}
  </div>;
}
