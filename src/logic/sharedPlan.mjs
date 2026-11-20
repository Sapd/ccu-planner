// Shared planning: every goal is planned together by priority, each seeing the copies, tokens and
// credit left by those before it. Pure.

import { searchRoutes, planRoutes } from './planner.mjs';
import { tokenPool, tokenSettings, tokenCopyId } from './tokens.mjs';
import { startOf, byPriority, settleStandard, acceptedInOrder, reservations, excludedCopies } from './goals.mjs';
import { createRouteReuse } from './routeReuse.mjs';

/**
 * Start entries for a goal's search. Fixed ship: [{ ship }]. A token start with a pledgeId: that
 * pool entry unless its copy is excluded. Any token: per ship type the cheapest pool pledge whose copy is free.
 */
export function goalStarts(state, chain, graph, exclude = new Set()) {
  const st = startOf(chain);
  if (st.kind === 'ship') return [{ ship: st.ship }];
  // An accepted token goal holds one pledge: that is its only start.
  const held = chain.accepted?.token;
  if (held) return [{ ship: held.ship, token: { copyId: held.copyId, pledgeId: held.pledgeId, paidCents: held.paidCents ?? null } }];
  const pool = tokenPool(graph.lti ?? [], tokenSettings(state));
  const entry = (t) => ({ ship: t.ship, token: { copyId: tokenCopyId(t.pledgeId), pledgeId: t.pledgeId, paidCents: t.paidCents } });
  if (st.pledgeId != null) {
    const t = pool.find((x) => x.pledgeId === String(st.pledgeId));
    return t && !exclude.has(tokenCopyId(t.pledgeId)) ? [entry(t)] : [];
  }
  const seen = new Set();
  const out = [];
  for (const t of pool) {
    if (seen.has(t.ship) || exclude.has(tokenCopyId(t.pledgeId))) continue;
    seen.add(t.ship);
    out.push(entry(t));
  }
  return out;
}

// The accepted route as a route-shaped object (for fleet plans). `settled` (settleStandard): step index -> the owned copy
// that already bought it; such a step shows as owned and costs nothing more, so the goal's cost is what is still to pay.
const acceptedRoute = (a, settled = new Map(), credit = a.creditUsed ?? 0) => {
  const steps = a.steps.map((s, i) => {
    const c = settled.get(i);
    if (!c) return s;
    const { virtual, virtualId, note, expires, skuId, ...rest } = s;
    return { ...rest, ...c, kind: 'owned', cash: 0 };
  });
  let wb = 0; let std = 0;
  for (const s of steps) if (s.kind === 'standard') std += s.cash; else if (s.kind !== 'owned') wb += s.cash;
  const creditUsed = Math.min(std, credit);
  return {
    steps, cash: settled.size ? wb + std - creditUsed : a.cash, creditUsed: settled.size ? creditUsed : a.creditUsed ?? 0, ownedBasis: a.ownedBasis ?? null, allIn: a.allIn ?? null,
    start: { ship: a.token?.ship ?? a.steps[0]?.from ?? null, token: a.token ? { copyId: a.token.copyId, pledgeId: a.token.pledgeId } : null },
  };
};

// What a reservation holds. Its credit only covers the Standard steps still to buy: once one is owned, its credit is free again.
// A Standard step you already own the copy for holds that copy (one copy settles one goal's step only).
const claimsOf = (accepted, graph, taken) => {
  const { credit, bought, settled } = settleStandard(accepted, graph, taken);
  return {
    settled,
    copies: [...accepted.steps.filter((s) => s.copyId).map((s) => s.copyId), ...(accepted.token?.copyId ? [accepted.token.copyId] : []), ...bought],
    credit,
  };
};

/** Route searches (all levels together) after which one planGoals call stops trying other goal orders; the default order of every level is always planned in full. */
export const SEARCH_CAP = 32;

// Better = more goals routed, then less cash, then less all-in. Equal is not better.
const scoreOf = (steps) => {
  let routed = 0, cash = 0, allIn = 0;
  for (const { entry } of steps) if (entry.route) { routed++; cash += entry.route.cash ?? 0; allIn += entry.route.allIn ?? entry.route.cash ?? 0; }
  return { routed, cash, allIn };
};
const better = (a, b) => (a.routed !== b.routed ? a.routed > b.routed : a.cash !== b.cash ? a.cash < b.cash : a.allIn < b.allIn);

/**
 * Orders the unaccepted goals of ONE priority level (given in default order) so the shared plan stays cheap.
 * Greedy construction (each goal tried next, the rest in default order), then single-move improvement passes,
 * until the planGoals-wide search cap is spent (best order so far is kept). Only a strictly better order replaces the default.
 * Planning state after every prefix is cached, so an order is only planned from its first new position on.
 * `capped()` says whether the search cap is spent; `improve` false = greedy only.
 * `planOne(goal, claimed, creditUsed)` plans one goal; `base` = { claimed, creditUsed } before the level.
 * @returns {{ order: object[], steps: { entry: object, after: { claimed: Set<string>, creditUsed: number } }[] }}
 */
function chooseGoalOrder(level, base, planOne, capped, improve = true) {
  const byId = new Map(level.map((c) => [c.id, c]));
  const prefixes = new Map(); // 'id|id' -> steps of that prefix
  const plan = (ids, stopWhenCapped = false) => {
    let k = ids.length;
    while (k > 0 && !prefixes.has(ids.slice(0, k).join('|'))) k--;
    const steps = k ? [...prefixes.get(ids.slice(0, k).join('|'))] : [];
    for (let i = k; i < ids.length; i++) {
      if (stopWhenCapped && capped()) return null;
      const from = i ? steps[i - 1].after : base;
      const entry = planOne(byId.get(ids[i]), from.claimed, from.creditUsed);
      const after = { claimed: new Set(from.claimed), creditUsed: from.creditUsed };
      if (entry.route) {
        for (const s of entry.route.steps) if (s.copyId) after.claimed.add(s.copyId);
        if (entry.route.start?.token) after.claimed.add(entry.route.start.token.copyId);
        after.creditUsed += entry.route.creditUsed;
      }
      steps.push({ entry, after });
      prefixes.set(ids.slice(0, i + 1).join('|'), steps.slice());
    }
    return steps;
  };
  const ids0 = level.map((c) => c.id);
  const seen = new Map(); // order key -> score
  let best = { ids: ids0, score: scoreOf(plan(ids0)) };
  seen.set(ids0.join('|'), best.score);
  // Scores an order once; false when the budget is spent. Updates `best` on a strict improvement.
  const tryOrder = (ids) => {
    const key = ids.join('|');
    if (seen.has(key)) return seen.get(key);
    if (capped()) return null;
    const steps = plan(ids, true);
    const score = steps && scoreOf(steps);
    if (steps) seen.set(key, score);
    if (score && better(score, best.score)) best = { ids, score };
    return score;
  };
  if (level.length >= 2) {
    // Greedy construction.
    const fixed = [];
    let rest = ids0.slice();
    while (rest.length > 1) {
      let pick = null;
      for (const g of rest) {
        const score = tryOrder([...fixed, g, ...rest.filter((x) => x !== g)]);
        if (score && (!pick || better(score, pick.score))) pick = { g, score };
      }
      if (!pick) break;
      fixed.push(pick.g);
      rest = rest.filter((x) => x !== pick.g);
    }
    // Improvement passes: move one goal elsewhere.
    let improved = true;
    while (improve && improved && !capped()) {
      improved = false;
      for (let i = 0; i < best.ids.length && !capped(); i++) {
        for (let j = 0; j < best.ids.length && !capped(); j++) {
          if (i === j) continue;
          const o = best.ids.slice();
          o.splice(j, 0, o.splice(i, 1)[0]);
          const before = best.score;
          tryOrder(o);
          if (best.score !== before) { improved = true; i = -1; break; }
        }
      }
    }
  }
  return { order: best.ids.map((id) => byId.get(id)), steps: plan(best.ids) };
}

const planMemo = new WeakMap();
const MEMO_LIMIT = 4;

/**
 * Plans every goal together. Accepted goals keep what they hold and claim it first; the others are
 * planned by priority (high, normal, low), each seeing the copies, tokens and credit left by those before it.
 * Within one priority level the order is not creation order: chooseGoalOrder searches (until SEARCH_CAP route searches are spent, deterministic)
 * for the order with the most routed goals, then the least cash, then the least
 * all-in, and keeps the createdAt order unless another is strictly better. The result Map lists the
 * unaccepted goals of a level in the chosen planning order.
 * `exclude`/`credit` of a goal = what everyone else (except goals planned after it) holds.
 * @returns {Map<string, { exclude: Set<string>, credit: number, route: object|null, noToken: boolean }>}
 */
export function planGoals(state, graph, { maxSteps = 25, searchCap = SEARCH_CAP, noReuse = false, noImprove = false } = {}) {
  // searchCap, noReuse and noImprove tune the search (tests, measurements); a call that sets one bypasses the memo.
  const tuned = searchCap !== SEARCH_CAP || noReuse || noImprove;
  const chains = Object.values(state.chains).sort(byPriority);
  const sig = JSON.stringify([
    maxSteps, state.profile?.credit ?? 0, state.profile?.tokens ?? null, state.profile?.excludedCopies ?? null,
    chains.map((c) => ({ id: c.id, start: startOf(c), target: c.target, priority: c.priority, createdAt: c.createdAt, mode: c.mode, objective: c.objective, via: c.via ?? null, accepted: c.accepted })),
  ]);
  let memo = tuned ? null : planMemo.get(graph);
  if (memo?.has(sig)) return memo.get(sig);

  const total = state.profile?.credit ?? 0;
  const result = new Map();
  const accepted = chains.filter((c) => c.accepted);
  const heldBy = new Map(); // accepted goal -> claims
  // Copies you excluded count as claimed by nobody's goal: every search skips them, and none settles a Standard step.
  const excluded = excludedCopies(state);
  const claimed = new Set(excluded);
  let creditUsed = 0;
  const taken = new Set([...reservations(state).keys(), ...excluded]);
  for (const c of acceptedInOrder(state)) {
    const cl = claimsOf(c.accepted, graph, taken);
    for (const id of cl.copies) taken.add(id);
    heldBy.set(c.id, cl);
    for (const id of cl.copies) claimed.add(id);
    creditUsed += cl.credit;
  }
  for (const c of accepted) {
    const own = heldBy.get(c.id);
    const exclude = new Set(excluded);
    for (const [id, cl] of heldBy) if (id !== c.id) for (const x of cl.copies) exclude.add(x);
    result.set(c.id, { exclude, credit: Math.max(0, total - (creditUsed - own.credit)), route: acceptedRoute(c.accepted, own.settled, own.credit), noToken: false });
  }
  // Plan the rest level by level (priority always wins). Inside one level the order is searched.
  // A goal's search only sees claimed copies that sit on an owned CCU between its start ships and its target
  // (and, for a token goal, tokens). Two orders that leave the same such copies and credit give the same result.
  let reverse = null;
  const relevantOf = new Map();
  const relevant = (c) => {
    if (relevantOf.has(c.id)) return relevantOf.get(c.id);
    if (!reverse) {
      reverse = new Map();
      for (const [from, edges] of graph.edges) for (const e of edges) (reverse.get(e.to) ?? reverse.set(e.to, new Set()).get(e.to)).add(from);
    }
    const reach = (seeds, next) => {
      const seen = new Set(seeds);
      for (const x of seen) for (const y of next(x)) seen.add(y);
      return seen;
    };
    const fwd = reach(goalStarts(state, c, graph).map((st) => st.ship), (x) => (graph.edges.get(x) ?? []).map((e) => e.to));
    const back = reach([c.target], (x) => reverse.get(x) ?? []);
    const copies = new Set();
    for (const from of fwd) for (const e of graph.edges.get(from) ?? []) if ((e.kind === 'owned' || e.virtual) && back.has(e.to)) for (const cp of e.copies) copies.add(cp.copyId);
    const rel = { copies, tokens: startOf(c).kind === 'token' };
    relevantOf.set(c.id, rel);
    return rel;
  };
  const reuse = createRouteReuse();
  const planOne = (c, claimedNow, creditUsedNow) => {
    const credit = Math.max(0, total - creditUsedNow);
    if (noReuse) return searchOne(c, new Set(claimedNow), credit);
    const rel = relevant(c);
    const seen = new Set([...claimedNow].filter((id) => rel.copies.has(id) || (rel.tokens && id.startsWith('token:'))));
    const exclude = new Set(claimedNow);
    const hit = reuse.lookup(c.id, seen, credit);
    if (hit) return { exclude, credit, route: hit.route, noToken: hit.noToken };
    const entry = searchOne(c, exclude, credit);
    reuse.store(c.id, seen, credit, entry);
    return entry;
  };
  let searches = 0;
    const searchOne = (c, exclude, credit) => {
    searches++;
    const starts = goalStarts(state, c, graph, exclude);
    const [route] = starts.length
      ? searchRoutes(graph, { starts, target: c.target, credit, maxSteps, excludeCopies: exclude, maxResults: 1, objective: c.objective ?? 'cash', via: c.via ?? null })
      : [];
    return { exclude, credit, route: route ?? null, noToken: startOf(c).kind === 'token' && starts.length === 0 };
  };
  const levels = [];
  for (const c of chains) {
    if (c.accepted) continue;
    const last = levels[levels.length - 1];
    if (last && last[0].priority === c.priority) last.push(c); else levels.push([c]);
  }
  let base = { claimed, creditUsed };
  for (const level of levels) {
    const { order, steps } = chooseGoalOrder(level, base, planOne, () => searches >= searchCap, !noImprove);
    for (let i = 0; i < order.length; i++) result.set(order[i].id, steps[i].entry);
    base = steps.length ? steps[steps.length - 1].after : base;
  }
  if (tuned) return result;
  if (!memo) planMemo.set(graph, (memo = new Map()));
  if (memo.size >= MEMO_LIMIT) memo.delete(memo.keys().next().value);
  memo.set(sig, result);
  return result;
}

/** Plans one goal in the shared plan: goals before it hold copies, tokens and credit; accepted goals keep theirs. `plan`: a planGoals result to reuse (a session's). */
export function proposeChain(state, chainId, graph, { k = 3, maxSteps = 25, plan = null } = {}) {
  const chain = state.chains[chainId];
  const shared = (plan ?? planGoals(state, graph, { maxSteps })).get(chainId);
  const credit = shared.credit;
  const starts = goalStarts(state, chain, graph, shared.exclude);
  const noToken = startOf(chain).kind === 'token' && starts.length === 0;
  const opts = { starts, target: chain.target, credit, maxSteps, excludeCopies: new Set(shared.exclude), objective: chain.objective ?? 'cash', via: chain.via ?? null };
  const routes = starts.length ? planRoutes(graph, opts, k) : [];
  return { routes, credit, noToken };
}

/**
 * Fleet proposal: all goals planned together (see planGoals), listed by priority and, within a level, in the
 * chosen planning order. Accepted goals report their accepted
 * route; the others get their shared route. Does not change state.
 */
export function proposeFleet(state, graph, { maxSteps = 25, ids = null, plan = null } = {}) {
  const shared = plan ?? planGoals(state, graph, { maxSteps });
  const order = Object.values(state.chains).filter((c) => !ids || ids.includes(c.id)).sort(byPriority);
  // Within a priority level, unaccepted goals appear in the chosen planning order.
  const rank = new Map([...shared.keys()].map((id, i) => [id, i]));
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j < order.length && order[j].priority === order[i].priority) j++;
    const slots = [];
    for (let k = i; k < j; k++) if (!order[k].accepted) slots.push(k);
    const sorted = slots.map((k) => order[k]).sort((a, b) => rank.get(a.id) - rank.get(b.id));
    slots.forEach((k, n) => { order[k] = sorted[n]; });
    i = j;
  }
  const plans = order.map((c) => ({ chainId: c.id, route: shared.get(c.id).route, noToken: shared.get(c.id).noToken }));
  const total = plans.reduce((sum, p) => sum + (p.route?.cash ?? 0), 0);
  // Credit left after the whole shared plan, not only the listed goals.
  const used = [...shared.values()].reduce((sum, r) => sum + (r.route?.creditUsed ?? 0), 0);
  return { plans, totalCash: total, creditLeft: (state.profile.credit ?? 0) - used, unreachable: plans.filter((p) => !p.route).map((p) => p.chainId) };
}

