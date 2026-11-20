import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whatIf, buyEffect } from '../src/logic/whatif.mjs';
import { buildGraph } from '../src/logic/planner.mjs';
import { addGoalText, removeGoalText, buyVerdictText, buyRowText, otherGoalsText } from '../src/logic/whatifText.mjs';
import { setup, copy, deepFreeze } from './support/ladder.mjs';

// Hercules -> Liberator is owned once. Goal A (Hercules -> Liberator) would use it alone; Ironclad (high) wants it too.
const sharedSetup = () => setup({ owned: [copy('x', 2, 4)], goals: [{ base: 2, target: 4 }] });

test('add goal: its own cost, what it does to the other goals, and the total', () => {
  const { app, ids: [a] } = sharedSetup();
  const r = whatIf(deepFreeze(app), { addGoal: { target: 5, start: { kind: 'ship', ship: 2 }, priority: 'high' } });
  assert.deepEqual(r.added, [{ id: r.newGoalId, name: 'Ironclad', cash: 5000 }]); // owned 2 -> 4, then Standard 4 -> 5
  assert.deepEqual(r.deltas, [{ id: a, name: 'Liberator', was: 0, now: 7500, delta: 7500 }]);
  assert.equal(r.before.total, 0);
  assert.equal(r.after.total, 7500, 'the totals only count goals in both states');
  assert.equal(r.totalDelta, 7500);
  assert.equal(r.grand.delta, 12500);
  assert.deepEqual(r.removed, []);
  assert.equal(addGoalText(r), 'Ironclad: $50. Other goals: +$75 (Liberator +$75). Total +$125.');
});

test('add goal that costs the others nothing', () => {
  const { app } = sharedSetup();
  const r = whatIf(app, { addGoal: { target: 3, start: { kind: 'ship', ship: 1 } } });
  assert.deepEqual(r.deltas, []);
  assert.equal(r.added[0].cash, 5000);
  assert.equal(addGoalText(r), 'Carrack: $50. Other goals: no change. Total +$50.');
});

test('remove goal: the others get cheaper, and the removed goal is listed apart', () => {
  const { app, ids: [a, b] } = setup({ owned: [copy('x', 2, 4)], goals: [{ base: 2, target: 4 }, { base: 2, target: 5, priority: 'high' }] });
  const r = whatIf(deepFreeze(app), { removeGoal: b });
  assert.deepEqual(r.removed, [{ id: b, name: 'Ironclad', cash: 5000 }]);
  assert.deepEqual(r.deltas, [{ id: a, name: 'Liberator', was: 7500, now: 0, delta: -7500 }]);
  assert.equal(r.totalDelta, -7500);
  assert.equal(r.grand.delta, -12500);
  assert.equal(removeGoalText(r), 'Without Ironclad: other goals -$75 (Liberator -$75). Total -$125 with its own $50.');
});

test('priority: the goals swap what they pay', () => {
  const { app, ids: [a, b] } = setup({ owned: [copy('x', 2, 4)], goals: [{ base: 2, target: 4 }, { base: 2, target: 5, priority: 'high' }] });
  const r = whatIf(deepFreeze(app), { priority: { id: b, priority: 'low' } });
  assert.equal(r.before.goals[a].cash, 7500);
  assert.equal(r.after.goals[a].cash, 0);
  assert.equal(r.after.goals[b].cash, 12500);
  assert.deepEqual(r.deltas.map((d) => [d.id, d.delta]).sort(), [[a, -7500], [b, 7500]]);
  assert.equal(r.totalDelta, 0);
});

test('buy: one copy helps, a second copy of the same CCU saves nothing for one goal', () => {
  const { app, ids: [a] } = setup({ goals: [{ base: 2, target: 4 }] });
  const e = buyEffect(deepFreeze(app), { from: 2, to: 4, kind: 'warbond', cash: 3000, maxCopies: 2 });
  const [one, two] = e.rows;
  assert.equal(one.saved, 7500);
  assert.equal(one.spent, 3000);
  assert.equal(one.net, -4500);
  assert.equal(one.usedCopies, 1);
  assert.deepEqual(one.deltas, [{ id: a, name: 'Liberator', was: 7500, now: 0, delta: -7500 }]);
  assert.equal(two.saved, 7500);
  assert.equal(two.extraSaved, 0);
  assert.equal(two.usedCopies, 1, 'the second copy is not used');
  assert.equal(two.net, -1500);
  assert.equal(buyVerdictText(e), 'A 2nd copy saves nothing.');
  assert.equal(buyRowText(one), '1 copy ($30): goals get $75 cheaper (Liberator -$75); you come out $45 ahead.');
});

test('buy: a second copy helps when two goals need the pair', () => {
  const { app } = setup({ goals: [{ base: 2, target: 4 }, { base: 2, target: 4 }] });
  const e = buyEffect(app, { from: 2, to: 4, kind: 'warbond', cash: 3000 });
  assert.deepEqual(e.rows.map((r) => [r.saved, r.extraSaved, r.usedCopies]), [[7500, 7500, 1], [15000, 7500, 2]]);
  assert.equal(buyVerdictText(e), 'A 2nd copy saves another $75.');
});

test('buy: a CCU no goal can use saves nothing', () => {
  const { app } = setup({ goals: [{ base: 2, target: 4 }] });
  const e = buyEffect(app, { from: 4, to: 5, kind: 'warbond', cash: 100, maxCopies: 1 });
  assert.equal(e.rows[0].saved, 0);
  assert.equal(e.rows[0].usedCopies, 0);
  assert.equal(buyVerdictText(e), null, 'the row says it already, so the verdict does not repeat it');
  assert.match(buyRowText(e.rows[0]), /no goal would use it/);
});

test('buy: the pair an accepted goal already buys is "already a step of its plan", not "no goal would use it"', async () => {
  const { acceptRoute } = await import('../src/logic/goals.mjs');
  const { sessionFor } = await import('../src/logic/session.mjs');
  const { app, ids: [a] } = setup({ goals: [{ base: 1, target: 2 }] });
  acceptRoute(app.plans, a, sessionFor(app).shared.get(a).route);
  const row = buyEffect(app, { from: 1, to: 2, kind: 'standard', cash: 2500, maxCopies: 1 }).rows[0];
  assert.equal(row.usedCopies, 0);
  assert.deepEqual(row.plannedBy, ['Hercules']);
  assert.equal(buyRowText(row), "1 copy ($25): this is already a step of Hercules's plan, and that plan would still buy it anyway. An extra copy would be a second purchase: $25 more.");
  assert.doesNotMatch(buyRowText(row), /no goal would use|cheaper|changes nothing/);
  assert.match(buyRowText({ ...row, plannedBy: ['Orion', 'Carrack'] }), /^1 copy \(\$25\): this is already a step of the plans of Orion and Carrack, and those plans would still buy them anyway\./);
});

test('price: Standard offers follow the new msrp, Warbonds stay', () => {
  const { app, ids: [a] } = setup({ goals: [{ base: 2, target: 4 }] });
  const r = whatIf(deepFreeze(app), { price: { shipId: 4, msrp: 17500 } });
  assert.deepEqual(r.deltas, [{ id: a, name: 'Liberator', was: 7500, now: 10000, delta: 2500 }]);
  assert.equal(r.totalDelta, 2500);
  // a Warbond into the ship keeps its quote
  const w = setup({ offers: [{ from: 2, to: 4, kind: 'warbond', cash: 4000 }], goals: [{ base: 2, target: 4 }] });
  assert.equal(whatIf(w.app, { price: { shipId: 4, msrp: 17500 } }).deltas.length, 0);
});

test('an input that cannot take a session is left alone (no session, no mutation)', () => {
  const { app } = sharedSetup();
  deepFreeze(app);
  assert.doesNotThrow(() => whatIf(app, { removeGoal: Object.keys(app.plans.chains)[0] }));
  assert.equal(app.session, undefined);
});

test('unknown changes and ships are refused', () => {
  const { app } = sharedSetup();
  assert.throws(() => whatIf(app, { nothing: 1 }), /unknown what-if/);
  assert.throws(() => whatIf(app, { price: { shipId: 99, msrp: 1000 } }), /unknown ship/);
  assert.throws(() => whatIf(app, { removeGoal: 'nope' }), /unknown chain/);
});

test('a goal without a route today gets one: delta null, not counted in the totals', () => {
  const { app, ids: [a] } = setup({ goals: [{ base: 1, target: 5 }] });
  const bare = { ...app, graph: buildGraph({ offers: [], owned: [] }), data: { ...app.data, offers: [], owned: [] } };
  const r = whatIf(bare, { buy: { from: 1, to: 5, kind: 'warbond', cash: 100, copies: 1 } });
  assert.equal(r.before.goals[a].cash, null);
  assert.equal(r.after.goals[a].cash, 0);
  assert.deepEqual(r.deltas, [{ id: a, name: 'Ironclad', was: null, now: 0, delta: null }]);
  assert.equal(r.totalDelta, 0);
  assert.equal(otherGoalsText(r), 'Other goals: no change; Ironclad would get a route.');
});

test('offerCheckLines words a check result', async () => {
  const { checkOffer } = await import('../src/logic/offerCheck.mjs');
  const { offerCheckLines } = await import('../src/logic/whatifText.mjs');
  const { app } = setup({ owned: [copy('x', 2, 3, 900)], goals: [{ base: 1, target: 3 }] });
  const name = (id) => ({ 1: 'Pulse', 2: 'Hercules', 3: 'Carrack' })[id];
  const lines = offerCheckLines(checkOffer(app, { from: 2, to: 3, kind: 'warbond', cash: 1000 }), name);
  assert.deepEqual(lines, [
    'The store sells Hercules → Carrack today as Standard $25.',
    'You own 1 copy of this CCU: used by Carrack.',
    'On the route of: Carrack.',
    '1 copy ($10): no goal would use it; nothing gets cheaper.',
  ]);
});

test('a known "before" is used as it is and gives the same answer', () => {
  const { app, ids: [a] } = sharedSetup();
  const change = { addGoal: { target: 5, start: { kind: 'ship', ship: 2 }, priority: 'high' } };
  const plain = whatIf(app, change);
  const given = whatIf({ ...app, session: undefined, plans: structuredClone(app.plans) }, change, { before: { total: 0, goals: { [a]: { name: 'Liberator', cash: 0 } } } });
  assert.deepEqual(given.deltas, plain.deltas);
  assert.deepEqual(given.added, plain.added);
});

test('buying something the plan buys anyway pays it early: never "cheaper" when the total stays the same', () => {
  const { app } = setup({ goals: [{ base: 1, target: 2 }] }); // the route is Standard Pulse -> Hercules for $25
  const same = buyEffect(app, { from: 1, to: 2, kind: 'standard', cash: 2500, maxCopies: 1 }).rows[0];
  assert.equal(same.net, 0);
  assert.equal(buyRowText(same), "1 copy ($25): buying it now pays $25 of Hercules's plan early; the total stays the same.");
  const dearer = buyEffect(app, { from: 1, to: 2, kind: 'warbond', cash: 4000, maxCopies: 1 }).rows[0];
  assert.equal(buyRowText(dearer), "1 copy ($40): saves $25 on Hercules's plan but costs $40 now: $15 more overall.");
  assert.doesNotMatch(buyRowText(same), /cheaper/);
  assert.doesNotMatch(buyRowText(dearer), /cheaper/);
});

test('a hypothetical purchase must be a CCU the store could sell: not the same ship, not downward; owned downward CCUs stay usable', async () => {
  const { assertBuyable, whatIf, buyEffect } = await import('../src/logic/whatif.mjs');
  const { app, ids } = setup({ goals: [{ base: 1, target: 3 }] });
  // Pulse(1) $50, Hercules(2) $75, Carrack(3) $100
  assert.doesNotThrow(() => assertBuyable(1, 3, app.data));
  assert.throws(() => assertBuyable(3, 1, app.data), /does not cost more than/);
  assert.throws(() => assertBuyable(2, 2, app.data), /to itself/);
  assert.throws(() => assertBuyable(1, 999, app.data), /unknown ship 999/);
  assert.doesNotThrow(() => assertBuyable(3, 1, null), 'no catalog, nothing to judge');
  assert.throws(() => whatIf(app, { buy: { from: 3, to: 1, kind: 'warbond', cash: 100, copies: 1 } }), /does not cost more than/);
  assert.throws(() => buyEffect(app, { from: 2, to: 2, kind: 'warbond', cash: 100 }), /to itself/);
  assert.ok(whatIf(app, { buy: { from: 1, to: 3, kind: 'warbond', cash: 100, copies: 1 } }).purchase);
  void ids;
});

test('buyRowText names only the goals whose cost went down; signed zero is a money text', () => {
  const row = { copies: 1, spent: 3000, saved: 7500, net: -4500, usedCopies: 1, deltas: [{ name: 'Liberator', delta: -9000 }, { name: 'Carrack', delta: 1500 }, { name: 'Pulse', delta: null }] };
  assert.equal(buyRowText(row), '1 copy ($30): goals get $75 cheaper (Liberator -$90); you come out $45 ahead.');
});

test('add goal without a route says nothing is to buy and no "Total $0"', () => {
  const r = { added: [{ name: 'Beta', cash: null }], deltas: [], grand: { delta: 0 } };
  assert.equal(addGoalText(r), 'Beta: no route found, so there is nothing to buy. Other goals: no change.');
});
