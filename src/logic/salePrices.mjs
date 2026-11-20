// The lowest Warbond price seen per upgrade pair (warbond-prices.json). Pure.
//
// Each sync reads the Warbond offers it saw and keeps, per pair, the lowest
// cash price with the day it was first seen at that price. A later, higher
// price never replaces it, and a tie keeps the earlier date. Standard offers
// are not recorded here.

const pairKey = (from, to) => `${from}-${to}`;

/**
 * @param {{ pairs: object }|null} prev the stored document (warbond-prices.json), not mutated
 * @param {object[]} offers planner offers (kind 'warbond' or 'standard')
 * @param {string} today local day 'YYYY-MM-DD' the offers were seen
 * @returns {{ pairs: object }} a new document
 */
export function recordWarbondPrices(prev, offers, today) {
  const pairs = { ...(prev?.pairs ?? {}) };
  for (const o of offers ?? []) {
    if (o.kind !== 'warbond') continue;
    const key = pairKey(o.from, o.to);
    const seen = pairs[key];
    if (!seen || o.cash < seen.cash) pairs[key] = { cash: o.cash, at: today, skuId: o.skuId };
  }
  return { pairs };
}

/**
 * The lowest Warbond price seen for an upgrade pair, with the entered sale
 * event whose date range (inclusive) covers the day it was seen.
 * @returns {{ cash: number, at: string, event: { name: string, from: string, to: string } | null } | null}
 */
export function seenSalePrice(warbondPrices, from, to, saleEvents) {
  const seen = warbondPrices?.pairs?.[pairKey(from, to)];
  if (!seen) return null;
  const events = Array.isArray(saleEvents?.events) ? saleEvents.events : [];
  const e = events.find((ev) => ev.from <= seen.at && seen.at <= ev.to);
  return { cash: seen.cash, at: seen.at, event: e ? { name: e.name, from: e.from, to: e.to } : null };
}

const quantile = (sorted, q) => {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
};

/**
 * How much cheaper your own Warbond history says a Warbond usually is than the Standard upgrade of the
 * same pair (msrp difference now): the middle half of the pairs' discounts, as fractions of the Standard price.
 * A pair counts when both ships have a price, the Standard price is above zero and the Warbond is cheaper.
 * @param {{ pairs: object }|null} warbondPrices warbond-prices.json
 * @param {Map|null} ships ship id -> { msrp }
 * @returns {{ n: number, low: number, median: number, high: number }|null} null without any usable pair
 */
export function warbondDiscounts(warbondPrices, ships) {
  const found = [];
  for (const [key, seen] of Object.entries(warbondPrices?.pairs ?? {})) {
    const [from, to] = key.split('-').map(Number);
    const a = ships?.get(from)?.msrp;
    const b = ships?.get(to)?.msrp;
    if (a == null || b == null || !Number.isInteger(seen?.cash)) continue;
    const standard = b - a;
    if (standard > 0 && seen.cash < standard) found.push(1 - seen.cash / standard);
  }
  if (!found.length) return null;
  found.sort((x, y) => x - y);
  return { n: found.length, low: quantile(found, 0.25), median: quantile(found, 0.5), high: quantile(found, 0.75) };
}
