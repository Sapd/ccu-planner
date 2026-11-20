// Price-change alerts for a route and what waiting costs. Pure.

import { searchRoutes, edgeKey, buildGraph, withEdge } from './planner.mjs';
import { shipAvailability } from './availability.mjs';
import { goalStarts } from './sharedPlan.mjs';


// The graph as it will be after the price change: today's owned copies and tokens, the expected offers.
function expectedGraph(graph, expected) {
  const owned = [];
  for (const edges of graph.edges.values()) for (const e of edges) if (e.kind === 'owned') for (const c of e.copies) owned.push({ ...c, from: e.from, to: e.to });
  const g = buildGraph({ offers: expected, owned, lti: graph.lti });
  return { ...g, concept: graph.concept };
}

// `graph` plus one Standard edge from -> to at `cash` (replacing that pair's Standard edge).
function withStandard(graph, from, to, cash) {
  const old = (graph.edges.get(from) ?? []).find((e) => e.kind === 'standard' && e.to === to);
  return withEdge(graph, { ...(old ?? {}), from, to, kind: 'standard', cash });
}

/**
 * What waiting costs this goal for the Standard steps of a route that the price change removes or
 * raises (`affected`: their alerts, all judged together): the best plan after the change minus the
 * best plan after the change that has every one of those steps at today's price. Both use the goal's
 * shared-planning inputs (starts, copies, credit) and objective (all-in cost for an all-in goal).
 * Infinity: no route after the change, one when bought now. Null: unknown (no plan or start, or no
 * route even when bought now). Memoised in the session.
 */
const waitMemo = new WeakMap(); // planGoals result -> { expected, graph, eg, after, saves }

function waitingPenalty({ session, chainId }, expected, affected) {
  const { plans, graph, maxSteps } = session;
  const chain = plans.chains[chainId];
  if (!chain) return null;
  const plan = session.shared.get(chainId);
  if (!plan) return null;
  // eg: the graph after the change; after: chainId -> best route after it; saves: 'chainId|stepKey@now|..' -> penalty
  // Keyed on the planGoals result (see lockCover): a session with an unchanged plan, graph and expected prices keeps its penalties.
  const result = session.shared;
  let memo = waitMemo.get(result);
  if (!memo || memo.expected !== expected || memo.graph !== graph) waitMemo.set(result, (memo = { expected, graph, eg: null, after: new Map(), saves: new Map() }));
  const key = `${chainId}|${affected.map((a) => `${edgeKey(a.step)}@${a.now}`).join('|')}`;
  if (memo.saves.has(key)) return memo.saves.get(key);
  const starts = goalStarts(plans, chain, graph, plan.exclude);
  let out = null;
  if (starts.length) {
    const objective = chain.objective ?? 'cash';
    const metric = (r) => (objective === 'allin' ? r.allIn : r.cash);
    const opts = { starts, target: chain.target, credit: plan.credit, maxSteps, excludeCopies: new Set(plan.exclude), objective, maxResults: 1 };
    memo.eg ??= expectedGraph(graph, expected);
    if (!memo.after.has(chainId)) memo.after.set(chainId, searchRoutes(memo.eg, opts)[0] ?? null);
    const after = memo.after.get(chainId);
    let restored = memo.eg;
    for (const a of affected) restored = withStandard(restored, a.step.from, a.step.to, a.now);
    const bought = searchRoutes(restored, opts)[0] ?? null;
    out = !bought ? null : !after ? Infinity : Math.max(0, metric(after) - metric(bought));
  }
  memo.saves.set(key, out);
  return out;
}

/**
 * Standard steps of a route whose price is expected to change.
 * reason: 'pricier' / 'cheaper' (your expected prices), 'gone' (target no longer
 * more expensive), 'event' (target only known on sale during the ongoing sale
 * event; the alert carries it as `event`), 'concept' (target is a concept ship
 * without your expected price: it will rise, by an unknown amount).
 * `avail` is an availCtx; without it no event is known.
 *
 * `ctx` ({ session, chainId }) keeps the 'gone' and 'pricier' alerts of a route only when
 * waiting really costs this goal money: they then all carry `saves`, the extra cash (all-in cost for an
 * all-in goal) after the change against buying all of them now (Infinity: no route after the change; an
 * alert whose penalty is unknown stays without `saves`). `route` must be the goal's full route: every page
 * gets its alerts from routeAdvice, so they all get the same answer. `together` marks a penalty shared by
 * several steps. Without `ctx` nothing is checked. 'event' and 'concept' alerts are never checked: their future price is unknown.
 */
export function expectedChanges(route, expected, ships = null, avail = null, ctx = null) {
  const exp = new Map();
  for (const o of expected) if (o.kind === 'standard') exp.set(`${o.from}-${o.to}`, o);
  let alerts = [];
  let later = 0;
  for (const s of route.steps) {
    if (s.kind !== 'standard') continue;
    const e = exp.get(`${s.from}-${s.to}`);
    if (!e) { alerts.push({ step: s, now: s.cash, expected: null, reason: 'gone' }); later += s.cash; continue; }
    later += e.cash;
    const a = avail ? shipAvailability(avail, s.to) : null;
    const event = a && a.status !== 'regular' ? a.event : null;
    if (e.cash > s.cash) alerts.push({ step: s, now: s.cash, expected: e.cash, reason: 'pricier' });
    else if (event) alerts.push({ step: s, now: s.cash, expected: e.cash === s.cash ? null : e.cash, reason: 'event', event });
    else if (e.cash !== s.cash) alerts.push({ step: s, now: s.cash, expected: e.cash, reason: 'cheaper' });
    else if (!e.assumed && ships?.get(s.to)?.concept) alerts.push({ step: s, now: s.cash, expected: null, reason: 'concept' });
  }
  const dropped = [];
  const shown = alerts.filter((a) => a.reason === 'gone' || a.reason === 'pricier');
  if (shown.length && ctx?.session && ctx.chainId != null) {
    // One penalty per route: buying all of its affected steps now is what waiting is compared with.
    const saves = waitingPenalty(ctx, expected, shown);
    if (saves != null) {
      if (saves > 0) for (const a of shown) { a.saves = saves; if (shown.length > 1) a.together = true; }
      else { alerts = alerts.filter((a) => !shown.includes(a)); dropped.push(...shown); }
    }
  }
  return { alerts, dropped, standardLaterExpected: later, buyBefore: alerts.filter((a) => a.reason !== 'cheaper') };
}

