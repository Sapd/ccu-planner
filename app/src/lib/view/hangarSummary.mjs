// The money line of the Hangar: what you spent, what the upgrades roughly saved, and the upgrades no goal uses. Pure.
import { hangarSummary } from '../../../../src/logic/hangar.mjs';

/** What you paid for your pledges: the sum of their RSI values in cents (the melt value). A pledge without a USD value, or a gift, counts as 0. */
export const spentCents = (pledges) => hangarSummary(pledges).totalValue;

/**
 * Roughly saved: the sum of the per-copy Saving of every owned upgrade (ccuRows: today's Standard price, or the ship-value difference,
 * minus what you paid). Negative savings count as negative; a copy without a saving counts as 0. `estimated` is true when any counted
 * saving rests on the ship-value fallback, `unknown` counts the copies that have no saving at all.
 */
export function savedSummary(rows) {
  let cents = 0, estimated = false, unknown = 0;
  for (const r of rows) {
    if (r.saving == null) { unknown++; continue; }
    cents += r.saving;
    if (r.estimate) estimated = true;
  }
  return { cents, estimated, unknown };
}

/**
 * The goal copies of one todayView: every owned copy a goal's reserved chain or proposed chain uses.
 * Reads each goal's proposed journey and its counted (reserved) journey; the owned steps carry the copyId.
 */
export function copiesInUse(goals) {
  const ids = new Set();
  const add = (j) => { for (const x of j?.steps ?? []) if (x.step?.copyId != null) ids.add(String(x.step.copyId)); };
  for (const g of goals ?? []) { add(g.journey); add(g.counted); }
  return ids;
}

/** Marks every row `inUse`: reserved by a goal, or on a goal's current chain (`used`, a Set of copy ids). */
export const markInUse = (rows, used) => rows.map((r) => ({ ...r, inUse: !!r.reservedBy || used.has(String(r.copyId)) }));

/** The copies no goal uses, and what you paid for them (copies without a known price add nothing; `unpriced` counts them). */
export function unusedSummary(rows) {
  const list = rows.filter((r) => !r.inUse);
  const paidRows = list.filter((r) => r.paid != null);
  return { count: list.length, paid: paidRows.reduce((n, r) => n + r.paid, 0), unpriced: list.length - paidRows.length };
}
