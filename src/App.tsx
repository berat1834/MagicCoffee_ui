import { ArrowLeft, ArrowRight, Check, CheckCircle2, Coffee, CreditCard, Languages, Minus, Plus, RotateCcw, ShoppingBag, Trash2, UtensilsCrossed, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { assetUrl, fetchCatalog, submitOrder } from './api';
import type { CartLine, Catalog, CustomizationStep, Fulfillment, Product, Screen, Selection } from './types';

const money = (amount: number) => `${amount.toFixed(2)} TL`;

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

function addToCartNotice(product: Product, nextCartQuantity: number) {
  if (!product.stockTrackingEnabled || product.stockQuantity == null) return null;
  const remaining = product.stockQuantity - nextCartQuantity;
  if (remaining <= 0) return `${product.name} sepete eklendi. Stokta kalmadı.`;
  if (remaining === 1) return `${product.name} sepete eklendi. Son 1 ürün kaldı.`;
  return null;
}

function BrandMark({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return <div className={`brand-mark ${light ? 'brand-mark--light' : ''} ${compact ? 'brand-mark--compact' : ''}`}>
    <span className="brand-mark__star"><Coffee /></span><span className="brand-mark__copy"><b>MAGIC</b><em>COFFEE</em></span>
  </div>;
}

function Intro({ onStart, loading }: { onStart: () => void; loading: boolean }) {
  const press = usePress(onStart);
  return <button type="button" className="intro" {...press} aria-label="Sipariş vermeye başla">
    <div className="intro__grain" />
    <header className="intro__header"><BrandMark light /></header>
    <img className="intro__burger intro__coffee-art" src="/images/products/cappuccino.png" alt="Magic Coffee Cappuccino" />
    <div className="intro__copy"><p>YENİ KAHVE MOLAN</p><h1>Kahveni<br /><i>Magic</i> hazırla</h1><span>Boyutunu, sütünü ve şurubunu seç.</span></div>
    <div className="intro__touch"><span>{loading ? 'Menu hazirlaniyor...' : 'Siparis vermek icin dokun'}</span><ArrowRight /></div>
  </button>;
}

function OrderType({ onContinue }: { onContinue: (type: Fulfillment) => void }) {
  const [soundOn, setSoundOn] = useState(true);
  return <main className="order-type page-enter">
    <div className="order-type__actions">
      <button className="utility-button"><span><Languages /></span><small>Dil seçimi</small><b>Türkçe</b></button>
      <button className="utility-button" onClick={() => setSoundOn((value) => !value)}><span className={soundOn ? 'green' : 'red'}>{soundOn ? <Volume2 /> : <VolumeX />}</span><small>Kiosk sesi</small><b>{soundOn ? 'Açık' : 'Kapalı'}</b></button>
    </div>
    <section className="order-type__content">
      <h1>Siparişinizi nasıl almak istersiniz?</h1><p>Kahvenizi mağazada içebilir veya paket alabilirsiniz.</p>
      <div className="order-type__grid">
        <button onClick={() => onContinue('restaurant')}><span><UtensilsCrossed /></span><b>Burada</b><small>Mağazada keyifle tüket</small></button>
        <button onClick={() => onContinue('package')}><span><ShoppingBag /></span><b>Paket</b><small>Yanında götür</small></button>
      </div>
    </section>
  </main>;
}

function ProductCard({ product, quantity, onClick }: { product: Product; quantity: number; onClick: () => void }) {
  const disabled = product.available === false;
  return <button type="button" className={`product-card ${disabled ? 'product-card--disabled' : ''}`} data-product-id={product.id} data-clickable="product" disabled={disabled}>
    {product.popular && <span className="product-card__popular">ÇOK SEVİLEN</span>}{quantity > 0 && <span className="product-card__quantity">{quantity}</span>}
    <div className={`product-card__visual ${product.image ? '' : 'product-card__visual--emoji'}`}>{product.image ? <img src={assetUrl(product.image)} alt={product.name} draggable={false} loading="eager" decoding="async" fetchPriority="high" /> : <span>{product.emoji || '☕'}</span>}</div>
    <div className="product-card__body"><small>{disabled ? product.unavailableReason : product.categoryId}</small><h3>{product.name}</h3><p>{product.description}</p><b>{money(product.price)}</b></div>
  </button>;
}

function CatalogScreen({ catalog, cart, onProduct, onCart }: { catalog: Catalog; cart: CartLine[]; onProduct: (product: Product) => void; onCart: () => void }) {
  const [activeCategory, setActiveCategory] = useState('all');
  const productsRef = useRef<HTMLElement>(null);
  const lastPointerHandledRef = useRef(0);
  const visibleCategories = activeCategory === 'all' ? catalog.categories : catalog.categories.filter((item) => item.id === activeCategory);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const selectCategory = (categoryId: string) => { setActiveCategory(categoryId); productsRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); };
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
    <header className="catalog__header"><BrandMark light compact /><button className="header-cart" data-clickable="cart" onClick={onCart}><span><ShoppingBag />{itemCount > 0 && <i>{itemCount}</i>}</span><span><b>Sepetim</b><small>{itemCount ? money(total) : 'Sepetiniz boş'}</small></span></button></header>
    <div className="category-menu"><div className="category-menu__label"><small>MENÜ</small><b>Kategorini seç</b></div><nav className="categories" aria-label="Ürün kategorileri"><button className={activeCategory === 'all' ? 'active' : ''} onClick={() => selectCategory('all')}>Tümü</button>{catalog.categories.map((item) => <button key={item.id} className={item.id === activeCategory ? 'active' : ''} onClick={() => selectCategory(item.id)}>{item.name}</button>)}</nav></div>
    <section ref={productsRef} className={`products ${activeCategory === 'all' ? 'products--all' : ''}`}>{visibleCategories.map((category) => {
      const categoryProducts = catalog.products.filter((product) => product.categoryId === category.id);
      return <section className="category-section" key={category.id}><div className="section-heading"><h1>{category.name}</h1><span /><small>{categoryProducts.length} ürün</small></div><div className="product-grid">{categoryProducts.map((product) => <ProductCard key={product.id} product={product} quantity={cart.filter((line) => line.product.id === product.id).reduce((sum, line) => sum + line.quantity, 0)} onClick={() => onProduct(product)} />)}</div></section>;
    })}</section>
    <button className={`cart-bar ${itemCount ? 'cart-bar--ready' : ''}`} data-clickable="cart" onClick={onCart}><span className="cart-bar__icon"><ShoppingBag />{itemCount > 0 && <i>{itemCount}</i>}</span>{itemCount ? <><b>Sepete Git</b><strong>{money(total)}</strong></> : <span>Seçtikleriniz burada görünecek</span>}</button>
  </main>;
}

function limitSteps(steps: [string, CustomizationStep][], maxSteps = 3) {
  if (steps.length <= maxSteps) return steps;
  const required = steps.filter(([, step]) => step.required);
  const optional = steps.filter(([, step]) => !step.required);
  return [...required, ...optional].slice(0, maxSteps);
}

function hasActiveCustomization(product: Product) {
  return Object.values(product.customization ?? {}).some((step) => step.enabled && step.options.some((option) => option.enabled !== false));
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
  const steps = limitSteps(Object.entries(product.customization ?? {}).filter(([, step]) => step.enabled && step.options.some((option) => option.enabled !== false)));
  const [choices, setChoices] = useState<Record<string, string[]>>(() => initial?.choices ?? Object.fromEntries(steps.map(([id, step]) => [id, step.required ? [] : step.options.filter((option) => option.defaultSelected && option.enabled !== false).map((option) => option.id)])));
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
    if (step.required && (choices[stepId] ?? []).length < (step.minSelect ?? 1)) { setError(`${step.title} seçimi zorunlu.`); return; }
    setError('');
    if (index < steps.length - 1) setIndex(index + 1); else onSave({ choices }, unitPrice);
  };
  if (!current) return null;
  const [stepId, step] = current;
  return <main className="customizer page-enter" role="dialog" aria-modal="true">
    <header><button className="icon-button" onClick={onClose}><X /></button><div><small>KAHVENİ HAZIRLA</small><h2>{product.name}</h2></div><b>{money(unitPrice)}</b></header>
    <div className="customizer__hero">{product.image ? <img src={assetUrl(product.image)} alt="" draggable={false} loading="eager" decoding="async" fetchPriority="high" /> : <span className="customizer__emoji">{product.emoji || '☕'}</span>}<div><span>MAGIC COFFEE</span><b>{step.title}</b></div></div>
    <nav className="steps">{steps.map(([id, item], stepIndex) => <button key={id} className={stepIndex === index ? 'active' : ''} onClick={() => setIndex(stepIndex)}><i>{stepIndex + 1}</i>{item.title}</button>)}</nav>
    <div className="customizer__content"><div className="customizer__title"><span><small>SEÇİM</small><h3>{step.title}</h3></span><p>{step.required ? 'Bu adım zorunludur.' : 'İstersen bu adımı boş bırakabilirsin.'}</p></div>
      <div className="option-list">{step.options.filter((option) => option.enabled !== false).map((option) => {
        const selected = (choices[stepId] ?? []).includes(option.id);
        return <button key={option.id} className={selected ? 'selected' : ''} disabled={option.available === false} onClick={() => toggle(stepId, option.id, step.maxSelect ?? 1)}><span>{selected && <Check />}</span><b>{option.name}</b><small>{option.priceDelta ? `+${money(option.priceDelta)}` : option.available === false ? 'Stokta yok' : 'Fiyata dahil'}</small></button>;
      })}</div>{error && <div className="payment__error">{error}</div>}</div>
    <footer><button className="secondary-button" onClick={onClose}>Vazgeç</button><button className="primary-button" disabled={index === steps.length - 1 && !requiredSelectionsComplete} onClick={next}>{index === steps.length - 1 ? 'Sepete Ekle' : 'Devam Et'} <ArrowRight /></button></footer>
  </main>;
}

function CartDrawer({ cart, onClose, onQuantity, onDelete, onEdit, onCheckout }: { cart: CartLine[]; onClose: () => void; onQuantity: (key: string, delta: number) => void; onDelete: (key: string) => void; onEdit: (line: CartLine) => void; onCheckout: () => void }) {
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  return <main className="cart-drawer page-enter">
    <header><span><ShoppingBag /></span><div><h2>Sepetim</h2><small>{cart.length} satır ürün</small></div><button className="icon-button" onClick={onClose}><X /></button></header>
    <div className="cart-drawer__items">{!cart.length && <div className="empty-cart"><ShoppingBag /><h3>Sepetiniz henüz boş</h3><p>Magic Coffee menüsünden bir ürün seçerek başlayın.</p></div>}{cart.map((line) => <article className="cart-line" key={line.key}><div className="cart-line__image">{line.product.image ? <img src={assetUrl(line.product.image)} alt="" draggable={false} loading="eager" decoding="async" fetchPriority="high" /> : <span>{line.product.emoji || '☕'}</span>}</div><div className="cart-line__main"><small>MAGIC COFFEE</small><h3>{line.product.name}</h3><p>{Object.values(line.selection?.choices ?? {}).flat().length ? 'Özelleştirildi' : 'Standart'}</p><div><button onClick={() => onQuantity(line.key, -1)}><Minus /></button><b>{line.quantity}</b><button className="plus" onClick={() => onQuantity(line.key, 1)}><Plus /></button>{hasActiveCustomization(line.product) && <button className="edit" onClick={() => onEdit(line)}>Düzenle</button>}<button className="delete" onClick={() => onDelete(line.key)}><Trash2 /> Sil</button></div></div><strong>{money(line.unitPrice * line.quantity)}</strong></article>)}</div>
    <footer><div><small>SİPARİŞ TOPLAMI</small><b>{money(total)}</b><span>{cart.reduce((sum, line) => sum + line.quantity, 0)} ürün</span></div><button className="primary-button" disabled={!cart.length} onClick={onCheckout}>Ödemeye Geç <ArrowRight /></button></footer>
  </main>;
}

function Payment({ cart, fulfillment, submitError, onBack, onEdit, onSubmitStart, onSubmitError, onSuccess }: { cart: CartLine[]; fulfillment: Fulfillment; submitError: string; onBack: () => void; onEdit: (line: CartLine) => void; onSubmitStart: () => void; onSubmitError: (message: string) => void; onSuccess: (orderNumber: string) => void }) {
  const [method, setMethod] = useState<'card' | 'meal-card' | null>(null);
  const [error, setError] = useState('');
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const complete = async () => { if (!method) return; setError(''); onSubmitStart(); try { const order = await submitOrder({ fulfillment, paymentMethod: method, total, lines: cart }); onSuccess(order.number); } catch (err) { onSubmitError(err instanceof Error ? err.message : 'Sipariş kaydedilemedi.'); } };
  const shownError = error || submitError;
  return <main className="payment page-enter"><section className="payment__methods"><header><button className="icon-button" onClick={onBack}><ArrowLeft /></button><div><h1>Ödeme Yöntemi</h1><p>Lütfen ödemeyi nasıl yapmak istediğinizi seçin.</p></div></header><div className="payment-options"><button className={method === 'card' ? 'selected' : ''} onClick={() => setMethod('card')}><span><CreditCard /></span><b>Kredi / Banka Kartı</b><small>Temassız veya çipli ödeme</small></button><button className={method === 'meal-card' ? 'selected' : ''} onClick={() => setMethod('meal-card')}><span className="dark"><UtensilsCrossed /></span><b>Yemek Kartı</b><small>Sodexo, Ticket, Multinet vb.</small></button></div>{shownError && <div className="payment__error">{shownError}</div>}</section><aside className="payment__summary"><div className="amount"><small>ÖDENECEK TUTAR</small><b>{money(total)}</b></div><div className="summary-card"><header><b>Sipariş Özeti</b><span>{itemCount} ürün</span></header><div className="summary-card__lines">{cart.map((line) => <article className="summary-line" key={line.key}><div className="summary-line__image">{line.product.image ? <img src={assetUrl(line.product.image)} alt="" loading="eager" decoding="async" fetchPriority="high" /> : <span>{line.product.emoji || '☕'}</span>}</div><span><b>{line.product.name}</b><small>{line.quantity} adet</small>{hasActiveCustomization(line.product) && <button className="summary-line__edit" onClick={() => onEdit(line)}>Düzenle</button>}</span><strong>{money(line.unitPrice * line.quantity)}</strong></article>)}</div><div className="summary-total"><span>Toplam</span><b>{money(total)}</b></div><p className="order-type-mini"><UtensilsCrossed /> {fulfillment === 'restaurant' ? 'Burada' : 'Paket'}</p><button className="primary-button" disabled={!method} onClick={complete}>Siparişi Tamamla <ArrowRight /></button></div></aside></main>;
}

function Success({ orderNumber, onRestart }: { orderNumber: string; onRestart: () => void }) {
  const completed = Boolean(orderNumber);
  return <main className="success page-enter"><BrandMark /><span className="success__check"><CheckCircle2 /></span><p>{completed ? 'SİPARİŞİNİ ALDIK' : 'SİPARİŞİN ALINIYOR'}</p><h1>Teşekkürler!</h1><h2>{completed ? 'Kahven barista ekranına düştü.' : 'Siparişin kaydediliyor.'}</h2><div><small>SİPARİŞ NUMARAN</small><b>{orderNumber || 'Hazırlanıyor...'}</b></div><button className="primary-button" disabled={!completed} onClick={onRestart}><RotateCcw /> Yeni Sipariş</button></main>;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('intro');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [fulfillment, setFulfillment] = useState<Fulfillment>('restaurant');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customizing, setCustomizing] = useState<Product | null>(null);
  const [editing, setEditing] = useState<CartLine | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [notice, setNotice] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [startPending, setStartPending] = useState(false);
  const loadCatalog = () => {
    setCatalogError('');
    setCatalogLoading(true);
    fetchCatalog().then((nextCatalog) => {
      setCatalog(nextCatalog);
      preloadCatalogImages(nextCatalog);
    }).catch((error: Error) => setCatalogError(error.message)).finally(() => setCatalogLoading(false));
  };
  useEffect(loadCatalog, []);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    if (startPending && catalog) {
      setStartPending(false);
      setScreen('order-type');
    }
  }, [catalog, startPending]);
  const startOrder = () => {
    if (catalog) {
      setScreen('order-type');
      return;
    }
    if (catalogError) loadCatalog();
    setNotice('Menu hazirlaniyor, lutfen bekleyin.');
    setStartPending(true);
    if (!catalogLoading) loadCatalog();
  };
  const addProduct = (product: Product) => {
    if (product.available === false) return;
    if (product.stockTrackingEnabled && product.stockQuantity != null && productCartQuantity(cart, product.id) >= product.stockQuantity) {
      setNotice(`${product.name} stokta kalmadı.`);
      return;
    }
    if (product.customizable && hasActiveCustomization(product)) { setEditing(null); setCustomizing(product); return; }
    const key = cartLineKey(product);
    const nextQuantity = productCartQuantity(cart, product.id) + 1;
    setCart((items) => items.some((line) => line.key === key) ? items.map((line) => line.key === key ? { ...line, quantity: line.quantity + 1 } : line) : [...items, { key, product, quantity: 1, unitPrice: product.price }]);
    const nextNotice = addToCartNotice(product, nextQuantity);
    if (nextNotice) setNotice(nextNotice);
  };
  const saveCustomized = (selection: Selection, unitPrice: number) => {
    if (!customizing) return;
    if (!editing && customizing.stockTrackingEnabled && customizing.stockQuantity != null && productCartQuantity(cart, customizing.id) >= customizing.stockQuantity) {
      setNotice(`${customizing.name} stokta kalmadı.`);
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
    const nextNotice = addToCartNotice(customizing, nextQuantity);
    if (nextNotice) setNotice(nextNotice);
    setCustomizing(null);
    setEditing(null);
  };
  const updateQuantity = (key: string, delta: number) => setCart((items) => {
    const target = items.find((line) => line.key === key);
    if (!target) return items;
    if (delta > 0 && target.product.stockTrackingEnabled && target.product.stockQuantity != null && productCartQuantity(items, target.product.id) >= target.product.stockQuantity) {
      setNotice(`${target.product.name} stokta kalmadı.`);
      return items;
    }
    const nextItems = items.map((line) => line.key === key ? { ...line, quantity: line.quantity + delta } : line).filter((line) => line.quantity > 0);
    if (delta > 0) {
      const nextNotice = addToCartNotice(target.product, productCartQuantity(nextItems, target.product.id));
      if (nextNotice) setNotice(nextNotice);
    }
    return nextItems;
  });
  const restart = () => { setCart([]); setOrderNumber(''); setPaymentError(''); setCartOpen(false); setNotice(''); setScreen('intro'); loadCatalog(); };
  return <div className="app-shell kiosk-no-focus-ring">
    {screen === 'intro' && <Intro onStart={startOrder} loading={catalogLoading} />}
    {screen === 'order-type' && <OrderType onContinue={(type) => { setFulfillment(type); setScreen('catalog'); }} />}
    {notice && <div className="stock-toast">{notice}</div>}
    {customizing && <Customizer product={customizing} initial={editing?.selection} onClose={() => { setCustomizing(null); setEditing(null); }} onSave={saveCustomized} />}
    {!customizing && cartOpen && <CartDrawer cart={cart} onClose={() => setCartOpen(false)} onQuantity={updateQuantity} onDelete={(key) => setCart((items) => items.filter((line) => line.key !== key))} onEdit={(line) => { setEditing(line); setCustomizing(line.product); setCartOpen(false); }} onCheckout={() => { setCartOpen(false); setScreen('payment'); }} />}
    {!customizing && !cartOpen && screen === 'catalog' && catalog && <CatalogScreen catalog={catalog} cart={cart} onProduct={addProduct} onCart={() => setCartOpen(true)} />}
    {!customizing && !cartOpen && screen === 'payment' && <Payment cart={cart} fulfillment={fulfillment} submitError={paymentError} onBack={() => { setPaymentError(''); setScreen('catalog'); }} onEdit={(line) => { setEditing(line); setCustomizing(line.product); }} onSubmitStart={() => { setPaymentError(''); setOrderNumber(''); setScreen('success'); }} onSubmitError={(message) => { setPaymentError(message); setScreen('payment'); }} onSuccess={(number) => { setOrderNumber(number); setCart([]); setScreen('success'); }} />}
    {!customizing && !cartOpen && screen === 'success' && <Success orderNumber={orderNumber} onRestart={restart} />}
    {catalogError && !catalog && <div className="load-error"><BrandMark /><h2>Menüye ulaşamadık</h2><p>Magic Coffee API çalışıyor mu kontrol edip yeniden deneyin.</p><button className="primary-button" onClick={loadCatalog}>Tekrar Dene</button></div>}
    {screen !== 'intro' && !catalog && !catalogError && <div className="loading"><BrandMark light /><span /><p>Kahve menüsü hazırlanıyor...</p></div>}
  </div>;
}
