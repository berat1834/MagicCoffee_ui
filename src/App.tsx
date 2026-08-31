import { ArrowLeft, ArrowRight, Check, CheckCircle2, Coffee, CreditCard, Languages, Minus, Plus, RotateCcw, ShoppingBag, Trash2, UtensilsCrossed, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchCatalog, submitOrder } from './api';
import type { CartLine, Catalog, Fulfillment, Product, Screen, Selection } from './types';

const money = (amount: number) => `${amount.toFixed(2)} TL`;

function BrandMark({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return <div className={`brand-mark ${light ? 'brand-mark--light' : ''} ${compact ? 'brand-mark--compact' : ''}`}>
    <span className="brand-mark__star"><Coffee /></span><span className="brand-mark__copy"><b>MAGIC</b><em>COFFEE</em></span>
  </div>;
}

function Intro({ onStart }: { onStart: () => void }) {
  return <button type="button" className="intro" onClick={onStart} aria-label="Sipariş vermeye başla">
    <div className="intro__grain" />
    <header className="intro__header"><BrandMark light /><span className="intro__badge">BARISTA HIZI<br />KIOSK RAHATLIĞI</span></header>
    <img className="intro__burger intro__coffee-art" src="/images/products/hero-coffee.svg" alt="Magic Coffee" />
    <div className="intro__copy"><p>YENİ KAHVE MOLAN</p><h1>Kahveni<br /><i>Magic</i> hazırla</h1><span>Boyutunu, sütünü, şurubunu ve ekstra shotunu seç.</span></div>
    <div className="intro__touch"><span>Sipariş vermek için dokun</span><ArrowRight /></div>
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
  return <button type="button" className={`product-card ${disabled ? 'product-card--disabled' : ''}`} onClick={onClick} disabled={disabled}>
    {product.popular && <span className="product-card__popular">ÇOK SEVİLEN</span>}{quantity > 0 && <span className="product-card__quantity">{quantity}</span>}
    <div className={`product-card__visual ${product.image ? '' : 'product-card__visual--emoji'}`}>{product.image ? <img src={product.image} alt={product.name} /> : <span>{product.emoji || '☕'}</span>}</div>
    <div className="product-card__body"><small>{disabled ? product.unavailableReason : product.categoryId}</small><h3>{product.name}</h3><p>{product.description}</p><b>{money(product.price)}</b></div>
  </button>;
}

function CatalogScreen({ catalog, cart, onProduct, onCart }: { catalog: Catalog; cart: CartLine[]; onProduct: (product: Product) => void; onCart: () => void }) {
  const [activeCategory, setActiveCategory] = useState('all');
  const productsRef = useRef<HTMLElement>(null);
  const visibleCategories = activeCategory === 'all' ? catalog.categories : catalog.categories.filter((item) => item.id === activeCategory);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const selectCategory = (categoryId: string) => { setActiveCategory(categoryId); productsRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); };
  return <main className="catalog page-enter">
    <header className="catalog__header"><BrandMark light compact /><button className="header-cart" onClick={onCart}><span><ShoppingBag />{itemCount > 0 && <i>{itemCount}</i>}</span><span><b>Sepetim</b><small>{itemCount ? money(total) : 'Sepetiniz boş'}</small></span></button></header>
    <div className="category-menu"><div className="category-menu__label"><small>MENÜ</small><b>Kategorini seç</b></div><nav className="categories" aria-label="Ürün kategorileri"><button className={activeCategory === 'all' ? 'active' : ''} onClick={() => selectCategory('all')}>Tümü</button>{catalog.categories.map((item) => <button key={item.id} className={item.id === activeCategory ? 'active' : ''} onClick={() => selectCategory(item.id)}>{item.name}</button>)}</nav></div>
    <section ref={productsRef} className={`products ${activeCategory === 'all' ? 'products--all' : ''}`}>{visibleCategories.map((category) => {
      const categoryProducts = catalog.products.filter((product) => product.categoryId === category.id);
      return <section className="category-section" key={category.id}><div className="section-heading"><h1>{category.name}</h1><span /><small>{categoryProducts.length} ürün</small></div><div className="product-grid">{categoryProducts.map((product) => <ProductCard key={product.id} product={product} quantity={cart.filter((line) => line.product.id === product.id).reduce((sum, line) => sum + line.quantity, 0)} onClick={() => onProduct(product)} />)}</div></section>;
    })}</section>
    <button className={`cart-bar ${itemCount ? 'cart-bar--ready' : ''}`} onClick={onCart}><span className="cart-bar__icon"><ShoppingBag />{itemCount > 0 && <i>{itemCount}</i>}</span>{itemCount ? <><b>Sepete Git</b><strong>{money(total)}</strong></> : <span>Seçtikleriniz burada görünecek</span>}</button>
  </main>;
}

function Customizer({ product, initial, onClose, onSave }: { product: Product; initial?: Selection; onClose: () => void; onSave: (selection: Selection, unitPrice: number) => void }) {
  const steps = Object.entries(product.customization ?? {}).filter(([, step]) => step.enabled);
  const [choices, setChoices] = useState<Record<string, string[]>>(() => initial?.choices ?? Object.fromEntries(steps.map(([id, step]) => [id, step.options.filter((option) => option.defaultSelected && option.enabled).map((option) => option.id)])));
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const current = steps[index];
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
  return <div className="modal-backdrop"><section className="customizer page-enter" role="dialog" aria-modal="true">
    <header><button className="icon-button" onClick={onClose}><X /></button><div><small>KAHVENİ HAZIRLA</small><h2>{product.name}</h2></div><b>{money(unitPrice)}</b></header>
    <div className="customizer__hero">{product.image ? <img src={product.image} alt="" /> : <span className="customizer__emoji">{product.emoji || '☕'}</span>}<div><span>MAGIC COFFEE</span><b>{step.title}</b></div></div>
    <nav className="steps">{steps.map(([id, item], stepIndex) => <button key={id} className={stepIndex === index ? 'active' : ''} onClick={() => setIndex(stepIndex)}><i>{stepIndex + 1}</i>{item.title}</button>)}</nav>
    <div className="customizer__content"><div className="customizer__title"><span><small>SEÇİM</small><h3>{step.title}</h3></span><p>{step.required ? 'Bu adım zorunludur.' : 'İstersen bu adımı boş bırakabilirsin.'}</p></div>
      <div className="option-list">{step.options.filter((option) => option.enabled).map((option) => {
        const selected = (choices[stepId] ?? []).includes(option.id);
        return <button key={option.id} className={selected ? 'selected' : ''} disabled={option.available === false} onClick={() => toggle(stepId, option.id, step.maxSelect ?? 1)}><span>{selected && <Check />}</span><b>{option.name}</b><small>{option.priceDelta ? `+${money(option.priceDelta)}` : option.available === false ? 'Stokta yok' : 'Fiyata dahil'}</small></button>;
      })}</div>{error && <div className="payment__error">{error}</div>}</div>
    <footer><button className="secondary-button" onClick={onClose}>Vazgeç</button><button className="primary-button" onClick={next}>{index === steps.length - 1 ? 'Sepete Ekle' : 'Devam Et'} <ArrowRight /></button></footer>
  </section></div>;
}

function CartDrawer({ cart, onClose, onQuantity, onDelete, onEdit, onCheckout }: { cart: CartLine[]; onClose: () => void; onQuantity: (key: string, delta: number) => void; onDelete: (key: string) => void; onEdit: (line: CartLine) => void; onCheckout: () => void }) {
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  return <div className="modal-backdrop modal-backdrop--drawer" onMouseDown={onClose}><section className="cart-drawer page-enter" onMouseDown={(event) => event.stopPropagation()}>
    <header><span><ShoppingBag /></span><div><h2>Sepetim</h2><small>{cart.length} satır ürün</small></div><button className="icon-button" onClick={onClose}><X /></button></header>
    <div className="cart-drawer__items">{!cart.length && <div className="empty-cart"><ShoppingBag /><h3>Sepetiniz henüz boş</h3><p>Magic Coffee menüsünden bir ürün seçerek başlayın.</p></div>}{cart.map((line) => <article className="cart-line" key={line.key}><div className="cart-line__image">{line.product.image ? <img src={line.product.image} alt="" /> : <span>{line.product.emoji || '☕'}</span>}</div><div className="cart-line__main"><small>MAGIC COFFEE</small><h3>{line.product.name}</h3><p>{Object.values(line.selection?.choices ?? {}).flat().length ? 'Özelleştirildi' : 'Standart'}</p><div><button onClick={() => onQuantity(line.key, -1)}><Minus /></button><b>{line.quantity}</b><button className="plus" onClick={() => onQuantity(line.key, 1)}><Plus /></button>{line.product.customizable && <button className="edit" onClick={() => onEdit(line)}>Düzenle</button>}<button className="delete" onClick={() => onDelete(line.key)}><Trash2 /> Sil</button></div></div><strong>{money(line.unitPrice * line.quantity)}</strong></article>)}</div>
    <footer><div><small>SİPARİŞ TOPLAMI</small><b>{money(total)}</b><span>{cart.reduce((sum, line) => sum + line.quantity, 0)} ürün</span></div><button className="primary-button" disabled={!cart.length} onClick={onCheckout}>Ödemeye Geç <ArrowRight /></button></footer>
  </section></div>;
}

function Payment({ cart, fulfillment, onBack, onSuccess }: { cart: CartLine[]; fulfillment: Fulfillment; onBack: () => void; onSuccess: (orderNumber: string) => void }) {
  const [method, setMethod] = useState<'card' | 'meal-card' | null>(null);
  const [error, setError] = useState('');
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const complete = async () => { if (!method) return; try { const order = await submitOrder({ fulfillment, paymentMethod: method, total, lines: cart }); onSuccess(order.number); } catch (err) { setError(err instanceof Error ? err.message : 'Sipariş kaydedilemedi.'); } };
  return <main className="payment page-enter"><section className="payment__methods"><header><button className="icon-button" onClick={onBack}><ArrowLeft /></button><div><h1>Ödeme Yöntemi</h1><p>Lütfen ödemeyi nasıl yapmak istediğinizi seçin.</p></div></header><div className="payment-options"><button className={method === 'card' ? 'selected' : ''} onClick={() => setMethod('card')}><span><CreditCard /></span><b>Kredi / Banka Kartı</b><small>Temassız veya çipli ödeme</small></button><button className={method === 'meal-card' ? 'selected' : ''} onClick={() => setMethod('meal-card')}><span className="dark"><UtensilsCrossed /></span><b>Yemek Kartı</b><small>Sodexo, Ticket, Multinet vb.</small></button></div>{error && <div className="payment__error">{error}</div>}</section><aside className="payment__summary"><div className="amount"><small>ÖDENECEK TUTAR</small><b>{money(total)}</b></div><div className="summary-card"><header><b>Sipariş Özeti</b><span>{itemCount} ürün</span></header><div className="summary-card__lines">{cart.map((line) => <article className="summary-line" key={line.key}><div className="summary-line__image">{line.product.image ? <img src={line.product.image} alt="" /> : <span>{line.product.emoji || '☕'}</span>}</div><span><b>{line.product.name}</b><small>{line.quantity} adet</small></span><strong>{money(line.unitPrice * line.quantity)}</strong></article>)}</div><div className="summary-total"><span>Toplam</span><b>{money(total)}</b></div><p className="order-type-mini"><UtensilsCrossed /> {fulfillment === 'restaurant' ? 'Burada' : 'Paket'}</p><button className="primary-button" disabled={!method} onClick={complete}>Siparişi Tamamla <ArrowRight /></button></div></aside></main>;
}

function Success({ orderNumber, onRestart }: { orderNumber: string; onRestart: () => void }) {
  return <main className="success page-enter"><BrandMark /><span className="success__check"><CheckCircle2 /></span><p>SİPARİŞİNİ ALDIK</p><h1>Teşekkürler!</h1><h2>Kahven barista ekranına düştü.</h2><div><small>SİPARİŞ NUMARAN</small><b>{orderNumber}</b></div><button className="primary-button" onClick={onRestart}><RotateCcw /> Yeni Sipariş</button></main>;
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
  const loadCatalog = () => { setCatalogError(''); fetchCatalog().then(setCatalog).catch((error: Error) => setCatalogError(error.message)); };
  useEffect(loadCatalog, []);
  const hasActiveCustomization = (product: Product) => Object.values(product.customization ?? {}).some((step) => step.enabled);
  const addProduct = (product: Product) => { if (product.available === false) return; if (product.customizable && hasActiveCustomization(product)) { setEditing(null); setCustomizing(product); return; } setCart((items) => [...items, { key: `${product.id}-${Date.now()}`, product, quantity: 1, unitPrice: product.price }]); };
  const saveCustomized = (selection: Selection, unitPrice: number) => { if (!customizing) return; const line = { key: `${customizing.id}-${JSON.stringify(selection)}-${Date.now()}`, product: customizing, quantity: 1, unitPrice, selection }; setCart((items) => editing ? items.map((item) => item.key === editing.key ? { ...item, selection, unitPrice } : item) : [...items, line]); setCustomizing(null); setEditing(null); };
  const updateQuantity = (key: string, delta: number) => setCart((items) => items.map((line) => line.key === key ? { ...line, quantity: line.quantity + delta } : line).filter((line) => line.quantity > 0));
  const restart = () => { setCart([]); setOrderNumber(''); setCartOpen(false); setScreen('intro'); loadCatalog(); };
  return <div className="app-shell kiosk-no-focus-ring">
    {screen === 'intro' && <Intro onStart={() => catalog && setScreen('order-type')} />}
    {screen === 'order-type' && <OrderType onContinue={(type) => { setFulfillment(type); setScreen('catalog'); }} />}
    {screen === 'catalog' && catalog && <CatalogScreen catalog={catalog} cart={cart} onProduct={addProduct} onCart={() => setCartOpen(true)} />}
    {screen === 'payment' && <Payment cart={cart} fulfillment={fulfillment} onBack={() => setScreen('catalog')} onSuccess={(number) => { setOrderNumber(number); setCart([]); setScreen('success'); }} />}
    {screen === 'success' && <Success orderNumber={orderNumber} onRestart={restart} />}
    {catalogError && !catalog && <div className="load-error"><BrandMark /><h2>Menüye ulaşamadık</h2><p>Magic Coffee API çalışıyor mu kontrol edip yeniden deneyin.</p><button className="primary-button" onClick={loadCatalog}>Tekrar Dene</button></div>}
    {!catalog && !catalogError && <div className="loading"><BrandMark light /><span /><p>Kahve menüsü hazırlanıyor...</p></div>}
    {customizing && <Customizer product={customizing} initial={editing?.selection} onClose={() => { setCustomizing(null); setEditing(null); }} onSave={saveCustomized} />}
    {cartOpen && <CartDrawer cart={cart} onClose={() => setCartOpen(false)} onQuantity={updateQuantity} onDelete={(key) => setCart((items) => items.filter((line) => line.key !== key))} onEdit={(line) => { setEditing(line); setCustomizing(line.product); setCartOpen(false); }} onCheckout={() => { setCartOpen(false); setScreen('payment'); }} />}
  </div>;
}
