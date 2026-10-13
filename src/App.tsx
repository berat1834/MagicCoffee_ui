import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, CreditCard, Delete, House, Languages, Lock, Minus, Plus, Printer, RotateCcw, Settings, ShoppingBag, Trash2, UtensilsCrossed, Volume2, VolumeX, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ApiError, assetUrl, paymentApproval, cancelPosPayment, fetchCatalog, fetchKioskConfig, fetchKioskProfiles, saveKioskPos, pollPosPayment, recordReceiptStatus, startPosPayment, submitOrder, uniqueRequestId, type PosPaymentStatus } from './api';
import { customizationOptionLabel, customizationStepLabel } from './i18n/catalogLocalization';
import { SUPPORTED_LANGUAGES, useKioskLanguage, type KioskLanguage } from './i18n/KioskLanguage';
import { KIOSK_ADMIN_PIN, KIOSK_PROFILES, getActiveKioskId, kioskProfile, sectionIcon, sectionProfile, setActiveKioskId } from './kioskProfiles';
import { prepareOrderPrinter, printOrderReceiptOnce, printTestReceipt, receiptRotated, setReceiptRotated, type ReceiptApproval, type ReceiptPrintStatus } from './printing/orderReceiptPrinter';
import { accentThemeVars, applyRootTheme } from './theme';
import type { CartLine, Catalog, CustomizationStep, Fulfillment, KioskConfig, KioskProfileStatus, Product, Screen, SectionSummary, Selection } from './types';

const money = (amount: number) => `${amount.toFixed(2)} TL`;
const AUDIO_BASE = '/audio/kiosk/';
const FULFILLMENT: Fulfillment = 'package';
const IDLE_RESET_MS = 120000;
const ADMIN_TAP_COUNT = 5;
const ADMIN_TAP_WINDOW_MS = 3000;
const ADMIN_LONG_PRESS_MS = 3000;
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

type SectionLookup = (sectionId?: string | null) => SectionSummary | null;

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

function SectionGlyph({ icon, className }: { icon?: string | null; className?: string }) {
  const Icon = sectionIcon(icon);
  return <Icon className={className} aria-hidden="true" />;
}

function BrandMark({ light = false, compact = false, icon }: { light?: boolean; compact?: boolean; icon?: string | null }) {
  return <div className={`brand-mark ${light ? 'brand-mark--light' : ''} ${compact ? 'brand-mark--compact' : ''}`}>
    <span className="brand-mark__star"><SectionGlyph icon={icon} /></span><span className="brand-mark__copy"><b>MAGICPAY</b><em>KIOSK</em></span>
  </div>;
}

/** Görselsiz ürünler için vurgu renginde yumuşak gradyan + büyük emoji (görselli karolarla aynı kutu). */
function ProductVisual({ product, className }: { product: Product; className: string }) {
  if (product.image) return <div className={className}><img src={assetUrl(product.image)} alt={product.name} draggable={false} loading="eager" decoding="async" /></div>;
  return <div className={`${className} ${className}--emoji emoji-tile`}><span>{product.emoji || '🛍️'}</span></div>;
}

/** Gizli yönetici erişimi: 3 sn içinde 5 dokunuş veya 3 sn basılı tutma. */
function AdminTrigger({ onTrigger, children, className = '' }: { onTrigger: () => void; children: ReactNode; className?: string }) {
  const tapsRef = useRef<number[]>([]);
  const timerRef = useRef<number | null>(null);
  const clearTimer = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  useEffect(() => clearTimer, []);
  const onPointerDown = (event: ReactPointerEvent) => {
    event.stopPropagation();
    clearTimer();
    timerRef.current = window.setTimeout(() => { timerRef.current = null; tapsRef.current = []; onTrigger(); }, ADMIN_LONG_PRESS_MS);
  };
  const onPointerUp = (event: ReactPointerEvent) => {
    event.stopPropagation();
    if (timerRef.current === null) return;
    clearTimer();
    const now = Date.now();
    tapsRef.current = [...tapsRef.current.filter((at) => now - at <= ADMIN_TAP_WINDOW_MS), now];
    if (tapsRef.current.length >= ADMIN_TAP_COUNT) {
      tapsRef.current = [];
      onTrigger();
    }
  };
  return <span className={`admin-trigger ${className}`} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerLeave={clearTimer} onPointerCancel={clearTimer} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>{children}</span>;
}

const PIN_MAX_LENGTH = 8;
const PIN_MIN_LENGTH = 4;
const POS_SERIAL_LENGTH = 12;

/** Ekran üstü sayısal PIN klavyesi. verifyLocally: yerel PIN ile doğrular (gizli menü); değilse PIN'i toplar, sunucu doğrular. */
function PinPad({ verifyLocally, error: externalError, onSubmit, onClose }: { verifyLocally: boolean; error?: string; onSubmit: (pin: string) => void; onClose: () => void }) {
  const { t } = useKioskLanguage();
  const [pin, setPin] = useState('');
  const [localError, setLocalError] = useState(false);
  const dotCount = verifyLocally ? KIOSK_ADMIN_PIN.length : Math.max(PIN_MIN_LENGTH, pin.length);
  const submit = (value: string) => {
    if (value.length < PIN_MIN_LENGTH) return;
    if (verifyLocally && value !== KIOSK_ADMIN_PIN) { setLocalError(true); setPin(''); return; }
    onSubmit(value);
  };
  const press = (digit: string) => {
    setLocalError(false);
    const next = (pin + digit).slice(0, PIN_MAX_LENGTH);
    setPin(next);
    if (verifyLocally && next.length === KIOSK_ADMIN_PIN.length) submit(next);
  };
  const error = localError ? t('admin.pinWrong') : externalError;
  return <section className="admin-sheet page-enter" role="dialog" aria-modal="true" aria-label={t('admin.pinTitle')}>
    <button className="icon-button admin-sheet__close" onClick={onClose} aria-label={t('common.close')}><X /></button>
    <span className="admin-sheet__icon"><Lock /></span>
    <h2>{t('admin.pinTitle')}</h2>
    <p>{t('admin.pinHint')}</p>
    <div className={`pin-dots ${error ? 'pin-dots--error' : ''}`} aria-live="polite">{Array.from({ length: dotCount }, (_, index) => <i key={index} className={index < pin.length ? 'filled' : ''} />)}</div>
    {error && <div className="payment__error">{error}</div>}
    <div className="pin-keypad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => <button type="button" key={digit} onClick={() => press(digit)}>{digit}</button>)}
      <button type="button" className="pin-keypad__muted" onClick={() => setPin((value) => value.slice(0, -1))} aria-label={t('admin.delete')}><Delete /></button>
      <button type="button" onClick={() => press('0')}>0</button>
      <button type="button" className="pin-keypad__ok" disabled={pin.length < PIN_MIN_LENGTH} onClick={() => submit(pin)} aria-label={t('admin.confirm')}><Check /></button>
    </div>
  </section>;
}

function AdminPanel({ kioskId, kioskName, onOpenSetup, onClearCart, onResetLanguage, onClose }: { kioskId: string | null; kioskName: string; onOpenSetup: (pin: string) => void; onClearCart: () => void; onResetLanguage: () => void; onClose: () => void }) {
  const { t } = useKioskLanguage();
  const [pin, setPin] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [testPrint, setTestPrint] = useState<{ busy: boolean; ok?: boolean; message?: string }>({ busy: false });
  const [rotated, setRotated] = useState(receiptRotated);
  const profile = kioskProfile(kioskId);
  const runTestPrint = async () => {
    setDone(false);
    setTestPrint({ busy: true });
    const result = await printTestReceipt(kioskName);
    setTestPrint({ busy: false, ok: result.ok, message: result.message });
  };
  return <div className="admin-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    {pin === null ? <PinPad verifyLocally onSubmit={setPin} onClose={onClose} /> : <section className="admin-sheet page-enter" role="dialog" aria-modal="true" aria-label={t('admin.menuTitle')}>
      <button className="icon-button admin-sheet__close" onClick={onClose} aria-label={t('common.close')}><X /></button>
      <span className="admin-sheet__icon"><Settings /></span>
      <h2>{t('admin.menuTitle')}</h2>
      <p>{t('admin.current', { name: profile ? `${profile.label} (${profile.id})` : '-' })}</p>
      <div className="admin-sheet__actions">
        <button className="primary-button" onClick={() => onOpenSetup(pin)}><CreditCard /> {t('admin.posSettings')}</button>
        <button className="secondary-button" onClick={() => { onClearCart(); setDone(true); }}><Trash2 /> {t('admin.clearCart')}</button>
        <button className="secondary-button" onClick={() => { onResetLanguage(); setDone(true); }}><Languages /> {t('admin.resetLanguage')}</button>
        <button className="secondary-button" disabled={testPrint.busy} onClick={() => { void runTestPrint(); }}>{testPrint.busy ? <RotateCcw className="spin" /> : <Printer />} {t('admin.testPrint')}</button>
        <button className="secondary-button" onClick={() => { const next = !rotated; setReceiptRotated(next); setRotated(next); setDone(true); }}><RotateCcw /> {t(rotated ? 'admin.receiptRotateOn' : 'admin.receiptRotateOff')}</button>
      </div>
      {done && <p className="admin-sheet__done"><Check /> {t('admin.done')}</p>}
      {testPrint.message && <p className={testPrint.ok ? 'admin-sheet__done' : 'admin-sheet__fail'}>{testPrint.ok ? <Check /> : <AlertTriangle />}<span>{testPrint.message}</span></p>}
    </section>}
  </div>;
}

const kioskNumber = (kioskId: string) => kioskId.replace(/^k/i, '');
const formatSerial = (digits: string) => Array.from({ length: POS_SERIAL_LENGTH }, (_, index) => digits[index] ?? '•').join('').replace(/(.{4})(?=.)/g, '$1 ');

/** Kurulum sihirbazı: 1) kiosk numarası, (PIN), 2) Castles POS seri numarası. */
function KioskSetupWizard({ currentId, initialPin, initialStep, onCancel }: { currentId: string | null; initialPin?: string; initialStep: 'kiosk' | 'pos'; onCancel?: () => void }) {
  const { t } = useKioskLanguage();
  const [step, setStep] = useState<'kiosk' | 'pin' | 'pos'>(initialStep === 'pos' && currentId ? (initialPin ? 'pos' : 'pin') : 'kiosk');
  const [selectedId, setSelectedId] = useState<string | null>(currentId);
  const [pin, setPin] = useState(initialPin ?? '');
  const [pinError, setPinError] = useState('');
  const [serial, setSerial] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [profiles, setProfiles] = useState<KioskProfileStatus[] | null>(null);
  const [profilesFailed, setProfilesFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchKioskProfiles()
      .then((list) => { if (!cancelled) setProfiles(list); })
      .catch(() => { if (!cancelled) setProfilesFailed(true); });
    return () => { cancelled = true; };
  }, []);
  const statusOf = (kioskId: string) => profiles?.find((profile) => profile.id === kioskId) ?? null;
  const posLine = (kioskId: string) => {
    const status = statusOf(kioskId);
    if (!status) return profilesFailed ? t('setup.posUnknown') : '…';
    return status.posConfigured ? t('setup.posLast4', { last4: status.posSerialLast4 ?? '????' }) : t('setup.posMissing');
  };
  const selectedStatus = selectedId ? statusOf(selectedId) : null;
  const goNext = () => {
    if (!selectedId) return;
    setError('');
    setStep(pin ? 'pos' : 'pin');
  };
  const finish = (kioskId: string) => {
    if (!setActiveKioskId(kioskId)) { setError(t('setup.storageError')); return; }
    if (kioskId === currentId && onCancel) onCancel();
    else window.location.reload();
  };
  const save = async () => {
    if (!selectedId || serial.length !== POS_SERIAL_LENGTH || saving) return;
    setSaving(true);
    setError('');
    try {
      await saveKioskPos(selectedId, pin, serial);
      if (!setActiveKioskId(selectedId)) { setError(t('setup.storageError')); return; }
      window.location.reload();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : t('setup.saveFailed');
      if (reason instanceof ApiError && reason.status === 403) {
        setPin('');
        setPinError(message);
        setStep('pin');
      } else {
        setError(message);
      }
    } finally {
      setSaving(false);
    }
  };
  const pressSerial = (digit: string) => { setError(''); setSerial((value) => (value + digit).slice(0, POS_SERIAL_LENGTH)); };

  if (step === 'pin') {
    return <main className="kiosk-setup kiosk-setup--pin page-enter">
      <PinPad verifyLocally={false} error={pinError} onSubmit={(value) => { setPin(value); setPinError(''); setStep('pos'); }} onClose={() => { setPinError(''); if (initialStep === 'pos' && onCancel && !selectedId) onCancel(); else setStep('kiosk'); }} />
    </main>;
  }

  return <main className="kiosk-setup page-enter">
    <header className="kiosk-setup__header">
      <span className="kiosk-setup__badge">{step === 'kiosk' ? <Settings /> : <CreditCard />}</span>
      <div>
        <small className="kiosk-setup__step">{t('setup.stepOf', { step: step === 'kiosk' ? 1 : 2 })}</small>
        <h1>{step === 'kiosk' ? t('setup.step1Title') : t('setup.step2Title')}</h1>
        <p>{step === 'kiosk' ? t('setup.step1Hint') : t('setup.posHint')}</p>
      </div>
      {onCancel && <button className="icon-button" onClick={onCancel} aria-label={t('common.close')}><X /></button>}
    </header>

    {step === 'kiosk' && <>
      {profilesFailed && <p className="kiosk-setup__notice"><AlertTriangle /> {t('setup.offline')}</p>}
      <div className="kiosk-setup__grid kiosk-setup__grid--numbers">
        {KIOSK_PROFILES.map((item) => {
          const isSelected = item.id === selectedId;
          const status = statusOf(item.id);
          return <button type="button" key={item.id} className={`kiosk-number ${isSelected ? 'kiosk-number--selected' : ''} ${status && !status.posConfigured ? 'kiosk-number--no-pos' : ''}`} onClick={() => setSelectedId(item.id)} aria-pressed={isSelected}>
            <b>{kioskNumber(item.id)}</b>
            <small>{posLine(item.id)}</small>
            {item.id === currentId && <em>{t('setup.current')}</em>}
            {status && !status.active && <em className="kiosk-number__inactive">{t('setup.inactive')}</em>}
            {isSelected && <i><Check /></i>}
          </button>;
        })}
      </div>
      <footer className="kiosk-setup__footer">
        <div><b>{selectedId ? t('setup.selected', { number: kioskNumber(selectedId) }) : t('setup.pickKiosk')}</b><small>{error || (selectedId ? posLine(selectedId) : '')}</small></div>
        <button className="primary-button" disabled={!selectedId} onClick={goNext}>{t('setup.next')} <ArrowRight /></button>
      </footer>
    </>}

    {step === 'pos' && selectedId && <div className="pos-setup">
      <div className="pos-setup__kiosk">
        <span className="pos-setup__number">{kioskNumber(selectedId)}</span>
        <div>
          <b>{kioskProfile(selectedId)?.label}</b>
          <small>{selectedStatus?.name ?? ''}</small>
          <small className={selectedStatus?.posConfigured ? 'pos-setup__current' : 'pos-setup__current pos-setup__current--missing'}>{selectedStatus?.posConfigured ? t('setup.currentPos', { last4: selectedStatus.posSerialLast4 ?? '????' }) : posLine(selectedId)}</small>
        </div>
        <button type="button" className="secondary-button" onClick={() => { setError(''); setStep('kiosk'); }}>{t('setup.changeKiosk')}</button>
      </div>
      <div className={`pos-setup__serial ${serial.length === POS_SERIAL_LENGTH ? 'pos-setup__serial--complete' : ''}`} aria-live="polite" aria-label={t('setup.serialLabel')}>{formatSerial(serial)}</div>
      <small className="pos-setup__count">{t('setup.serialCount', { count: serial.length })}</small>
      {error && <div className="payment__error pos-setup__error" role="alert">{error}</div>}
      <div className="pin-keypad pos-setup__keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => <button type="button" key={digit} disabled={saving} onClick={() => pressSerial(digit)}>{digit}</button>)}
        <button type="button" className="pin-keypad__muted" disabled={saving} onClick={() => { setError(''); setSerial(''); }}>{t('admin.clear')}</button>
        <button type="button" disabled={saving} onClick={() => pressSerial('0')}>0</button>
        <button type="button" className="pin-keypad__muted" disabled={saving} onClick={() => setSerial((value) => value.slice(0, -1))} aria-label={t('admin.delete')}><Delete /></button>
      </div>
      <div className="pos-setup__actions">
        <button type="button" className="secondary-button" disabled={saving} onClick={() => finish(selectedId)}>{t('setup.later')}</button>
        <button type="button" className="primary-button" disabled={saving || serial.length !== POS_SERIAL_LENGTH} onClick={save}>{saving ? <RotateCcw className="spin" /> : <Check />} {saving ? t('setup.saving') : t('setup.saveAndStart')}</button>
      </div>
    </div>}
  </main>;
}

function LanguageControl() {
  const { language, setLanguage, t } = useKioskLanguage();
  const [open, setOpen] = useState(false);
  return <div className="language-control">
    <button type="button" className={`utility-button utility-button--language ${open ? 'utility-button--open' : ''}`} onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open} aria-controls="language-picker" aria-label={t('language.choose')}><span><Languages /></span><small>{t('language.title')}</small><b>{t('language.current')}</b></button>
    {open && <><button type="button" className="language-picker__backdrop" onClick={() => setOpen(false)} aria-label={t('common.close')} tabIndex={-1} /><section id="language-picker" className="language-picker" role="menu" aria-label={t('language.choose')}><header className="language-picker__header"><span><Languages /></span><div><small>{t('language.title')}</small><b>{t('language.choose')}</b></div></header><div className="language-picker__options">{SUPPORTED_LANGUAGES.map((option) => { const selected = option === language; return <button type="button" role="menuitemradio" aria-checked={selected} key={option} className={selected ? 'selected' : ''} onClick={() => { setLanguage(option); setOpen(false); }}><span>{option.toUpperCase()}</span><b>{option === 'tr' ? t('language.turkish') : t('language.english')}</b>{selected && <i><Check /></i>}</button>; })}</div></section></>}
  </div>;
}

function Intro({ config, onStart, loading, onAdmin }: { config: KioskConfig | null; onStart: () => void; loading: boolean; onAdmin: () => void }) {
  const { t } = useKioskLanguage();
  const featured = config?.sections.find((section) => section.id === config.kiosk.featuredSectionId) ?? null;
  const orbit = (config?.sections ?? []).filter((section) => section.id !== featured?.id).slice(0, 8);
  return <div className="hub-intro" role="button" tabIndex={0} onClick={onStart} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onStart(); }} aria-label={t('intro.startAria')}>
    <div className="hub-intro__rays" />
    <header className="hub-intro__header"><AdminTrigger onTrigger={onAdmin}><BrandMark light icon={featured?.icon} /></AdminTrigger></header>
    <div className="hub-intro__art" aria-hidden="true">
      <div className="hub-intro__orbit">{orbit.map((section, index) => <span key={section.id} style={{ '--i': index, '--n': orbit.length, ...accentThemeVars(section.accent) } as CSSProperties}><SectionGlyph icon={section.icon} /></span>)}</div>
      <div className="hub-intro__core"><SectionGlyph icon={featured?.icon} /></div>
    </div>
    <div className="hub-intro__copy">
      <p>{t('intro.eyebrow')}</p>
      <h1>{t('intro.title')} <i>{t('intro.magic')}</i>{t('intro.titleEnd')}</h1>
      <span>{config?.kiosk.name ? `${config.kiosk.name} · ` : ''}{t('intro.subtitle')}</span>
    </div>
    <div className="hub-intro__touch"><span>{loading ? t('intro.loading') : t('intro.touch')}</span><ArrowRight /></div>
  </div>;
}

function Home({ config, cart, soundOn, onToggleSound, onSection, onCart, onAdmin }: { config: KioskConfig; cart: CartLine[]; soundOn: boolean; onToggleSound: () => void; onSection: (sectionId: string) => void; onCart: () => void; onAdmin: () => void }) {
  const { t } = useKioskLanguage();
  const ownSectionId = config.kiosk.featuredSectionId;
  // Kioskun kendi reyonu ilk sırada; diğerleri sıralamalarına göre.
  const sections = [...config.sections].sort((left, right) => {
    if (left.id === ownSectionId) return -1;
    if (right.id === ownSectionId) return 1;
    return (left.position ?? 0) - (right.position ?? 0);
  });
  const ownSection = sections.find((section) => section.id === ownSectionId) ?? null;
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  return <main className={`home page-enter ${itemCount ? 'home--with-cart' : ''}`}>
    <header className="home__header">
      <AdminTrigger onTrigger={onAdmin} className="home__identity">
        <span className="home__identity-icon"><SectionGlyph icon={ownSection?.icon} /></span>
        <span className="home__identity-copy"><small>{config.brand?.name || 'MagicPay Kiosk'}</small><b>{config.kiosk.name.split(' · ')[0]}</b></span>
      </AdminTrigger>
      <div className="home__utilities order-type__actions">
        <LanguageControl />
        <button className="utility-button utility-button--sound" onClick={onToggleSound}><span className={soundOn ? 'green' : 'red'}>{soundOn ? <Volume2 /> : <VolumeX />}</span><small>{t('audio.title')}</small><b>{soundOn ? t('audio.on') : t('audio.off')}</b></button>
      </div>
    </header>
    <div className="home__scroll">
      <div className="home__greeting"><h1>{t('home.title')}</h1><p>{t('home.allCategoriesHint')}</p></div>
      <div className="section-grid">
        {sections.map((section) => <button type="button" key={section.id} className={`section-card ${section.id === ownSectionId ? 'section-card--own' : ''}`} style={accentThemeVars(section.accent)} onClick={() => onSection(section.id)}>
          {section.id === ownSectionId && <span className="section-card__badge">{t('home.ownSection')}</span>}
          <span className="section-card__icon"><SectionGlyph icon={section.icon} /></span>
          <b>{section.name}</b>
          {section.tagline && <small>{section.tagline}</small>}
          <em>{t('home.productCount', { count: section.productCount ?? 0 })}</em>
        </button>)}
      </div>
    </div>
    {itemCount > 0 && <button className="cart-bar cart-bar--ready home__cart" onClick={onCart}><span className="cart-bar__icon"><ShoppingBag /><i>{itemCount}</i></span><b>{t('cart.go')}</b><strong>{money(total)}</strong></button>}
  </main>;
}

function ProductCard({ product, quantity, categoryName }: { product: Product; quantity: number; categoryName?: string }) {
  const { t } = useKioskLanguage();
  const disabled = product.available === false;
  return <button type="button" className={`product-card ${disabled ? 'product-card--disabled' : ''}`} data-product-id={product.id} data-clickable="product" disabled={disabled}>
    {product.popular && <span className="product-card__popular">{t('product.popular')}</span>}{quantity > 0 && <span className="product-card__quantity">{quantity}</span>}
    <ProductVisual product={product} className="product-card__visual" />
    <div className="product-card__body"><small>{disabled ? product.unavailableReason : categoryName}</small><h3>{product.name}</h3><p>{product.description}</p><b>{money(product.price)}</b></div>
  </button>;
}

function CatalogScreen({ catalog, section, cart, onProduct, onHome, onHeaderCart, onBottomCart, onAdmin }: { catalog: Catalog; section: SectionSummary | null; cart: CartLine[]; onProduct: (product: Product) => void; onHome: () => void; onHeaderCart: () => void; onBottomCart: () => void; onAdmin: () => void }) {
  const { t } = useKioskLanguage();
  const [activeCategory, setActiveCategory] = useState('all');
  const [categoryScroll, setCategoryScroll] = useState({ left: false, right: false });
  const categoriesRef = useRef<HTMLElement>(null);
  const productsRef = useRef<HTMLElement>(null);
  const lastPointerHandledRef = useRef(0);
  const categoryNames = useMemo(() => new Map(catalog.categories.map((category) => [category.id, category.name])), [catalog.categories]);
  const visibleCategories = activeCategory === 'all' ? catalog.categories : catalog.categories.filter((item) => item.id === activeCategory);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const selectCategory = (categoryId: string) => { setActiveCategory(categoryId); productsRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); };
  const scrollCategories = (direction: -1 | 1) => {
    const categories = categoriesRef.current;
    if (!categories) return;
    categories.scrollBy({ left: direction * categories.clientWidth * 0.75, behavior: 'smooth' });
  };
  useEffect(() => { setActiveCategory('all'); productsRef.current?.scrollTo({ top: 0 }); }, [section?.id]);
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
      }
    };

    document.addEventListener('pointerup', handleNativePress, { capture: true });
    document.addEventListener('click', handleNativePress, { capture: true });
    return () => {
      document.removeEventListener('pointerup', handleNativePress, { capture: true });
      document.removeEventListener('click', handleNativePress, { capture: true });
    };
  }, [catalog.products, onBottomCart, onHeaderCart, onProduct]);
  return <main className="catalog page-enter" style={accentThemeVars(section?.accent)}>
    <header className="catalog__header">
      <button type="button" className="catalog__home" onClick={onHome}><ArrowLeft /><span>{t('catalog.backHome')}</span></button>
      <AdminTrigger onTrigger={onAdmin} className="catalog__section"><span className="catalog__section-icon"><SectionGlyph icon={section?.icon} /></span><b>{section?.name ?? catalog.section?.name ?? ''}</b></AdminTrigger>
      <button className="header-cart" data-clickable="cart" onClick={onHeaderCart}><span><ShoppingBag />{itemCount > 0 && <i>{itemCount}</i>}</span><span><b>{t('cart.myCart')}</b><small>{itemCount ? money(total) : t('cart.empty')}</small></span></button>
    </header>
    <div className="category-menu"><div className="category-menu__label"><small>{t('catalog.menu')}</small><b>{t('catalog.chooseCategory')}</b></div><div className="categories-wrap">{categoryScroll.left && <button type="button" className="categories-wrap__hint categories-wrap__hint--prev" onClick={() => scrollCategories(-1)} aria-label={t('catalog.moreCategories')}><ArrowLeft /></button>}<nav ref={categoriesRef} className="categories" aria-label={t('catalog.categoriesAria')}><button className={activeCategory === 'all' ? 'active' : ''} onClick={() => selectCategory('all')}>{t('catalog.all')}</button>{catalog.categories.map((item) => <button key={item.id} className={item.id === activeCategory ? 'active' : ''} onClick={() => selectCategory(item.id)}>{item.name}</button>)}</nav>{categoryScroll.right && <button type="button" className="categories-wrap__hint categories-wrap__hint--next" onClick={() => scrollCategories(1)} aria-label={t('catalog.moreCategories')}><ArrowRight /></button>}</div></div>
    <section ref={productsRef} className={`products ${activeCategory === 'all' ? 'products--all' : ''}`}>{!catalog.products.length && <p className="catalog__empty">{t('catalog.empty')}</p>}{visibleCategories.map((category) => {
      const categoryProducts = catalog.products.filter((product) => product.categoryId === category.id);
      if (!categoryProducts.length) return null;
      return <section className="category-section" key={category.id}><div className="section-heading"><h1>{category.name}</h1><span /><small>{categoryProducts.length} {t(categoryProducts.length === 1 ? 'catalog.product' : 'catalog.products')}</small></div><div className="product-grid">{categoryProducts.map((product) => <ProductCard key={product.id} product={product} categoryName={categoryNames.get(product.categoryId)} quantity={productCartQuantity(cart, product.id)} />)}</div></section>;
    })}</section>
    <button className={`cart-bar ${itemCount ? 'cart-bar--ready' : ''}`} data-clickable="cart" onClick={onBottomCart}><span className="cart-bar__icon"><ShoppingBag />{itemCount > 0 && <i>{itemCount}</i>}</span>{itemCount ? <><b>{t('cart.go')}</b><strong>{money(total)}</strong></> : <span>{t('cart.placeholder')}</span>}</button>
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

function Customizer({ product, section, initial, onClose, onSave }: { product: Product; section: SectionSummary | null; initial?: Selection; onClose: () => void; onSave: (selection: Selection, unitPrice: number) => void }) {
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
  const heroImage = CUSTOMIZER_HERO_IMAGES[product.id] ?? product.image;
  return <main className="customizer page-enter" role="dialog" aria-modal="true" style={accentThemeVars(section?.accent)}>
    <header><button className="icon-button" onClick={onClose} aria-label={t('common.close')}><X /></button><div><small>{t('customizer.prepare')}</small><h2>{product.name}</h2></div><b>{money(unitPrice)}</b></header>
    <div className={`customizer__hero ${heroImage ? '' : 'customizer__hero--emoji'}`}>{heroImage ? <img src={assetUrl(heroImage)} alt={product.name} draggable={false} loading="eager" decoding="async" /> : <span>{product.emoji || '🛍️'}</span>}<div><span>{(section?.name ?? 'MagicPay Kiosk').toLocaleUpperCase(language === 'tr' ? 'tr-TR' : 'en-US')}</span><b>{customizationStepLabel(language, stepId, step)}</b></div></div>
    <nav className="steps">{steps.map(([id, item], stepIndex) => <button key={id} className={stepIndex === index ? 'active' : ''} onClick={() => setIndex(stepIndex)}><i>{stepIndex + 1}</i>{customizationStepLabel(language, id, item)}</button>)}</nav>
    <div className="customizer__content"><div className="customizer__title"><span><small>{t('customizer.selection')}</small><h3>{customizationStepLabel(language, stepId, step)}</h3></span><p>{step.required ? t('customizer.required') : t('customizer.optional')}</p></div>
      <div className="option-list">{step.options.filter((option) => option.enabled !== false).map((option) => {
        const selected = (choices[stepId] ?? []).includes(option.id);
        return <button key={option.id} className={selected ? 'selected' : ''} disabled={option.available === false} onClick={() => toggle(stepId, option.id, maxSelections(stepId, step))}><span>{selected && <Check />}</span><b>{customizationOptionLabel(language, stepId, option)}</b><small>{option.priceDelta ? `+${money(option.priceDelta)}` : option.available === false ? t('product.soldOut') : t('product.included')}</small></button>;
      })}</div>{error && <div className="payment__error">{error}</div>}</div>
    <footer><button className="secondary-button" onClick={onClose}>{t('common.cancel')}</button><button className="primary-button" disabled={index === steps.length - 1 && !requiredSelectionsComplete} onClick={next}>{index === steps.length - 1 ? t('common.addToCart') : t('common.continue')}</button></footer>
  </main>;
}

function CartDrawer({ cart, sectionOf, onClose, onQuantity, onDelete, onEdit, onCheckout }: { cart: CartLine[]; sectionOf: SectionLookup; onClose: () => void; onQuantity: (key: string, delta: number) => void; onDelete: (key: string) => void; onEdit: (line: CartLine) => void; onCheckout: () => void }) {
  const { language, t } = useKioskLanguage();
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const upper = (value: string) => value.toLocaleUpperCase(language === 'tr' ? 'tr-TR' : 'en-US');
  return <main className="cart-drawer page-enter">
    <header><span><ShoppingBag /></span><div><h2>{t('cart.myCart')}</h2><small>{t('cart.lineCount', { count: itemCount })}</small></div><button className="icon-button" onClick={onClose} aria-label={t('common.close')}><X /></button></header>
    <div className="cart-drawer__items">{!cart.length && <div className="empty-cart"><ShoppingBag /><h3>{t('cart.emptyLong')}</h3><p>{t('cart.emptyHint')}</p></div>}{cart.map((line) => {
      const section = sectionOf(line.product.sectionId);
      return <article className="cart-line" key={line.key} style={accentThemeVars(section?.accent)}><ProductVisual product={line.product} className="cart-line__image" /><div className="cart-line__main"><small>{upper(section?.name ?? 'MagicPay Kiosk')}</small><h3>{line.product.name}</h3><p>{Object.values(line.selection?.choices ?? {}).flat().length ? t('cart.customized') : t('cart.standard')}</p><div><button disabled={line.quantity === 1} onClick={() => onQuantity(line.key, -1)}><Minus /></button><b>{line.quantity}</b><button className="plus" onClick={() => onQuantity(line.key, 1)}><Plus /></button>{hasActiveCustomization(line.product) && <button className="edit" onClick={() => onEdit(line)}>{t('cart.edit')}</button>}<button className="delete" onClick={() => onDelete(line.key)}><Trash2 /> {t('cart.delete')}</button></div></div><strong>{money(line.unitPrice * line.quantity)}</strong></article>;
    })}</div>
    <footer><div><small>{t('cart.total')}</small><b>{money(total)}</b><span>{itemCount} {t('cart.items')}</span></div><button className="primary-button" disabled={!cart.length} onClick={onCheckout}>{t('cart.checkout')}</button></footer>
  </main>;
}

const POS_SUCCESS = new Set<PosPaymentStatus>(['COMPLETED', 'PAID', 'SUCCESS', 'SUCCEEDED']);
const POS_FAILURE = new Set<PosPaymentStatus>(['FAILED', 'ERROR', 'CANCELLED', 'CANCELED', 'DECLINED']);
const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function Payment({ cart, posConfigured, kioskName, categoryOf, onBack, onBeginPayment, onPaymentFailed, onSuccess, onReceiptStatus }: { cart: CartLine[]; posConfigured: boolean; kioskName: string; categoryOf: (line: CartLine) => string; onBack: () => void; onBeginPayment: () => void; onPaymentFailed: () => void; onSuccess: (orderNumber: string) => void; onReceiptStatus: (status: ReceiptPrintStatus) => void }) {
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
  const approvalRef = useRef<ReceiptApproval | undefined>(undefined);
  const requestControllerRef = useRef<AbortController | null>(null);
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  const finishPaidOrder = async (selectedMethod: 'card' | 'meal-card') => {
    if (!orderRequestIdRef.current) orderRequestIdRef.current = uniqueRequestId('order');
    setPhase('saving');
    const order = await submitOrder({
      clientRequestId: orderRequestIdRef.current,
      fulfillment: FULFILLMENT,
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
      fulfillment: FULFILLMENT,
      kioskName,
      paymentMethod: selectedMethod,
      paymentReference: paymentReferenceRef.current,
      approval: approvalRef.current,
      language,
      total,
      lines: cart,
      categoryOf,
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
    if (!posConfigured || processingRef.current) return;
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
        : await startPosPayment({ clientRequestId: paymentRequestIdRef.current, paymentMethod: selectedMethod, amount: total, lines: cart, signal: controller.signal });
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
      approvalRef.current = paymentApproval(result);
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
  const methodsDisabled = busy || !posConfigured;
  return <main className="payment page-enter"><section className="payment__methods"><header><button className="icon-button" onClick={handleBack} disabled={backDisabled} aria-label={t('common.back')}><ArrowLeft /></button><div><h1>{t('payment.title')}</h1><p>{t('payment.hint')}</p></div></header>{!posConfigured && <div className="payment__pos-warning" role="alert"><AlertTriangle /><span>{t('payment.posNotConfigured')}</span></div>}<div className="payment-options"><button className={method === 'card' ? 'selected' : ''} disabled={methodsDisabled} onClick={() => complete('card')}><span><CreditCard /></span><b>{t('payment.card')}</b><small>{t('payment.cardHint')}</small></button><button className={method === 'meal-card' ? 'selected' : ''} disabled={methodsDisabled} onClick={() => complete('meal-card')}><span className="dark"><UtensilsCrossed /></span><b>{t('payment.mealCard')}</b><small>{t('payment.mealCardHint')}</small></button></div>{statusText && <div className="payment__status" role="status" aria-live="polite"><span className="spin" />{statusText}</div>}{error && <div className="payment__error">{error}<button onClick={() => method && complete(method)}>{t('payment.retryPos')}</button></div>}</section><aside className="payment__summary"><div className="amount"><small>{t('payment.amount')}</small><b>{money(total)}</b></div><div className="summary-card"><header><b>{t('payment.summary')}</b><span>{itemCount} {t(itemCount === 1 ? 'cart.item' : 'cart.items')}</span></header><div className="summary-card__lines">{cart.map((line) => <div key={line.key}><span><b>{line.product.name}</b><small>{line.quantity} {t('cart.quantityUnit')}</small></span><strong>{money(line.unitPrice * line.quantity)}</strong></div>)}</div><div className="summary-total"><span>{t('payment.total')}</span><b>{money(total)}</b></div></div></aside></main>;
}

function Success({ orderNumber, receiptStatus, icon, onRestart }: { orderNumber: string; receiptStatus: ReceiptPrintStatus | 'printing'; icon?: string | null; onRestart: () => void }) {
  const { t } = useKioskLanguage();
  return <main className="success page-enter"><BrandMark icon={icon} /><span className="success__check"><CheckCircle2 /></span><p>{t('success.received')}</p><h1>{t('success.thanks')}</h1><h2>{t('success.preparing')}</h2><div><small>{t('success.number')}</small><b>{orderNumber}</b></div>{receiptStatus === 'printing' && <p className="success__receipt">{t('payment.printingReceipt')}</p>}{receiptStatus === 'printed' && <p className="success__receipt">{t('success.receiptPrinted')}</p>}{receiptStatus === 'failed' && <p className="success__receipt success__receipt--error">{t('success.receiptFailed')}</p>}<button className="primary-button" onClick={onRestart}><RotateCcw /> {t('success.newOrder')}</button></main>;
}

export default function App() {
  const { language, setLanguage, t } = useKioskLanguage();
  const [kioskId] = useState(() => getActiveKioskId());
  const [setup, setSetup] = useState<{ step: 'kiosk' | 'pos'; pin?: string } | null>(() => (kioskId ? null : { step: 'kiosk' }));
  const setupOpen = setup !== null;
  const [adminOpen, setAdminOpen] = useState(false);
  const [screen, setScreen] = useState<Screen>('intro');
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [configLoading, setConfigLoading] = useState(false);
  const [catalogs, setCatalogs] = useState<Record<string, Catalog>>({});
  const [catalogError, setCatalogError] = useState('');
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customizing, setCustomizing] = useState<Product | null>(null);
  const [editing, setEditing] = useState<CartLine | null>(null);
  const [cartOpen, setCartOpen] = useState<'full' | 'sheet' | null>(null);
  const [orderNumber, setOrderNumber] = useState('');
  const [receiptStatus, setReceiptStatus] = useState<ReceiptPrintStatus | 'printing'>('printing');
  const [notice, setNotice] = useState('');
  const [startPending, setStartPending] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const configRequestRef = useRef(0);
  const catalogRequestRef = useRef(0);
  const kioskAudio = useKioskAudio(soundOn, language);

  const localProfile = kioskProfile(kioskId);
  const featuredSectionId = config?.kiosk.featuredSectionId ?? localProfile?.section.id ?? null;
  const sectionOf = useCallback<SectionLookup>((sectionId) => {
    if (!sectionId) return null;
    const fromConfig = config?.sections.find((section) => section.id === sectionId);
    if (fromConfig) return fromConfig;
    const local = sectionProfile(sectionId);
    return local ? { id: local.id, name: language === 'en' ? local.nameEn : local.name, tagline: language === 'en' ? local.taglineEn : local.tagline, icon: local.icon, accent: local.accent } : null;
  }, [config, language]);
  const featuredSection = sectionOf(featuredSectionId);

  useEffect(() => {
    applyRootTheme(featuredSection?.accent ?? localProfile?.section.accent);
  }, [featuredSection?.accent, localProfile?.section.accent]);

  const loadConfig = useCallback(() => {
    if (!kioskId) return;
    const requestId = ++configRequestRef.current;
    setConfigError('');
    setConfigLoading(true);
    fetchKioskConfig(language).then((nextConfig) => {
      if (requestId !== configRequestRef.current) return;
      setConfig(nextConfig);
    }).catch((error: Error) => {
      if (requestId !== configRequestRef.current) return;
      setConfigError(error.message);
      setStartPending(false);
    }).finally(() => {
      if (requestId === configRequestRef.current) setConfigLoading(false);
    });
  }, [kioskId, language]);
  useEffect(loadConfig, [loadConfig]);

  const catalogKey = activeSectionId ? `${language}:${activeSectionId}` : '';
  const activeCatalog = catalogKey ? catalogs[catalogKey] ?? null : null;
  const loadCatalog = useCallback((sectionId: string) => {
    const requestId = ++catalogRequestRef.current;
    const requestedLanguage = language;
    setCatalogError('');
    fetchCatalog(requestedLanguage, sectionId).then((nextCatalog) => {
      if (nextCatalog.language && nextCatalog.language !== requestedLanguage) return;
      const products = nextCatalog.products.map((product) => ({ ...product, sectionId: product.sectionId ?? sectionId }));
      const normalized = { ...nextCatalog, products };
      setCatalogs((current) => ({ ...current, [`${requestedLanguage}:${sectionId}`]: normalized }));
      setCart((items) => items.map((line) => {
        const product = products.find((candidate) => candidate.id === line.product.id);
        return product ? { ...line, product } : line;
      }));
      preloadCatalogImages(normalized);
    }).catch((error: Error) => {
      if (requestId !== catalogRequestRef.current) return;
      setCatalogError(error.message);
    });
  }, [language]);
  useEffect(() => {
    if (activeSectionId && !catalogs[`${language}:${activeSectionId}`]) loadCatalog(activeSectionId);
  }, [activeSectionId, catalogs, language, loadCatalog]);

  useEffect(() => {
    const refreshOnVisible = () => {
      if (document.visibilityState !== 'visible') return;
      loadConfig();
      setCatalogs({});
    };
    document.addEventListener('visibilitychange', refreshOnVisible);
    return () => document.removeEventListener('visibilitychange', refreshOnVisible);
  }, [loadConfig]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    prepareOrderPrinter();
  }, []);
  useEffect(() => {
    if (startPending && config) {
      setStartPending(false);
      kioskAudio.play('welcome.mp3');
      setScreen('home');
    }
  }, [config, kioskAudio, startPending]);

  const startOrder = () => {
    if (config) {
      kioskAudio.play('welcome.mp3');
      setScreen('home');
      return;
    }
    setNotice(t('notice.menuWaiting'));
    setStartPending(true);
    if (!configLoading) loadConfig();
  };
  const openSection = (sectionId: string) => {
    kioskAudio.stop();
    kioskAudio.play('product-selection-prompt.mp3');
    setActiveSectionId(sectionId);
    setCartOpen(null);
    setScreen('catalog');
  };
  const addProduct = useCallback((product: Product) => {
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
  }, [cart, t]);
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
    setCartOpen(null);
    setCustomizing(null);
    setEditing(null);
    setNotice('');
    setActiveSectionId(null);
    setLanguage('tr');
    setScreen('intro');
  }, [kioskAudio, setLanguage]);
  useEffect(() => {
    if (screen !== 'success' || !orderNumber) return;
    const timeout = window.setTimeout(restart, 10000);
    return () => window.clearTimeout(timeout);
  }, [orderNumber, restart, screen]);

  // Boşta kalma: ana menü / katalog / sepet ekranlarında dokunuş olmazsa açılış ekranına dönülür.
  const idleEligible = !setupOpen && !adminOpen && (screen === 'home' || screen === 'catalog');
  useEffect(() => {
    if (!idleEligible) return;
    let timeout = window.setTimeout(restart, IDLE_RESET_MS);
    const bump = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(restart, IDLE_RESET_MS);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((name) => window.addEventListener(name, bump, { passive: true }));
    return () => {
      window.clearTimeout(timeout);
      events.forEach((name) => window.removeEventListener(name, bump));
    };
  }, [idleEligible, restart]);

  const goHome = useCallback(() => { kioskAudio.stop(); setCartOpen(null); setScreen('home'); }, [kioskAudio]);
  const openFullCart = useCallback(() => setCartOpen('full'), []);
  const openSheetCart = useCallback(() => setCartOpen('sheet'), []);
  const openAdmin = useCallback(() => setAdminOpen(true), []);
  const checkout = () => { kioskAudio.play('payment-method-selection.mp3'); setCartOpen(null); setScreen('payment'); };
  const editLine = (line: CartLine) => { setEditing(line); setCustomizing(line.product); setCartOpen(null); };
  const deleteLine = (key: string) => setCart((items) => items.filter((line) => line.key !== key));
  const activeSection = sectionOf(activeSectionId);
  const adminPanel = adminOpen && <AdminPanel kioskId={kioskId} kioskName={config?.kiosk.name ?? localProfile?.label ?? ''} onClose={() => setAdminOpen(false)} onOpenSetup={(pin) => { setAdminOpen(false); setSetup({ step: 'pos', pin }); }} onClearCart={() => { setCart([]); setCartOpen(null); }} onResetLanguage={() => setLanguage('tr')} />;

  if (setupOpen) {
    return <div className="app-shell kiosk-no-focus-ring"><KioskSetupWizard currentId={kioskId} initialStep={setup.step} initialPin={setup.pin} onCancel={kioskId ? () => setSetup(null) : undefined} /></div>;
  }

  const drawer = <CartDrawer cart={cart} sectionOf={sectionOf} onClose={() => setCartOpen(null)} onQuantity={updateQuantity} onDelete={deleteLine} onEdit={editLine} onCheckout={checkout} />;
  return <div className="app-shell kiosk-no-focus-ring">
    {screen === 'intro' && <Intro config={config} onStart={startOrder} loading={configLoading && !config} onAdmin={openAdmin} />}
    {notice && <div className="stock-toast">{notice}</div>}
    {customizing && <Customizer product={customizing} section={sectionOf(customizing.sectionId)} initial={editing?.selection} onClose={() => { setCustomizing(null); setEditing(null); }} onSave={saveCustomized} />}
    {!customizing && cartOpen !== 'full' && screen === 'home' && config && <Home config={config} cart={cart} soundOn={soundOn} onToggleSound={() => setSoundOn((value) => !value)} onSection={openSection} onCart={openSheetCart} onAdmin={openAdmin} />}
    {!customizing && cartOpen !== 'full' && screen === 'catalog' && activeCatalog && <CatalogScreen catalog={activeCatalog} section={activeSection} cart={cart} onProduct={addProduct} onHome={goHome} onHeaderCart={openFullCart} onBottomCart={openSheetCart} onAdmin={openAdmin} />}
    {!customizing && cartOpen === 'full' && drawer}
    {!customizing && cartOpen === 'sheet' && <div className="cart-sheet-layer"><button type="button" className="cart-sheet-backdrop" onClick={() => setCartOpen(null)} aria-label={t('common.close')} />{drawer}</div>}
    {!customizing && !cartOpen && screen === 'payment' && <Payment cart={cart} posConfigured={config?.kiosk.posConfigured ?? false} kioskName={config?.kiosk.name ?? localProfile?.label ?? ''} categoryOf={(line) => sectionOf(line.product.sectionId)?.name ?? ''} onBack={() => { kioskAudio.stop(); setScreen(activeSectionId ? 'catalog' : 'home'); setCartOpen('full'); }} onBeginPayment={() => kioskAudio.play('card-reader-prompt.mp3')} onPaymentFailed={() => kioskAudio.playSequence(['payment-failed-notice.mp3', 'payment-failed-prompt.mp3'])} onSuccess={(number) => { kioskAudio.playSequence(['order-complete-success.mp3', 'order-created.mp3']); setOrderNumber(number); setReceiptStatus('printing'); setCart([]); setScreen('success'); }} onReceiptStatus={setReceiptStatus} />}
    {!customizing && !cartOpen && screen === 'success' && <Success orderNumber={orderNumber} receiptStatus={receiptStatus} icon={featuredSection?.icon} onRestart={restart} />}
    {configError && !config && <div className="load-error"><AdminTrigger onTrigger={openAdmin}><BrandMark icon={featuredSection?.icon} /></AdminTrigger><h2>{t('loading.catalogError')}</h2><p>{configError}</p><p>{t('loading.catalogErrorHint')}</p><button className="primary-button" onClick={loadConfig}>{t('common.retry')}</button></div>}
    {screen === 'catalog' && !activeCatalog && catalogError && <div className="load-error"><BrandMark icon={activeSection?.icon} /><h2>{t('loading.catalogError')}</h2><p>{catalogError}</p><div className="load-error__actions"><button className="secondary-button" onClick={goHome}><House /> {t('catalog.backHome')}</button><button className="primary-button" onClick={() => activeSectionId && loadCatalog(activeSectionId)}>{t('common.retry')}</button></div></div>}
    {((screen === 'home' && !config && !configError) || (screen === 'catalog' && !activeCatalog && !catalogError)) && <div className="loading"><BrandMark light icon={(activeSection ?? featuredSection)?.icon} /><span /><p>{t('loading.catalog')}</p></div>}
    {adminPanel}
  </div>;
}
