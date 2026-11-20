// What to look out for while a chain waits for Warbonds.
//
// Nobody knows which Warbonds RSI will offer next, so this predicts nothing.
// It answers two questions from today's data:
//
//   wanted:  for a pair A -> B with no Warbond today, below which price would a
//            Warbond make this chain cheaper? ("worth it below $X")
//   holding: Warbonds on sale today that are not on the best route but on one
//            that costs at most `slack` more. They vanish when the sale ends;
//            an unused one melts back to store credit at what you paid.
//
// Every threshold is exact for the chain as planned (its objective, credit,
// and CCUs reserved by other chains): the candidate edge is added at price 0,
// and if the best route then uses it, the threshold is today's best minus that
// route's cost. A Dijkstra estimate that ignores copy conflicts only picks
// which pairs are worth that exact check.

import { startOf, startShip, goalStarts, planGoals } from './chains.mjs';
import { searchRoutes, withEdge } from './planner.mjs';

class MinHeap {
  constructor() { this.a = []; }
  push(x) {
    const a = this.a; a.push(x);
    for (let i = a.length - 1; i > 0;) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1; const r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

export function dijkstra(adj, src) {
  const dist = new Map([[src, 0]]);
  const h = new MinHeap(); h.push([0, src]);
  while (h.size) {
    const [d, u] = h.pop();
    if (d > dist.get(u)) continue;
    for (const [v, w] of adj.get(u) ?? []) {
      if (d + w < (dist.get(v) ?? Infinity)) { dist.set(v, d + w); h.push([d + w, v]); }
    }
  }
  return dist;
}

/** Cost of one edge for the estimate, or null if unusable for this chain. */
export function edgeCost(e, objective, taken) {
  if (e.kind !== 'owned') return e.cash;
  const free = e.copies.filter((c) => !taken.has(c.copyId));
  if (!free.length) return null;
  return objective === 'allin' ? Math.min(...free.map((c) => c.paid?.cents ?? 0)) : 0;
}

/**
 * Lower bounds for A* probes: returns `(from, to) => Map(ship -> lower bound of what is still to pay to reach `target`)` on the graph
 * with a hypothetical free edge from -> to. Costs ignore copy conflicts (only free copies count), so a bound never overestimates:
 * for the cash objective an owned step is free; with store credit a Standard step may cost nothing, so it counts 0 then (the bound
 * is only exact without credit); for all-in an owned step costs the cheapest free copy's price.
 */
export function costBounds(graph, { target, objective, credit, taken }) {
  const zeroStandard = credit > 0 && objective !== 'allin';
  const rev = new Map();
  for (const [from, edges] of graph.edges) {
    for (const e of edges) {
      const w0 = edgeCost(e, objective, taken);
      if (w0 == null) continue;
      const w = zeroStandard && e.kind === 'standard' ? 0 : w0;
      if (!rev.has(e.to)) rev.set(e.to, []);
      rev.get(e.to).push([from, w]);
    }
  }
  return (from, to) => dijkstra({ get: (u) => (u === to ? [...(rev.get(u) ?? []), [from, 0]] : rev.get(u)) }, target);
}

/**
 * Exact checks per kind (a pair any discount helps / a pair that needs a discount) for one goal. Each check is a route search
 * (A*, see `through`). The pairs are checked best first (smallest discount needed, then the biggest Standard price), so what is
 * left out are the least promising pairs. Measured on a 10-goal account: 1.4 s CPU for all goals at 40, 22 s at the old 300.
 */
export const WANTED_CHECKS = 40;

/**
 * `onProgress({ done, total })` (optional) is called after every exact check, so a caller can show "checked 12 of 85".
 * The result's `truncated` is true when pairs were left unchecked (`candidates` > `checked`).
 */
export function wantedWarbonds(state, chainId, graph, ships, { slack = 1000, checks = WANTED_CHECKS, maxSteps = 25, plan = null, onProgress = null } = {}) {
  const chain = state.chains[chainId];
  const objective = chain.objective ?? 'cash';
  // Same copies and credit as proposeChain: the shared plan (accepted goals, higher-priority goals and
  // same-priority goals the order search placed before this one).
  const shared = (plan ?? planGoals(state, graph, { maxSteps })).get(chainId);
  const taken = shared.exclude;
  const credit = shared.credit;
  const isToken = startOf(chain).kind === 'token';
  // Every ship the goal can start from: the one ship of a fixed start, each free token type of a token goal.
  const starts = isToken ? goalStarts(state, chain, graph, shared.exclude) : [];
  const sources = isToken ? starts.map((x) => x.ship) : [startShip(chain, shared.route)].filter((x) => x != null);
  if (!sources.length) return { chainId, objective, best: null, bestCost: null, wanted: [], holding: [], checked: 0, candidates: 0 };
  const startOpt = isToken ? { starts } : { base: sources[0] };
  const opts = { ...startOpt, target: chain.target, credit, maxSteps, excludeCopies: new Set(taken), objective, via: chain.via ?? null };
  const metric = (r) => (objective === 'allin' ? r.allIn : r.cash);
  // Only the cheapest route is needed; planRoutes also searches alternatives
  // before returning k=1, multiplying the work for every hypothetical probe.
  const best = searchRoutes(graph, { ...opts, maxResults: 1 })[0] ?? null;
  const B = best ? metric(best) : Infinity;

  // Estimate: cheapest cost base -> X and X -> target, ignoring copy conflicts.
  const fwd = new Map();
  const rev = new Map();
  const warbondNow = new Map();
  const targets = new Set();
  for (const [from, edges] of graph.edges) {
    for (const e of edges) {
      const w = edgeCost(e, objective, taken);
      if (w == null) continue;
      if (!fwd.has(from)) fwd.set(from, []);
      fwd.get(from).push([e.to, w]);
      if (!rev.has(e.to)) rev.set(e.to, []);
      rev.get(e.to).push([from, w]);
      if (e.kind !== 'owned') targets.add(e.to);
      if (e.kind === 'warbond' && !e.virtual) warbondNow.set(`${e.from}-${e.to}`, e);
    }
  }
  // The chain's own target counts even when RSI sells no upgrade into it today
  // (e.g. a concept ship that is only offered during sales).
  targets.add(chain.target);
  // Cheapest cost from the nearest start ship.
  const dF = new Map();
  for (const src of sources) for (const [k, d] of dijkstra(fwd, src)) if (d < (dF.get(k) ?? Infinity)) dF.set(k, d);
  const dB = dijkstra(rev, chain.target);

  // Exact: best cost through `edge` excluding its own price, or null if no
  // route through it beats routes without it.
  // The probes are A* searches (see costBounds); a route only matters when it does not cost more than today's best.
  const bounds = costBounds(graph, { target: chain.target, objective, credit, taken });
  // Both kinds of probe are A* searches that put the probe edge at price 0.
  //   wanted pairs: only a strictly cheaper route matters (bound B - 1, whole cents). Then every cheapest route uses the probe.
  //   "on sale near this route" (`ties`): a route that merely ties today's best counts too, if some cheapest route goes through the
  //   Warbond: the bound is B and, among equally cheap labels, those that went through the probe are expanded first.
  const through = (from, to, ties = false) => {
    const probe = { from, to, kind: 'warbond', cash: 0, hypothetical: true };
    const r = searchRoutes(withEdge(graph, probe), { ...opts, maxResults: 1, heuristic: bounds(from, to), bound: ties ? B : B - 1, ...(ties ? { prefer: (e) => e.hypothetical === true } : {}) })[0];
    if (!r || !r.steps.some((s) => s.from === from && s.to === to && s.kind === 'warbond')) return null;
    return { cost: metric(r), route: r };
  };

  const msrp = (id) => ships.get(id)?.msrp ?? null;
  const onBest = new Set((best?.steps ?? []).map((s) => `${s.from}-${s.to}`));

  // Wanted: pairs without a Warbond today.
  const cands = [];
  for (const [a, da] of dF) {
    if (a === chain.target) continue;
    for (const [b, db] of dB) {
      if (b === a || sources.includes(b) || !targets.has(b)) continue;
      const std = msrp(b) - msrp(a);
      if (!(std > 0) || warbondNow.has(`${a}-${b}`)) continue;
      const est = B - da - db;
      if (est <= 0) continue;
      cands.push({ from: a, to: b, standard: std, estimate: est, needOff: std - Math.min(est, std) });
    }
  }
  const share = (x) => x.needOff / x.standard; // discount needed, as a share of the Standard price
  cands.sort((x, y) => share(x) - share(y) || y.standard - x.standard || x.from - y.from || x.to - y.to);
  const wanted = [];
  // Today's Warbonds near (not on) the route, the nearest first, capped like the wanted pairs.
  const holdingCands = [...warbondNow.values()]
    .filter((e) => !(onBest.has(`${e.from}-${e.to}`) && best?.steps.some((s) => s.kind === 'warbond' && s.from === e.from && s.to === e.to)))
    .map((e) => ({ e, est: dF.has(e.from) && dB.has(e.to) ? dF.get(e.from) + e.cash + dB.get(e.to) - B : null }))
    .filter((x) => x.est != null && !(x.est > slack))
    .sort((x, y) => x.est - y.est || x.e.from - y.e.from || x.e.to - y.e.to)
    .slice(0, checks)
    .map((x) => x.e);
  // probed in today's order, so equal results keep the order they always had
  const rank = new Map([...warbondNow.values()].map((e, i) => [e, i]));
  holdingCands.sort((x, y) => rank.get(x) - rank.get(y));
  // Many pairs tie with today's route ("any discount helps"); check those and
  // the pairs that need a discount separately so neither crowds out the other.
  const toCheck = [...cands.filter((c) => c.needOff === 0).slice(0, checks), ...cands.filter((c) => c.needOff > 0).slice(0, checks)];
  const total = toCheck.length + holdingCands.length;
  let done = 0;
  for (const c of toCheck) {
    onProgress?.({ done: done++, total });
    const t = through(c.from, c.to);
    if (!t) continue;
    const below = B - t.cost; // a Warbond priced under this saves money
    if (below <= 0) continue;
    // Above the Standard price is not a Warbond any more; a Standard offer at the
    // msrp difference would be used already, so the cap only matters for pairs
    // RSI does not sell as Standard today.
    wanted.push({ from: c.from, to: c.to, standard: c.standard, below: Math.min(below, c.standard), createsRoute: B === Infinity, needOff: Math.max(0, c.standard - below), onBestRoute: onBest.has(`${c.from}-${c.to}`) });
  }
  wanted.sort((x, y) => share(x) - share(y) || y.standard - x.standard || x.from - y.from || x.to - y.to);

  // Holding: today's Warbonds near (not on) the best route.
  const holding = [];
  for (const e of holdingCands) {
    onProgress?.({ done: done++, total });
    const t = through(e.from, e.to, true);
    if (!t) continue;
    const extra = t.cost + e.cash - B;
    if (extra <= slack) holding.push({ from: e.from, to: e.to, cash: e.cash, standard: msrp(e.to) - msrp(e.from), extra, limited: e.limited ?? null, title: e.title ?? null });
  }
  onProgress?.({ done: total, total });
  holding.sort((x, y) => x.extra - y.extra || (y.standard - y.cash) - (x.standard - x.cash));

  return { chainId, objective, best, bestCost: best ? B : null, wanted, holding, checked: toCheck.length, candidates: cands.length, truncated: cands.length > toCheck.length };
}
