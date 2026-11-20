import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journey, cashBreakdown } from '../src/logic/journey.mjs';
import {
  tokenStepText, STATE_LABEL, LOCK_LABEL, FIGURE_HELP, NO_SALES_SEEN, ownedRunText, stepNumber, lockReasonText, waitReasonText, NEW_CASH_LABEL, LIST_VALUE_LABEL, SALES_CASH_LABEL, breakdownLines, cashCutText, estimateHowText,
} from '../src/logic/describe.mjs';
import { availCtx } from '../src/logic/availability.mjs';

const IAE_EVENT = { name: 'IAE 2956', from: '2026-11-14', to: '2026-11-27' }; // the sale these fixtures run in

// Ladder: 1=$50, 2=$75, 3=$100, 4=$150 (concept), 5=$200, 6=$250, 9 has no msrp
const ships = new Map([
  [1, { id: 1, name: 'One', msrp: 5000, concept: false }],
  [2, { id: 2, name: 'Two', msrp: 7500, concept: false }],
  [3, { id: 3, name: 'Three', msrp: 10000, concept: false }],
  [4, { id: 4, name: 'Four', msrp: 15000, concept: true }],
  [5, { id: 5, name: 'Five', msrp: 20000, concept: false }],
  [6, { id: 6, name: 'Six', msrp: 25000, concept: false }],
  [9, { id: 9, name: 'Nine', msrp: null, concept: false }],
]);
const owned = (from, to) => ({ kind: 'owned', from, to, copyId: `c${from}-${to}`, cash: 0 });
const warbond = (from, to, cash) => ({ kind: 'warbond', from, to, cash, skuId: 20 });
const standard = (from, to) => ({ kind: 'standard', from, to, cash: ships.get(to).msrp - ships.get(from).msrp });
// Expected prices equal to the offers: no alert unless a test changes them.
// The planner's route.cash: non-owned cash less the store credit used.
const priced = (route, creditUsed = 0) => ({ ...route, creditUsed, cash: route.steps.reduce((n, s) => n + (s.kind === 'owned' ? 0 : s.cash), 0) - creditUsed });
const expectedFor = (route) => route.steps.filter((s) => s.kind === 'standard').map((s) => ({ kind: 'standard', from: s.from, to: s.to, cash: s.cash }));
const ctxFor = (route, extra = {}) => ({ ships, overrides: null, expected: expectedFor(route), avail: null, warbondPrices: null, saleEvents: null, ...extra });

const watch = (base, target, extra = {}) => ({ id: 'c1', start: { kind: 'ship', ship: base }, target, mode: 'watch', ...extra });

// Watch route: owned 1->2, Warbond 2->3 ($20), Standard 3->5 ($100)
const W = priced({ steps: [owned(1, 2), warbond(2, 3, 2000), standard(3, 5)] });

test('watch: owned step is own, Warbond is buy now, Standard is wait; today sums now and wait', () => {
  const j = journey(W, watch(1, 5), ctxFor(W));
  assert.deepEqual(j.steps.map((s) => s.state), ['own', 'now', 'wait']);
  assert.equal(j.figures.today, 12000);
  assert.equal(j.figures.ifSales, null);
  assert.equal(j.figures.salesSeen, false);
  assert.equal(j.figures.fullPrice, 15000);
  assert.equal(j.figures.saveToday, 3000);
  assert.equal(j.figures.saveIfSales, null);
  assert.equal(j.done, false);
  assert.equal(j.steps[2].reason, 'Only at the normal price right now ($100). Warbonds for it show up during sales.');
  assert.equal(j.steps[2].seen, null);
});

test('a seen Warbond price below the Standard cash gives the if-sales figure', () => {
  const warbondPrices = { pairs: { '3-5': { cash: 9000, at: '2026-11-18', skuId: 21 } } };
  const j = journey(W, watch(1, 5), ctxFor(W, { warbondPrices }));
  assert.equal(j.steps[2].seen.cash, 9000);
  assert.equal(j.steps[2].reason, 'Seen for $90 during an earlier sale.');
  assert.equal(j.figures.ifSales, j.figures.today - 1000);
  assert.equal(j.figures.ifSales, 11000);
  assert.equal(j.figures.salesSeen, true);
  assert.equal(j.figures.saveIfSales, 4000);
});

test('a seen price that is not below the Standard cash does not count as sales', () => {
  const warbondPrices = { pairs: { '3-5': { cash: 10000, at: '2026-11-18', skuId: 21 } } };
  const j = journey(W, watch(1, 5), ctxFor(W, { warbondPrices }));
  assert.equal(j.figures.ifSales, null);
  assert.equal(j.figures.salesSeen, false);
});

test('finish goal: every non-owned step is buy now, no if-sales figure, no lock', () => {
  const j = journey(W, watch(1, 5, { mode: 'finish' }), ctxFor(W, { warbondPrices: { pairs: { '3-5': { cash: 9000, at: '2026-11-18', skuId: 21 } } } }));
  assert.deepEqual(j.steps.map((s) => s.state), ['own', 'now', 'now']);
  assert.equal(j.steps[2].lock, false);
  assert.equal(j.steps[2].reason, null);
  assert.equal(j.figures.ifSales, null);
  assert.equal(j.figures.salesSeen, false);
  assert.equal(j.figures.today, 12000);
});

test('concept target locks its last Standard step now with the plain lock reason', () => {
  const L = priced({ steps: [owned(1, 2), warbond(2, 3, 2000), standard(3, 4)] });
  const j = journey(L, watch(1, 4), ctxFor(L));
  assert.deepEqual(j.steps.map((s) => s.state), ['own', 'now', 'now']);
  assert.deepEqual(j.steps.map((s) => s.lock), [false, false, true]);
  assert.equal(j.steps[2].reason, 'This ship is a concept; its price usually rises when it becomes flyable.');
  assert.equal(j.steps[2].alert, null, 'a locked step gets no buy-before alert');
});

test('a Standard step with a raised expected price gets an alert; other steps get none', () => {
  const expected = [{ kind: 'standard', from: 3, to: 5, cash: 12000 }];
  const j = journey(W, watch(1, 5), ctxFor(W, { expected }));
  assert.equal(j.steps[2].alert, 'Buy before the price changes: Three → Five $100 now, $120 after');
  assert.equal(j.steps[0].alert, null);
  assert.equal(j.steps[1].alert, null);
});

test('an event-only target gets the event wait reason and alert', () => {
  const avail = availCtx({
    data: { ships, saleHistory: null },
    saleEvents: { rev: 1, events: [{ id: 'e1', ...IAE_EVENT }] },
    overrides: { ships: { 5: { availability: 'event-only' } } },
  }, '2026-11-18');
  const j = journey(W, watch(1, 5, { lock: 'off' }), ctxFor(W, { avail }));
  assert.equal(j.steps[2].state, 'wait');
  assert.equal(j.steps[2].reason, 'Only known on sale during IAE 2956. Buy before Nov 27 or it may be gone.');
  assert.equal(j.steps[2].alert, 'Three → Five $100: only known on sale during IAE 2956 (ends Nov 27): buy before it ends or risk losing this upgrade path');
});

test('unknown msrp: bar counts steps, fullPrice is null and no NaN appears', () => {
  const U = priced({ steps: [owned(1, 2), { kind: 'standard', from: 2, to: 9, cash: 5000 }] });
  const j = journey(U, watch(1, 9), ctxFor(U));
  assert.equal(j.bar.unit, 'steps');
  assert.equal(j.bar.own, 1);
  assert.equal(j.bar.wait, 1);
  assert.equal(j.figures.fullPrice, null);
  assert.equal(j.figures.saveToday, null);
  assert.equal(j.figures.saveIfSales, null);
  assert.equal(j.steps[0].value, 2500);
  assert.equal(j.steps[1].value, null);
  assert.ok(!JSON.stringify(j).includes('NaN'));
});

test('a route of only owned steps is done and the bar holds own value only', () => {
  const A = priced({ steps: [owned(1, 2), owned(2, 3)] });
  const j = journey(A, watch(1, 3), ctxFor(A));
  assert.equal(j.done, true);
  assert.deepEqual(j.bar, { unit: 'steps', own: 2, now: 0, norush: 0, optional: 0, wait: 0 });
  assert.equal(j.figures.today, 0);
});

test('five consecutive owned steps collapse into one owned run', () => {
  const R = priced({ steps: [owned(1, 2), owned(2, 3), owned(3, 4), owned(4, 5), owned(5, 6)] });
  const j = journey(R, watch(1, 6), ctxFor(R));
  assert.deepEqual(j.groups, [{ kind: 'owned-run', from: 0, to: 4, count: 5 }]);
});

test('two owned steps stay individual groups; three collapse', () => {
  const two = priced({ steps: [owned(1, 2), owned(2, 3), standard(3, 5)] });
  assert.deepEqual(journey(two, watch(1, 5), ctxFor(two)).groups, [
    { kind: 'step', index: 0 }, { kind: 'step', index: 1 }, { kind: 'step', index: 2 },
  ]);
  const three = priced({ steps: [owned(1, 2), owned(2, 3), owned(3, 4), standard(4, 5)] });
  assert.deepEqual(journey(three, watch(1, 5), ctxFor(three)).groups, [
    { kind: 'owned-run', from: 0, to: 2, count: 3 }, { kind: 'step', index: 3 },
  ]);
});

test('no route gives the empty journey shape', () => {
  const j = journey(null, watch(1, 5), ctxFor(W));
  assert.deepEqual(j, {
    steps: [], groups: [], bar: { unit: 'steps', own: 0, now: 0, norush: 0, optional: 0, wait: 0 },
    figures: { fullPrice: 15000, today: 0, ifSales: null, salesSeen: false, estimate: null, saveToday: null, saveIfSales: null },
    done: false,
  });
});

test('the plain texts are exact', () => {
  assert.deepEqual(STATE_LABEL, { own: 'Owned', now: 'Buy now', wait: 'Wait', norush: 'On sale', optional: 'Optional', reserved: 'Reserved' });
  assert.equal(LOCK_LABEL, 'Buy now · locks the price');
  assert.equal(NO_SALES_SEEN, 'Sale prices not seen yet; keep syncing during sales');
  assert.equal(ownedRunText({ first: 4, last: 19, total: 19, fromName: 'Reliant Sen', toName: '600i Explorer', count: 16 }), '04–19 Reliant Sen → 600i Explorer · 16 owned upgrades');
  assert.equal(ownedRunText({ first: 2, last: 4, total: 120, fromName: 'A', toName: 'B', count: 3 }), '002–004 A → B · 3 owned upgrades');
  assert.equal(stepNumber(1, 5), '01');
  assert.deepEqual(FIGURE_HELP, {
    fullPrice: `For comparison only: the price difference between your starting ship and the goal ship if you bought one direct upgrade at today's list prices. It is not money you saved or spent.`,
    today: `The money you still have to pay at today's store prices for the upgrades you do not own yet, after the upgrades you own and any store credit. Steps marked "Wait" are included but are not meant to be bought today.`,
    ifSales: 'The new cash still needed if each waiting step gets the lowest sale price seen so far. Not guaranteed.',
  });
  assert.equal([NEW_CASH_LABEL, LIST_VALUE_LABEL, SALES_CASH_LABEL].join(' | '), 'New cash still needed | Direct upgrade at list value | New cash if the sales come back');
});

test('lockReasonText maps each code to one plain sentence', () => {
  assert.equal(lockReasonText('on'), 'You chose to lock the price of this step.');
  assert.equal(lockReasonText('expected'), 'The normal price of this ship is expected to go up.');
  assert.equal(lockReasonText('concept'), 'This ship is a concept; its price usually rises when it becomes flyable.');
  assert.equal(lockReasonText('event', { event: { name: 'IAE 2956', to: '2026-11-27' } }), 'Only known on sale during IAE 2956.');
  assert.equal(lockReasonText('unknown-code'), null);
});

test('waitReasonText gives each wait kind its plain sentence', () => {
  assert.equal(waitReasonText('normal', { cash: 10000 }), 'Only at the normal price right now ($100). Warbonds for it show up during sales.');
  assert.equal(waitReasonText('off-store'), 'Not in the store right now. It usually comes back during sales.');
  assert.equal(
    waitReasonText('event-only', { event: { name: 'IAE 2956', from: '2026-11-14', to: '2026-11-27' } }),
    'Only known on sale during IAE 2956. Buy before Nov 27 or it may be gone.',
  );
  assert.equal(waitReasonText('seen', { seen: { cash: 9000 }, event: null }), 'Seen for $90 during an earlier sale.');
  assert.equal(waitReasonText('seen', { seen: { cash: 9000 }, event: { name: 'IAE 2956' } }), 'Seen for $90 during IAE 2956.');
});

// Credit: the planner nets store credit out of route.cash, and `today` is what you pay in new money.
test('one $100 Standard step with $100 store credit costs $0 today', () => {
  const C = priced({ steps: [standard(3, 5)] }, 10000);
  assert.equal(C.cash, 0);
  const j = journey(C, watch(3, 5), ctxFor(C));
  assert.equal(j.figures.today, 0);
  assert.equal(j.figures.fullPrice, 10000);
  assert.equal(j.figures.saveToday, 10000);
  assert.equal(j.figures.ifSales, null);
});

test('with store credit, if-sales floors at 0 when the seen saving exceeds today', () => {
  const C = priced({ steps: [standard(3, 5)] }, 10000);
  const warbondPrices = { pairs: { '3-5': { cash: 9000, at: '2026-11-18', skuId: 21 } } };
  const j = journey(C, watch(3, 5), ctxFor(C, { warbondPrices }));
  assert.equal(j.figures.today, 0);
  assert.equal(j.figures.ifSales, 0);
  assert.equal(j.figures.salesSeen, true);
  assert.equal(j.figures.saveIfSales, 10000);
});

test('today follows route.cash, not the raw step sum, when a Warbond and credit are both used', () => {
  // Warbond $20 + Standard $125 (msrp $75 -> $200), $30 credit: route.cash is $115.
  const C = priced({ steps: [warbond(1, 2, 2000), standard(2, 5)] }, 3000);
  assert.equal(C.cash, 11500);
  const j = journey(C, watch(1, 5), ctxFor(C));
  assert.equal(j.figures.today, 11500);
  assert.equal(j.figures.today, C.cash);
});

test('wait reasons: event-only during an event, off-store when there is no Standard SKU, else normal', () => {
  const reasonFor = (shipMap, extra) => journey(W, watch(1, 5), ctxFor(W, { ships: shipMap, ...extra })).steps[2].reason;
  const eventAvail = availCtx({
    data: { ships, saleHistory: null },
    saleEvents: { rev: 1, events: [{ id: 'e1', ...IAE_EVENT }] },
    overrides: { ships: { 5: { availability: 'event-only' } } },
  }, '2026-11-18');
  assert.match(reasonFor(ships, { avail: eventAvail }), /^Only known on sale during /);
  const offStore = new Map(ships).set(5, { ...ships.get(5), standard: false });
  assert.equal(reasonFor(offStore, { avail: null }), waitReasonText('off-store'));
  assert.equal(reasonFor(offStore, { avail: availCtx({ data: { ships: offStore, saleHistory: null } }, '2026-11-18') }), waitReasonText('off-store'));
  assert.match(reasonFor(ships, { avail: null }), /^Only at the normal price/);
  assert.match(reasonFor(ships, { avail: availCtx({ data: { ships, saleHistory: null } }, '2026-11-18') }), /^Only at the normal price/);
});

test('fullPrice uses the start ship of a start-only fixed-ship goal', () => {
  const j = journey(W, { id: 'c1', start: { kind: 'ship', ship: 1 }, target: 5, mode: 'watch' }, ctxFor(W));
  assert.equal(j.figures.fullPrice, 15000);
  const t = journey(W, { id: 'c1', start: { kind: 'token' }, target: 5, mode: 'watch' }, ctxFor(W));
  assert.equal(t.figures.fullPrice, null);
});

test('a token goal takes fullPrice from the route start ship, null when there is no route', () => {
  const r = priced({ start: { ship: 1, token: { copyId: 't1', pledgeId: '1' } }, steps: [standard(1, 5)] });
  const tokenGoal = { id: 'c1', start: { kind: 'token' }, target: 5, mode: 'watch' };
  assert.equal(journey(r, tokenGoal, ctxFor(r)).figures.fullPrice, ships.get(5).msrp - ships.get(1).msrp);
  assert.equal(journey(null, tokenGoal, ctxFor(r)).figures.fullPrice, null);
});

test('a route that starts from a token marks its first step; accepted routes keep fullPrice and the mark', () => {
  const r = priced({ start: { ship: 1, token: { copyId: 't1', pledgeId: '1' } }, steps: [standard(1, 5), standard(5, 6)] });
  const tokenGoal = { id: 'c1', start: { kind: 'token' }, target: 6, mode: 'watch' };
  const j = journey(r, tokenGoal, ctxFor(r));
  assert.deepEqual(j.steps.map((x) => x.token), [true, false]);
  const acc = { ...priced({ steps: [standard(1, 5), standard(5, 6)] }), token: { copyId: 't1', pledgeId: '1', ship: 1 } };
  const aj = journey(acc, { ...tokenGoal, accepted: acc }, ctxFor(acc));
  assert.deepEqual(aj.steps.map((x) => x.token), [true, false]);
  assert.equal(aj.figures.fullPrice, ships.get(6).msrp - ships.get(1).msrp);
  assert.equal(journey(W, watch(1, 5), ctxFor(W)).steps.some((x) => x.token), false);
  assert.equal(tokenStepText('One'), 'Your One (starting ship)');
});

// ----- what the cash figure measures -----

test('cashBreakdown: owned upgrades and what was paid, purchases at list price, store credit, cash left', () => {
  const route = priced({ steps: [owned(1, 2), owned(2, 3), warbond(3, 4, 2000), standard(4, 5)] }, 1000);
  const j = journey(route, watch(1, 5), ctxFor(route));
  const paid = { 'c1-2': 500, 'c2-3': null };
  const b = cashBreakdown(j.steps, route, (id) => paid[id] ?? null);
  assert.deepEqual(b.owned, { count: 2, paid: 500, paidKnown: 1 });
  assert.deepEqual(b.purchases, { count: 2, cash: 7000 });
  assert.equal(b.credit, 1000);
  assert.equal(b.cash, 6000);
  assert.equal(b.purchases.cash - b.credit, b.cash, 'purchases less credit is the new cash still needed');
  assert.deepEqual(breakdownLines(b), [
    '2 upgrades you own already · you paid $5 for the 1 with a known price. That money is spent, not part of the cash still needed.',
    '2 upgrades still to buy · $70 at today\'s prices',
    'Store credit applied: $10',
    'New cash still needed: $60',
  ]);
});

test('cashBreakdown: nothing left to buy, a known paid price for every copy, no credit line', () => {
  const route = priced({ steps: [owned(1, 2)] });
  const j = journey(route, watch(1, 2), ctxFor(route));
  const b = cashBreakdown(j.steps, route, () => 2500);
  assert.deepEqual(breakdownLines(b), [
    '1 upgrade you own already · you paid $25 for them. That money is spent, not part of the cash still needed.',
    'No upgrade left to buy.',
    'New cash still needed: $0',
  ]);
});

test('the estimate text says what it is based on and that it was not seen', () => {
  const lines = estimateHowText(8000, 8000, 8750, 3);
  assert.equal(lines[0], 'Range $80–$87.50, typically $80.');
  assert.match(lines[1], /from 3 sales in your own history/);
  assert.match(lines[2], /inferred, not observed/);
  assert.match(estimateHowText(8000, 8000, 8750, 1)[1], /from 1 sale in your own history/);
  assert.equal(cashCutText('$5'), "up to ≈ $5 less new cash than at today's prices");
});

test('the bar counts upgrades only, with each purchase in its real urgency bucket', () => {
  const j = journey(W, watch(1, 5), ctxFor(W));
  assert.equal(j.bar.unit, 'steps');
  assert.equal(j.bar.own + j.bar.now + j.bar.norush + j.bar.optional + j.bar.wait, j.steps.length, 'every step is in exactly one segment');
  assert.equal(j.bar.own, 1);
  assert.equal(j.bar.wait, 1);
  assert.equal(j.bar.now + j.bar.norush + j.bar.optional, 1);
  // even with every msrp known the unit is steps, never money
  assert.ok(j.steps.every((x) => x.value != null));
});
