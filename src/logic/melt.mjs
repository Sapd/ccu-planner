// Melt (reclaim) candidates: unused CCUs that can be turned into store credit
// without losing anything you cannot buy back today.
//
// A copy is a candidate only if ALL hold:
//   - not reserved by an accepted chain and not protected by you
//   - meltable on RSI and its paid value is known
//   - a Standard offer for the exact same pair exists today (rebuyable)
//   - its target was seen or manually confirmed in the store outside sale events
//   - that Standard price <= what the copy cost (saving <= 0)
//   - it carries no extras (insurance, paint, ...)
//   - it does not lead into a concept ship (those rise in price before release)
//     and would not save money at your expected prices
// Even then it keeps option value (the target may get more expensive), so the
// planner recommends melting only to cover a finish goal's Standard purchases,
// and only as much as needed.

import { reservations } from './chains.mjs';
import { goalNamer } from './ships.mjs';
import { usd } from './format.mjs';
import { routeAdvice } from './advice.mjs';
import { buildGraph } from './planner.mjs';
import { createSession, planningGraph } from './session.mjs';
import { shipAvailability } from './availability.mjs';

export const KEEP = {
  RESERVED: 'reserved by',
  PROTECTED: 'protected',
  NOT_MELTABLE: 'not meltable',
  UNKNOWN_PRICE: 'paid value unknown',
  NOT_REBUYABLE: 'no Standard offer for this upgrade at the last sync',
  NO_OUTSIDE_OBSERVATION: 'not yet seen in the store on two syncs clear of any sale',
  SAVES: 'cheaper than the store today',
  SAVES_LATER: 'will save after an expected price change',
  CONCEPT: 'into a concept ship (its price rises before release)',
  EXTRAS: 'carries extras',
};

/** The cheapest Standard price per pair, Map 'from-to' -> cents: what the same upgrade costs today. */
export const standardPrices = (offers) => {
  const m = new Map();
  for (const o of offers) {
    if (o.kind !== 'standard') continue;
    const k = `${o.from}-${o.to}`;
    if (!m.has(k) || o.cash < m.get(k)) m.set(k, o.cash);
  }
  return m;
};

/**
 * @param expected offers after your price overrides (see expectedOffers); a copy
 *   that would save money after an expected increase is never a candidate.
 * @param avail availCtx(...): without it no target is known to be on sale outside events, so nothing melts.
 */
export function classifyCopies({ owned, offers, ships = null }, state, { protect = new Set(), expected = null, avail = null } = {}) {
  const reserved = reservations(state);
  const goalName = goalNamer(state, ships);
  const standard = standardPrices(offers);
  const standardExp = expected ? standardPrices(expected) : standard;
  return owned.map((c) => {
    const paid = c.paid?.cents ?? null;
    const k = `${c.from}-${c.to}`;
    const std = standard.get(k) ?? null;
    const saving = std != null && paid != null ? std - paid : null;
    const stdExp = standardExp.get(k) ?? null;
    const savingExp = stdExp != null && paid != null ? stdExp - paid : null;
    const targetAvail = shipAvailability(avail, c.to);
    let keep = null;
    if (reserved.has(c.copyId)) keep = `${KEEP.RESERVED} ${goalName(reserved.get(c.copyId))}`;
    else if (protect.has(c.copyId)) keep = KEEP.PROTECTED;
    else if (!c.meltable) keep = KEEP.NOT_MELTABLE;
    else if (paid == null) keep = KEEP.UNKNOWN_PRICE;
    else if (std == null) keep = KEEP.NOT_REBUYABLE;
    else if (!targetAvail.meltSafe && !targetAvail.confirmedOutsideEvents) keep = KEEP.NO_OUTSIDE_OBSERVATION;
    else if (saving > 0) keep = `${KEEP.SAVES} (${usd(saving)})`;
    else if (savingExp > 0) keep = `${KEEP.SAVES_LATER} (${usd(savingExp)})`;
    else if (ships?.get(c.to)?.concept) keep = KEEP.CONCEPT;
    else if ((c.extras ?? []).length) keep = `${KEEP.EXTRAS}: ${c.extras.join(', ')}`;
    return { copy: c, paid, standardNow: std, saving, standardExpected: stdExp, savingExpected: savingExp, candidate: keep == null, keep };
  });
}

/**
 * Picks the fewest candidates whose credit covers `need` (cents), preferring
 * duplicate pairs (you keep at least one copy of a pair where possible) and
 * then larger values (fewer melts). Returns the selection and the credit.
 */
export function pickMelts(candidates, need) {
  if (need <= 0) return { melt: [], credit: 0 };
  const perPair = new Map();
  for (const c of candidates) perPair.set(`${c.copy.from}-${c.copy.to}`, (perPair.get(`${c.copy.from}-${c.copy.to}`) ?? 0) + 1);
  const seenPair = new Map();
  const ranked = [...candidates]
    .sort((a, b) => b.paid - a.paid || String(a.copy.copyId).localeCompare(String(b.copy.copyId)))
    .map((c) => {
      const k = `${c.copy.from}-${c.copy.to}`;
      const nth = (seenPair.get(k) ?? 0) + 1;
      seenPair.set(k, nth);
      return { ...c, lastOfPair: nth === perPair.get(k) };
    })
    .sort((a, b) => Number(a.lastOfPair) - Number(b.lastOfPair) || b.paid - a.paid || String(a.copy.copyId).localeCompare(String(b.copy.copyId)));
  const melt = [];
  let credit = 0;
  for (const c of ranked) {
    if (credit >= need) break;
    melt.push(c);
    credit += c.paid;
  }
  // Drop picks that are not needed any more (largest overshoot first).
  for (const c of [...melt].sort((a, b) => a.paid - b.paid)) {
    if (credit - c.paid >= need) { melt.splice(melt.indexOf(c), 1); credit -= c.paid; }
  }
  return { melt, credit };
}

/**
 * Melt plan for the finish chains: how much Standard spend their accepted
 * routes still need beyond the credit pool, which copies to melt for it, and
 * the new money before and after. Warbond steps always need new money.
 */
/** `session`: the planning session of `data` and `state` (lets an owned CCU cover a lock); without one a session is built for this call. */
export function meltPlan(data, state, { protect, expected, overrides = null, avail = null, session = null } = {}) {
  const finish = [];
  let warbond = 0;
  let standard = 0;
  const locks = [];
  for (const c of Object.values(state.chains)) {
    if (!c.accepted) continue;
    if (c.mode === 'finish') {
      // A finish goal buys its Warbonds now and its Standard steps when done.
      finish.push(c);
      const s = routeAdvice(null, c, c.accepted).split;
      warbond += s.cashNow;
      standard += s.standardLater;
      continue;
    }
    // A waiting goal that locks its target needs that Standard last step now; a lock covered by an owned CCU into the target reserves nothing.
    session ??= createSession({ plans: state, graph: planningGraph(buildGraph(data), state), data });
    // Same answer as the session's cached advice when asked with the session's own overrides and today's availability.
    const own = session.plans === state && (overrides ?? null) === (session.overrides ?? null) && avail != null && avail === session.avail();
    const adv = own ? session.advice(c.id, { route: c.accepted }) : routeAdvice(session, c, c.accepted, { ships: data.ships, overrides, avail });
    if (!adv.dec.lock) continue;
    if (adv.split.lockCash) { locks.push({ chainId: c.id, step: adv.split.lockNow[0] }); standard += adv.split.lockCash; }
  }
  const pool = state.profile.credit ?? 0;
  const need = Math.max(0, standard - pool);
  const classified = classifyCopies(data, state, { protect, expected, avail });
  const candidates = classified.filter((c) => c.candidate);
  const { melt, credit } = pickMelts(candidates, need);
  const before = warbond + need;
  const after = warbond + Math.max(0, standard - pool - credit);
  return {
    finishChains: finish.map((c) => c.id), locks, warbond, standard, pool, need,
    candidates, melt, meltCredit: credit, newMoneyBefore: before, newMoneyAfter: after,
    creditLeftAfter: Math.max(0, pool + credit - standard),
    candidateCredit: candidates.reduce((n, c) => n + c.paid, 0),
  };
}
