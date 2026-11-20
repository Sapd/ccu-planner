// What sharing costs a goal: its best route "alone" (nothing taken by other goals) against its route in the
// shared plan, and which goals hold what the alone route would use. Also the planning order shown on the Goals
// page. Pure; the planning session caches these (session.alone, session.sharedEffect, session.levels).
import { searchRoutes, edgeKey } from './planner.mjs';
import { goalStarts } from './sharedPlan.mjs';
import { excludedCopies } from './goals.mjs';
import { goalNamer } from './ships.mjs';

/**
 * The goal's best route with the same objective, step limit and starts as in the shared plan, but with no copies,
 * tokens or credit taken by other goals. Your whole store credit counts. Null when there is no route.
 */
export function aloneRoute(session, chainId) {
  const { plans, graph, maxSteps } = session;
  const chain = plans.chains[chainId];
  // Nothing taken from this goal and all the credit left: the shared plan is the alone plan, no second search.
  // Copies you excluded stay excluded alone too: "alone" means no other goal takes anything, not that your exclusions lapse.
  const excluded = excludedCopies(plans);
  const entry = session.shared.get(chainId);
  if (entry && [...entry.exclude].every((id) => excluded.has(id)) && (entry.credit ?? 0) >= (plans.profile?.credit ?? 0)) return session.route(chainId);
  const starts = goalStarts(plans, chain, graph, new Set());
  if (!starts.length) return null;
  const [route] = searchRoutes(graph, {
    starts, target: chain.target, credit: plans.profile?.credit ?? 0, maxSteps,
    excludeCopies: excluded, maxResults: 1, objective: chain.objective ?? 'cash',
  });
  return route ?? null;
}

// copy id (owned CCU or token) -> the goal whose shared route uses it.
function holdersOf(session) {
  const held = new Map();
  for (const [id, entry] of session.shared) {
    const r = entry.route;
    if (!r) continue;
    for (const s of r.steps) if (s.copyId) held.set(s.copyId, id);
    if (r.start?.token?.copyId) held.set(r.start.token.copyId, id);
  }
  return held;
}

/**
 * @returns {{
 *   shared: object|null, alone: object|null, extra: number|null,
 *   blockers: Array<{ goalId: string, goalName: string, items: Array<{ kind: 'copy'|'token'|'credit', from: number|null, to: number|null, amount?: number }> }>,
 * }}
 * shared = the route the goal shows (session.route), alone = aloneRoute, extra = shared cash - alone cash (null
 * when either has no route). blockers say what the alone route uses that the shared plan gave to another goal:
 * an owned CCU (from, to), an LTI token (from = its ship) or store credit (amount, cents), grouped by the goal
 * that holds it, in planning order. They are only listed when sharing costs something (extra > 0), or when the
 * goal has no route in the shared plan but would alone.
 */
export function sharedEffect(session, chainId) {
  const { plans, graph, data } = session;
  const shared = session.route(chainId);
  const alone = session.alone(chainId);
  const extra = shared && alone ? shared.cash - alone.cash : null;
  const out = { shared, alone, extra, blockers: [] };
  if (!alone || (shared && !(extra > 0))) return out;

  const entry = session.shared.get(chainId);
  const held = holdersOf(session);
  const order = [...session.shared.keys()];
  const groups = new Map(); // goal id -> items
  const add = (goalId, item) => {
    if (!goalId || goalId === chainId) return;
    (groups.get(goalId) ?? groups.set(goalId, []).get(goalId)).push(item);
  };

  // Owned CCUs: blocked only when every copy of that pair is taken (a free copy of the pair gives the same step).
  for (const s of alone.steps) {
    if (s.kind !== 'owned' || !s.copyId) continue;
    const pair = (graph.edges.get(s.from) ?? []).find((e) => e.kind === 'owned' && e.to === s.to);
    const copies = pair?.copies ?? [{ copyId: s.copyId }];
    if (!copies.every((c) => entry.exclude.has(c.copyId))) continue;
    add(held.get(s.copyId) ?? copies.map((c) => held.get(c.copyId)).find(Boolean), { kind: 'copy', from: s.from, to: s.to });
  }

  // The LTI token: blocked when the alone route's token is held and the shared route starts from another one.
  const tk = alone.start?.token;
  if (tk && entry.exclude.has(tk.copyId) && tk.copyId !== shared?.start?.token?.copyId) {
    add(held.get(tk.copyId), { kind: 'token', from: alone.start.ship, to: null });
  }

  // Store credit: the alone route uses more than the goals before this one left.
  const need = alone.creditUsed ?? 0;
  let missing = need - (entry.credit ?? 0);
  if (missing > 0) {
    const accepted = !!plans.chains[chainId]?.accepted;
    const before = accepted ? order.filter((id) => id !== chainId && plans.chains[id]?.accepted) : order.slice(0, order.indexOf(chainId));
    for (const id of before) {
      const used = session.shared.get(id).route?.creditUsed ?? 0;
      if (used <= 0 || missing <= 0) continue;
      const amount = Math.min(used, missing);
      add(id, { kind: 'credit', from: null, to: null, amount });
      missing -= amount;
    }
  }

  const namer = goalNamer(plans, data?.ships ?? null);
  out.blockers = [...groups].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([goalId, items]) => ({ goalId, goalName: namer(goalId), items }));
  return out;
}

/**
 * The blockers to name on a step of the goal's shared route, or null. Only what belongs to that step:
 * the alone and shared routes are aligned on the ships they share (anchors); for a purchase the alone route does not
 * make, the span of the alone route between the nearest anchors before and after it is its alternative, and only the
 * blocker items inside that span count (an owned CCU of the span; the token when the span starts at the route's
 * start). A credit blocker goes to the Standard purchases that pay cash because the credit ran out. When no
 * span matches, all blockers are named. Blockers keep their shape ({ goalId, goalName, items }) with only those items.
 */
export function neededBecause(effect, step) {
  if (!effect?.alone || !effect.shared || !(effect.extra > 0) || !effect.blockers.length || step.kind === 'owned') return null;
  const shared = effect.shared.steps;
  const alone = effect.alone.steps;
  const at = shared.indexOf(step);
  const inAlone = alone.some((s) => edgeKey(s) === edgeKey(step));
  const picked = new Map(); // goal id -> items
  const take = (b, item) => (picked.get(b.goalId) ?? picked.set(b.goalId, { goalId: b.goalId, goalName: b.goalName, items: [] }).get(b.goalId)).items.push(item);

  if (!inAlone) {
    const sNodes = [shared[0]?.from, ...shared.map((s) => s.to)];
    const aNodes = [alone[0]?.from, ...alone.map((s) => s.to)];
    let ia = 0;
    for (let k = at; k >= 0; k--) { const j = aNodes.indexOf(sNodes[k]); if (j >= 0) { ia = j; break; } }
    let ib = aNodes.length - 1;
    for (let k = at + 1; k < sNodes.length; k++) { const j = aNodes.indexOf(sNodes[k]); if (j >= 0) { ib = j; break; } }
    if (at >= 0) {
      const span = ib > ia ? alone.slice(ia, ib) : []; // empty: the alone route already starts at the anchor after the step
      for (const b of effect.blockers) {
        for (const item of b.items) {
          if (item.kind === 'copy' && span.some((s) => s.kind === 'owned' && s.from === item.from && s.to === item.to)) take(b, item);
          else if (item.kind === 'token' && ia === 0) take(b, item);
        }
      }
    }
  }
  // Credit: the Standard purchases of the shared route that pay cash once the credit it used is spent.
  if (step.kind === 'standard' && effect.blockers.some((b) => b.items.some((i) => i.kind === 'credit'))) {
    let std = 0;
    for (const s of shared) {
      if (s.kind === 'standard') std += s.cash;
      if (s === step) break;
    }
    if (std > (effect.shared.creditUsed ?? 0)) for (const b of effect.blockers) for (const item of b.items) if (item.kind === 'credit') take(b, item);
  }
  if (picked.size) return [...picked.values()];
  return inAlone ? null : effect.blockers;
}

/**
 * Goals in planning order: first the accepted goals (they hold their CCUs before any other goal is planned) as
 * { priority: 'accepted', ids }, then one group per priority level that has unaccepted goals, in the order the shared
 * plan chose: [{ priority: 'accepted'|'high'|'normal'|'low', ids }]. Empty groups are left out.
 */
export function planningLevels(session) {
  const chains = Object.values(session.plans.chains);
  const rank = new Map([...session.shared.keys()].map((id, i) => [id, i]));
  return ['accepted', 'high', 'normal', 'low']
    .map((priority) => ({
      priority,
      ids: chains.filter((c) => (priority === 'accepted' ? !!c.accepted : !c.accepted && (c.priority ?? 'normal') === priority)).sort((a, b) => rank.get(a.id) - rank.get(b.id)).map((c) => c.id),
    }))
    .filter((l) => l.ids.length);
}
