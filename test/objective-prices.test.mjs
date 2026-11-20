import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, searchRoutes, cashNeeded } from '../src/logic/planner.mjs';
import { expectedOffers } from '../src/logic/prices.mjs';
import { newState, addChain, proposeChain, acceptRoute, setObjective, expectedChanges } from '../src/logic/chains.mjs';
import { classifyCopies } from '../src/logic/melt.mjs';

const MSRP = { 1: 5000, 2: 7500, 3: 10000, 4: 15000 };
const ships = new Map(Object.entries(MSRP).map(([id, msrp]) => [Number(id), { id: Number(id), msrp }]));
const standard = () => {
  const out = [];
  for (const f of [1, 2, 3, 4]) for (const t of [1, 2, 3, 4]) if (MSRP[t] > MSRP[f]) out.push({ from: f, to: t, kind: 'standard', cash: MSRP[t] - MSRP[f] });
  return out;
};
const copy = (copyId, from, to, paid) => ({ copyId, from, to, paid: { cents: paid }, meltable: true, extras: [] });

test('all-in prefers spending a little cash over consuming an expensive owned CCU', () => {
  // Owned 1->4 paid $90 vs. buying 1->4 for $100 standard... and a $40 Warbond path 1->2->4.
  const offers = [...standard(), { from: 1, to: 2, kind: 'warbond', cash: 1000 }, { from: 2, to: 4, kind: 'warbond', cash: 3000 }];
  const g = buildGraph({ offers, owned: [copy('exp', 1, 4, 9000)] });
  const cash = searchRoutes(g, { base: 1, target: 4 })[0];
  assert.equal(cash.cash, 0, 'cash objective uses the owned CCU');
  assert.equal(cash.allIn, 9000);
  const allin = searchRoutes(g, { base: 1, target: 4, objective: 'allin' })[0];
  assert.equal(allin.allIn, 4000, 'all-in buys the $40 of Warbonds and keeps the $90 CCU');
  assert.equal(allin.cash, 4000);
});

test('all-in uses the cheapest copy of a pair', () => {
  const g = buildGraph({ owned: [copy('a', 1, 2, 2500), copy('b', 1, 2, 1000)] });
  assert.equal(searchRoutes(g, { base: 1, target: 2, objective: 'allin' })[0].steps[0].copyId, 'b');
});

test('all-in matches brute force on random graphs', () => {
  let s = 7;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let round = 0; round < 200; round++) {
    const n = 4 + Math.floor(rand() * 4);
    const msrp = Array.from({ length: n }, (_, i) => (i + 1) * 2500);
    const offers = [];
    const owned = [];
    for (let f = 0; f < n; f++) for (let t = 0; t < n; t++) {
      if (f === t) continue;
      const d = msrp[t] - msrp[f];
      if (d > 0 && rand() < 0.6) offers.push({ from: f, to: t, kind: 'standard', cash: d });
      if (d > 0 && rand() < 0.2) offers.push({ from: f, to: t, kind: 'warbond', cash: Math.floor(d * rand()) });
      if (rand() < 0.1) owned.push(copy(`c${f}-${t}`, f, t, Math.floor(rand() * 4000)));
    }
    const g = buildGraph({ offers, owned });
    let best = Infinity;
    const walk = (ship, cost, seen, steps) => {
      if (ship === n - 1) { best = Math.min(best, cost); return; }
      if (steps >= 6) return;
      for (const e of g.edges.get(ship) ?? []) {
        if (seen.has(e.to)) continue;
        const c = e.kind === 'owned' ? Math.min(...e.copies.map((x) => x.paid.cents)) : e.cash;
        walk(e.to, cost + c, new Set(seen).add(e.to), steps + 1);
      }
    };
    walk(0, 0, new Set([0]), 0);
    const got = searchRoutes(g, { base: 0, target: n - 1, objective: 'allin', maxSteps: 6 })[0];
    if (best === Infinity) assert.equal(got, undefined);
    else assert.equal(got.allIn, best, `round ${round}`);
  }
});

test('expected offers: Standard prices follow the override, Warbonds stay', () => {
  const overrides = { ships: { 2: { msrp: 9500 } } }; // ship 2: $75 -> $95
  const offers = [...standard(), { from: 1, to: 2, kind: 'warbond', cash: 1000 }];
  const exp = expectedOffers(offers, ships, overrides);
  const find = (f, t, k = 'standard') => exp.find((o) => o.from === f && o.to === t && o.kind === k);
  assert.equal(find(1, 2).cash, 4500, 'into ship 2 gets more expensive');
  assert.equal(find(1, 2).nowCash, 2500);
  assert.equal(find(2, 3).cash, 500, 'out of ship 2 gets cheaper');
  assert.equal(find(1, 2, 'warbond').cash, 1000);
  assert.equal(find(1, 3).cash, 5000, 'pairs not touching ship 2 unchanged');
  assert.equal(expectedOffers(offers, ships, { ships: { 2: { msrp: 12000 } } }).some((o) => o.kind === 'standard' && o.from === 2 && o.to === 3), false, 'target no longer more expensive -> gone');
});

test('a zero-saving CCU into a ship with an expected increase is not a melt candidate', () => {
  const offers = standard();
  const owned = [copy('into2', 1, 2, 2500), copy('other', 1, 3, 5000)];
  const exp = expectedOffers(offers, ships, { ships: { 2: { msrp: 9500 } } });
  const res = Object.fromEntries(classifyCopies({ owned, offers }, newState(), { expected: exp, avail: { overrides: { ships: { 2: { availability: 'regular' }, 3: { availability: 'regular' } } }, today: '2026-11-18' } }).map((c) => [c.copy.copyId, c]));
  assert.equal(res.into2.candidate, false);
  assert.match(res.into2.keep, /expected price change \(\$20\)/);
  assert.equal(res.other.candidate, true);
});

test('watch: a Standard step that gets more expensive must be bought before the change', () => {
  const offers = standard();
  const g = buildGraph({ offers });
  const s = newState();
  const c = addChain(s, { base: 1, target: 2 });
  const route = proposeChain(s, c.id, g).routes[0];
  const ch = expectedChanges(route, expectedOffers(offers, ships, { ships: { 2: { msrp: 9500 } } }));
  assert.equal(ch.buyBefore.length, 1);
  assert.equal(ch.buyBefore[0].expected, 4500);
  assert.equal(ch.standardLaterExpected, 4500);
  assert.equal(expectedChanges(route, offers).buyBefore.length, 0);
});

test('chain objective is used by proposals and stored on accept', () => {
  const offers = [...standard(), { from: 1, to: 2, kind: 'warbond', cash: 1000 }, { from: 2, to: 4, kind: 'warbond', cash: 3000 }];
  const g = buildGraph({ offers, owned: [copy('exp', 1, 4, 9000)] });
  const s = newState();
  const c = addChain(s, { base: 1, target: 4 });
  assert.equal(proposeChain(s, c.id, g).routes[0].cash, 0);
  setObjective(s, c.id, 'allin');
  const r = proposeChain(s, c.id, g).routes[0];
  assert.equal(r.allIn, 4000);
  assert.equal(acceptRoute(s, c.id, r).objective, 'allin');
  assert.equal(cashNeeded(4000, 0, 0), 4000);
});
