// What reserving a chain holds, in words. A reservation holds the owned CCU copies a chain uses, the starting ship
// (an LTI pledge) when the chain starts from one, and store credit. Pure: routes in, lines out.
import { usd } from './format.mjs';

/**
 * The things a route would hold, or does hold when it is the reserved chain.
 * copies: the owned upgrades it uses; token: the starting ship when it starts from an LTI pledge, else null; credit: cents.
 * `paidOf` maps a copyId to what you paid for it (cents) or null.
 */
export function reservationItems(route, paidOf = () => null) {
  if (!route) return { copies: [], token: null, credit: 0 };
  const tk = route.start?.token ?? route.token ?? null;
  return {
    copies: route.steps.filter((s) => s.kind === 'owned' && s.copyId).map((s) => ({ copyId: s.copyId, from: s.from, to: s.to, paid: paidOf(s.copyId) })),
    token: tk ? { ship: route.start?.ship ?? tk.ship ?? null, pledgeId: tk.pledgeId ?? null } : null,
    credit: route.creditUsed ?? 0,
  };
}

/** One line per held item: "Alpha → Beta upgrade you own (paid $25)", "Starting ship: Pulse", "Store credit: $5". Empty when nothing is held. */
export function reservationLines(items, name) {
  const lines = items.copies.map((c) => `${name(c.from)} → ${name(c.to)} upgrade you own${c.paid != null ? ` (paid ${usd(c.paid)})` : ''}`);
  if (items.token) lines.push(`Starting ship: ${items.token.ship != null ? name(items.token.ship) : 'your lifetime-insurance ship'}`);
  if (items.credit > 0) lines.push(`Store credit: ${usd(items.credit)}`);
  return lines;
}

/** The held items in one line: "16 upgrades you own, your starting ship Pulse and $5 store credit". Empty when nothing is held. */
export function reservationSummary(items, name) {
  const parts = [];
  if (items.copies.length) parts.push(`${items.copies.length} ${items.copies.length === 1 ? 'upgrade' : 'upgrades'} you own`);
  if (items.token) parts.push(`your starting ship${items.token.ship != null ? ` ${name(items.token.ship)}` : ''}`);
  if (items.credit > 0) parts.push(`${usd(items.credit)} store credit`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? '');
}

/** More held items than this are folded behind a one-line summary. */
export const HELD_FOLD_AFTER = 3;

export const NOTHING_HELD = 'This chain holds nothing of yours: it only needs purchases.';

/** Heading above the lines of a chain that is not reserved yet, and of one that is. */
export const reserveHeading = (goalName, hasItems = true) => (hasItems ? `Reserving holds these for ${goalName}, so other goals cannot use them:` : `Reserve this chain for ${goalName}.`);
export const reservedHeading = (goalName, hasItems = true) => (hasItems ? `Reserved for ${goalName}. Other goals can no longer use these:` : `Reserved for ${goalName}.`);
export const releaseHeading = 'Releasing gives these back to your other goals:';

/**
 * Preview of reserving several goals at once: [{ goalName, lines }] for every plan with a route whose goal is not
 * reserved yet. `plans`: fleet plans ({ chainId, route }); `chains`: plans.chains; `goalName(id)` and `name(shipId)` give names.
 */
export function bulkPreview(plans, chains, { goalName, name, paidOf = () => null }) {
  return plans
    .filter((p) => p.route && !chains[p.chainId]?.accepted)
    .map((p) => ({ chainId: p.chainId, goalName: goalName(p.chainId), lines: reservationLines(reservationItems(p.route, paidOf), name) }));
}
