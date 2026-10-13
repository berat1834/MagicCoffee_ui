import type { CSSProperties } from 'react';

type Rgb = [number, number, number];

const FALLBACK_ACCENT = '#7a4a2a';

function parseHex(value: string | null | undefined): Rgb {
  const raw = (value ?? '').trim().replace(/^#/, '');
  const hex = raw.length === 3 ? raw.split('').map((part) => part + part).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return parseHex(FALLBACK_ACCENT);
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as Rgb;
}

const toHex = (rgb: Rgb) => `#${rgb.map((part) => Math.round(Math.min(255, Math.max(0, part))).toString(16).padStart(2, '0')).join('')}`;
const mix = (color: Rgb, target: Rgb, amount: number): Rgb => color.map((part, index) => part + (target[index] - part) * amount) as Rgb;
const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

function luminance(rgb: Rgb) {
  const [r, g, b] = rgb.map((part) => {
    const channel = part / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrastWithWhite = (rgb: Rgb) => 1.05 / (luminance(rgb) + 0.05);

/** Beyaz metinle en az 4.5:1 kontrast veren, vurgu renginden türetilmiş koyu ton. */
function accessibleDeep(accent: Rgb) {
  let amount = 0.12;
  let deep = mix(accent, BLACK, amount);
  while (contrastWithWhite(deep) < 4.6 && amount < 0.9) {
    amount += 0.04;
    deep = mix(accent, BLACK, amount);
  }
  return deep;
}

export type ThemeVars = CSSProperties & Record<`--${string}`, string>;

/** Vurgu renginden (--accent, --accent-soft, --accent-deep ...) CSS değişkenlerini üretir. */
export function accentThemeVars(accentHex: string | null | undefined): ThemeVars {
  const accent = parseHex(accentHex);
  const deep = accessibleDeep(accent);
  const deeper = mix(deep, BLACK, 0.5);
  const bright = mix(accent, WHITE, 0.18);
  const soft = mix(accent, WHITE, 0.88);
  const softer = mix(accent, WHITE, 0.95);
  const vars: ThemeVars = {
    '--accent': toHex(accent),
    '--accent-rgb': accent.join(', '),
    '--accent-deep': toHex(deep),
    '--accent-deep-rgb': deep.map(Math.round).join(', '),
    '--accent-deeper': toHex(deeper),
    '--accent-bright': toHex(bright),
    '--accent-soft': toHex(soft),
    '--accent-softer': toHex(softer),
  };
  // Mevcut tasarım dilinin değişkenleri vurgu rengine bağlanır (kahve paleti yerine).
  vars['--red'] = vars['--accent-deep'];
  vars['--red-bright'] = vars['--accent-bright'];
  vars['--coffee'] = vars['--accent-deep'];
  vars['--coffee-deep'] = vars['--accent-deeper'];
  vars['--caramel'] = vars['--accent-bright'];
  return vars;
}

export function applyRootTheme(accentHex: string | null | undefined) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(accentThemeVars(accentHex))) root.style.setProperty(name, String(value));
}
