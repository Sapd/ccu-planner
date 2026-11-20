import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain } from '../src/logic/chains.mjs';
import { createSession } from '../src/logic/session.mjs';
import {
  warbondTargets, warbondSources, recentWarbondEvents, hangarShipIds, upgradeIntoIds, ownershipOf, scopeOffers, parseHistory, warbondUsage, filterWarbondTargets,
} from '../src/logic/warbonds.mjs';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const ago = (h) => new Date(NOW - h * 3600e3).toISOString();
const ships = new Map([
  [1, { id: 1, name: 'Alpha', msrp: 5000, manufacturer: 'Aegis' }],
  [2, { id: 2, name: 'Bravo', msrp: 7500, manufacturer: 'Drake' }],
  [10, { id: 10, name: 'Tenner', msrp: 20000, manufacturer: 'Anvil', concept: true }],
  [11, { id: 11, name: 'Eleven', msrp: 25000, manufacturer: 'Origin' }],
]);
const o = (from, to, kind, cash, skuId, extra = {}) => ({ from, to, kind, cash, skuId, title: null, fetchedAt: ago(1), limited: null, firstSeen: null, ...extra });
const offers = [
  o(1, 10, 'standard', 15000, 's1'), o(2, 10, 'standard', 12500, 's2'),
  o(1, 10, 'warbond', 12000, 'w1', { limited: true }), o(2, 10, 'warbond', 9000, 'w2'),
  o(1, 11, 'warbond', 20000, 'w3'),
];

test('two Warbonds into one ship and a Standard make one target with the cheapest saving', () => {
  const [t] = warbondTargets(offers, ships, { now: NOW }).filter((x) => x.to === 10);
  assert.equal(t.sources, 2);
  assert.deepEqual(t.cheapest, { from: 2, cash: 9000, standard: 12500, saving: 3500 });
  assert.equal(t.limited, true);
  assert.equal(t.concept, true);
  assert.equal(t.msrp, 20000);
});

test('a target without a Standard offer has a null saving', () => {
  const t = warbondTargets(offers, ships, { now: NOW }).find((x) => x.to === 11);
  assert.deepEqual(t.cheapest, { from: 1, cash: 20000, standard: null, saving: null });
});

test('targets of your chains come first, then the biggest saving', () => {
  const state = newState();
  const c = addChain(state, { name: 'C', base: 1, target: 11 });
  const graph = buildGraph({ offers, owned: [] });
  const list = warbondTargets(offers, ships, { session: createSession({ plans: state, graph }), now: NOW });
  assert.deepEqual(list.map((x) => x.to), [11, 10]);
  assert.deepEqual(list[0].targetOf, [c.id]);
  assert.deepEqual(warbondTargets(offers, ships, { now: NOW }).map((x) => x.to), [10, 11], 'no chain: saving first');
});

test('usedBy lists chains whose best route uses a Warbond into the target', () => {
  const state = newState();
  const c = addChain(state, { name: 'C', base: 2, target: 10 });
  const graph = buildGraph({ offers, owned: [] });
  assert.deepEqual(warbondUsage(createSession({ plans: state, graph })).get('2-10'), [c.id]);
  const t = warbondTargets(offers, ships, { session: createSession({ plans: state, graph }), now: NOW }).find((x) => x.to === 10);
  assert.deepEqual(t.usedBy, [c.id]);
  assert.deepEqual(t.targetOf, [c.id]);
});

test('newSince follows the window: 2 h ago counts, 30 h ago does not at 24 h', () => {
  const ev = (at, skuId, toId = 10) => ({ at, event: 'appeared', fromId: 1, toId, skuId, cash: 1 });
  const find = (history, hours) => warbondTargets(offers, ships, { history, now: NOW, hours }).find((x) => x.to === 10).newSince;
  assert.equal(find([ev(ago(2), 'w1')], 24), ago(2));
  assert.equal(find([ev(ago(30), 'w1')], 24), null);
  assert.equal(find([ev(ago(30), 'w1')], 168), ago(30));
  assert.equal(find([ev(ago(2), 's1')], 24), null, 'a Standard appearing is not a Warbond');
  assert.equal(find([ev(ago(5), 'w1'), ev(ago(2), 'w2')], 24), ago(2), 'the latest wins');
});

test('warbondSources sorts by cash and says what you own of each source ship', () => {
  const src = warbondSources(offers, ships, 10, { hangar: new Set([1]), upgradeInto: new Set([2]), usage: new Map([['2-10', ['g1']]]) });
  assert.deepEqual(src.map((s) => [s.from, s.cash, s.standard, s.saving, s.ownership, s.usedBy, s.limited]), [
    [2, 9000, 12500, 3500, 'upgrade', ['g1'], false],
    [1, 12000, 15000, 3000, 'ship', [], true],
  ]);
  assert.equal(src[0].fromName, 'Bravo');
  assert.deepEqual(warbondSources(offers, ships, 99), []);
  assert.deepEqual(warbondSources(offers, ships, 10).map((s) => s.ownership), [null, null], 'nothing owned: no badge');
});

test('hangarShipIds counts ships in ship and package pledges only; an owned CCU does not make its target a ship in the hangar', () => {
  const data = {
    pledges: [{ category: 'ship', ships: [{ shipId: 1 }, { shipId: null }] }, { ships: [{ shipId: 3 }] }, { category: 'ccu', ships: [{ shipId: 9 }] }, { category: 'package', ships: [{ shipId: 4 }] }],
    owned: [{ from: 1, to: 2 }],
  };
  assert.deepEqual([...hangarShipIds(data)].sort(), [1, 3, 4]);
  assert.deepEqual([...upgradeIntoIds(data)], [2]);
  assert.equal(hangarShipIds({}).size, 0);
  assert.equal(upgradeIntoIds({}).size, 0);
});

test('ownershipOf: a ship in the hangar wins over an upgrade into it', () => {
  const own = { hangar: new Set([1]), upgradeInto: new Set([1, 2]) };
  assert.equal(ownershipOf(1, own), 'ship');
  assert.equal(ownershipOf(2, own), 'upgrade');
  assert.equal(ownershipOf(3, own), null);
  assert.equal(ownershipOf(3), null);
});

test('scopeOffers filters the Warbond sources, keeps every Standard offer, and counts and cheapest follow the scope', () => {
  const own = { hangar: new Set([1]), upgradeInto: new Set([2]) };
  assert.equal(scopeOffers(offers, 'all', own), offers);
  const inHangar = scopeOffers(offers, 'hangar', own);
  assert.equal(inHangar.filter((x) => x.kind === 'standard').length, 2, 'Standard offers stay for the comparison');
  assert.deepEqual(inHangar.filter((x) => x.kind === 'warbond').map((x) => x.skuId), ['w1', 'w3']);
  const t10 = warbondTargets(inHangar, ships, { now: NOW }).find((x) => x.to === 10);
  assert.equal(t10.sources, 1, 'the count only has the source ship in the hangar');
  assert.deepEqual(t10.cheapest, { from: 1, cash: 12000, standard: 15000, saving: 3000 }, 'cheaper offer from a ship you only have an upgrade into is not the cheapest');
  const viaUpgrade = scopeOffers(offers, 'upgrade', own);
  assert.deepEqual(warbondTargets(viaUpgrade, ships, { now: NOW }).map((x) => [x.to, x.sources, x.cheapest.from]), [[10, 1, 2]]);
  assert.deepEqual(scopeOffers(offers, 'hangar', {}).filter((x) => x.kind === 'warbond'), [], 'nothing owned: no source');
});

test('recentWarbondEvents: Warbond appearances and all disappearances in the window', () => {
  const h = [
    { at: ago(2), event: 'appeared', fromId: 1, toId: 10, skuId: 'w1', cash: 1 },
    { at: ago(2), event: 'appeared', fromId: 1, toId: 10, skuId: 's1', cash: 1 },
    { at: ago(30), event: 'appeared', fromId: 2, toId: 10, skuId: 'w2', cash: 1 },
    { at: ago(3), event: 'disappeared', fromId: 2, toId: 11, skuId: 'gone', cash: 1 },
  ];
  const r = recentWarbondEvents(h, offers, 24, NOW);
  assert.deepEqual(r.appeared.map((e) => e.skuId), ['w1']);
  assert.deepEqual(r.disappeared.map((e) => e.skuId), ['gone']);
  assert.deepEqual(recentWarbondEvents(h, offers, 168, NOW).appeared.map((e) => e.skuId), ['w1', 'w2']);
  assert.deepEqual(recentWarbondEvents([], offers, 24, NOW), { appeared: [], disappeared: [] });
  assert.deepEqual(recentWarbondEvents(undefined, offers, 24, NOW), { appeared: [], disappeared: [] });
});

test('parseHistory: empty, blank lines and a damaged line', () => {
  assert.deepEqual(parseHistory(''), []);
  assert.deepEqual(parseHistory(undefined), []);
  assert.deepEqual(parseHistory('{"a":1}\n\nnot json\n{"b":2}\n'), [{ a: 1 }, { b: 2 }]);
  // Lines that parse but are not objects are skipped too.
  assert.deepEqual(parseHistory('null\n5\n[1]\n"x"\ntrue\n{"c":3}\n'), [{ c: 3 }]);
});

test('filterWarbondTargets matches the target or a source ship by name or manufacturer', () => {
  const t = warbondTargets(offers, ships, { now: NOW });
  assert.deepEqual(filterWarbondTargets(t, ships, offers, '').length, 2);
  assert.deepEqual(filterWarbondTargets(t, ships, offers, 'anvil').map((x) => x.to), [10]);
  assert.deepEqual(filterWarbondTargets(t, ships, offers, 'drake').map((x) => x.to), [10], 'Drake only sources Tenner');
  assert.deepEqual(filterWarbondTargets(t, ships, offers, 'alpha').map((x) => x.to).sort(), [10, 11]);
  assert.deepEqual(filterWarbondTargets(t, ships, offers, 'zzz'), []);
  assert.deepEqual(filterWarbondTargets(t, ships, offers, 'anvil alpha').map((x) => x.to), [10], 'every word must match one ship');
  assert.deepEqual(filterWarbondTargets(t, ships, offers, 'alpha anvil zzz'), []);
});
