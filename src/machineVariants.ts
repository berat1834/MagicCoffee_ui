import type { CustomizationStep, MachineVariant, Product, Selection } from './types';

/**
 * Otomat varyant anahtarı (API'deki option_key ile aynı kanonik biçim):
 * boş olmayan adımlar adım kimliğine göre sıralanır, her adımda seçenek kimlikleri sıralanıp virgülle birleştirilir,
 * adımlar "|" ile ayrılır. Ör. { sides: ['large'], content: ['oat'] } -> "content=oat|sides=large". Seçimsiz -> "".
 */
export function variantKeyOf(choices: Record<string, string[]> | undefined | null): string {
  return Object.entries(choices ?? {})
    .map(([stepId, optionIds]) => [stepId, [...new Set(optionIds)].filter(Boolean).sort()] as const)
    .filter(([, optionIds]) => optionIds.length > 0)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([stepId, optionIds]) => `${stepId}=${optionIds.join(',')}`)
    .join('|');
}

/** Varyant anahtarını adım → seçenek listesine çevirir. */
export function parseVariantKey(key: string): Record<string, string[]> {
  const choices: Record<string, string[]> = {};
  for (const part of key.split('|')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const optionIds = part.slice(index + 1).split(',').map((item) => item.trim()).filter(Boolean);
    if (optionIds.length) choices[part.slice(0, index).trim()] = optionIds;
  }
  return choices;
}

/** Otomat kioskunda ürünün makinede yapılabilen varyantları (yoksa null: serbest seçim). */
export function machineVariantsOf(product: Product): MachineVariant[] | null {
  return Array.isArray(product.machineVariants) && product.machineVariants.length ? product.machineVariants : null;
}

/** Seçimle birebir eşleşen varyant. */
export function matchVariant(product: Product, selection?: Selection | null): MachineVariant | null {
  const variants = machineVariantsOf(product);
  if (!variants) return null;
  const key = variantKeyOf(selection?.choices);
  return variants.find((variant) => variantKeyOf(parseVariantKey(variant.optionKey)) === key) ?? null;
}

/** Seçim, en az bir varyantın alt kümesi mi (adım adım seçim yapılırken devam edilebilir mi). */
export function variantCompatible(variants: MachineVariant[], choices: Record<string, string[]>) {
  return variants.some((variant) => {
    const target = parseVariantKey(variant.optionKey);
    return Object.entries(choices).every(([stepId, optionIds]) => optionIds.every((optionId) => (target[stepId] ?? []).includes(optionId)));
  });
}

/** Satırın seçilen seçenek adları (vend ekranında "Latte · Büyük · Yulaf sütü" için). */
export function selectionLabel(product: Product, selection?: Selection | null): string {
  if (!selection) return '';
  const steps: Record<string, CustomizationStep> = product.customization ?? {};
  return Object.entries(selection.choices)
    .flatMap(([stepId, optionIds]) => optionIds.map((optionId) => steps[stepId]?.options.find((option) => option.id === optionId)?.name ?? ''))
    .filter(Boolean)
    .join(' · ');
}
