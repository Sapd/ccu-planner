// Can a Warbond still make a full-price step cheaper? Pure.
//
// RSI discounts a Warbond by an amount that grows with the ship's price. A step whose price difference is smaller
// than that amount can never take a Warbond into its target: the Warbond would cost less than the $5 minimum, so
// RSI does not offer it from that ship. Such a step is a filler: buy the Standard upgrade whenever, with store credit.
// A larger gap is a slot: any Warbond into a ship between its two ends can fill it, so the goal waits for one.
// The bands are the ones CCU Game uses for its "no saving" mark (target price → smallest gap a Warbond fits).

export const MIN_CCU = 500; // cents: RSI's cheapest upgrade
/** [target price below (cents), smallest gap (cents)]; the last band has no upper limit. */
export const WARBOND_GAP_BANDS = [[10000, 1000], [20000, 1500], [40000, 2000], [Infinity, 3000]];

/** The smallest price gap (cents) a Warbond into a ship of this price fits into. */
export const minWarbondGap = (toMsrp) => WARBOND_GAP_BANDS.find(([below]) => toMsrp < below)[1];

/** True when a Warbond could still make the step fromMsrp → toMsrp cheaper; null when a price is unknown. */
export function warbondCanFit(fromMsrp, toMsrp) {
  if (fromMsrp == null || toMsrp == null) return null;
  return toMsrp - fromMsrp >= minWarbondGap(toMsrp);
}

/**
 * The ships a Warbond could go into to fill the slot fromMsrp → toMsrp: sold ships priced above the start and up to the
 * target, nearest the target first.
 * @param {Map<number, { id: number, name: string, msrp?: number, standard?: boolean }>} ships
 * @returns {{ count: number, examples: Array<{ id: number, name: string }> }}
 */
export function slotShips(ships, fromMsrp, toMsrp, max = 3) {
  const list = [...(ships?.values() ?? [])]
    .filter((s) => s.msrp != null && s.msrp > fromMsrp && s.msrp <= toMsrp && s.standard !== false)
    .sort((a, b) => b.msrp - a.msrp || String(a.name).localeCompare(String(b.name)));
  return { count: list.length, examples: list.slice(0, max).map((s) => ({ id: s.id, name: s.name })) };
}
