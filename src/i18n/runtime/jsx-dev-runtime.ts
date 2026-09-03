import { Fragment, jsxDEV as reactJsxDEV } from 'react/jsx-dev-runtime';
import { translateKioskTextToEnglish } from '../kioskEnglishFallback';
import { shouldTranslateKioskRuntime } from './languageState';

type RuntimeProps = Record<string, unknown> | null;

const translateChildren = (children: unknown): unknown => {
  if (typeof children === 'string') return translateKioskTextToEnglish(children);
  if (!Array.isArray(children)) return children;
  let changed = false;
  const translated = children.map((child) => {
    if (typeof child !== 'string') return child;
    const next = translateKioskTextToEnglish(child);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? translated : children;
};

const translateProps = (props: RuntimeProps): RuntimeProps => {
  if (!props || !shouldTranslateKioskRuntime()) return props;
  let translatedProps: Record<string, unknown> | null = null;
  const setTranslatedProp = (key: string, value: unknown) => {
    if (!translatedProps) translatedProps = { ...props };
    translatedProps[key] = value;
  };
  if ('children' in props) {
    const translatedChildren = translateChildren(props.children);
    if (translatedChildren !== props.children) setTranslatedProp('children', translatedChildren);
  }
  for (const attribute of ['aria-label', 'title', 'placeholder'] as const) {
    const value = props[attribute];
    if (typeof value !== 'string') continue;
    const translated = translateKioskTextToEnglish(value);
    if (translated !== value) setTranslatedProp(attribute, translated);
  }
  return translatedProps ?? props;
};

export const jsxDEV = (
  type: Parameters<typeof reactJsxDEV>[0],
  props: Parameters<typeof reactJsxDEV>[1],
  key: Parameters<typeof reactJsxDEV>[2],
  isStaticChildren: Parameters<typeof reactJsxDEV>[3],
  source: Parameters<typeof reactJsxDEV>[4],
  self: Parameters<typeof reactJsxDEV>[5],
) => reactJsxDEV(type, translateProps(props as RuntimeProps), key, isStaticChildren, source, self);
export { Fragment };
export type { JSX } from 'react';
