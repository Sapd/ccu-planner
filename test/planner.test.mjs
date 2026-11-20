import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, searchRoutes, planRoutes, cashNeeded } from '../src/logic/planner.mjs';

// Synthetic ladder (prices in cents): A 50, B 75, C 100, D 150, E 200
const V = { A: 1, B: 2, C: 3, D: 4, E: 5 };
const MSRP = { 1: 5000, 2: 7500, 3: 10000, 4: 15000, 5: 20000 };
const std = (f, t) => ({ from: V[f], to: V[t], kind: 'standard', cash: MSRP[V[t]] - MSRP[V[f]], skuId: V[f] * 100 + V[t] });
const wb = (f, t, cash) => ({ from: V[f], to: V[t], kind: 'warbond', cash, skuId: 9000 + V[f] * 100 + V[t] });
const own = (id, f, t) => ({ copyId: id, from: V[f], to: V[t] });
const allStandard = () => {
  const out = [];
  for (const f of Object.keys(V)) for (const t of Object.keys(V)) if (MSRP[V[t]] > MSRP[V[f]]) out.push(std(f, t));
  return out;
};
const best = (g, o) => searchRoutes(g, o)[0];

test('standard-only chains cost the msrp difference whatever the path', () => {
  const g = buildGraph({ offers: allStandard() });
  const r = best(g, { base: V.A, target: V.E });
  assert.equal(r.cash, 15000);
  assert.equal(r.steps.length, 1, 'direct upgrade wins the tie (fewest steps)');
});

test('a warbond edge saves its discount', () => {
  const g = buildGraph({ offers: [...allStandard(), wb('B', 'D', 2500)] });
  const r = best(g, { base: V.A, target: V.E });
  // A->B 25 std, B->D 25 wb, D->E 50 std = 100 instead of 150
  assert.equal(r.cash, 10000);
  assert.deepEqual(r.steps.map((s) => s.kind), ['standard', 'warbond', 'standard']);
});

test('owned copy costs nothing and beats a paid offer for the same pair', () => {
  const g = buildGraph({ offers: [...allStandard(), wb('B', 'C', 500)], owned: [own('p1', 'B', 'C')] });
  const r = best(g, { base: V.B, target: V.C });
  assert.equal(r.cash, 0);
  assert.equal(r.steps[0].kind, 'owned');
  assert.equal(r.steps[0].copyId, 'p1');
});

test('legacy owned CCU to a cheaper ship is still usable', () => {
  // Owned D -> C although C is cheaper now; route D -> C -> E is not better than D -> E,
  // but from D to C it is the only way.
  const g = buildGraph({ offers: allStandard(), owned: [own('legacy', 'D', 'C')] });
  const r = best(g, { base: V.D, target: V.C });
  assert.equal(r.cash, 0);
  assert.equal(r.steps[0].copyId, 'legacy');
});

test('store credit pays standard steps, warbond still needs cash', () => {
  const g = buildGraph({ offers: [...allStandard(), wb('B', 'D', 2500)] });
  const r = best(g, { base: V.A, target: V.E, credit: 5000 });
  assert.equal(r.warbondCash, 2500);
  assert.equal(r.standardCash, 7500);
  assert.equal(r.creditUsed, 5000);
  assert.equal(r.cash, 5000);
  assert.equal(cashNeeded(2500, 7500, 5000), 5000);
});

test('with enough credit, least cash may prefer standard over warbond', () => {
  // Warbond A->E for 100 cash vs standard A->E 150 fully covered by 150 credit.
  const g = buildGraph({ offers: [...allStandard(), wb('A', 'E', 10000)] });
  const r = best(g, { base: V.A, target: V.E, credit: 15000 });
  assert.equal(r.cash, 0);
  assert.equal(r.creditUsed, 15000);
});

test('at equal cash, owned copies win over spending credit', () => {
  const g = buildGraph({ offers: allStandard(), owned: [own('o1', 'A', 'B')] });
  const r = best(g, { base: V.A, target: V.B, credit: 10000 });
  assert.equal(r.cash, 0);
  assert.equal(r.creditUsed, 0);
  assert.equal(r.steps[0].kind, 'owned');
});

test('excluded (reserved) copies are not used', () => {
  const g = buildGraph({ offers: allStandard(), owned: [own('o1', 'A', 'B')] });
  const r = best(g, { base: V.A, target: V.B, excludeCopies: new Set(['o1']) });
  assert.equal(r.cash, 2500);
});

test('no route returns empty', () => {
  const g = buildGraph({ offers: [std('A', 'B')] });
  assert.deepEqual(searchRoutes(g, { base: V.A, target: V.E }), []);
});

test('maxSteps limits route length', () => {
  const g = buildGraph({ owned: [own('1', 'A', 'B'), own('2', 'B', 'C'), own('3', 'C', 'D')] });
  assert.equal(searchRoutes(g, { base: V.A, target: V.D, maxSteps: 2 }).length, 0);
  assert.equal(best(g, { base: V.A, target: V.D, maxSteps: 3 }).cash, 0);
});

test('planRoutes returns distinct alternatives, best first', () => {
  const g = buildGraph({ offers: [...allStandard(), wb('B', 'D', 2500), wb('A', 'C', 3000)], owned: [own('o', 'C', 'D')] });
  const routes = planRoutes(g, { base: V.A, target: V.E }, 3);
  assert.ok(routes.length >= 2);
  for (let i = 1; i < routes.length; i++) assert.ok(routes[i - 1].cash <= routes[i].cash);
  const sigs = new Set(routes.map((r) => r.steps.map((s) => s.copyId ?? s.skuId).join('|')));
  assert.equal(sigs.size, routes.length);
});

test('identical copies collapse: alternatives differ by route, not by copy', () => {
  const g = buildGraph({ offers: allStandard(), owned: [own('x1', 'A', 'B'), own('x2', 'A', 'B'), own('x3', 'A', 'B')] });
  const routes = planRoutes(g, { base: V.A, target: V.B }, 3);
  assert.equal(routes.filter((r) => r.steps[0].kind === 'owned').length, 1);
  assert.equal(routes[0].steps[0].otherCopies, 2);
});

test('copy choice keeps giftable copies free and uses the cheapest paid copy', () => {
  const g = buildGraph({
    owned: [
      { copyId: 'gift', from: 1, to: 2, giftable: true, paid: { cents: 500 } },
      { copyId: 'exp', from: 1, to: 2, giftable: false, paid: { cents: 1000 } },
      { copyId: 'cheap', from: 1, to: 2, giftable: false, paid: { cents: 500 } },
    ],
  });
  assert.equal(searchRoutes(g, { base: 1, target: 2 })[0].steps[0].copyId, 'cheap');
  assert.equal(searchRoutes(g, { base: 1, target: 2, excludeCopies: new Set(['cheap', 'exp']) })[0].steps[0].copyId, 'gift');
});

test('deterministic: same input, same output', () => {
  const offers = [...allStandard(), wb('B', 'D', 2500), wb('A', 'C', 3000)];
  const a = planRoutes(buildGraph({ offers, owned: [own('o', 'C', 'D')] }), { base: V.A, target: V.E, credit: 1000 });
  const b = planRoutes(buildGraph({ offers: [...offers].reverse(), owned: [own('o', 'C', 'D')] }), { base: V.A, target: V.E, credit: 1000 });
  assert.deepEqual(JSON.stringify(a), JSON.stringify(b));
});

// Random graphs vs brute force over all simple paths.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function bruteForce(graph, base, target, credit, maxSteps) {
  let bestCash = Infinity;
  const walk = (ship, wbc, stdc, visited, steps) => {
    if (ship === target) { bestCash = Math.min(bestCash, cashNeeded(wbc, stdc, credit)); return; }
    if (steps >= maxSteps) return;
    for (const e of graph.edges.get(ship) ?? []) {
      if (visited.has(e.to)) continue;
      walk(e.to, wbc + (e.kind === 'warbond' ? e.cash : 0), stdc + (e.kind === 'standard' ? e.cash : 0), new Set(visited).add(e.to), steps + 1);
    }
  };
  walk(base, 0, 0, new Set([base]), 0);
  return bestCash;
}

test('matches brute force on 300 random graphs', () => {
  const rand = rng(42);
  for (let round = 0; round < 300; round++) {
    const n = 4 + Math.floor(rand() * 5);
    const msrp = Array.from({ length: n }, (_, i) => (i + 1) * 2500 + Math.floor(rand() * 4) * 500);
    const offers = [];
    const owned = [];
    for (let f = 0; f < n; f++) {
      for (let t = 0; t < n; t++) {
        if (f === t) continue;
        const delta = msrp[t] - msrp[f];
        if (delta > 0 && rand() < 0.6) offers.push({ from: f, to: t, kind: 'standard', cash: delta, skuId: f * 100 + t });
        if (delta > 0 && rand() < 0.2) offers.push({ from: f, to: t, kind: 'warbond', cash: Math.floor(delta * rand()), skuId: 5000 + f * 100 + t });
        if (rand() < 0.08) owned.push({ copyId: `c${f}-${t}-${round}`, from: f, to: t });
      }
    }
    const graph = buildGraph({ offers, owned });
    const credit = rand() < 0.5 ? 0 : Math.floor(rand() * 10000);
    const base = 0;
    const target = n - 1;
    const expected = bruteForce(graph, base, target, credit, 6);
    const got = searchRoutes(graph, { base, target, credit, maxSteps: 6 })[0];
    if (expected === Infinity) assert.equal(got, undefined, `round ${round}: expected no route`);
    else assert.equal(got?.cash, expected, `round ${round}: cash mismatch`);
  }
});

// Multi-start search (goal tokens)
const tok = (ship, pledgeId, paidCents) => ({ ship, token: { copyId: `token:${pledgeId}`, pledgeId, paidCents } });
const pulse = tok(V.A, 'P1', 2500);
const rambler = tok(V.B, 'R1', 4500);

test('starts: equal cash prefers the cheaper token', () => {
  const g = buildGraph({ offers: [wb('A', 'E', 12500), std('B', 'E')] });
  const r = best(g, { target: V.E, starts: [rambler, pulse] });
  assert.equal(r.cash, 12500);
  assert.equal(r.start.ship, V.A);
  assert.equal(r.start.token.pledgeId, 'P1');
  assert.equal(r.start.token.copyId, 'token:P1');
});

test('starts: $5 less cash beats the cheaper token', () => {
  const g = buildGraph({ offers: [wb('A', 'E', 12500), wb('B', 'E', 12000)] });
  const r = best(g, { target: V.E, starts: [pulse, rambler] });
  assert.equal(r.cash, 12000);
  assert.equal(r.start.token.pledgeId, 'R1');
});

test('starts: base alone reports a null token start', () => {
  const g = buildGraph({ offers: allStandard() });
  const r = best(g, { base: V.A, target: V.E });
  assert.deepEqual(r.start, { ship: V.A, token: null });
});

test('starts: a start equal to the target gives no zero-step route', () => {
  const g = buildGraph({ offers: allStandard() });
  const routes = searchRoutes(g, { target: V.E, starts: [tok(V.E, 'X', 100)] });
  assert.deepEqual(routes, []);
  const r = best(g, { target: V.E, starts: [tok(V.E, 'X', 100), pulse] });
  assert.equal(r.start.ship, V.A);
  assert.ok(r.steps.length > 0);
});

test('starts: empty list gives no routes and ignores base', () => {
  const g = buildGraph({ offers: allStandard() });
  assert.deepEqual(searchRoutes(g, { base: V.A, target: V.E, starts: [] }), []);
});

test('starts: allin counts the token paid amount in the basis', () => {
  const g = buildGraph({ offers: allStandard() });
  const r = best(g, { target: V.E, starts: [pulse], objective: 'allin' });
  assert.equal(r.ownedBasis, 2500);
  assert.equal(r.allIn, 15000 + 2500);
});

test('starts: a start whose token copy is excluded is skipped', () => {
  const g = buildGraph({ offers: allStandard() });
  const r = best(g, { target: V.E, starts: [pulse, rambler], excludeCopies: new Set(['token:P1']) });
  assert.equal(r.start.token.pledgeId, 'R1');
});

test('planRoutes passes starts through and may offer another token as alternative', () => {
  const g = buildGraph({ offers: [wb('A', 'E', 12500), wb('B', 'E', 12000), ...allStandard()] });
  const routes = planRoutes(g, { target: V.E, starts: [pulse, rambler] }, 3);
  assert.equal(routes[0].start.token.pledgeId, 'R1');
  assert.ok(routes.some((r) => r.start.token?.pledgeId === 'P1'));
});

test('a token start without a known paid price counts as an unknown basis', async () => {
  const { buildGraph, searchRoutes } = await import('../src/logic/planner.mjs');
  const g = buildGraph({ offers: [{ from: 1, to: 2, kind: 'standard', cash: 1000 }] });
  const [r] = searchRoutes(g, { target: 2, credit: 0, starts: [{ ship: 1, token: { copyId: 'token:9', pledgeId: '9', paidCents: null } }] });
  assert.equal(r.unknownBasis, 1);
  const [known] = searchRoutes(g, { target: 2, credit: 0, starts: [{ ship: 1, token: { copyId: 'token:9', pledgeId: '9', paidCents: 500 } }] });
  assert.equal(known.unknownBasis, 0);
});

// Equal-cost tie: A->B owned + B->T Warbond (B is a concept ship) versus A->C Standard + C->T owned (C flight-ready).
const TIE = { A: 1, B: 2, C: 3, T: 4 };
const tieOffers = (warbondCash) => [
  { from: TIE.B, to: TIE.T, kind: 'warbond', cash: warbondCash, skuId: 1 },
  { from: TIE.A, to: TIE.C, kind: 'standard', cash: 1000, skuId: 2 },
];
const tieOwned = [{ copyId: 'ab', from: TIE.A, to: TIE.B }, { copyId: 'ct', from: TIE.C, to: TIE.T }];
const tieShips = (conceptIds) => new Map([TIE.A, TIE.B, TIE.C, TIE.T].map((id) => [id, { id, concept: conceptIds.includes(id) }]));

test('equal cash: a Warbond from a flight-ready ship beats one from a concept ship', () => {
  const g = buildGraph({ offers: tieOffers(1000), owned: tieOwned, ships: tieShips([TIE.B]) });
  const r = best(g, { base: TIE.A, target: TIE.T });
  assert.equal(r.cash, 1000);
  assert.deepEqual(r.steps.map((s) => s.to), [TIE.C, TIE.T], 'route A->C->T');
});

test('without concept marks the existing order decides the same tie', () => {
  const g = buildGraph({ offers: tieOffers(1000), owned: tieOwned, ships: tieShips([]) });
  const r = best(g, { base: TIE.A, target: TIE.T });
  assert.equal(r.cash, 1000);
  assert.deepEqual(r.steps.map((s) => s.to), [TIE.B, TIE.T], 'route A->B->T');
});

test('concept preference never makes a route cost more: a cheaper concept Warbond still wins', () => {
  const g = buildGraph({ offers: tieOffers(500), owned: tieOwned, ships: tieShips([TIE.B]) });
  const r = best(g, { base: TIE.A, target: TIE.T });
  assert.equal(r.cash, 500);
  assert.deepEqual(r.steps.map((s) => s.to), [TIE.B, TIE.T], 'route A->B->T');
});

test('buildGraph without ships has no concept preference', () => {
  const g = buildGraph({ offers: tieOffers(1000), owned: tieOwned });
  assert.equal(g.concept.size, 0);
  const r = best(g, { base: TIE.A, target: TIE.T });
  assert.deepEqual(r.steps.map((s) => s.to), [TIE.B, TIE.T], 'route A->B->T');
});

import { withEdge } from '../src/logic/planner.mjs';

test('buildGraph returns edges, lti and concept as plain fields', () => {
  const g = buildGraph({ offers: [{ from: 1, to: 2, kind: 'standard', cash: 100 }], lti: [{ pledgeId: 'p' }], ships: new Map([[2, { concept: true }]]) });
  assert.ok(g.edges instanceof Map);
  assert.deepEqual(g.lti, [{ pledgeId: 'p' }]);
  assert.deepEqual([...g.concept], [2]);
  assert.deepEqual(Object.keys(g).sort(), ['concept', 'edges', 'lti']);
  assert.deepEqual(Object.keys(buildGraph({})).sort(), ['concept', 'edges', 'lti']);
});

test('withEdge copies the graph, keeps lti and concept, replaces a same-kind pair and keeps lists sorted', () => {
  const g = buildGraph({ offers: [{ from: 1, to: 2, kind: 'standard', cash: 100 }, { from: 1, to: 4, kind: 'standard', cash: 300 }], lti: [1], ships: new Map([[4, { concept: true }]]) });
  const before = JSON.stringify([...g.edges]);
  const added = withEdge(g, { from: 1, to: 3, kind: 'warbond', cash: 50 });
  assert.deepEqual(added.edges.get(1).map((e) => e.to), [2, 3, 4]);
  assert.equal(added.lti, g.lti);
  assert.equal(added.concept, g.concept);
  const replaced = withEdge(g, { from: 1, to: 2, kind: 'standard', cash: 90 });
  assert.deepEqual(replaced.edges.get(1).map((e) => [e.to, e.cash]), [[2, 90], [4, 300]]);
  const fresh = withEdge(g, { from: 9, to: 1, kind: 'warbond', cash: 1 });
  assert.deepEqual(fresh.edges.get(9).map((e) => e.to), [1]);
  assert.equal(JSON.stringify([...g.edges]), before, 'the input graph is untouched');
});

test('A* search (costBounds heuristic + bound) finds the same cheapest cost as the plain search: cash and all-in, with and without credit', async () => {
  const { costBounds } = await import('../src/logic/wanted.mjs');
  let seed = 11;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  let runs = 0;
  for (const objective of ['cash', 'allin']) for (const credit of [0, 1500, 6000, 100000]) for (let round = 0; round < 60; round++) {
    const n = 6 + Math.floor(rand() * 5);
    const offers = [];
    const owned = [];
    for (let f = 0; f < n; f++) for (let t = 0; t < n; t++) {
      if (f === t) continue;
      if (rand() < 0.3) offers.push({ from: f, to: t, kind: rand() < 0.5 ? 'standard' : 'warbond', cash: Math.floor(rand() * 5000) });
      if (rand() < 0.1) owned.push({ copyId: `c${f}-${t}-${round}`, from: f, to: t, paid: rand() < 0.2 ? undefined : { cents: Math.floor(rand() * 4000) } });
    }
    const graph = buildGraph({ offers, owned });
    const o = { base: 0, target: n - 1, maxResults: 1, maxSteps: 25, credit, objective };
    const metric = (r) => (r ? (objective === 'allin' ? r.allIn : r.cash) : null);
    const heuristic = costBounds(graph, { target: n - 1, objective, credit, taken: new Set() })(0, 0);
    const plain = searchRoutes(graph, o)[0];
    const star = searchRoutes(graph, { ...o, heuristic })[0];
    assert.equal(metric(star), metric(plain), `${objective} credit ${credit} round ${round}`);
    // a bound at the best cost keeps a route that ties it; one below drops everything
    const atBound = searchRoutes(graph, { ...o, heuristic, bound: plain ? metric(plain) : Infinity })[0];
    assert.equal(metric(atBound), metric(plain), 'a tie with the bound is kept');
    if (plain) assert.equal(searchRoutes(graph, { ...o, heuristic, bound: metric(plain) - 1 })[0], undefined, 'nothing beats the best cost');
    runs++;
  }
  assert.equal(runs, 480);
});

test('prefer finds a tied route through the probe edge although a shorter route reaches the same ship at the same cost', () => {
  // 1 -> 3 Warbond 500 and 1 -> 2 Warbond 500, 3 -> 4 Standard 1000, probe 2 -> 3 free: both routes cost 1500; the one through 2 -> 3 has more steps.
  const offers = [
    { from: 1, to: 3, kind: 'warbond', cash: 500 }, { from: 1, to: 2, kind: 'warbond', cash: 500 },
    { from: 3, to: 4, kind: 'standard', cash: 1000 }, { from: 2, to: 3, kind: 'warbond', cash: 0, hypothetical: true },
  ];
  const graph = buildGraph({ offers });
  const heuristic = new Map([[4, 0], [3, 1000], [2, 1000], [1, 1500]]);
  const o = { base: 1, target: 4, maxResults: 1, maxSteps: 25, heuristic, bound: 1500 };
  const plain = searchRoutes(graph, o)[0];
  assert.equal(plain.cash, 1500);
  assert.equal(plain.steps.length, 2, 'without prefer the shorter route wins the tie');
  const via = searchRoutes(graph, { ...o, prefer: (e) => e.hypothetical === true })[0];
  assert.equal(via.cash, 1500);
  assert.deepEqual(via.steps.map((s) => [s.from, s.to]), [[1, 2], [2, 3], [3, 4]]);
  assert.throws(() => searchRoutes(graph, { base: 1, target: 4, prefer: () => true }), /prefer needs a heuristic/);
});

test('prefer survives the per-ship label cap: of more than 16 equal-cost labels on one ship, the one through the probe edge is kept', () => {
  // 1 -> 100+i Warbond i*100, then 100+i -> 200 Standard (21-i)*100: twenty routes of the same cost 2100 that never dominate each other
  // (more Warbond cash against less Standard cash). Only the last one ends with the probe edge; a plain cap would drop it.
  const offers = [];
  const heuristic = new Map([[200, 0], [1, 2100]]);
  for (let i = 1; i <= 20; i++) {
    offers.push({ from: 1, to: 100 + i, kind: 'warbond', cash: i * 100 });
    offers.push({ from: 100 + i, to: 200, kind: 'standard', cash: (21 - i) * 100, ...(i === 20 ? { hypothetical: true } : {}) });
    heuristic.set(100 + i, (21 - i) * 100);
  }
  const graph = buildGraph({ offers });
  const o = { base: 1, target: 200, maxResults: 40, maxSteps: 25, heuristic, bound: 2100, maxLabelsPerShip: 16 };
  const routes = searchRoutes(graph, { ...o, prefer: (e) => e.hypothetical === true });
  assert.ok(routes.length > 0 && routes.length <= 16, `${routes.length} routes reach the target through the cap`);
  assert.ok(routes.every((r) => r.cash === 2100));
  const through = routes.filter((r) => r.steps.some((s) => s.hypothetical === true));
  assert.equal(through.length, 1, 'exactly one route uses the probe edge');
  assert.deepEqual(through[0].steps.map((s) => [s.from, s.to]), [[1, 120], [120, 200]]);
});
