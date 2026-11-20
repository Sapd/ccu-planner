// CCU route planner. Pure functions, no I/O: callers pass ships, offers and owned copies.
//
// Model
//   node  = exact ship ID (RSI upgrade-tool ship ID)
//   edge  = one way to get from A to B:
//     owned     owned CCU copies for that exact pair, $0 new money; a route uses one copy
//     standard  store offer, payable with store credit
//     warbond   discounted store offer, new cash only
//
// Objective "least new cash": cash = warbond + max(0, standard - credit).
// Because standard upgrades always cost value(B) - value(A), a chain of only
// standard edges costs value(target) - value(base) whatever the path; savings
// come only from owned and warbond edges. The search still works on explicit
// edges so legacy owned CCUs (target cheaper than source) are handled.
//
// Search: label-setting with a binary heap over (warbondCash, standardCash),
// Pareto pruning per ship, cycle-free paths and a step limit. Equal-cost ties
// prefer Warbond steps from flight-ready ships over concept ships (their price
// usually rises before release), then more owned copies, then fewer steps,
// then fewer purchases, then stable keys. The concept tie-break never changes cash.

/**
 * @typedef {{ from: number, to: number, kind: 'standard'|'warbond', cash: number, skuId?: number, title?: string }} Offer
 * @typedef {{ copyId: string, from: number, to: number, giftable?: boolean, paid?: { cents: number } }} OwnedCopy
 */

const kindRank = (k) => ({ owned: 0, warbond: 1, standard: 2 }[k] ?? 3);

/** Copy preference: keep giftable copies free, use the cheapest-paid copy first. */
const copyOrder = (a, b) =>
  Number(!!a.giftable) - Number(!!b.giftable)
  || (a.paid?.cents ?? Infinity) - (b.paid?.cents ?? Infinity)
  || String(a.copyId).localeCompare(String(b.copyId));

/**
 * The planning graph: `edges` maps a ship id to its outgoing edges (sorted by target, then kind);
 * `lti` is the pool of token pledges; `concept` the ship ids whose price rises before release (a tie-break only).
 * @typedef {{ edges: Map<number, object[]>, lti: object[], concept: Set<number> }} Graph
 * @returns {Graph}
 */
export function buildGraph({ offers = [], owned = [], lti, ships }) {
  const byPair = new Map(); // "from-to-kind" -> edge
  for (const c of owned) {
    if (c.from === c.to) continue;
    const k = `${c.from}-${c.to}-owned`;
    if (!byPair.has(k)) byPair.set(k, { from: c.from, to: c.to, kind: 'owned', cash: 0, copies: [] });
    byPair.get(k).copies.push(c);
  }
  for (const o of offers) {
    if (o.from === o.to || !Number.isInteger(o.cash) || o.cash < 0) continue;
    const k = `${o.from}-${o.to}-${o.kind}`;
    const prev = byPair.get(k);
    if (!prev || o.cash < prev.cash || (o.cash === prev.cash && (o.skuId ?? 0) < (prev.skuId ?? 0))) byPair.set(k, { ...o });
  }
  const out = new Map();
  for (const e of byPair.values()) {
    if (e.copies) e.copies.sort(copyOrder);
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e);
  }
  for (const list of out.values()) list.sort((a, b) => a.to - b.to || kindRank(a.kind) - kindRank(b.kind));
  // Concept ships (price rises before release): used only to break ties between equal-cost routes.
  const concept = new Set();
  for (const [id, s] of ships ?? []) if (s?.concept === true) concept.add(id);
  return { edges: out, lti: lti ?? [], concept };
}

/**
 * A copy of `graph` with one more edge. An existing edge for the same pair and kind is replaced in
 * place; otherwise the edge is inserted so the list stays sorted by target. `lti` and `concept` carry over.
 * The input is never changed.
 * @returns {Graph}
 */
export function withEdge(graph, edge) {
  const edges = new Map(graph.edges);
  const list = graph.edges.get(edge.from) ?? [];
  const at = list.findIndex((e) => !e.virtual && !!edge.virtual === false && e.kind === edge.kind && e.to === edge.to);
  if (at >= 0) edges.set(edge.from, list.map((e, i) => (i === at ? edge : e)));
  else {
    const pos = list.findLastIndex((e) => e.to <= edge.to) + 1;
    edges.set(edge.from, [...list.slice(0, pos), edge, ...list.slice(pos)]);
  }
  return { edges, lti: graph.lti, concept: graph.concept };
}

export function cashNeeded(warbond, standard, credit) {
  return warbond + Math.max(0, standard - credit);
}

export const edgeKey = (e) => (e.virtual ? `virtual:${e.virtualId}:${e.from}-${e.to}` : `${e.kind}:${e.from}-${e.to}`);

/** The id prefix of a virtual CCU's copies: `virtual:<id>:<from>-<to>:<n>`. */
export const VIRTUAL_COPY = 'virtual:';

/** True when a virtual CCU has expired by `today` ('YYYY-MM-DD'): it is kept in the list but no longer planned with. */
export const virtualExpired = (v, today) => !!(v?.expires && today && v.expires < today);

/**
 * A copy of `graph` with your virtual CCUs (plans.profile.virtualCcus) as edges: an upgrade you can get outside the
 * store (a friend, a trade, a sale you expect) for `cents` new cash, `copies` times. Each is a Warbond-like edge (cash
 * only, store credit cannot pay it) marked `virtual`, with copies `virtual:<id>:<from>-<to>:<n>` that goals claim one by one like
 * owned CCUs. Expired ones are left out. Without any, the graph itself is returned.
 */
export function withVirtualCcus(graph, list, today = null) {
  const live = (list ?? []).filter((v) => v && v.from !== v.to && Number.isInteger(v.cents) && v.cents >= 0 && !virtualExpired(v, today));
  if (!live.length) return graph;
  const edges = new Map(graph.edges);
  for (const v of live) {
    const n = Math.max(1, Math.trunc(v.copies ?? 1));
    const edge = {
      from: v.from, to: v.to, kind: 'warbond', cash: v.cents, virtual: true, virtualId: v.id, note: v.note ?? null, expires: v.expires ?? null,
      // The pair is in the copy id: a record edited to another pair never shares a copy with a chain that kept the old one.
      copies: Array.from({ length: n }, (_, i) => ({ copyId: `${VIRTUAL_COPY}${v.id}:${v.from}-${v.to}:${i + 1}` })),
    };
    const list2 = [...(edges.get(v.from) ?? []), edge];
    list2.sort((a, b) => a.to - b.to || kindRank(a.kind) - kindRank(b.kind) || Number(!!a.virtual) - Number(!!b.virtual) || a.cash - b.cash);
    edges.set(v.from, list2);
  }
  return { ...graph, edges };
}

/** `next` with the virtual CCU edges of `prev` added (for graphs rebuilt from offers and owned copies, which carry none). */
export function keepVirtual(prev, next) {
  const virtual = [...prev.edges.values()].flat().filter((e) => e.virtual);
  if (!virtual.length) return next;
  const edges = new Map(next.edges);
  for (const e of virtual) edges.set(e.from, [...(edges.get(e.from) ?? []), e].sort((a, b) => a.to - b.to || kindRank(a.kind) - kindRank(b.kind) || Number(!!a.virtual) - Number(!!b.virtual) || a.cash - b.cash));
  return { ...next, edges };
}

// Objectives
//   cash   least new cash (credit covers Standard steps), then reuse owned copies
//   allin  lowest all-in cost: new purchases (cash or credit) + what the consumed
//          owned copies cost you; keeps cheap-to-replace CCUs over spending cash
//          only when that is cheaper overall. Unknown copy prices count as 0 and
//          are reported (the result is then a lower bound).
export const allInCost = (l) => l.wb + l.std + l.basis;

function compareLabels(a, b, credit, objective = 'cash') {
  return (
    (objective === 'allin' ? allInCost(a) - allInCost(b) : 0)
    || cashNeeded(a.wb, a.std, credit) - cashNeeded(b.wb, b.std, credit)
    || Math.min(a.std, credit) - Math.min(b.std, credit) // less credit spent
    || a.wbConcept - b.wbConcept // prefer flight-ready Warbond sources
    || a.tokenCents - b.tokenCents // cheaper start token
    || b.owned - a.owned // reuse owned copies
    || a.steps - b.steps
    || (a.steps - a.owned) - (b.steps - b.owned) // fewer purchase lines
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}

class Heap {
  constructor(cmp) { this.a = []; this.cmp = cmp; }
  get size() { return this.a.length; }
  push(x) {
    const a = this.a; a.push(x);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (this.cmp(a[i], a[p]) >= 0) break;
      [a[i], a[p]] = [a[p], a[i]]; i = p;
    }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1; const r = l + 1; let m = i;
        if (l < a.length && this.cmp(a[l], a[m]) < 0) m = l;
        if (r < a.length && this.cmp(a[r], a[m]) < 0) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}

const onPath = (label, ship) => {
  for (let l = label; l; l = l.prev) if (l.ship === ship) return true;
  return false;
};

// Every ship on x's path is also on y's: whatever y can still visit, x can too.
const pathWithin = (x, y) => {
  for (let l = x; l; l = l.prev) if (!onPath(y, l.ship)) return false;
  return true;
};

/**
 * Finds the cheapest routes from base to target.
 * @param {Graph} graph from buildGraph
 * @param {{ base: number, target: number, credit?: number, maxSteps?: number,
 *           excludeCopies?: Set<string>, excludeEdges?: Set<string>, allowOwned?: boolean,
 *           allowWarbond?: boolean, allowStandard?: boolean, maxLabelsPerShip?: number,
 *           maxResults?: number, starts?: Array<{ ship: number, token?: { copyId: string, pledgeId: string, paidCents: number|null } }>,
 *           heuristic?: Map<number, number>, bound?: number, prefer?: (edge: object) => boolean, via?: number|null }} opts
 * `via`: only routes that pass through this ship count (a goal's "route through this ship").
 * With `starts`, base is ignored and every start seeds one label.
 * `heuristic` (A* search): ship -> a lower bound of what is still to pay from there to the target, in the objective's metric (new
 * cash, or all-in cost). It must never overestimate (a ship missing from it cannot reach the target). Labels are then expanded in
 * order of cost so far plus that bound, which finds the same cheapest cost after far fewer expansions; among routes of equal cost the
 * one returned may differ from a plain search. `bound`: only routes that cost at most this are of interest (labels that cannot
 * get down to it are dropped; a route tying the bound is kept). `prefer` (requires `heuristic`, else it throws): among labels of equal
 * cost so far plus bound, those whose path uses an edge for which it returns true are expanded first, so the route returned among equally cheap
 * ones is one that uses such an edge when there is one ("some cheapest route uses this edge" without a second search): such a label is
 * never dominated by one that did not use one, and survives the per-ship label limit first among labels of equal cost.
 * @returns {Array} routes sorted best first
 */
export function searchRoutes(graph, opts) {
  const {
    base, target, credit = 0, maxSteps = 15, excludeCopies = new Set(), excludeEdges = new Set(),
    allowOwned = true, allowWarbond = true, allowStandard = true, maxLabelsPerShip = 16, maxResults = 8,
    objective = 'cash', starts, heuristic = null, bound = Infinity, prefer = null, via = null,
  } = opts;
  if (!['cash', 'allin'].includes(objective)) throw new Error(`unknown objective ${objective}`);
  if (prefer && !heuristic) throw new Error('prefer needs a heuristic (it only orders the A* queue)');
  if (!starts && base === target) return [];
  const cmp = (a, b) => compareLabels(a, b, credit, objective);
  const concept = graph.concept ?? new Set();
  const frontier = new Map();
  const spent = (l) => (objective === 'allin' ? allInCost(l) : cashNeeded(l.wb, l.std, credit));
  const queue = new Heap(heuristic ? (a, b) => a.f - b.f || (prefer ? Number(!!b.via) - Number(!!a.via) : 0) || cmp(a, b) : cmp);
  const seeds = starts
    ? starts
      .filter((st) => st.ship !== target && !(st.token && excludeCopies.has(st.token.copyId)))
      .map((st) => ({ ship: st.ship, token: st.token ? { copyId: st.token.copyId, pledgeId: st.token.pledgeId } : null, tokenCents: st.token?.paidCents ?? 0, unknown: st.token && st.token.paidCents == null ? 1 : 0, key: st.token ? `${st.ship}#${st.token.pledgeId}` : String(st.ship) }))
    : [{ ship: base, token: null, tokenCents: 0, key: String(base) }];
  for (const sd of seeds) {
    const start = { ship: sd.ship, token: sd.token };
    const label = { passed: via == null || sd.ship === via, ship: sd.ship, wb: 0, std: 0, basis: sd.tokenCents, unknownBasis: sd.unknown ?? 0, owned: 0, steps: 0, wbConcept: 0, edge: null, copy: null, prev: null, key: sd.key, tokenCents: sd.tokenCents, start };
    if (heuristic) {
      const h = heuristic.get(sd.ship);
      if (h == null) continue;
      label.f = spent(label) + h;
    }
    queue.push(label);
  }
  const done = [];

  while (queue.size && done.length < maxResults) {
    const cur = queue.pop();
    if (cur.dead) continue;
    if (cur.ship === target) { if (cur.passed) done.push(cur); continue; }
    if (cur.steps >= maxSteps) continue;
    for (const e of graph.edges.get(cur.ship) ?? []) {
      if (excludeEdges.has(edgeKey(e))) continue;
      let copy = null;
      if (e.kind === 'owned') {
        if (!allowOwned) continue;
        const free = e.copies.filter((c) => !excludeCopies.has(c.copyId));
        if (!free.length) continue;
        // all-in: consume the cheapest copy; cash: keep giftable copies free (graph order).
        copy = objective === 'allin'
          ? free.reduce((m, c) => ((c.paid?.cents ?? 0) < (m.paid?.cents ?? 0) ? c : m))
          : free[0];
      } else if (e.virtual) {
        // A virtual CCU: limited copies like an owned one, but it costs its price in new cash.
        copy = e.copies.find((c) => !excludeCopies.has(c.copyId));
        if (!copy) continue;
      } else if ((e.kind === 'warbond' && !allowWarbond) || (e.kind === 'standard' && !allowStandard)) continue;
      if (onPath(cur, e.to)) continue;
      let h = 0;
      if (heuristic) {
        h = heuristic.get(e.to);
        if (h == null) continue;
      }
      const next = {
        ship: e.to,
        wb: cur.wb + (e.kind === 'warbond' ? e.cash : 0),
        std: cur.std + (e.kind === 'standard' ? e.cash : 0),
        basis: cur.basis + (e.kind === 'owned' ? copy.paid?.cents ?? 0 : 0),
        unknownBasis: cur.unknownBasis + (e.kind === 'owned' && copy.paid?.cents == null ? 1 : 0),
        passed: cur.passed || e.to === via,
        owned: cur.owned + (e.kind === 'owned' ? 1 : 0),
        steps: cur.steps + 1,
        wbConcept: cur.wbConcept + (e.kind === 'warbond' && concept.has(cur.ship) ? 1 : 0),
        edge: e,
        copy,
        prev: cur,
        key: `${cur.key}>${edgeKey(e)}`,
        tokenCents: cur.tokenCents,
        start: cur.start,
      };
      if (heuristic) {
        next.f = spent(next) + h;
        if (prefer) next.via = cur.via || prefer(e);
        if (next.f > bound) continue;
      }
      // With `via`, labels before and after the via ship compete apart (a cheap detour-free label must not crowd out one that passed it).
      const fk = via == null ? e.to : `${e.to}|${next.passed ? 1 : 0}`;
      const list = frontier.get(fk) ?? [];
      // With `prefer`, a label that did not go through the preferred edge never dominates one that did (it would hide the tied route through it).
      const dominates = (x, y) => (!prefer || x.via || !y.via) && (x.passed || !y.passed) && x.wb <= y.wb && x.std <= y.std && x.basis <= y.basis && x.owned >= y.owned && x.steps <= y.steps && x.tokenCents <= y.tokenCents && x.wbConcept <= y.wbConcept
        // A route through `via` may have to go back down past ships it skipped: a cheaper label that visited other ships must not hide it.
        && (via == null || pathWithin(x, y));
      if (list.some((o) => dominates(o, next))) continue;
      const kept = [];
      for (const o of list) {
        if (dominates(next, o)) o.dead = true;
        else kept.push(o);
      }
      kept.push(next);
      if (kept.length > maxLabelsPerShip) {
        // with `prefer`, among labels that cost the same the ones that went through the preferred edge stay
        kept.sort(prefer ? (a, b) => spent(a) - spent(b) || Number(!!b.via) - Number(!!a.via) || cmp(a, b) : cmp);
        for (const o of kept.splice(maxLabelsPerShip)) o.dead = true;
      }
      frontier.set(fk, kept);
      if (!next.dead) queue.push(next);
    }
  }
  return done.sort(cmp).map((l) => toRoute(l, credit));
}

function toRoute(label, credit) {
  const steps = [];
  for (let l = label; l.edge; l = l.prev) {
    const { copies, ...edge } = l.edge;
    if (edge.virtual) steps.unshift({ ...edge, copyId: l.copy.copyId });
    else steps.unshift(l.copy ? { ...edge, ...l.copy, kind: 'owned', cash: 0, otherCopies: copies.length - 1 } : edge);
  }
  return {
    steps,
    start: label.start,
    cash: cashNeeded(label.wb, label.std, credit),
    creditUsed: Math.min(label.std, credit),
    warbondCash: label.wb,
    standardCash: label.std,
    ownedUsed: label.owned,
    ownedBasis: label.basis,
    unknownBasis: label.unknownBasis,
    allIn: allInCost(label),
    purchases: steps.filter((s) => s.kind !== 'owned').length,
  };
}

const routeSig = (r) => r.steps.map(edgeKey).join('|');

/**
 * Best route plus up to k-1 materially different alternatives (different
 * ships or acquisition kinds, not just a different copy of the same CCU):
 * each alternative is the best route that avoids one non-standard step of a
 * route found so far.
 */
export function planRoutes(graph, opts, k = 3) {
  const [best] = searchRoutes(graph, { ...opts, maxResults: 1 });
  if (!best) return [];
  const found = [best];
  const seen = new Set([routeSig(best)]);
  for (let i = 0; i < found.length && found.length < k * 2; i++) {
    for (const e of found[i].steps.filter((s) => s.kind !== 'standard')) {
      const excludeEdges = new Set([...(opts.excludeEdges ?? []), edgeKey(e)]);
      const [alt] = searchRoutes(graph, { ...opts, excludeEdges, maxResults: 1 });
      if (alt && !seen.has(routeSig(alt))) { seen.add(routeSig(alt)); found.push(alt); }
      if (found.length >= k * 2) break;
    }
  }
  const primary = opts.objective === 'allin' ? (a, b) => a.allIn - b.allIn : () => 0;
  return found
    .sort((a, b) => primary(a, b) || a.cash - b.cash || a.creditUsed - b.creditUsed || b.ownedUsed - a.ownedUsed || a.steps.length - b.steps.length)
    .slice(0, k);
}

/** Catalog delta and savings for a route. */
export function summarize(route, ships, base, target) {
  const value = (id) => ships.get(id)?.msrp ?? null;
  const delta = value(target) != null && value(base) != null ? value(target) - value(base) : null;
  const paid = route.cash + route.creditUsed;
  return { msrpDelta: delta, newSpend: paid, savingsVsStandard: delta == null ? null : delta - paid };
}

/** Why a target cannot be reached at all (no incoming edges). */
export function incomingCount(graph, ship) {
  let n = 0;
  for (const list of graph.edges.values()) for (const e of list) if (e.to === ship) n++;
  return n;
}
