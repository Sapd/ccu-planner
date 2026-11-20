import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, planRoutes, searchRoutes } from '../src/logic/planner.mjs';
import { newState, addChain, acceptRoute, proposeChain, setObjective, planGoals } from '../src/logic/chains.mjs';
import { wantedWarbonds } from '../src/logic/wanted.mjs';

const shipsOf = (msrp) => new Map(msrp.map((m, i) => [i, { id: i, msrp: m }]));
const copy = (copyId, from, to, paid) => ({ copyId, from, to, paid: { cents: paid }, meltable: true, extras: [] });
const costWith = (graph, state, chainId, edge) => {
  const g = { ...graph, edges: new Map(graph.edges) };
  g.edges.set(edge.from, [...(graph.edges.get(edge.from) ?? []), edge]);
  // The copies and credit left for this goal come from the shared plan of the real graph: a
  // hypothetical Warbond must not change what the other goals hold.
  const shared = planGoals(state, graph).get(chainId);
  const c = state.chains[chainId];
  const [r] = searchRoutes(g, { base: c.start.ship, target: c.target, credit: shared.credit, excludeCopies: shared.exclude, maxResults: 1, objective: c.objective ?? 'cash' });
  return (c.objective === 'allin' ? r.allIn : r.cash);
};

test('a Standard bridge on the best route: any Warbond on that pair helps', () => {
  const msrp = [5000, 7500, 10000];
  const offers = [
    { from: 0, to: 1, kind: 'standard', cash: 2500 }, { from: 1, to: 2, kind: 'standard', cash: 2500 },
    { from: 0, to: 2, kind: 'standard', cash: 5000 },
  ];
  const s = newState();
  const c = addChain(s, { base: 0, target: 2 });
  const w = wantedWarbonds(s, c.id, buildGraph({ offers }), shipsOf(msrp));
  const direct = w.wanted.find((x) => x.from === 0 && x.to === 2);
  assert.equal(direct.below, 5000);
  assert.equal(direct.needOff, 0);
  assert.equal(w.wanted.find((x) => x.from === 1 && x.to === 2).below, 2500);
});

test('thresholds are exact on random graphs (cash and all-in, with reservations)', () => {
  let seed = 11;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  let checked = 0;
  for (let round = 0; round < 60; round++) {
    const n = 5 + Math.floor(rand() * 4);
    const msrp = Array.from({ length: n }, (_, i) => (i + 1) * 2500);
    const offers = [];
    const owned = [];
    for (let f = 0; f < n; f++) for (let t = f + 1; t < n; t++) {
      if (rand() < 0.5) offers.push({ from: f, to: t, kind: 'standard', cash: msrp[t] - msrp[f] });
      if (rand() < 0.15) offers.push({ from: f, to: t, kind: 'warbond', cash: Math.floor((msrp[t] - msrp[f]) * (0.5 + rand() / 2)) });
      if (rand() < 0.12) owned.push(copy(`c${f}-${t}`, f, t, Math.floor(rand() * 3000)));
    }
    const graph = buildGraph({ offers, owned });
    const s = newState();
    const other = addChain(s, { base: 0, target: n - 2 });
    const r0 = proposeChain(s, other.id, graph, { k: 1 }).routes[0];
    // Accepted or only proposed: either way `c` is planned behind it in the shared plan.
    if (r0 && rand() < 0.5) acceptRoute(s, other.id, r0);
    const c = addChain(s, { base: 0, target: n - 1 });
    if (round % 2) setObjective(s, c.id, 'allin');
    const w = wantedWarbonds(s, c.id, graph, shipsOf(msrp), { top: 50, checks: 500 });
    if (!w.best) continue;
    for (const x of w.wanted) {
      checked++;
      const edge = { from: x.from, to: x.to, kind: 'warbond', cash: x.below - 1 };
      assert.ok(costWith(graph, s, c.id, edge) < w.bestCost, `round ${round}: ${x.from}->${x.to} below ${x.below} should save`);
      if (x.below < x.standard) assert.equal(costWith(graph, s, c.id, { ...edge, cash: x.below }), w.bestCost, `round ${round}: at ${x.below} no saving`);
    }
  }
  assert.ok(checked > 50, `only ${checked} thresholds checked`);
});

test('holding: a Warbond on sale near the best route, with its extra cost', () => {
  const msrp = [5000, 7500, 10000, 12500];
  const std = [];
  for (let f = 0; f < 4; f++) for (let t = f + 1; t < 4; t++) std.push({ from: f, to: t, kind: 'standard', cash: msrp[t] - msrp[f] });
  const offers = [...std, { from: 1, to: 2, kind: 'warbond', cash: 1500 }, { from: 0, to: 2, kind: 'warbond', cash: 4000 }];
  const graph = buildGraph({ offers, owned: [copy('own', 0, 1, 2000)] });
  const s = newState();
  const c = addChain(s, { base: 0, target: 3 });
  // best: owned 0->1, WB 1->2 $15, std 2->3 $25 = $40
  const w = wantedWarbonds(s, c.id, graph, shipsOf(msrp), { slack: 3000 });
  assert.equal(w.bestCost, 4000);
  assert.deepEqual(w.holding.map((h) => [h.from, h.to, h.extra]), [[0, 2, 2500]]);
  assert.equal(wantedWarbonds(s, c.id, graph, shipsOf(msrp), { slack: 2000 }).holding.length, 0);
});

test('no route today: the upgrade into the target is wanted, up to the msrp difference', () => {
  const s = newState();
  const c = addChain(s, { base: 0, target: 1 });
  const w = wantedWarbonds(s, c.id, buildGraph({}), shipsOf([5000, 7500]));
  assert.equal(w.best, null);
  assert.deepEqual(w.wanted.map((x) => [x.from, x.to, x.below, x.createsRoute]), [[0, 1, 2500, true]]);
  assert.equal(planRoutes(buildGraph({}), { base: 0, target: 1 }, 1).length, 0);
});

test('a token goal runs wanted from the planned route start; no token gives the empty shape', () => {
  const msrp = [5000, 7500, 10000];
  const offers = [
    { from: 0, to: 1, kind: 'standard', cash: 2500 }, { from: 1, to: 2, kind: 'standard', cash: 2500 },
    { from: 0, to: 2, kind: 'standard', cash: 5000 },
  ];
  const tok = { pledgeId: '1', ship: 0, name: 'S0', paidCents: 3000, msrpCents: 5000 };
  const s = newState();
  const c = addChain(s, { start: { kind: 'token' }, target: 2 });
  const w = wantedWarbonds(s, c.id, buildGraph({ offers, lti: [tok] }), shipsOf(msrp));
  assert.equal(w.best.start.ship, 0);
  assert.ok(w.wanted.some((x) => x.from === 0 && x.to === 2));
  const none = wantedWarbonds(s, c.id, buildGraph({ offers, lti: [] }), shipsOf(msrp));
  assert.equal(none.best, null);
  assert.equal(none.bestCost, null);
  assert.deepEqual(none.wanted, []);
  assert.deepEqual(none.holding, []);
});

test('a token goal with free tokens but no route today still gets wanted entries (multi-source estimate)', () => {
  const msrp = [5000, 7500, 10000];
  const tok = { pledgeId: '1', ship: 0, name: 'S0', paidCents: 3000, msrpCents: 5000 };
  const s = newState();
  const c = addChain(s, { start: { kind: 'token' }, target: 1 });
  const g = buildGraph({ lti: [tok] });
  const w = wantedWarbonds(s, c.id, g, shipsOf(msrp));
  assert.equal(w.best, null);
  assert.deepEqual(w.wanted.map((x) => [x.from, x.to, x.below, x.createsRoute]), [[0, 1, 2500, true]]);
  // The fixed-start goal gives the same entry.
  const f = addChain(s, { base: 0, target: 1 });
  assert.deepEqual(wantedWarbonds(s, f.id, buildGraph({}), shipsOf(msrp)).wanted.map((x) => [x.from, x.to, x.below, x.createsRoute]), [[0, 1, 2500, true]]);
  // Two token types: the estimate starts from both.
  const tok2 = { pledgeId: '2', ship: 2, name: 'S2', paidCents: 3000, msrpCents: 10000 };
  const s2 = newState();
  const c2 = addChain(s2, { start: { kind: 'token' }, target: 1 });
  const w2 = wantedWarbonds(s2, c2.id, buildGraph({ lti: [tok, tok2] }), shipsOf(msrp));
  assert.ok(w2.wanted.some((x) => x.from === 0 && x.to === 1));
});

test('wanted probes keep exact thresholds when a Standard edge to the same target already exists and routes tie', () => {
  // Every ship has a Standard offer to every higher one, so each probed pair already has an edge of another kind
  // from the same source, and several routes cost the same (Standard costs are path independent).
  const ships = shipsOf([100, 200, 300, 400, 500, 600]);
  const offers = [];
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) offers.push({ from: a, to: b, kind: 'standard', cash: ships.get(b).msrp - ships.get(a).msrp });
  offers.push({ from: 1, to: 4, kind: 'warbond', cash: 150, skuId: 5 });
  const graph = buildGraph({ offers, owned: [] });
  const s = newState();
  const c = addChain(s, { base: 0, target: 5 });
  const result = wantedWarbonds(s, c.id, graph, ships);
  assert.ok(result.wanted.length > 3);
  let checked = 0;
  for (const w of result.wanted) {
    if (w.below >= w.standard) continue; // capped at the Standard price: no exact threshold to check
    assert.ok(costWith(graph, s, c.id, { from: w.from, to: w.to, kind: 'warbond', cash: w.below - 1 }) < result.bestCost, `${w.from}->${w.to} just below the threshold helps`);
    assert.ok(costWith(graph, s, c.id, { from: w.from, to: w.to, kind: 'warbond', cash: w.below }) >= result.bestCost, `${w.from}->${w.to} at the threshold does not`);
    checked++;
  }
  assert.ok(checked > 0, 'some thresholds are exact');
});

test('progress is reported after every exact check, ending at the total; the cap leaves the least promising pairs out', () => {
  const n = 8;
  const msrp = Array.from({ length: n }, (_, i) => (i + 1) * 2500);
  const offers = [];
  for (let f = 0; f < n; f++) for (let t = f + 1; t < n; t++) offers.push({ from: f, to: t, kind: 'standard', cash: msrp[t] - msrp[f] });
  const s = newState();
  const c = addChain(s, { base: 0, target: n - 1 });
  const graph = buildGraph({ offers });
  const full = wantedWarbonds(s, c.id, graph, shipsOf(msrp));
  assert.equal(full.truncated, false);
  assert.equal(full.checked, full.candidates);

  const seen = [];
  const capped = wantedWarbonds(s, c.id, graph, shipsOf(msrp), { checks: 2, onProgress: (p) => seen.push(p) });
  assert.equal(capped.truncated, true);
  assert.ok(capped.checked <= 4 && capped.checked < capped.candidates);
  assert.ok(seen.length >= 2);
  assert.ok(seen.every((p, i) => p.total === seen[0].total && (i === 0 || p.done >= seen[i - 1].done)));
  assert.deepEqual(seen.at(-1), { done: seen[0].total, total: seen[0].total });
  // the pairs that were checked give the same thresholds as in the full run
  for (const x of capped.wanted) assert.deepEqual(x, full.wanted.find((y) => y.from === x.from && y.to === x.to));
});

test('"on sale near this route" lists a free Warbond when some cheapest route goes through it, even if a shorter route ties', () => {
  // Best: Standard 0 -> 2 for $50. Warbond 0 -> 1 for $5 leads to Standard 1 -> 2 at $50: with the edge free a route through it ties the
  // best (and has more steps than the direct one), so the Warbond counts, at its own price extra.
  const msrp = [5000, 7500, 10000];
  const offers = [
    { from: 0, to: 2, kind: 'standard', cash: 5000 }, { from: 1, to: 2, kind: 'standard', cash: 5000 }, { from: 0, to: 1, kind: 'warbond', cash: 500 },
  ];
  const s = newState();
  const c = addChain(s, { base: 0, target: 2 });
  const w = wantedWarbonds(s, c.id, buildGraph({ offers }), shipsOf(msrp), { slack: 1000 });
  assert.deepEqual(w.holding.map((h) => [h.from, h.to, h.extra]), [[0, 1, 500]]);
});
