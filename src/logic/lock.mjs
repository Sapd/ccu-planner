// Locking the target and covering a lock, and the split of a route by urgency. Pure.

import { searchRoutes, edgeKey, cashNeeded } from './planner.mjs';
import { shipAvailability } from './availability.mjs';
import { goalStarts } from './sharedPlan.mjs';

/**
 * Splits a route by urgency. Warbonds can disappear (they are sale offers), so
 * they are the only purchases worth making while waiting. Standard upgrades stay
 * available at the msrp difference and may later be replaced by a Warbond, so
 * they are deferred until the chain is finished.
 */
export function splitRoute(route, { lock = false } = {}) {
  const last = route.steps.at(-1);
  const lockStep = lock && last?.kind === 'standard' ? last : null;
  const buyNow = route.steps.filter((s) => s.kind === 'warbond');
  const later = route.steps.filter((s) => s.kind === 'standard' && s !== lockStep);
  return {
    buyNow, later, owned: route.steps.filter((s) => s.kind === 'owned'),
    lockNow: lockStep ? [lockStep] : [],
    lockCash: lockStep?.cash ?? 0,
    lockedBy: last?.kind === 'owned' || last?.kind === 'warbond' ? last : null,
    cashNow: buyNow.reduce((n, s) => n + s.cash, 0),
    standardLater: later.reduce((n, s) => n + s.cash, 0),
  };
}

// Locking the target: while a chain waits, its last step into the target is
// bought now instead of later when the target's price is going to rise. A CCU
// fixes the price difference at purchase, so the rise does not reach you. A
// Standard last step can be paid with store credit (also from melting CCUs
// that save nothing), so a lock need not cost new money.
//   auto (default): lock when the target is a concept ship or you set a higher
//                   expected price for it; on: always; off: never.
/** Why this chain locks its target now ('on' | 'expected' | 'concept' | 'event'), or null. 'event': a sale event is on and the target has only ever been sold during events. */
export function lockReason(chain, ships = null, overrides = null, avail = null) {
  const lock = chain.lock ?? 'auto';
  if (lock === 'off') return null;
  if (lock === 'on') return 'on';
  const t = ships?.get(chain.target);
  const exp = overrides?.ships?.[chain.target]?.msrp;
  if (t && exp != null && exp > t.msrp) return 'expected';
  if (t?.concept) return 'concept';
  if (avail) {
    const a = shipAvailability(avail, chain.target);
    // Only a target proven to be sold during events alone: a ship not seen outside one yet may simply be new to the history.
    if (a.status === 'event-only' && a.event) return 'event';
  }
  return null;
}

const coverMemo = new WeakMap(); // planGoals result -> { assigned, other }
const routeSig = (r) => r.steps.map((s) => `${edgeKey(s)}${s.copyId ? `#${s.copyId}` : ''}`).join('|');
const copiesOf = (r) => [...r.steps.filter((s) => s.copyId).map((s) => s.copyId), ...(r.start?.token ? [r.start.token.copyId] : [])];

// One backup search for `chain`'s `route`; `taken` = copies it must not use. Null when there is no cover.
function computeCover(session, chain, plan, route, taken) {
  const { plans: state, graph, maxSteps } = session;
  const last = route.steps.at(-1);
  const edgeNow = (s) => (graph.edges.get(s.from) ?? []).find((e) => e.kind === s.kind && e.to === s.to && !!e.virtual === !!s.virtual && (!s.virtual || e.virtualId === s.virtualId));
  let wb = 0; let std = 0;
  for (const s of route.steps) {
    if (s.kind === 'owned') continue;
    const e = edgeNow(s);
    if (!e) return null; // the step is not on offer today: nothing to compare
    if (s.kind === 'warbond') wb += e.cash; else std += e.cash;
  }
  const cashToday = cashNeeded(wb, std, plan.credit);
  const excludeEdges = new Set();
  for (const edges of graph.edges.values()) for (const e of edges) if (e.to === chain.target && e.kind !== 'owned') excludeEdges.add(edgeKey(e));
  const starts = goalStarts(state, chain, graph, plan.exclude);
  const [backup] = starts.length
    ? searchRoutes(graph, { starts, target: chain.target, credit: plan.credit, maxSteps, excludeCopies: taken, excludeEdges, maxResults: 1, objective: chain.objective ?? 'cash', via: chain.via ?? null })
    : [];
  const end = backup?.steps.at(-1);
  return end?.kind === 'owned' && end.copyId && !taken.has(end.copyId)
    ? { copyId: end.copyId, from: end.from, extraCash: Math.max(0, backup.cash - cashToday), lockCash: edgeNow(last).cash, route: backup }
    : null;
}

const lockStepInto = (chain, route) => route?.steps?.at(-1)?.kind === 'standard' && route.steps.at(-1).to === chain.target;

/**
 * A backup for a Standard lock step: the cheapest route that ends with an OWNED CCU into the target,
 * planned with the goal's own inputs. A target price rise can then cost at most `extraCash` more than
 * the route today. Null when the route's last step is not a Standard step into the target, when no
 * such backup exists, or when a non-owned step of the route is not on offer today. Whether a lock
 * applies at all is the caller's call.
 *
 * A copy that any other goal's route uses (accepted or draft) never counts as cover and is excluded
 * from the backup search. Covers are given out in planning order (accepted goals first, then planGoals'
 * order), so one copy covers one goal only: a goal's search also skips copies earlier goals got as cover.
 * Only goals in `lockIds` (default: every watch goal) take part; the whole assignment is computed once
 * per session, so the answer does not depend on which goal is asked first. A route that differs
 * from the one planned for the goal (e.g. an alternative) is computed on its own against that assignment.
 * Both routes are compared at today's prices; `lockCash` is the lock step's price today.
 * @param {{ lockIds?: Iterable<string>|null }} [opts]
 * @returns {null | { copyId: string, from: number, extraCash: number, lockCash: number, route: object }}
 */
export function lockCover(session, chainId, route, { lockIds = null } = {}) {
  const state = session.plans;
  const chain = state.chains[chainId];
  if (!chain || !lockStepInto(chain, route)) return null;
  const result = session.shared;
  const plan = result.get(chainId);
  if (!plan) return null;
  // Keyed on the planGoals result, not on the session: a new session whose plan did not change (a lock or
  // name edit) keeps its covers. assigned: lockKey -> Map(chainId -> { sig, cover }); other: 'chainId|sig|lockKey' -> cover
  let memo = coverMemo.get(result);
  if (!memo) coverMemo.set(result, (memo = { assigned: new Map(), other: new Map() }));
  const ids = lockIds ? new Set(lockIds) : new Set(Object.values(state.chains).filter((c) => (c.mode ?? 'watch') === 'watch').map((c) => c.id));
  const lockKey = [...ids].sort().join(',');
  let assigned = memo.assigned.get(lockKey);
  if (!assigned) {
    assigned = new Map();
    const used = new Set(); // copies given out as cover so far
    for (const [id, entry] of result) { // Map order = planning order
      const c = state.chains[id];
      if (!ids.has(id) || !entry.route || !lockStepInto(c, entry.route)) continue;
      const taken = new Set([...entry.exclude, ...used]);
      for (const [oid, other] of result) if (oid !== id && other.route) for (const x of copiesOf(other.route)) taken.add(x);
      const cover = computeCover(session, c, entry, entry.route, taken);
      if (cover) used.add(cover.copyId);
      assigned.set(id, { sig: routeSig(entry.route), cover });
    }
    memo.assigned.set(lockKey, assigned);
  }
  const sig = routeSig(route);
  const mine = assigned.get(chainId);
  if (mine?.sig === sig) return mine.cover;
  const key = `${chainId}|${sig}|${lockKey}`;
  if (memo.other.has(key)) return memo.other.get(key);
  const taken = new Set(plan.exclude);
  for (const [oid, other] of result) if (oid !== chainId && other.route) for (const x of copiesOf(other.route)) taken.add(x);
  for (const [oid, a] of assigned) if (oid !== chainId && a.cover) taken.add(a.cover.copyId);
  const cover = computeCover(session, chain, plan, route, taken);
  memo.other.set(key, cover);
  return cover;
}

/** True when a price rise could cost no more than the route's Standard lock step itself (cover.extraCash <= that step's cash). */
export function lockCovered(cover, route) {
  const last = route?.steps?.at(-1);
  return !!cover && last?.kind === 'standard' && cover.extraCash <= (cover.lockCash ?? last.cash);
}

/**
 * Everything a caller needs to decide the lock of a watch goal's route (`session` null: no cover is looked up): the lockReason code, the
 * cover (looked up only when there is a reason) and `lock`, whether the last step is bought now.
 * @returns {{ reason: string|null, cover: object|null, covered: boolean, coveredStep: object|null, lock: boolean }}
 * A covered step is bought later like any Standard step, but its price-rise alerts are dropped: the owned CCU caps the rise.
 */
export function lockDecision(session, chain, route, { ships = null, overrides = null, avail = null } = {}) {
  const reason = lockReason(chain, ships, overrides, avail);
  if (!reason || !route || !session) return { reason, cover: null, covered: false, coveredStep: null, lock: !!reason };
  const lockIds = Object.values(session.plans.chains).filter((c) => (c.mode ?? 'watch') === 'watch' && lockReason(c, ships, overrides, avail)).map((c) => c.id);
  const cover = lockCover(session, chain.id, route, { lockIds });
  const covered = lockCovered(cover, route);
  return { reason, cover, covered, coveredStep: covered ? route.steps.at(-1) : null, lock: !covered };
}

