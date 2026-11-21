import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain } from '../src/logic/chains.mjs';
import { createSession } from '../src/logic/session.mjs';
import { buildSnapshot, addSnapshot, changesSinceSync, SNAPSHOT_MAX } from '../src/logic/changes.mjs';
import { recordSnapshot, loadSnapshots, readRaw } from '../src/data.mjs';
import { buildPlannerData } from '../src/logic/mapping.mjs';
import { changesHeadline, goalChangeLine, changesGoalLines, signedUsd, shortWhen } from '../src/logic/describe.mjs';

const NAMES = { 1: 'Alpha', 2: 'Prospector', 3: 'Carrack', 4: 'Orion' };
const std = (from, to, cash) => ({ from, to, kind: 'standard', cash });
const wb = (from, to, cash) => ({ from, to, kind: 'warbond', cash, skuId: 7 });
const copy = (copyId, from, to) => ({ copyId, from, to, paid: { cents: 100 } });
const name = (id) => NAMES[id];

/** A session for one state of the world: msrp by ship, offers, owned copies, the sync stamps, goals. */
function world({ msrp = { 1: 5000, 2: 10000, 3: 15000, 4: 25000 }, offers, owned = [], store = 'S1', hangar = 'H1', offersAt, credit = 0, rev = 0, goals, saleHistory = null }) {
  const ships = new Map(Object.entries(msrp).map(([id, m]) => [Number(id), { id: Number(id), name: NAMES[id], msrp: m, concept: false }]));
  const plans = newState();
  plans.profile.credit = credit;
  plans.rev = rev;
  for (const g of goals) addChain(plans, g);
  if (offersAt) offers = offers.map((o) => ({ ...o, fetchedAt: offersAt }));
  return createSession({ plans, graph: buildGraph({ offers, owned, ships }), data: { ships, offers, owned, saleHistory, meta: { catalogAt: store, hangarAt: hangar } } });
}
const snap = (session, at) => buildSnapshot(session, at);
const only = (c) => { assert.equal(c.goals.length, 1); return c.goals[0]; };

test('a snapshot holds the shared plan in planning order, every msrp and every hangar copy', () => {
  const s = world({ offers: [std(1, 2, 5000), std(2, 3, 5000)], owned: [copy('x', 1, 2)], goals: [{ base: 1, target: 3 }, { base: 1, target: 2, priority: 'high' }] });
  const sn = snap(s, '2026-11-18T20:34:00.000Z');
  assert.deepEqual(Object.keys(sn.goals), ['c2', 'c1'], 'planning order');
  assert.deepEqual(sn.goals.c2.route, [[1, 2, 'owned', 0, 'x']], 'the high goal takes the owned CCU');
  assert.deepEqual(sn.goals.c1.route, [[1, 2, 'standard', 5000, null], [2, 3, 'standard', 5000, null]]);
  assert.deepEqual([sn.goals.c2.cash, sn.goals.c1.cash, sn.total], [0, 10000, 10000]);
  assert.equal(sn.goals.c1.name, 'Carrack');
  assert.deepEqual(sn.msrp, { 1: 5000, 2: 10000, 3: 15000, 4: 25000 });
  assert.deepEqual(sn.copies, ['x']);
  assert.deepEqual([sn.at, sn.storeAt, sn.hangarAt], ['2026-11-18T20:34:00.000Z', 'S1', 'H1']);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(sn))), JSON.stringify(sn), 'plain JSON');
});

test('no earlier snapshot, or only one of the same data: null', () => {
  const s = world({ offers: [std(1, 2, 5000)], goals: [{ base: 1, target: 2 }] });
  assert.equal(changesSinceSync(s, []), null);
  assert.equal(changesSinceSync(s, null), null);
  assert.equal(changesSinceSync(s, [snap(s)]), null, 'same store and hangar stamps');
});

test('a price change: total delta, the goal delta and the ship whose msrp changed', () => {
  const before = world({ msrp: { 1: 5000, 2: 15500, 3: 20000 }, offers: [std(1, 2, 10500)], goals: [{ base: 1, target: 2 }] });
  const after = world({ msrp: { 1: 5000, 2: 17500, 3: 20000 }, offers: [std(1, 2, 12500)], store: 'S2', goals: [{ base: 1, target: 2 }] });
  const c = changesSinceSync(after, [snap(before, 'T0')]);
  assert.equal(c.totalDelta, 2000);
  assert.equal(c.was, 10500);
  assert.equal(c.since, 'S1', 'when the older data was fetched');
  const g = only(c);
  assert.deepEqual([g.name, g.was, g.now, g.delta], ['Prospector', 10500, 12500, 2000]);
  assert.deepEqual(g.causes, [{ kind: 'msrp', shipId: 2, was: 15500, now: 17500 }]);
  assert.equal(goalChangeLine(g, { name }), 'Prospector +$20: Prospector went from $155 to $175');
});

test('a Standard step that is no longer offered', () => {
  const before = world({ offers: [std(1, 2, 5000), std(2, 3, 5000), std(1, 3, 15000)], goals: [{ base: 1, target: 3 }] });
  const after = world({ offers: [std(1, 2, 5000), std(1, 3, 15000)], store: 'S2', goals: [{ base: 1, target: 3 }] });
  const g = only(changesSinceSync(after, [snap(before)]));
  assert.equal(g.delta, 5000);
  assert.deepEqual(g.causes, [{ kind: 'step-gone', step: 'standard', from: 2, to: 3 }]);
  assert.equal(goalChangeLine(g, { name }), 'Carrack +$50: Prospector → Carrack is no longer sold');
});

test('a Warbond that ended, and a new Warbond on the new route', () => {
  const base = [std(1, 2, 5000), std(2, 3, 5000)];
  const withWb = world({ offers: [...base, wb(1, 2, 1000)], goals: [{ base: 1, target: 3 }] });
  const without = world({ offers: base, store: 'S2', goals: [{ base: 1, target: 3 }] });
  const ended = only(changesSinceSync(without, [snap(withWb)]));
  assert.deepEqual(ended.causes, [{ kind: 'step-gone', step: 'warbond', from: 1, to: 2 }]);
  assert.equal(goalChangeLine(ended, { name }), 'Carrack +$40: Warbond Alpha → Prospector is no longer offered');
  const appeared = world({ offers: [...base, wb(1, 2, 1000)], store: 'S3', goals: [{ base: 1, target: 3 }] });
  const fresh = only(changesSinceSync(appeared, [snap(without)]));
  assert.equal(fresh.delta, -4000);
  assert.deepEqual(fresh.causes, [{ kind: 'new-warbond', from: 1, to: 2, cash: 1000 }]);
  assert.equal(goalChangeLine(fresh, { name }), 'Carrack -$40: now uses Warbond Alpha → Prospector for $10');
});

test('a newly available Standard step explains its goal and the store credit freed for another goal', () => {
  const setup = {
    offers: [std(1, 3, 10000), std(1, 4, 20000)], owned: [copy('x', 2, 3)], credit: 8000,
    goals: [{ base: 1, target: 3, priority: 'high' }, { base: 1, target: 4 }],
  };
  const before = world({ ...setup, store: '2026-11-20T12:00:00' });
  const compare = (saleHistory) => changesSinceSync(world({
    ...setup, store: '2026-11-21T12:00:00', offers: [...setup.offers, std(1, 2, 5000)], saleHistory,
  }), [snap(before)]);
  const target = { onSaleDays: ['2026-11-21'] };
  const [direct, shared] = compare({ ships: { 2: target, 3: { onSaleDays: ['2026-11-20'] } } }).goals;
  assert.deepEqual(direct.causes, [{ kind: 'in-store', shipId: 2 }]);
  assert.equal(goalChangeLine(direct, { name }), 'Carrack -$20: Prospector is in the store again, so a route through it is possible today');
  assert.deepEqual(shared.causes, [{ kind: 'shared' }]);
  assert.equal(goalChangeLine(shared, { name }), 'Orion -$30: follows from changes to other goals. The shared plan reassigned your CCUs or store credit');
  assert.deepEqual(compare({ ships: { 2: target } }).goals.map((g) => g.causes), [[{ kind: 'none' }], [{ kind: 'none' }]], 'no earlier sync was recorded');
  const alreadyThere = compare({ ships: { 2: { onSaleDays: ['2026-11-20', '2026-11-21'] } } });
  assert.deepEqual(alreadyThere.goals[0].causes, [{ kind: 'none' }]);
});

test('a ship back in the store the same day: the snapshot records which ships were in the store', () => {
  const offers = [std(1, 3, 10000)];
  const goals = [{ base: 1, target: 3 }];
  const flag = (session, inStore) => { for (const [id, s] of session.data.ships) s.standard = inStore.includes(id); return session; };
  const before = flag(world({ offers, goals, store: '2026-11-21T10:00:00' }), [1, 3]);
  const after = flag(world({ offers: [...offers, std(1, 2, 5000)], owned: [copy('x', 2, 3)], goals, store: '2026-11-21T17:00:00' }), [1, 2, 3]);
  const sn = snap(before);
  assert.deepEqual(sn.inStore, [1, 3]);
  assert.deepEqual(only(changesSinceSync(after, [sn])).causes.filter((c) => c.kind === 'in-store'), [{ kind: 'in-store', shipId: 2 }]);
  const was = flag(world({ offers, goals, store: '2026-11-21T10:00:00' }), [1, 2, 3]);
  assert.deepEqual(only(changesSinceSync(after, [snap(was)])).causes.filter((c) => c.kind === 'in-store'), [], 'already in the store before');
});

test('a hangar change: a new CCU appears, an old one is used up', () => {
  const offers = [std(1, 2, 5000), std(2, 3, 5000)];
  const none = world({ offers, goals: [{ base: 1, target: 3 }] });
  const bought = world({ offers, owned: [copy('n', 2, 3)], hangar: 'H2', goals: [{ base: 1, target: 3 }] });
  const up = only(changesSinceSync(bought, [snap(none)]));
  assert.equal(up.delta, -5000);
  assert.deepEqual(up.causes, [{ kind: 'copy-new', from: 2, to: 3 }]);
  assert.equal(goalChangeLine(up, { name }), 'Carrack -$50: now uses your new Prospector → Carrack CCU');
  const gone = only(changesSinceSync(none, [snap(bought)]));
  assert.equal(gone.delta, 5000);
  assert.deepEqual(gone.causes, [{ kind: 'copy-gone', from: 2, to: 3 }]);
  assert.equal(goalChangeLine(gone, { name }), 'Carrack +$50: your Prospector → Carrack CCU is no longer in your hangar');
});

test('only the allocation changed: another goal took a shared CCU; the other goal says the planning order changed', () => {
  const offers = [std(1, 2, 5000), std(2, 3, 5000), std(3, 4, 5000), std(1, 4, 15000), std(1, 3, 10000)];
  const owned = [copy('x', 2, 3)];
  const goals = [{ base: 1, target: 3 }, { base: 1, target: 4 }];
  const before = world({ offers, owned, goals });
  const after = world({ offers, owned, hangar: 'H2', goals: [goals[0], { ...goals[1], priority: 'high' }] });
  const c = changesSinceSync(after, [snap(before)]);
  assert.equal(c.totalDelta, 0, 'the total is the same, the split is not');
  const [a, b] = c.goals;
  assert.equal(a.name, 'Orion', 'planning order of the new plan');
  assert.deepEqual(b.causes, [{ kind: 'taken', from: 2, to: 3, by: 'Orion' }]);
  assert.equal(goalChangeLine(b, { name }), 'Carrack +$50: Orion took your Prospector → Carrack CCU');
  assert.deepEqual(a.causes, [{ kind: 'order' }]);
  assert.equal(goalChangeLine(a, { name }), 'Orion -$50: Planning order changed');
  assert.equal(changesHeadline(c), `Total unchanged since ${shortWhen('S1') ?? 'the last sync'}`);
});

test('no cause found when nothing in the list explains the change', () => {
  const offers = [std(1, 2, 5000)];
  const before = world({ offers, goals: [{ base: 1, target: 2 }] });
  const after = world({ offers, credit: 2000, store: 'S2', goals: [{ base: 1, target: 2 }] }); // more store credit, a plan edit
  const g = only(changesSinceSync(after, [snap(before)]));
  assert.deepEqual(g.causes, [{ kind: 'none' }]);
  assert.equal(goalChangeLine(g, { name }), 'Prospector -$20: No cause found');
});

test('a Warbond that costs something else now is a step-repriced cause; the msrp cause needs a Standard step whose price changed', () => {
  const before = world({ offers: [wb(1, 2, 3000)], goals: [{ base: 1, target: 2 }] });
  const after = world({ offers: [wb(1, 2, 4000)], store: 'S2', goals: [{ base: 1, target: 2 }] });
  const g = only(changesSinceSync(after, [snap(before)]));
  assert.deepEqual(g.causes, [{ kind: 'step-repriced', step: 'warbond', from: 1, to: 2, was: 3000, now: 4000 }]);
  assert.equal(goalChangeLine(g, { name }), 'Prospector +$10: Warbond Alpha → Prospector went from $30 to $40');
  // A ship whose msrp moved but whose Standard step on the route costs the same is no cause.
  const b2 = world({ msrp: { 1: 5000, 2: 10000, 3: 15000 }, offers: [std(1, 2, 5000), std(2, 3, 5000), wb(1, 3, 9000)], goals: [{ base: 1, target: 3 }] });
  const a2 = world({ msrp: { 1: 5000, 2: 11000, 3: 15000 }, offers: [std(1, 2, 5000), std(2, 3, 5000), wb(1, 3, 9500)], store: 'S2', goals: [{ base: 1, target: 3 }] });
  const g2 = only(changesSinceSync(a2, [snap(b2)]));
  assert.deepEqual(g2.causes.map((c) => c.kind), ['step-repriced'], 'Prospector msrp moved but is not on the Warbond route');
});

test('an upgrades sync (only the offers change) is told apart by the offers stamp', () => {
  const offers = [std(1, 2, 5000), std(2, 3, 5000), wb(1, 2, 1000)];
  const before = world({ offers, offersAt: 'U1', goals: [{ base: 1, target: 3 }] });
  const after = world({ offers: offers.filter((o) => o.kind !== 'warbond'), offersAt: 'U2', goals: [{ base: 1, target: 3 }] });
  assert.equal(snap(before).offersAt, 'U1');
  const c = changesSinceSync(after, [snap(before)]);
  assert.ok(c, 'same store and hangar stamps, other offers stamp');
  assert.equal(c.since, 'U1');
  assert.deepEqual(only(c).causes, [{ kind: 'step-gone', step: 'warbond', from: 1, to: 2 }]);
  assert.equal(changesSinceSync(before, [snap(before)]), null);
});

test('adding or removing a goal never moves the total; added and removed goals are listed with their cash', () => {
  const offers = [std(1, 2, 5000), std(2, 3, 5000)];
  const one = world({ offers, goals: [{ base: 1, target: 2 }] });
  const two = world({ offers, store: 'S2', goals: [{ base: 1, target: 2 }, { base: 1, target: 3 }] });
  const up = changesSinceSync(two, [snap(one)]);
  assert.equal(up.totalDelta, 0);
  assert.deepEqual(up.goals, []);
  assert.deepEqual(up.added, [{ goalId: 'c2', name: 'Carrack', cash: 10000 }]);
  assert.deepEqual(changesGoalLines(up), ['Goal added: Carrack, $100 today']);
  const down = changesSinceSync(world({ offers, store: 'S3', goals: [{ base: 1, target: 2 }] }), [snap(two)]);
  assert.equal(down.totalDelta, 0);
  assert.deepEqual(changesGoalLines(down), ['Goal removed: Carrack, was $100']);
  // a price change on the common goal still shows, next to an added goal
  const dearer = world({ offers: [std(1, 2, 6000), std(2, 3, 5000)], store: 'S4', goals: [{ base: 1, target: 2 }, { base: 1, target: 3 }] });
  assert.equal(changesSinceSync(dearer, [snap(one)]).totalDelta, 1000);
});

test('compares with the latest snapshot of different data, skips the same data, and reports added and removed goals', () => {
  const offers = [std(1, 2, 5000)];
  const s0 = world({ offers, goals: [{ base: 1, target: 2 }], store: 'S0' });
  const s1 = world({ offers: [std(1, 2, 6000)], goals: [{ base: 1, target: 2 }, { base: 1, target: 3 }], store: 'S1' });
  const now = world({ offers: [std(1, 2, 6000)], goals: [{ base: 1, target: 2 }, { base: 1, target: 3 }], store: 'S1', hangar: 'H1' });
  const c = changesSinceSync(now, [snap(s0), snap(s1)]);
  assert.equal(c.since, 'S0', 'the S1 snapshot is the current data and is skipped');
  assert.deepEqual(c.added.map((g) => g.name), ['Carrack']);
  assert.deepEqual(changesGoalLines(c), ['Goal added: Carrack, no route today']);
  assert.deepEqual(c.removed, []);
});

test('wording helpers', () => {
  assert.equal(signedUsd(9000), '+$90');
  assert.equal(signedUsd(-3000), '-$30');
  assert.equal(signedUsd(0), '$0');
  assert.match(shortWhen('2026-11-18T20:34:00'), /^18 Nov 20:34$/);
  assert.equal(shortWhen(null), null);
  assert.match(changesHeadline({ totalDelta: 21500, since: '2026-11-18T20:34:00' }), /^Total \+\$215 since 18 Nov 20:34$/);
  assert.equal(goalChangeLine({ name: 'Orion', delta: null, now: null, causes: [{ kind: 'none' }] }, { name }), 'Orion has no route now: No cause found');
});

test('addSnapshot replaces a snapshot of the same data (the latest wins) and keeps the newest 30', () => {
  const mk = (n) => ({ at: `t${n}`, storeAt: `S${n}`, hangarAt: 'H', offersAt: null, total: n });
  const one = addSnapshot([], mk(1));
  assert.equal(one.length, 1);
  const again = addSnapshot(one, { ...mk(1), at: 'later', total: 99 });
  assert.deepEqual(again.map((x) => [x.at, x.total]), [['later', 99]], 'same stamps: replaced, not added');
  assert.equal(addSnapshot(one, { ...mk(1), hangarAt: 'H2' }).length, 2, 'a different hangar stamp is another snapshot');
  assert.equal(addSnapshot(one, { ...mk(1), offersAt: 'U2' }).length, 2, 'a different offers stamp is another snapshot');
  let list = [];
  for (let n = 1; n <= SNAPSHOT_MAX + 5; n++) list = addSnapshot(list, mk(n));
  assert.equal(list.length, SNAPSHOT_MAX);
  assert.equal(list[0].storeAt, 'S6');
  assert.equal(list.at(-1).storeAt, `S${SNAPSHOT_MAX + 5}`);
});

test('recordSnapshot (sync: before and after) writes plan-snapshots.json: replaces on plan edits, skips when nothing changed, at most 30', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-snap-'));
  const offers = [std(1, 2, 5000)];
  const sess = (store, rev = 0, offersAt) => world({ offers, store, rev, offersAt, goals: [{ base: 1, target: 2 }] });
  assert.deepEqual(loadSnapshots(dir), []);
  assert.equal(recordSnapshot(sess('S1'), dir, 'before'), true);
  assert.equal(recordSnapshot(sess('S1'), dir, 'again'), false, 'same data and same plan documents: nothing to record (a details or buyback sync)');
  assert.equal(recordSnapshot(sess('S1', 3), dir, 'edited'), true, 'plan edited since: the baseline is replaced');
  assert.deepEqual(loadSnapshots(dir).map((s) => [s.at, s.storeAt, s.revs]), [['edited', 'S1', '3|0|0']]);
  assert.equal(recordSnapshot(sess('S1', 3, 'U1'), dir, 'upgrades'), true, 'an upgrades sync changes the offers stamp');
  assert.equal(recordSnapshot(sess('S2', 3, 'U1'), dir, 'after'), true);
  assert.deepEqual(loadSnapshots(dir).map((s) => s.at), ['edited', 'upgrades', 'after']);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'plan-snapshots.json'), 'utf8'))), ['version', 'snapshots']);
  assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.tmp')));
  for (let n = 0; n < 40; n++) recordSnapshot(sess(`N${n}`), dir, `t${n}`);
  const capped = loadSnapshots(dir);
  assert.equal(capped.length, SNAPSHOT_MAX);
  assert.equal(capped.at(-1).storeAt, 'N39');
});

test('a damaged plan-snapshots.json is no history, not an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccu-snap-bad-'));
  fs.writeFileSync(path.join(dir, 'plan-snapshots.json'), '{ not json');
  const warn = console.warn;
  const seen = [];
  console.warn = (m) => seen.push(m);
  try {
    assert.deepEqual(loadSnapshots(dir), []);
    fs.writeFileSync(path.join(dir, 'catalog.json'), '{"ships":[]}');
    assert.equal(readRaw(dir).planSnapshots, null, 'the app load keeps working');
  } finally { console.warn = warn; }
  assert.match(seen[0], /ignoring unreadable plan-snapshots\.json/);
});

test('the snapshots reach the app data: mapping passes them through, [] without the file', () => {
  const raw = { catalog: { fetchedAt: 'C', ships: [] }, details: null, upgrades: [], hangar: null, buyback: null, history: '' };
  assert.deepEqual(buildPlannerData(raw, { items: {} }).planSnapshots, []);
  const snapshots = [{ at: 'a', storeAt: 'S', hangarAt: 'H' }];
  assert.deepEqual(buildPlannerData({ ...raw, planSnapshots: { version: 1, snapshots } }, { items: {} }).planSnapshots, snapshots);
  assert.deepEqual(buildPlannerData({ ...raw, planSnapshots: { bad: true } }, { items: {} }).planSnapshots, []);
});

test('a goal with many causes is still one line: taken CCUs grouped by goal, more than two of a kind counted', () => {
  const name = (id) => ({ 1: 'Alpha', 2: 'Beta', 3: 'Gamma', 4: 'Delta' })[id];
  const taken = (by, from, to) => ({ kind: 'taken', from, to, by });
  const g = { name: 'Liberator', delta: -6500, causes: [
    ...Array.from({ length: 12 }, () => taken('Constellation Mk V Centaurus', 1, 2)),
    taken('Endeavor', 2, 3), taken('Endeavor', 3, 4), taken('Odyssey', 1, 3),
    { kind: 'new-warbond', from: 1, to: 2, cash: 1000 }, { kind: 'new-warbond', from: 2, to: 3, cash: 1000 }, { kind: 'new-warbond', from: 3, to: 4, cash: 1000 },
    { kind: 'step-gone', step: 'standard', from: 2, to: 4 },
  ] };
  assert.equal(goalChangeLine(g, { name }),
    'Liberator -$65: now uses 3 new Warbonds; Beta → Delta is no longer sold; its CCUs now go to Constellation Mk V Centaurus (12), Endeavor (2), Odyssey (1)');
  // One taken CCU keeps its full wording; two of a kind are still listed.
  const few = { name: 'Orion', delta: 500, causes: [taken('Carrack', 1, 2), { kind: 'copy-new', from: 2, to: 3 }, { kind: 'copy-new', from: 3, to: 4 }] };
  assert.equal(goalChangeLine(few, { name }), 'Orion +$5: now uses your new Beta → Gamma CCU; now uses your new Gamma → Delta CCU; Carrack took your Alpha → Beta CCU');
});
