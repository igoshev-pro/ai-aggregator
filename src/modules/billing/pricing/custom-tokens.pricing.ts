// src/modules/billing/pricing/custom-tokens.pricing.ts
// Единый источник правды для кастомной покупки спичек.
// ВАЖНО: фронтовый src/lib/pricing.ts должен повторять ровно эту логику.

export const BASE_PRICE = 3;            // ₽ за спичку базовая
export const MIN_PRICE = 2.5;           // ₽ нижний предел
export const CUSTOM_MIN_TOKENS = 10;
export const CUSTOM_MAX_TOKENS = 100000;

// Пороговые значения спичек по тирам (из ₽-брекетов по ТЗ)
const TOKEN_TIERS: { min: number; price: number }[] = [
  { min: 4000, price: 2.5 },
  { min: 3529, price: 2.55 },
  { min: 3077, price: 2.6 },
  { min: 2642, price: 2.65 },
  { min: 2222, price: 2.7 },
  { min: 1818, price: 2.75 },
  { min: 1429, price: 2.8 },
  { min: 1053, price: 2.85 },
  { min: 690, price: 2.9 },
  { min: 339, price: 2.95 },
  { min: 0, price: 3.0 },
];

export function pricePerTokenByTokens(tokens: number): number {
  for (const t of TOKEN_TIERS) {
    if (tokens >= t.min) return t.price;
  }
  return BASE_PRICE;
}

export function calcCustomByTokens(tokensRaw: number) {
  const tokens = Math.max(0, Math.floor(Number(tokensRaw) || 0));
  const pricePerToken = pricePerTokenByTokens(tokens);
  const rub = Math.round(tokens * pricePerToken);
  const baseRub = tokens * BASE_PRICE;
  const discountPct =
    baseRub > 0 ? Math.round(((baseRub - rub) / baseRub) * 100) : 0;
  const valid = tokens >= CUSTOM_MIN_TOKENS && tokens <= CUSTOM_MAX_TOKENS;
  return { tokens, pricePerToken, rub, baseRub, discountPct, valid };
}