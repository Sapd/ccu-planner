// Expected prices: the user's price overrides applied to offers. Pure.

/** Override file content when none exists yet. */
export const emptyOverrides = () => ({ rev: 0, ships: {} });

/** Ship ids (numbers) with an expected price. An override may hold only an availability mark. */
export const pricedShips = (overrides) => Object.entries(overrides.ships).filter(([, o]) => o?.msrp != null).map(([id]) => Number(id));

/** True when any ship has an expected price. */
export const hasPriceOverrides = (overrides) => pricedShips(overrides).length > 0;

/** Expected msrp: the override if set, else today's RSI price. */
export function expectedMsrp(ships, overrides, shipId) {
  return overrides.ships[shipId]?.msrp ?? ships.get(shipId)?.msrp ?? null;
}

/**
 * Offers as they would be after the overridden price changes. Standard
 * upgrades cost the msrp difference, so every Standard offer touching an
 * overridden ship is recomputed; one whose target would no longer be more
 * expensive disappears. Warbond prices are fixed quotes and stay as they are.
 * Changed offers carry nowCash (today's price) and assumed: true.
 */
export function expectedOffers(offers, ships, overrides) {
  const changed = new Set(pricedShips(overrides));
  if (!changed.size) return offers;
  const out = [];
  for (const o of offers) {
    if (o.kind !== 'standard' || (!changed.has(o.from) && !changed.has(o.to))) { out.push(o); continue; }
    const cash = expectedMsrp(ships, overrides, o.to) - expectedMsrp(ships, overrides, o.from);
    if (cash > 0) out.push({ ...o, cash, nowCash: o.cash, assumed: true });
  }
  return out;
}
