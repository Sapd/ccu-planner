// A small store simulator for the end-to-end tests: a virtual account that buys CCUs day after day.
// Pure and deterministic: days are 'YYYY-MM-DD' strings computed from a fixed base, there is no clock and no network.
//
// The world (ships, prices, Standard and Warbond offers, sale events) is described by a spec and asked for any day.
// The account (plans, overrides, sale events, owned CCU copies, store credit, Warbond stock) is the state `S`. The planner
// is driven exactly the way the app drives it: withDocs() builds the app object, todayView() is what the Today page shows,
// applyAction() is every user action (add a goal, reserve = accept, set a price, ...).
import { buildGraph } from '../../src/logic/planner.mjs';
import { newState } from '../../src/logic/chains.mjs';
import { emptyOverrides } from '../../src/logic/prices.mjs';
import { emptySaleEvents } from '../../src/logic/availability.mjs';
import { applyAction } from '../../src/logic/state.mjs';
import { withDocs } from '../../app/src/lib/view/derive.mjs';
import { todayView } from '../../app/src/lib/view/today.mjs';

export const dayAdd = (base, n) => new Date(Date.UTC(+base.slice(0, 4), +base.slice(5, 7) - 1, +base.slice(8, 10) + n)).toISOString().slice(0, 10);
export const stepKey = (s) => `${s.kind}:${s.from}-${s.to}`;

/**
 * @typedef {{ id: number, name: string, msrp: number, concept?: boolean, eventOnly?: boolean }} SimShip
 *   eventOnly: its Standard upgrades exist only on the days of a sale event (see spec.events).
 * @typedef {{ id: number, from: number, to: number, cash: number, start: number, end: number, stock?: number, limited?: boolean }} SimWarbond
 *   start/end: first and last day index it is in the store; stock: how many the store sells before it is gone (default unlimited).
 */

/** The store on any day index. `spec`: { base, ships, priceChanges, warbonds, events, standardPair? }. */
export function createWorld(spec) {
  const dayStr = (d) => dayAdd(spec.base, d);
  const inEvent = (d) => spec.events.some((e) => e.from <= d && d <= e.to);
  const msrpOn = (id, d) => {
    let m = spec.ships.find((s) => s.id === id).msrp;
    for (const c of spec.priceChanges ?? []) if (c.ship === id && c.day <= d) m = c.msrp;
    return m;
  };
  const conceptOn = (id, d) => {
    let c = !!spec.ships.find((s) => s.id === id).concept;
    for (const x of spec.priceChanges ?? []) if (x.ship === id && x.day <= d && x.concept != null) c = x.concept;
    return c;
  };
  const standardOn = (s, d) => !s.eventOnly || inEvent(d);
  return {
    spec, dayStr, msrpOn, conceptOn,
    ships(d) {
      return new Map(spec.ships.map((s) => [s.id, { id: s.id, name: s.name, msrp: msrpOn(s.id, d), concept: conceptOn(s.id, d), owned: false, onSale: true, standard: standardOn(s, d) }]));
    },
    /** Every Standard upgrade (msrp difference, always buyable for a ship with a Standard SKU) and the Warbonds in the store, minus sold-out ones. */
    offers(d, stock = new Map()) {
      const out = [];
      for (const to of spec.ships) {
        if (!standardOn(to, d)) continue;
        for (const from of spec.ships) {
          const cash = msrpOn(to.id, d) - msrpOn(from.id, d);
          if (cash > 0 && (spec.standardPair?.(from.id, to.id, d) ?? true)) out.push({ from: from.id, to: to.id, kind: 'standard', cash });
        }
      }
      for (const w of spec.warbonds) {
        if (d < w.start || d > w.end || (stock.get(w.id) ?? w.stock ?? Infinity) <= 0) continue;
        out.push({ from: w.from, to: w.to, kind: 'warbond', cash: w.cash, skuId: w.id, ...(w.limited ? { limited: true } : {}), ...(w.start > 0 ? { firstSeen: `${dayStr(w.start)}T12:00:00.000Z` } : {}) });
      }
      return out;
    },
    /** What a sync would have recorded by day d: the days each ship's Standard SKU was on sale (30 quiet days before day 0). */
    saleHistory(d) {
      const ships = {};
      for (const s of spec.ships) {
        const days = [];
        if (!s.eventOnly) for (let k = -30; k < 0; k++) days.push(dayStr(k));
        for (let k = 0; k <= d; k++) if (standardOn(s, k)) days.push(dayStr(k));
        ships[s.id] = { onSaleDays: days };
      }
      return { ships };
    },
  };
}

/** The account: its documents, copies, credit and what it has paid. */
export function newAccount(spec, world) {
  const plans = newState();
  plans.profile.credit = spec.credit ?? 0;
  const lti = spec.lti.map((t) => {
    const ship = spec.ships.find((s) => s.id === t.ship);
    return { pledgeId: t.pledgeId, ship: t.ship, name: ship.name, paidCents: t.paidCents, msrpCents: ship.msrp };
  });
  return { world, plans, overrides: emptyOverrides(), saleEvents: emptySaleEvents(), owned: (spec.owned ?? []).map((c) => ({ giftable: false, ...c })), nextCopy: 1, stock: new Map(), spent: { cash: 0, credit: 0 }, creditIn: spec.credit ?? 0, purchases: [], missed: [], seq: 0, lti, ships: null };
}

/** One user action through applyAction; the state's documents are replaced (the store bumps rev when it saves). Returns the action's result. */
export function act(S, action) {
  const r = applyAction({ plans: S.plans, overrides: S.overrides, saleEvents: S.saleEvents }, action, { ships: S.ships ?? undefined });
  S.plans = r.plans; S.overrides = r.overrides; S.saleEvents = r.saleEvents;
  S[r.changed].rev += 1;
  return r.result;
}

/** addChain with a deterministic createdAt (the planner orders equal priorities by it). */
export function addGoal(S, goal) {
  const c = act(S, { type: 'addChain', ...goal });
  S.plans.chains[c.id].createdAt = `2026-01-01T00:00:${String(++S.seq).padStart(2, '0')}.000Z`;
  return c.id;
}

/** The app object for day d, built like the UI builds it (withDocs). */
export function appOf(S, d) {
  const ships = S.world.ships(d);
  S.ships = ships;
  const data = {
    ships, offers: S.world.offers(d, S.stock), owned: S.owned, lti: S.lti,
    meta: { catalogAt: `day ${d}`, hangarAt: `day ${d}`, limitedShare: { warbond: 0, standard: 0 }, historyFrom: dayAdd(S.world.spec.base, 0) },
    warbondPrices: null, saleHistory: S.world.saleHistory(d),
  };
  const graph = buildGraph(data);
  return withDocs({ data, graph }, S.plans, S.overrides, S.saleEvents);
}

export const todayOf = (S, d) => {
  const app = appOf(S, d);
  return { app, view: todayView(app, S.world.dayStr(d)) };
};

/**
 * Buys one step: the cheapest matching offer of the store on day d. A Warbond is paid with cash; a Standard upgrade with store credit
 * first (at most `creditCap`, what the plan gave this goal) and cash for the rest. The copy joins the owned CCUs.
 * Returns the purchase, or null when the offer is gone (sold out or ended).
 */
export function buy(S, d, goalId, step, creditCap) {
  const o = S.world.offers(d, S.stock).filter((x) => x.kind === step.kind && x.from === step.from && x.to === step.to).sort((a, b) => a.cash - b.cash)[0];
  if (!o) { S.missed.push({ day: d, goalId, step: stepKey(step) }); return null; }
  const credit = o.kind === 'standard' ? Math.min(o.cash, creditCap, S.plans.profile.credit) : 0;
  const cash = o.cash - credit;
  if (credit) act(S, { type: 'setCredit', cents: S.plans.profile.credit - credit });
  S.spent.cash += cash; S.spent.credit += credit;
  if (o.kind === 'warbond') {
    const w = S.world.spec.warbonds.find((x) => x.id === o.skuId);
    if (w.stock != null) S.stock.set(w.id, (S.stock.get(w.id) ?? w.stock) - 1);
  }
  const copyId = `k${S.nextCopy++}`;
  S.owned = [...S.owned, { copyId, from: o.from, to: o.to, paid: { cents: o.cash }, giftable: false }];
  const p = { day: d, goalId, kind: o.kind, from: o.from, to: o.to, price: o.cash, cash, credit, copyId };
  S.purchases.push(p);
  return p;
}

// ----- helpers for the run and its end state -----

const RANK = { high: 0, normal: 1, low: 2 };
/** Goal ids in planning priority order (priority, then creation). */
export const goalOrder = (S) => Object.values(S.plans.chains).sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.createdAt.localeCompare(b.createdAt)).map((c) => c.id);

/** A goal is complete when its route has steps and every step is an owned copy. */
export const isDoneRoute = (route) => !!route && route.steps.length > 0 && route.steps.every((s) => s.kind === 'owned');

/**
 * Walks the owned copies: gives every goal its own chain of copies from a starting ship to its target, no copy and no starting ship twice
 * (a small backtracking search, independent of the planner). Returns Map(goalId -> { start, token, copies, target }) or null when the
 * copies cannot be divided between the goals.
 */
export function assignChains(S) {
  const goals = goalOrder(S).map((id) => S.plans.chains[id]);
  const usedCopies = new Set();
  const usedTokens = new Set();
  const out = new Map();
  function* walk(ship, target, seen, trail) {
    if (ship === target && trail.length) { yield trail; return; }
    for (const c of S.owned) {
      if (c.from !== ship || usedCopies.has(c.copyId) || seen.has(c.to)) continue;
      yield* walk(c.to, target, new Set([...seen, c.to]), [...trail, c.copyId]);
    }
  }
  const solve = (gi) => {
    if (gi === goals.length) return true;
    const g = goals[gi];
    const starts = g.start.kind === 'ship'
      ? [{ ship: g.start.ship, token: null }]
      : S.lti.filter((t) => g.start.pledgeId == null || t.pledgeId === g.start.pledgeId).map((t) => ({ ship: t.ship, token: t.pledgeId }));
    for (const st of starts) {
      if (st.token && usedTokens.has(st.token)) continue;
      for (const copies of walk(st.ship, g.target, new Set([st.ship]), [])) {
        copies.forEach((c) => usedCopies.add(c));
        if (st.token) usedTokens.add(st.token);
        out.set(g.id, { start: st.ship, token: st.token, copies, target: g.target });
        if (solve(gi + 1)) return true;
        copies.forEach((c) => usedCopies.delete(c));
        if (st.token) usedTokens.delete(st.token);
        out.delete(g.id);
      }
    }
    return false;
  };
  return solve(0) ? out : null;
}
