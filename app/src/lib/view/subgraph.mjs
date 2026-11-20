// Bounded network view. All prices and the $100 radius are in cents.
import { startShip, reservations, goalStarts } from '../../../../src/logic/chains.mjs';
import { sessionOf } from '../../../../src/logic/session.mjs';
import { dijkstra, edgeCost } from '../../../../src/logic/wanted.mjs';

const rank = { owned: 0, warbond: 1, standard: 2 };
const same = (a, b) => a.from === b.from && a.to === b.to && a.kind === b.kind
  && a.copyId === b.copyId && a.skuId === b.skuId;

// Cached in the app's planning session, per goal.
export function chainContext(app, chainId = null) {
  const session = sessionOf(app);
  return session.memo('chain-context', String(chainId), () => prepareChain(app, session, chainId));
}

/**
 * copyId -> holder for a goal's view: what the shared plan keeps from this goal (accepted goals and the
 * goals planned before it), not only accepted reservations. Holders that are not accepted show as 'another goal'.
 */
export function takenFor(session, chainId) {
  const held = reservations(session.plans, chainId);
  if (!session.plans.chains[chainId]) return held;
  const out = new Map();
  for (const id of session.shared.get(chainId).exclude) out.set(id, held.get(id) ?? 'another goal');
  return out;
}

function prepareChain(app, session, chainId) {
  const { graph, plans, data: { ships } } = app;
  const chain = plans.chains[chainId];
  const taken = takenFor(session, chainId);
  const best = chain ? session.route(chainId) : null;
  const steps = best?.steps ?? [];
  const start = chain ? startShip(chain, best) : null;
  // Every ship the goal can start from: all free token types of a token goal, even when it has no route.
  const starts = chain ? [...new Set([start, ...goalStarts(plans, chain, graph, taken).map((x) => x.ship)].filter((x) => x != null))] : [];
  const routeShips = new Set(steps.flatMap((e) => [e.from, e.to]));
  if (chain) { for (const s of starts) routeShips.add(s); routeShips.add(chain.target); }

  let nearby = new Set(ships.keys());
  if (chain) {
    const fwd = new Map(); const rev = new Map();
    for (const edges of graph.edges.values()) for (const e of edges) {
      const cost = edgeCost(e, chain.objective ?? 'cash', taken);
      if (cost == null) continue;
      if (!fwd.has(e.from)) fwd.set(e.from, []);
      if (!rev.has(e.to)) rev.set(e.to, []);
      fwd.get(e.from).push([e.to, cost]);
      rev.get(e.to).push([e.from, cost]);
    }
    const forward = new Map();
    for (const s of starts) for (const [id, cost] of dijkstra(fwd, s)) if (cost < (forward.get(id) ?? Infinity)) forward.set(id, cost);
    const backward = dijkstra(rev, chain.target);
    const budget = (best ? (chain.objective === 'allin' ? best.allIn : best.cash) : Infinity) + 10000;
    nearby = new Set([...forward].filter(([id, cost]) => cost <= budget && backward.has(id)).map(([id]) => id));
  }
  const candidates = [];
  for (const edges of graph.edges.values()) for (const edge of edges) {
    const copies = edge.kind === 'owned' ? edge.copies : [null];
    for (const copy of copies) {
      const e = { from: edge.from, to: edge.to, kind: edge.kind, cash: edge.cash,
        ...(edge.skuId != null ? { skuId: edge.skuId } : {}),
        ...(copy ? { copyId: copy.copyId, paid: copy.paid?.cents, reservedBy: taken.get(copy.copyId) } : {}),
        hypothetical: false };
      e.onRoute = steps.some((s) => same(s, e));
      candidates.push(e);
    }
  }
  return { chain, start, starts, routeShips, nearby, candidates };
}

// Filtering never runs route search or Dijkstra. Wanted is lazy and shared with WouldHelp.
export function subgraph(app, {
  chainId = null, kinds = new Set(['owned', 'standard', 'warbond']),
  minMsrp = -Infinity, maxMsrp = Infinity, onlyChainEdges = false,
  showWanted = false, maxEdges = 600,
} = {}, context = chainContext(app, chainId), wantedResult = null) {
  const { chain, starts, routeShips, nearby } = context;
  const { ships } = app.data;
  const visible = new Set([...nearby].filter((id) => {
    const msrp = ships.get(id)?.msrp;
    return msrp != null && msrp >= minMsrp && msrp <= maxMsrp;
  }));
  for (const id of routeShips) visible.add(id);

  const candidates = context.candidates.filter((e) => e.onRoute
    || (!onlyChainEdges && kinds.has(e.kind) && visible.has(e.from) && visible.has(e.to)));
  if (chain && showWanted && !onlyChainEdges && kinds.has('warbond')) {
    const { wanted } = wantedResult ?? sessionOf(app).wanted(chainId);
    for (const w of wanted.filter((w) => visible.has(w.from) && visible.has(w.to)).slice(0, 10)) {
      candidates.push({ from: w.from, to: w.to, kind: 'warbond', cash: w.below, hypothetical: true, onRoute: false });
    }
  }
  candidates.sort((a, b) => Number(b.onRoute) - Number(a.onRoute) || rank[a.kind] - rank[b.kind]
    || a.cash - b.cash || a.from - b.from || a.to - b.to
    || String(a.copyId ?? a.skuId ?? '').localeCompare(String(b.copyId ?? b.skuId ?? '')));
  const protectedCount = candidates.filter((e) => e.onRoute || e.hypothetical).length;
  let remaining = Math.max(0, maxEdges - protectedCount);
  const edges = candidates.filter((e) => e.onRoute || e.hypothetical || remaining-- > 0);
  const nodes = [...visible].filter((id) => !onlyChainEdges || routeShips.has(id)).map((id) => {
    const s = ships.get(id);
    return { id, name: s?.name ?? String(id), msrp: s?.msrp ?? 0, concept: !!s?.concept,
      role: chain && starts.includes(id) ? 'base' : id === chain?.target ? 'target' : routeShips.has(id) ? 'route' : 'other' };
  });
  return { nodes, edges, hidden: candidates.length - edges.length };
}

/** Stable y offset independent of filtering and resize. */
export function shipY(id) {
  let hash = 2166136261;
  for (const c of String(id)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967295;
}

/** Equal spacing per distinct visible price; equal prices share an x coordinate. */
export function priceRanks(nodes) {
  const prices = [...new Set(nodes.map((n) => n.msrp))].sort((a, b) => a - b);
  return new Map(prices.map((price, i) => [price, i / Math.max(1, prices.length - 1)]));
}
