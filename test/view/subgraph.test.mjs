import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../../src/logic/planner.mjs';
import { newState, addChain, proposeChain, setObjective, acceptRoute } from '../../src/logic/chains.mjs';
import { subgraph, chainContext, takenFor, priceRanks } from '../../app/src/lib/view/subgraph.mjs';

import { wantedWarbonds } from '../../src/logic/wanted.mjs';
import { sessionOf } from '../../src/logic/session.mjs';

const wantedMemo = (app, id, slack) => sessionOf(app).wanted(id, slack);

function fixture() {
  const ships = new Map(Array.from({ length: 50 }, (_, i) => [i + 1, { id: i + 1, name: `Ship ${i + 1}`, msrp: (i + 1) * 100, concept: false }]));
  const offers = [];
  for (let gap = 1; gap < 50 && offers.length < 1000; gap++) {
    for (let from = 1; from + gap <= 50 && offers.length < 1000; from++) {
      offers.push({ from, to: from + gap, kind: 'standard', cash: gap * 100, skuId: offers.length + 1 });
    }
  }
  const owned = [{ from: 1, to: 2, copyId: 'copy1', paid: { cents: 50 } }];
  const plans = newState();
  addChain(plans, { base: 1, target: 50 });
  return { data: { ships, offers, owned }, graph: buildGraph({ offers, owned }), plans };
}

test('50 ships and 1,000 offers: caps edges at 600, counts hidden, preserves best route', () => {
  const app = fixture();
  const full = subgraph(app, { chainId: 'c1', maxEdges: Infinity });
  assert.equal(full.nodes.length, 50);
  assert.equal(full.edges.length, 1001);
  const view = subgraph(app, { chainId: 'c1' });
  assert.equal(view.edges.length, 600);
  assert.equal(view.hidden, full.edges.length - view.edges.length);
  for (const step of proposeChain(app.plans, 'c1', app.graph, { k: 1 }).routes[0].steps) {
    assert.ok(view.edges.some((e) => e.from === step.from && e.to === step.to && e.kind === step.kind && e.copyId === step.copyId && e.onRoute));
  }
});

test('owned kind filter returns no offers; route edges survive filters', () => {
  const app = fixture();
  const view = subgraph(app, { kinds: new Set(['owned']) });
  assert.ok(view.edges.length);
  assert.ok(view.edges.every((e) => e.kind === 'owned'));
  const route = subgraph(app, { chainId: 'c1', kinds: new Set(), minMsrp: 999999, onlyChainEdges: true });
  assert.ok(route.edges.length);
  assert.ok(route.edges.every((e) => e.onRoute));
});

test('showWanted adds the top ten hypothetical pairs for the selected chain', () => {
  const app = fixture();
  assert.equal(subgraph(app, { chainId: 'c1' }).edges.some((e) => e.hypothetical), false);
  const view = subgraph(app, { chainId: 'c1', showWanted: true, maxEdges: Infinity });
  assert.equal(view.edges.filter((e) => e.hypothetical).length, 10);
  assert.ok(view.edges.filter((e) => e.hypothetical).every((e) => e.kind === 'warbond' && !e.onRoute));
});

test('remaining edges rank owned, Warbond, then Standard by cash', () => {
  const app = fixture();
  app.graph.edges.get(2).push({ from: 2, to: 3, kind: 'warbond', cash: 90, skuId: 2000 });
  app.graph.edges.get(3).push({ from: 3, to: 4, kind: 'warbond', cash: 50, skuId: 2001 });
  const { edges, hidden } = subgraph(app, { maxEdges: 4 });
  assert.deepEqual(edges.map((e) => [e.kind, e.cash]), [['owned', 0], ['warbond', 50], ['warbond', 90], ['standard', 100]]);
  assert.equal(hidden, 999);
});

test('chain radius is best cost plus $100, and excludes dead ends', () => {
  const app = fixture();
  app.data.ships.set(51, { id: 51, name: 'Boundary', msrp: 5100 });
  app.data.ships.set(52, { id: 52, name: 'Too far', msrp: 5200 });
  app.data.ships.set(53, { id: 53, name: 'Dead end', msrp: 5300 });
  const best = proposeChain(app.plans, 'c1', app.graph, { k: 1 }).routes[0];
  const limit = best.cash + 10000;
  app.graph.edges.get(1).push(...[51, 52, 53].map((to) => ({ from: 1, to, kind: 'standard', cash: limit + (to === 52 ? 1 : 0) })));
  for (const from of [51, 52]) app.graph.edges.set(from, [{ from, to: 50, kind: 'standard', cash: 10000 }]);
  const { nodes } = subgraph(app, { chainId: 'c1' });
  assert.ok(nodes.some((n) => n.id === 51));
  assert.ok(!nodes.some((n) => n.id === 52 || n.id === 53));
});

test('copies retain reservations separately; another chain cannot supply the route copy', () => {
  const app = fixture();
  app.graph.edges.get(1).find((e) => e.kind === 'owned').copies.push({ copyId: 'copy2', paid: { cents: 75 } });
  addChain(app.plans, { base: 1, target: 2 });
  app.plans.chains.c2.accepted = { steps: [{ from: 1, to: 2, kind: 'owned', copyId: 'copy1' }] };
  const owned = subgraph(app, { chainId: 'c1' }).edges.filter((e) => e.kind === 'owned');
  assert.equal(owned.find((e) => e.copyId === 'copy1').reservedBy, 'c2');
  assert.equal(owned.find((e) => e.copyId === 'copy1').onRoute, false);
  assert.equal(owned.find((e) => e.copyId === 'copy2').onRoute, true);
});

test('hypothetical and route edges survive even a zero ordinary-edge budget', () => {
  const app = fixture();
  const full = subgraph(app, { chainId: 'c1', showWanted: true, maxEdges: Infinity });
  for (const maxEdges of [0, 1, 3]) {
    const view = subgraph(app, { chainId: 'c1', showWanted: true, maxEdges });
    assert.deepEqual(view.edges, full.edges.filter((e) => e.onRoute || e.hypothetical));
    assert.equal(view.edges.filter((e) => e.hypothetical).length, 10);
    assert.equal(view.hidden, full.edges.length - view.edges.length);
  }
});

test('wanted takes ten pairs after MSRP visibility, with kinds and route-only respected', () => {
  const app = fixture();
  const opts = { chainId: 'c1', showWanted: true, minMsrp: 2000, maxMsrp: 4000, maxEdges: 1 };
  const view = subgraph(app, opts);
  const visible = new Set(view.nodes.map((n) => n.id));
  const wanted = wantedMemo(app, 'c1').wanted;
  const expected = wanted.filter((w) => visible.has(w.from) && visible.has(w.to)).slice(0, 10);
  assert.equal(expected.length, 10);
  assert.ok(expected.some((w) => !wanted.slice(0, 10).includes(w)));
  assert.deepEqual(view.edges.filter((e) => e.hypothetical).map((e) => `${e.from}-${e.to}`).sort(),
    expected.map((w) => `${w.from}-${w.to}`).sort());
  for (const filters of [{ onlyChainEdges: true }, { kinds: new Set(['owned']) }]) {
    assert.ok(!subgraph(app, { ...opts, ...filters }).edges.some((e) => e.hypothetical));
  }
});

test('chain context and shared wanted cache survive filters and live in the planning session: new revisions, graphs and goals start over', () => {
  const app = fixture();
  app.overrides = { rev: 0 };
  const context = chainContext(app, 'c1');
  const wanted = wantedMemo(app, 'c1'); // As if WouldHelp already computed it.
  for (const opts of [{ minMsrp: 2000 }, { kinds: new Set(['warbond']) }, { onlyChainEdges: true }]) {
    subgraph(app, { chainId: 'c1', showWanted: true, ...opts });
    assert.equal(chainContext(app, 'c1'), context);
    assert.equal(wantedMemo(app, 'c1'), wanted);
  }
  assert.notEqual(wantedMemo(app, 'c1', 2000), wanted);
  assert.equal(wantedMemo(app, 'c1'), wanted, 'another slack does not evict it');
  assert.equal(sessionOf(app), sessionOf(app));
  addChain(app.plans, { base: 2, target: 50 });
  app.plans.rev = 1; // a changed document comes with a new rev
  assert.notEqual(chainContext(app, 'c2'), context);
  assert.notEqual(wantedMemo(app, 'c2'), wanted);
  for (const change of [() => app.plans.rev++, () => app.overrides.rev++, () => app.graph = { ...app.graph }]) {
    const prev = chainContext(app, 'c1');
    const prevWanted = wantedMemo(app, 'c1');
    const session = sessionOf(app);
    change();
    assert.notEqual(sessionOf(app), session);
    assert.notEqual(chainContext(app, 'c1'), prev);
    assert.notEqual(wantedMemo(app, 'c1'), prevWanted);
  }
});

test('ranked x positions spread ordinary prices despite outliers, preserve ties and use shown prices', () => {
  const nodes = [100, 200, 300, 10000000, 200].map((msrp) => ({ msrp }));
  assert.deepEqual([...priceRanks(nodes)], [[100, 0], [200, 1 / 3], [300, 2 / 3], [10000000, 1]]);
  assert.deepEqual([...priceRanks(nodes.slice(1, 3))], [[200, 0], [300, 1]]);
  assert.equal(priceRanks([{ msrp: 100 }]).get(100), 0);
  assert.equal(priceRanks([]).size, 0);
});

test('allin radius uses proposeChain allIn total, including owned basis, rather than cash', () => {
  const app = fixture();
  setObjective(app.plans, 'c1', 'allin');
  const best = proposeChain(app.plans, 'c1', app.graph, { k: 1 }).routes[0];
  assert.equal(best.allIn, best.cash + 50);
  const boundary = best.allIn + 10000;
  for (const [id, cash] of [[51, boundary], [52, boundary + 1]]) {
    app.data.ships.set(id, { id, name: `Boundary ${id}`, msrp: id * 100 });
    app.graph.edges.get(1).push({ from: 1, to: id, kind: 'standard', cash });
    app.graph.edges.set(id, [{ from: id, to: 50, kind: 'standard', cash: 10000 }]);
  }
  const view = subgraph(app, { chainId: 'c1' });
  assert.ok(view.nodes.some((n) => n.id === 51));
  assert.ok(!view.nodes.some((n) => n.id === 52));
});

test('wanted single-route searches keep exact thresholds and holding costs for both objectives', () => {
  for (const objective of ['cash', 'allin']) {
    const app = fixture();
    setObjective(app.plans, 'c1', objective);
    const result = wantedWarbonds(app.plans, 'c1', app.graph, app.data.ships);
    const metric = (r) => objective === 'allin' ? r.allIn : r.cash;
    assert.equal(result.bestCost, metric(proposeChain(app.plans, 'c1', app.graph, { k: 1 }).routes[0]));
    assert.ok(result.wanted.length > 10);
    for (const w of result.wanted.slice(0, 20)) {
      const g = { ...app.graph, edges: new Map(app.graph.edges) };
      g.edges.set(w.from, [...g.edges.get(w.from), { from: w.from, to: w.to, kind: 'warbond', cash: w.below - 1 }]);
      assert.ok(metric(proposeChain(app.plans, 'c1', g, { k: 1 }).routes[0]) < result.bestCost);
    }
  }
});

test('the start ship of a start-only goal has the base role', () => {
  const app = fixture();
  const c = app.plans.chains.c1;
  const ship = c.start.ship;
  assert.equal('base' in c, false);
  assert.equal(subgraph(app, { chainId: 'c1' }).nodes.find((n) => n.id === ship).role, 'base');
});

test('a token goal without a route: starts are every free token type and nothing is reserved by itself', () => {
  const app = fixture();
  app.plans = newState();
  addChain(app.plans, { start: { kind: 'token' }, target: 50 });
  const lti = [{ pledgeId: '1', ship: 3, name: 'Ship 3', paidCents: 100, msrpCents: 300 }, { pledgeId: '2', ship: 7, name: 'Ship 7', paidCents: 100, msrpCents: 700 }];
  app.data = { ...app.data, offers: [], owned: [], lti };
  app.graph = buildGraph({ offers: [], owned: [], lti });
  const ctx = chainContext(app, 'c1');
  assert.deepEqual([...ctx.starts].sort((a, b) => a - b), [3, 7]);
  const nodes = subgraph(app, { chainId: 'c1' }).nodes;
  assert.deepEqual(nodes.filter((n) => n.role === 'base').map((n) => n.id).sort((a, b) => a - b), [3, 7]);
});

test('takenFor: accepted holders keep their id, the goals planned before show as another goal', () => {
  const app = fixture();
  app.plans = newState();
  const a = addChain(app.plans, { base: 1, target: 2, priority: 'high' });
  addChain(app.plans, { base: 1, target: 2 });
  const route = sessionOf(app).route(a.id);
  assert.ok(route.steps.some((s) => s.copyId === 'copy1'));
  assert.equal(takenFor(sessionOf(app), 'c2').get('copy1'), 'another goal');
  acceptRoute(app.plans, a.id, route);
  app.plans.rev = 1;
  assert.equal(takenFor(sessionOf(app), 'c2').get('copy1'), 'c1');
  assert.equal(takenFor(sessionOf(app), 'c1').has('copy1'), false);
});
