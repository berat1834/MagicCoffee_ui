import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Languages,
  Minus,
  Package,
  Plus,
  RotateCcw,
  ShoppingBag,
  Sparkles,
  Trash2,
  UtensilsCrossed,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchCatalog, submitOrder } from './api';
import type { CartLine, Catalog, Fulfillment, Product, Screen, Selection } from './types';

const money = (amount: number) => `${amount.toFixed(2)} TL`;

function BrandMark({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <div className={`brand-mark ${light ? 'brand-mark--light' : ''} ${compact ? 'brand-mark--compact' : ''}`}>
      <span className="brand-mark__star"><Sparkles /></span>
      <span className="brand-mark__copy"><b>MAGIC</b><em>BURGER</em></span>
    </div>
  );
}

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <button type="button" className="intro" onClick={onStart} aria-label="Sipariş vermeye başla">
      <div className="intro__grain" />
      <header className="intro__header">
        <BrandMark light />
        <span className="intro__badge">%100 LEZZET<br />%100 MAGIC</span>
      </header>
      <div className="intro__copy">
        <p>YENİ FAVORİN</p>
        <h1>Isırınca<br /><i>Magic!</i></h1>
        <span>Bol malzeme. Gerçek lezzet. Tam senlik.</span>
      </div>
      <img className="intro__burger" src="/images/products/beef-big.webp" alt="Big Magic Burger" />
      <div className="intro__touch"><span>Sipariş vermek için dokun</span><ChevronRight /></div>
    </button>
  );
}

function OrderType({ muted, onMute, onContinue }: {
  muted: boolean;
  onMute: () => void;
  onContinue: (type: Fulfillment) => void;
}) {
  return (
    <main className="order-type page-enter">
      <div className="order-type__actions">
        <button className="utility-button"><span><Languages /></span><small>Dil seçimi</small><b>Türkçe</b></button>
        <button className="utility-button" onClick={onMute}><span className={muted ? 'red' : 'green'}>{muted ? <VolumeX /> : <Volume2 />}</span><small>Kiosk sesi</small><b>{muted ? 'Kapalı' : 'Açık'}</b></button>
      </div>
      <section className="order-type__content">
        <h1>Siparişinizi nasıl almak istersiniz?</h1>
        <p>Sipariş tipinizi seçin, sizi hemen menüye alalım.</p>
        <div className="order-type__grid">
          <button onClick={() => onContinue('restaurant')}><span><UtensilsCrossed /></span><b>Restoranda</b><small>Burada keyifle tüket</small></button>
          <button onClick={() => onContinue('package')}><span><ShoppingBag /></span><b>Paket</b><small>Yanında götür</small></button>
        </div>
      </section>
    </main>
  );
}

function ProductCard({ product, quantity, onClick }: { product: Product; quantity: number; onClick: () => void }) {
  return (
    <button type="button" className="product-card" onClick={onClick}>
      {product.popular && <span className="product-card__popular">ÇOK SEVİLEN</span>}
      {quantity > 0 && <span className="product-card__quantity">{quantity}</span>}
      <div className={`product-card__visual ${product.image ? '' : 'product-card__visual--emoji'}`}>
        {product.image ? <img src={product.image} alt={product.name} /> : <span>{product.emoji}</span>}
      </div>
      <div className="product-card__body">
        <small>{product.protein ? `${product.protein} • ${product.patties} KAT` : product.categoryId}</small>
        <h3>{product.name}</h3>
        <p>{product.description}</p>
        <b>{money(product.price)}</b>
      </div>
    </button>
  );
}

function CatalogScreen({ catalog, cart, fulfillment, onBack, onProduct, onCart }: {
  catalog: Catalog;
  cart: CartLine[];
  fulfillment: Fulfillment;
  onBack: () => void;
  onProduct: (product: Product) => void;
  onCart: () => void;
}) {
  const [activeCategory, setActiveCategory] = useState('all');
  const productsRef = useRef<HTMLElement>(null);
  const visibleCategories = activeCategory === 'all'
    ? catalog.categories
    : catalog.categories.filter((item) => item.id === activeCategory);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);

  const selectCategory = (categoryId: string) => {
    setActiveCategory(categoryId);
    productsRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <main className="catalog page-enter">
      <header className="catalog__header">
        <BrandMark light compact />
        <button className="header-cart" onClick={onCart}>
          <span><ShoppingBag />{itemCount > 0 && <i>{itemCount}</i>}</span>
          <span><b>Sepetim</b><small>{itemCount ? money(total) : 'Sepetiniz boş'}</small></span>
        </button>
      </header>
      <div className="category-menu">
        <div className="category-menu__label"><small>MENÜ</small><b>Kategorini seç</b></div>
        <nav className="categories" aria-label="Ürün kategorileri">
          <button className={activeCategory === 'all' ? 'active' : ''} onClick={() => selectCategory('all')}>
            Tümü
          </button>
          {catalog.categories.map((item) => (
            <button key={item.id} className={item.id === activeCategory ? 'active' : ''} onClick={() => selectCategory(item.id)}>
              {item.name}
            </button>
          ))}
        </nav>
      </div>
      <section ref={productsRef} className={`products ${activeCategory === 'all' ? 'products--all' : ''}`}>
        {visibleCategories.map((category) => {
          const categoryProducts = catalog.products.filter((product) => product.categoryId === category.id);
          return (
          <section className="category-section" id={`category-${category.id}`} key={category.id}>
            <div className="section-heading">
              <h1>{category.name}</h1>
              <span />
              <small>{categoryProducts.length} ürün</small>
            </div>
            <div className="product-grid">
              {categoryProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  quantity={cart.filter((line) => line.product.id === product.id).reduce((sum, line) => sum + line.quantity, 0)}
                  onClick={() => onProduct(product)}
                />
              ))}
            </div>
          </section>
        )})}
      </section>
      <button className={`cart-bar ${itemCount ? 'cart-bar--ready' : ''}`} onClick={onCart}>
        <span className="cart-bar__icon"><ShoppingBag />{itemCount > 0 && <i>{itemCount}</i>}</span>
        {itemCount ? <><b>Sepete Git</b><strong>{money(total)}</strong></> : <span>Seçtikleriniz burada görünecek</span>}
      </button>
    </main>
  );
}

function Customizer({ product, catalog, initial, onClose, onSave }: {
  product: Product;
  catalog: Catalog;
  initial?: Selection;
  onClose: () => void;
  onSave: (selection: Selection, unitPrice: number) => void;
}) {
  const needsMenu = product.kind === 'menu' || product.kind === 'bundle';
  const [ingredients, setIngredients] = useState<string[]>(initial?.ingredients ?? catalog.modifiers.ingredients.map((item) => item.id));
  const [fries, setFries] = useState(initial?.fries ?? 'small');
  const [drink, setDrink] = useState(initial?.drink ?? '');
  const [step, setStep] = useState<'ingredients' | 'fries' | 'drink'>('ingredients');
  const friesDelta = catalog.modifiers.fries.find((item) => item.id === fries)?.priceDelta ?? 0;
  const unitPrice = product.price + friesDelta * (product.serves ?? 1);
  const canSave = !needsMenu || Boolean(drink);

  const next = () => {
    if (step === 'ingredients' && needsMenu) setStep('fries');
    else if (step === 'fries') setStep('drink');
    else onSave({ ingredients, fries: needsMenu ? fries : undefined, drink: needsMenu ? drink : undefined }, unitPrice);
  };

  return (
    <div className="modal-backdrop">
      <section className="customizer page-enter" role="dialog" aria-modal="true" aria-label={`${product.name} özelleştirme`}>
        <header>
          <button className="icon-button" onClick={onClose}><X /></button>
          <div><small>ÜRÜNÜNÜ HAZIRLA</small><h2>{product.name}</h2></div>
          <b>{money(unitPrice)}</b>
        </header>
        <div className="customizer__hero">
          {product.image ? <img src={product.image} alt="" /> : <span>{product.emoji}</span>}
          <div><span>{product.protein ?? 'MAGIC'}</span><b>{product.patties ? `${product.patties} kat lezzet` : 'Tam senlik'}</b></div>
        </div>
        <nav className="steps">
          <button className={step === 'ingredients' ? 'active' : ''} onClick={() => setStep('ingredients')}><i>1</i>İçerik</button>
          {needsMenu && <button className={step === 'fries' ? 'active' : ''} onClick={() => setStep('fries')}><i>2</i>Patates</button>}
          {needsMenu && <button className={step === 'drink' ? 'active' : ''} onClick={() => setStep('drink')}><i>3</i>İçecek</button>}
        </nav>
        <div className="customizer__content">
          {step === 'ingredients' && <>
            <div className="customizer__title"><span><small>BURGER İÇERİĞİ</small><h3>İçinde neler olsun?</h3></span><p>İstemediğin malzemeyi çıkarabilirsin.</p></div>
            <div className="option-list option-list--ingredients">
              {catalog.modifiers.ingredients.map((option) => {
                const selected = ingredients.includes(option.id);
                return <button key={option.id} className={selected ? 'selected' : ''} onClick={() => setIngredients((items) => selected ? items.filter((id) => id !== option.id) : [...items, option.id])}><span>{selected && <Check />}</span><b>{option.name}</b><small>{selected ? 'Burgerinde olsun' : 'Çıkarıldı'}</small></button>;
              })}
            </div>
          </>}
          {step === 'fries' && <>
            <div className="customizer__title"><span><small>PATATES BOYU</small><h3>Boyunu seç</h3></span><p>Küçük boy varsayılan olarak seçilidir.</p></div>
            <div className="size-options">
              {catalog.modifiers.fries.map((option, index) => <button key={option.id} className={fries === option.id ? 'selected' : ''} onClick={() => setFries(option.id)}><span className={`fries fries--${index + 1}`}>🍟</span><b>{option.name}</b><small>{option.priceDelta ? `+${money(option.priceDelta * (product.serves ?? 1))}` : 'Fiyata dahil'}</small>{fries === option.id && <i><Check /></i>}</button>)}
            </div>
          </>}
          {step === 'drink' && <>
            <div className="customizer__title"><span><small>İÇECEK SEÇİMİ</small><h3>Buz gibi bir seçim</h3></span><p>{product.serves === 2 ? 'Seçiminiz iki içecek için uygulanır.' : 'Menünü tamamlamak için bir içecek seç.'}</p></div>
            <div className="drink-options">
              {catalog.modifiers.drinks.map((option) => <button key={option.id} className={drink === option.id ? 'selected' : ''} onClick={() => setDrink(option.id)}><span>🥤</span><b>{option.name}</b>{drink === option.id && <i><Check /></i>}</button>)}
            </div>
          </>}
        </div>
        <footer>
          <button className="secondary-button" onClick={onClose}>Vazgeç</button>
          <button className="primary-button" disabled={step === 'drink' && !drink} onClick={next}>
            {step === 'ingredients' && !needsMenu ? 'Sepete Ekle' : step === 'drink' ? 'Sepete Ekle' : 'Devam Et'} <ArrowRight />
          </button>
        </footer>
      </section>
    </div>
  );
}

function CartDrawer({ cart, catalog, onClose, onQuantity, onDelete, onEdit, onCheckout }: {
  cart: CartLine[];
  catalog: Catalog;
  onClose: () => void;
  onQuantity: (key: string, delta: number) => void;
  onDelete: (key: string) => void;
  onEdit: (line: CartLine) => void;
  onCheckout: () => void;
}) {
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  const optionName = (group: 'ingredients' | 'fries' | 'drinks', id?: string) => catalog.modifiers[group].find((item) => item.id === id)?.name;
  return (
    <div className="modal-backdrop modal-backdrop--drawer" onMouseDown={onClose}>
      <section className="cart-drawer page-enter" onMouseDown={(event) => event.stopPropagation()}>
        <header><span><ShoppingBag /></span><div><h2>Sepetim</h2><small>{count} ürün seçildi</small></div><button className="icon-button" onClick={onClose}><X /></button></header>
        <div className="cart-drawer__items">
          {!cart.length && <div className="empty-cart"><ShoppingBag /><h3>Sepetiniz henüz boş</h3><p>Magic lezzetlerden birini seçerek başlayın.</p></div>}
          {cart.map((line) => {
            const removed = catalog.modifiers.ingredients.filter((item) => !line.selection?.ingredients.includes(item.id)).map((item) => item.name);
            return <article className="cart-line" key={line.key}>
              <div className="cart-line__image">{line.product.image ? <img src={line.product.image} alt="" /> : <span>{line.product.emoji}</span>}</div>
              <div className="cart-line__main"><small>{line.product.kind === 'bundle' ? '2 KİŞİLİK MENÜ' : line.product.kind === 'menu' ? 'BURGER MENÜ' : 'MAGIC BURGER'}</small><h3>{line.product.name}</h3>
                {line.selection && <p>{removed.length ? `Olmasın: ${removed.join(', ')}` : 'Standart içerik'}{line.selection.fries ? ` • ${optionName('fries', line.selection.fries)} patates` : ''}{line.selection.drink ? ` • ${optionName('drinks', line.selection.drink)}` : ''}</p>}
                <div><button onClick={() => onQuantity(line.key, -1)}><Minus /></button><b>{line.quantity}</b><button className="plus" onClick={() => onQuantity(line.key, 1)}><Plus /></button>{line.product.customizable && <button className="edit" onClick={() => onEdit(line)}>Düzenle</button>}<button className="delete" onClick={() => onDelete(line.key)}><Trash2 /> Sil</button></div>
              </div><strong>{money(line.unitPrice * line.quantity)}</strong>
            </article>;
          })}
        </div>
        <footer><div><small>SİPARİŞ TOPLAMI</small><b>{money(total)}</b><span>{count} ürün</span></div><button className="primary-button" disabled={!cart.length} onClick={onCheckout}>Ödemeye Geç <ArrowRight /></button></footer>
      </section>
    </div>
  );
}

function Payment({ cart, fulfillment, onBack, onSuccess }: {
  cart: CartLine[];
  fulfillment: Fulfillment;
  onBack: () => void;
  onSuccess: (orderNumber: string) => void;
}) {
  const [method, setMethod] = useState<'card' | 'meal-card' | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  const complete = async () => {
    if (!method) return;
    setProcessing(true); setError('');
    try {
      const order = await submitOrder({ fulfillment, paymentMethod: method, total, lines: cart });
      onSuccess(order.number);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bir sorun oluştu.');
      setProcessing(false);
    }
  };
  return (
    <main className="payment page-enter">
      <section className="payment__methods">
        <header><button className="icon-button" onClick={onBack}><ArrowLeft /></button><div><h1>Ödeme Yöntemi</h1><p>Lütfen ödemeyi nasıl yapmak istediğinizi seçin.</p></div></header>
        <div className="payment-options">
          <button className={method === 'card' ? 'selected' : ''} onClick={() => setMethod('card')}><span><CreditCard /></span><b>Kredi / Banka Kartı</b><small>Temassız veya çipli ödeme</small>{method === 'card' && <i><Check /></i>}</button>
          <button className={method === 'meal-card' ? 'selected' : ''} onClick={() => setMethod('meal-card')}><span className="dark"><UtensilsCrossed /></span><b>Yemek Kartı</b><small>Sodexo, Ticket, Multinet vb.</small>{method === 'meal-card' && <i><Check /></i>}</button>
        </div>
        {error && <div className="payment__error">{error}</div>}
      </section>
      <aside className="payment__summary">
        <div className="amount"><small>ÖDENECEK TUTAR</small><b>{money(total)}</b></div>
        <div className="summary-card"><header><b>Sipariş Özeti</b><span>{count} ürün</span></header><div className="summary-card__lines">{cart.map((line) => <div key={line.key}><span><b>{line.product.name}</b><small>{line.quantity} adet</small></span><strong>{money(line.unitPrice * line.quantity)}</strong></div>)}</div><div className="summary-total"><span>Toplam</span><b>{money(total)}</b></div><div className="order-type-mini">{fulfillment === 'restaurant' ? <UtensilsCrossed /> : <Package />}{fulfillment === 'restaurant' ? 'Restoranda' : 'Paket'}</div><button className="primary-button" disabled={!method || processing} onClick={complete}>{processing ? <><RotateCcw className="spin" /> İşleniyor...</> : <>Siparişi Tamamla <ArrowRight /></>}</button></div>
      </aside>
    </main>
  );
}

function Success({ orderNumber, onRestart }: { orderNumber: string; onRestart: () => void }) {
  return (
    <main className="success page-enter">
      <BrandMark />
      <span className="success__check"><CheckCircle2 /></span>
      <p>SİPARİŞİNİ ALDIK</p>
      <h1>Teşekkürler!</h1>
      <h2>Siparişin mutfakta sihirli dokunuşlarla hazırlanıyor.</h2>
      <div><small>SİPARİŞ NUMARAN</small><b>{orderNumber}</b></div>
      <button className="primary-button" onClick={onRestart}><RotateCcw /> Yeni Sipariş</button>
    </main>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('intro');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [fulfillment, setFulfillment] = useState<Fulfillment>('restaurant');
  const [muted, setMuted] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customizing, setCustomizing] = useState<Product | null>(null);
  const [editing, setEditing] = useState<CartLine | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');

  const loadCatalog = () => {
    setCatalogError('');
    fetchCatalog().then(setCatalog).catch((error: Error) => setCatalogError(error.message));
  };
  useEffect(loadCatalog, []);

  const addProduct = (product: Product) => {
    if (product.customizable) { setEditing(null); setCustomizing(product); return; }
    setCart((items) => {
      const existing = items.find((line) => line.product.id === product.id);
      return existing ? items.map((line) => line.key === existing.key ? { ...line, quantity: line.quantity + 1 } : line) : [...items, { key: `${product.id}-${Date.now()}`, product, quantity: 1, unitPrice: product.price }];
    });
  };

  const saveCustomized = (selection: Selection, unitPrice: number) => {
    if (!customizing) return;
    if (editing) {
      setCart((items) => items.map((line) => line.key === editing.key ? { ...line, selection, unitPrice } : line));
    } else {
      const signature = `${customizing.id}-${JSON.stringify(selection)}`;
      setCart((items) => {
        const existing = items.find((line) => line.key.startsWith(signature));
        return existing ? items.map((line) => line.key === existing.key ? { ...line, quantity: line.quantity + 1 } : line) : [...items, { key: `${signature}-${Date.now()}`, product: customizing, quantity: 1, unitPrice, selection }];
      });
    }
    setCustomizing(null); setEditing(null);
  };

  const updateQuantity = (key: string, delta: number) => setCart((items) => items.map((line) => line.key === key ? { ...line, quantity: line.quantity + delta } : line).filter((line) => line.quantity > 0));
  const restart = () => { setCart([]); setOrderNumber(''); setCartOpen(false); setScreen('intro'); };
  const isReady = useMemo(() => Boolean(catalog), [catalog]);

  return (
    <div className="app-shell kiosk-no-focus-ring">
      {screen === 'intro' && <Intro onStart={() => isReady && setScreen('order-type')} />}
      {screen === 'order-type' && <OrderType muted={muted} onMute={() => setMuted((value) => !value)} onContinue={(type) => { setFulfillment(type); setScreen('catalog'); }} />}
      {screen === 'catalog' && catalog && <CatalogScreen catalog={catalog} cart={cart} fulfillment={fulfillment} onBack={() => setScreen('order-type')} onProduct={addProduct} onCart={() => setCartOpen(true)} />}
      {screen === 'payment' && <Payment cart={cart} fulfillment={fulfillment} onBack={() => { setScreen('catalog'); setCartOpen(true); }} onSuccess={(number) => { setOrderNumber(number); setCart([]); setScreen('success'); }} />}
      {screen === 'success' && <Success orderNumber={orderNumber} onRestart={restart} />}

      {catalogError && !catalog && <div className="load-error"><BrandMark /><h2>Menüye ulaşamadık</h2><p>Magic Burger API çalışıyor mu kontrol edip yeniden deneyin.</p><button className="primary-button" onClick={loadCatalog}>Tekrar Dene</button></div>}
      {!catalog && !catalogError && <div className="loading"><BrandMark light /><span /><p>Magic lezzetler hazırlanıyor...</p></div>}
      {customizing && catalog && <Customizer product={customizing} catalog={catalog} initial={editing?.selection} onClose={() => { setCustomizing(null); setEditing(null); }} onSave={saveCustomized} />}
      {cartOpen && catalog && <CartDrawer cart={cart} catalog={catalog} onClose={() => setCartOpen(false)} onQuantity={updateQuantity} onDelete={(key) => setCart((items) => items.filter((line) => line.key !== key))} onEdit={(line) => { setEditing(line); setCustomizing(line.product); setCartOpen(false); }} onCheckout={() => { setCartOpen(false); setScreen('payment'); }} />}
    </div>
  );
}
