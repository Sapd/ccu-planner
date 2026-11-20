import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reservationItems, reservationLines, bulkPreview, reserveHeading, reservedHeading, NOTHING_HELD } from '../src/logic/reservation.mjs';
import { goalCostLines, settingsSummary, CHAIN_ORDER_NOTE, STATE_LABEL } from '../src/logic/describe.mjs';

const names = { 1: 'Alpha', 2: 'Beta', 3: 'Gamma', 7: 'Pulse' };
const name = (id) => names[id];

test('a reservation lists the owned copies, the LTI starting ship and the store credit it holds, and nothing else', () => {
  const route = { start: { ship: 7, token: { pledgeId: 'p1' } }, creditUsed: 500, steps: [{ kind: 'owned', from: 1, to: 2, copyId: 'k1' }, { kind: 'standard', from: 2, to: 3, cash: 1000 }] };
  const items = reservationItems(route, (id) => (id === 'k1' ? 2500 : null));
  assert.deepEqual(reservationLines(items, name), ['Alpha → Beta upgrade you own (paid $25)', 'Starting ship: Pulse', 'Store credit: $5']);
});

test('a fixed starting ship and no credit are not listed as held', () => {
  const route = { start: { ship: 1 }, creditUsed: 0, steps: [{ kind: 'owned', from: 1, to: 2, copyId: 'k1' }] };
  assert.deepEqual(reservationLines(reservationItems(route), name), ['Alpha → Beta upgrade you own']);
  assert.deepEqual(reservationLines(reservationItems({ start: { ship: 1 }, steps: [{ kind: 'standard', from: 1, to: 2, cash: 1 }] }), name), []);
  assert.deepEqual(reservationItems(null), { copies: [], token: null, credit: 0 });
  assert.match(NOTHING_HELD, /nothing of yours/);
});

test('an accepted route (token on the route itself) lists its starting ship too', () => {
  const accepted = { token: { pledgeId: 'p1', ship: 7 }, steps: [] };
  assert.deepEqual(reservationLines(reservationItems(accepted), name), ['Starting ship: Pulse']);
});

test('bulk preview covers only goals with a route that are not reserved yet', () => {
  const plans = [
    { chainId: 'a', route: { steps: [{ kind: 'owned', from: 1, to: 2, copyId: 'k1' }] } },
    { chainId: 'b', route: { steps: [] } },
    { chainId: 'c', route: null },
    { chainId: 'd', route: { steps: [] } },
  ];
  const chains = { d: { accepted: { steps: [] } } };
  const out = bulkPreview(plans, chains, { goalName: (id) => id.toUpperCase(), name });
  assert.deepEqual(out, [{ chainId: 'a', goalName: 'A', lines: ['Alpha → Beta upgrade you own'] }, { chainId: 'b', goalName: 'B', lines: [] }]);
  assert.equal(reserveHeading('Beta'), 'Reserving holds these for Beta, so other goals cannot use them:');
  assert.equal(reservedHeading('Beta'), 'Reserved for Beta. Other goals can no longer use these:');
  assert.equal(reservedHeading('Beta', false), 'Reserved for Beta.');
  assert.equal(reserveHeading('Beta', false), 'Reserve this chain for Beta.');
});

test('goal cost lines: labelled figures only when sharing makes the goal dearer than alone', () => {
  assert.deepEqual(goalCostLines(16000, 1500), { main: 'With other goals · $160', alone: 'If planned alone · $15' });
  assert.deepEqual(goalCostLines(1500, 1500), { main: '$15', alone: null });
  assert.deepEqual(goalCostLines(1500, null), { main: '$15', alone: null });
  assert.equal(goalCostLines(null, null), null);
});

test('settings on one line, chain order note and owned label', () => {
  assert.equal(settingsSummary({ mode: 'watch', priority: 'normal', lock: 'auto' }, 'from your Pulse · LTI'), 'Starts from your Pulse · LTI · Wait for sales when it saves money · Normal priority · price lock auto');
  assert.equal(settingsSummary({}, null), 'Starting ship not chosen yet · Wait for sales when it saves money · Normal priority · price lock auto');
  assert.equal(CHAIN_ORDER_NOTE, 'You own these upgrades. Apply them in the order shown to build the ship.');
  assert.equal(STATE_LABEL.own, 'Owned');
});

test('creditToSpend: a reserved Standard step you now own no longer holds credit, a part-bought chain holds the rest', async () => {
  const { creditToSpend } = await import('../src/logic/goals.mjs');
  const { buildGraph } = await import('../src/logic/planner.mjs');
  const accepted = { creditUsed: 2500, steps: [{ kind: 'standard', from: 1, to: 2, cash: 2000 }, { kind: 'standard', from: 2, to: 3, cash: 1000 }] };
  const none = buildGraph({ offers: [], owned: [] });
  assert.equal(creditToSpend(accepted, none), 2500, 'nothing bought yet');
  assert.equal(creditToSpend(accepted, null), 2500, 'without a graph the whole credit counts');
  const one = buildGraph({ offers: [], owned: [{ copyId: 'k1', from: 1, to: 2 }] });
  assert.equal(creditToSpend(accepted, one), 1000, 'one step bought: only the other is left to pay');
  assert.equal(creditToSpend(accepted, one, new Set(['k1'])), 2500, 'a copy another goal holds is not this goal\'s purchase');
  const both = buildGraph({ offers: [], owned: [{ copyId: 'k1', from: 1, to: 2 }, { copyId: 'k2', from: 2, to: 3 }] });
  assert.equal(creditToSpend(accepted, both), 0);
});

test('reservationSummary is one line; long lists fold behind it', async () => {
  const { reservationSummary, HELD_FOLD_AFTER } = await import('../src/logic/reservation.mjs');
  const name = (id) => ({ 1: 'Pulse' }[id]);
  const copies = Array.from({ length: 16 }, (_, i) => ({ copyId: `k${i}`, from: 1, to: 2, paid: null }));
  assert.equal(reservationSummary({ copies, token: { ship: 1, pledgeId: 'p' }, credit: 0 }, name), '16 upgrades you own and your starting ship Pulse');
  assert.equal(reservationSummary({ copies: copies.slice(0, 1), token: null, credit: 500 }, name), '1 upgrade you own and $5 store credit');
  assert.equal(reservationSummary({ copies: [], token: null, credit: 0 }, name), '');
  assert.ok(HELD_FOLD_AFTER >= 1);
});
