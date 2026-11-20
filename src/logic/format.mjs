// Money text. The store catalog says which currency the account pays in (app.pricing: currencyCode, currencySymbol,
// exponent). The planner's prices are cents of USD, so every other currency is refused (see currencyProblem).

import { loc } from './i18n.mjs';
export const USD_PRICING = Object.freeze({ currencyCode: 'USD', currencySymbol: '$', exponent: 2 });

/**
 * The pricing of a store catalog's app.pricing, ready for money(). USD when it is missing or unusable; `declared` says
 * whether the catalog named a currency, and taxRate / isTaxInclusive are carried for currencyProblem().
 */
export function normalizePricing(pricing) {
  const code = typeof pricing?.currencyCode === 'string' && pricing.currencyCode.trim() ? pricing.currencyCode.trim().toUpperCase() : null;
  const taxRate = Number(pricing?.taxRate) || 0;
  const isTaxInclusive = pricing?.isTaxInclusive === true;
  if (!code) return { ...USD_PRICING, declared: false, taxRate, isTaxInclusive };
  const exponent = Number.isInteger(pricing.exponent) && pricing.exponent >= 0 && pricing.exponent <= 4 ? pricing.exponent : 2;
  const symbol = typeof pricing.currencySymbol === 'string' && pricing.currencySymbol.trim() ? pricing.currencySymbol.trim() : code === 'USD' ? '$' : `${code} `;
  return { currencyCode: code, currencySymbol: symbol, exponent, declared: true, taxRate, isTaxInclusive };
}

let current = USD_PRICING;
/** Sets the pricing that money() uses when it is not given one: call it once per loaded data set. */
export const setPricing = (pricing) => { current = normalizePricing(pricing); };

/** Minor units as money: $40, $42.50, −$5 (a true minus sign before the symbol), or ? when unknown. A whole amount has no decimals. */
export function money(cents, pricing = current) {
  if (cents == null) return '?';
  const p = pricing === current ? pricing : normalizePricing(pricing);
  const text = (Math.abs(cents) / 10 ** p.exponent).toFixed(p.exponent);
  return `${cents < 0 ? '\u2212' : ''}${p.currencySymbol}${p.exponent ? text.replace(/\.0+$/, '') : text}`;
}

/** Kept as the one short name used all over the planner's texts; same as money(). */
export const usd = (c) => money(c);

/** Plain-English reason the planner cannot be used for this store account, or null when it can. Takes the catalog's pricing or its normalized form. */
function currencyProblemEn(pricing) {
  const p = pricing?.declared === undefined ? normalizePricing(pricing) : pricing;
  if (!p.declared) return "This planner currently supports USD store accounts only, and the saved store data does not say which currency your account uses. Sync the store again to read your account's currency; no plan is shown until then.";
  if (p.currencyCode !== 'USD') {
    return `This planner currently supports USD store accounts only; your account uses ${p.currencyCode}. Its prices and Warbond logic are not checked for other currencies, so no plan is shown.`;
  }
  // The store sync keeps only pre-tax USD upgrade prices (src/sync/core.mjs): with any tax rate it saves none, so say so here.
  if (p.taxRate && !p.isTaxInclusive) {
    return 'This planner currently supports USD store accounts only, and your store prices have tax added on top, which the planner does not account for, so no plan is shown.';
  }
  if (p.taxRate) {
    return 'This planner currently supports USD store accounts without tax only. Your store prices include tax, and the planner does not read tax-inclusive prices yet, so no plan is shown.';
  }
  return null;
}
export const currencyProblem = loc('currencyProblem', currencyProblemEn);
