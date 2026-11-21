// What Today tells you besides the list: the lock trade, an estimate when no sale price was seen,
// and the concept-ship tie-break note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain, proposeChain } from '../src/logic/chains.mjs';
import { createSession, sessionOf } from '../src/logic/session.mjs';
import { journey } from '../src/logic/journey.mjs';
import { decisionGraph, conceptTieNotes, versusText, tieNoteFor } from '../src/logic/decision.mjs';
import { warbondDiscounts } from '../src/logic/salePrices.mjs';
import { lockTradeText, estimateText, conceptTieText, NO_SALES_SEEN } from '../src/logic/describe.mjs';
import { emptyOverrides } from '../src/logic/prices.mjs';
import { emptySaleEvents } from '../src/logic/availability.mjs';

// ----- lock trade -----

const NAMES = { 1: 'Start', 2: 'Carrack', 3: 'Orion', 4: 'Ironclad' };
const lockShips = new Map([1, 2, 3, 4].map((id) => [id, { id, name: NAMES[id], msrp: id * 5000, concept: id === 3 }]));
// Route: owned Start -> Carrack, Standard Carrack -> Orion $50 (concept target: the lock). Backup: Standard Start -> Ironclad, owned Ironclad -> Orion.
function lockSetup({ withCopy, backupCash = 12000 }) {
  const offers = [{ kind: 'standard', from: 2, to: 3, cash: 5000 }, { kind: 'standard', from: 1, to: 4, cash: backupCash }];
  const owned = [{ from: 1, to: 2, copyId: 'c-sc', paid: { cents: 100 } }, ...(withCopy ? [{ from: 4, to: 3, copyId: 'c-it', paid: { cents: 100 } }] : [])];
  const plans = newState();
  const chain = addChain(plans, { base: 1, target: 3, name: 'Orion' });
  const graph = buildGraph({ offers, owned });
  const session = createSession({ plans, graph, data: { ships: lockShips, offers, owned } });
  const route = proposeChain(plans, chain.id, graph, { k: 1, plan: session.shared }).routes[0];
  return { session, chain, route, offers };
}
const lockStep = (x) => journey(x.route, x.chain, { session: x.session, ships: lockShips, overrides: null, expected: x.offers, avail: null }).steps.at(-1);

test('a lock step says what it costs and what waiting risks, and names the cover when there is one', () => {
  const covered = lockStep(lockSetup({ withCopy: true }));
  assert.equal(covered.lock, true);
  assert.equal(covered.urgency, 'optional');
  assert.equal(covered.trade, "Optional: buy now for $50 to keep this price. If Orion's price rises before release, waiting costs the rise; your other routes limit the extra cost to at most $70.");
  const alone = lockStep(lockSetup({ withCopy: false }));
  assert.equal(alone.trade, "Optional: buy now for $50 to keep this price. If Orion's price rises before release, waiting costs the rise; none of your other routes caps it.");
});

test('lockTradeText words every lock reason', () => {
  const base = { targetName: 'Orion', cash: 5000 };
  assert.match(lockTradeText({ ...base, code: 'expected' }), /rises as you expect/);
  assert.match(lockTradeText({ ...base, code: 'on' }), /If Orion's price rises, waiting/);
  assert.match(lockTradeText({ ...base, code: 'concept', extraCash: 0 }), /limit the extra cost to at most \$0\.$/);
});

// ----- estimate when no sale price was seen -----

const estShips = new Map([[1, 5000], [2, 7500], [3, 10000], [4, 15000], [5, 20000]].map(([id, msrp]) => [id, { id, name: `S${id}`, msrp }]));
const W = { steps: [
  { kind: 'owned', from: 1, to: 2, copyId: 'k', cash: 0 },
  { kind: 'warbond', from: 2, to: 3, cash: 2000, skuId: 20 },
  { kind: 'standard', from: 3, to: 5, cash: 10000 },
], cash: 12000, creditUsed: 0 };
const watch = { id: 'c1', start: { kind: 'ship', ship: 1 }, target: 5, mode: 'watch' };
const run = (warbondPrices, extra = {}) => journey(W, watch, { ships: estShips, overrides: null, expected: [{ kind: 'standard', from: 3, to: 5, cash: 10000 }], avail: null, warbondPrices, saleEvents: null, ...extra });
// Warbond vs Standard (msrp difference): 1-2 $15 of $25 = 40 %, 2-3 $15 of $25 = 40 %, 1-4 $75 of $100 = 25 %
const HISTORY = { pairs: { '1-2': { cash: 1500, at: '2026-11-18', skuId: 1 }, '2-3': { cash: 1500, at: '2026-11-18', skuId: 2 }, '1-4': { cash: 7500, at: '2026-11-18', skuId: 3 } } };

test('warbondDiscounts: the middle half of the discounts in your own history', () => {
  const d = warbondDiscounts(HISTORY, estShips);
  assert.equal(d.n, 3);
  assert.ok(Math.abs(d.low - 0.325) < 1e-9 && Math.abs(d.median - 0.4) < 1e-9 && Math.abs(d.high - 0.4) < 1e-9);
  assert.equal(warbondDiscounts({ pairs: {} }, estShips), null);
  assert.equal(warbondDiscounts(null, estShips), null);
  // Not usable: a Warbond that is not cheaper, a ship without a price, a malformed price.
  assert.equal(warbondDiscounts({ pairs: { '1-2': { cash: 2500 }, '1-9': { cash: 1 }, '2-3': { cash: 'x' } } }, estShips), null);
});

test('with no sale price seen, the journey gives a range from your own Warbond history', () => {
  const j = run(HISTORY);
  assert.equal(j.figures.salesSeen, false);
  assert.deepEqual(j.figures.estimate, { typical: 8000, low: 8000, high: 8750, n: 3 });
  assert.equal(estimateText(8000), 'Estimated new cash if discounts return · ≈ $80');
  assert.equal(estimateText(3879), 'Estimated new cash if discounts return · ≈ $39', 'an inferred $38.79 is shown as ≈ $39');
});

test('without any history there is no estimate, and a seen sale price replaces it', () => {
  assert.equal(run({ pairs: {} }).figures.estimate, null, 'the old "not seen yet" text stays');
  assert.equal(run(null).figures.estimate, null);
  assert.ok(NO_SALES_SEEN.length > 0);
  const seen = run({ pairs: { ...HISTORY.pairs, '3-5': { cash: 9000, at: '2026-11-18', skuId: 21 } } });
  assert.equal(seen.figures.salesSeen, true);
  assert.equal(seen.figures.estimate, null);
  // A finish goal does not wait, so it has nothing to estimate.
  assert.equal(run(HISTORY, {}).figures.estimate !== null, true);
  assert.equal(journey(W, { ...watch, mode: 'finish' }, { ships: estShips, expected: [], warbondPrices: HISTORY }).figures.estimate, null);
});

// ----- tie-break note -----

// Start(1) can reach Galaxy(4) through Phoenix(2) or through Crucible(3, a concept ship): both cost $40.
const tieShips = new Map([[1, 'Start', false], [2, 'Phoenix', false], [3, 'Crucible', true], [4, 'Galaxy', false]].map(([id, name, concept]) => [id, { id, name, msrp: id * 5000, concept }]));
function tieApp() {
  const offers = [
    { kind: 'standard', from: 1, to: 2, cash: 1000 }, { kind: 'standard', from: 1, to: 3, cash: 1000 },
    { kind: 'warbond', from: 2, to: 4, cash: 3000, skuId: 1 }, { kind: 'warbond', from: 3, to: 4, cash: 3000, skuId: 2 },
  ];
  const plans = newState();
  addChain(plans, { base: 1, target: 4, name: 'Galaxy' });
  const graph = buildGraph({ offers, owned: [], ships: tieShips });
  return { data: { ships: tieShips, offers, owned: [] }, graph, plans, overrides: emptyOverrides(), saleEvents: emptySaleEvents(), expected: offers };
}

test('a step chosen over an equal-cost route from a concept ship says so, in the decision graph and per goal', () => {
  const app = tieApp();
  const g = decisionGraph(app, 'c1', { wanted: null, today: '2026-11-19' });
  const warbond = g.steps.find((s) => s.chosen.kind === 'warbond');
  assert.equal(warbond.from, 2, 'the flight-ready Phoenix is chosen');
  const want = 'Chosen over Crucible → Galaxy (same price): the Crucible is a concept ship and may rise.';
  assert.equal(warbond.tie, want);
  assert.equal(conceptTieText('Crucible', 'Galaxy'), want);
  assert.ok(g.steps.filter((s) => s !== warbond).every((s) => !s.tie), 'only the step that won the tie-break');
  assert.match(g.verdict.versus, /^same cash, prefers a flight-ready Warbond source: Crucible is a concept ship and may rise$/);
  // The same line for Today's rows, computed from the goal's route.
  const session = sessionOf(app);
  assert.equal(tieNoteFor(session, 'c1', session.route('c1').steps.find((s) => s.kind === 'warbond')), want);
});

test('no tie note when the alternative is dearer, or when no concept ship is involved', () => {
  const route = (from, cash) => ({ cash, creditUsed: 0, ownedUsed: 0, steps: [{ kind: 'warbond', from, to: 4, cash }] });
  const name = (id) => `S${id}`;
  const best = route(2, 3000);
  assert.equal(conceptTieNotes(best, [best, route(3, 3500)], { concept: new Set([3]), name }).size, 0);
  assert.equal(conceptTieNotes(best, [best, route(3, 3000)], { concept: new Set(), name }).size, 0);
  assert.equal(conceptTieNotes(best, [best, route(2, 3000)], { concept: new Set([3]), name }).size, 0, 'a concept source on both sides is no preference');
  assert.equal(conceptTieNotes(best, [best, route(3, 3000)], { concept: new Set([3]), name }).size, 1);
  assert.equal(versusText(best, route(3, 3000), 'cash'), 'same cash and the same effort; a stable order breaks the tie', 'without concept data the old ladder applies');
});

test('the tie note needs the two steps to cost the same: a different step price drops it', () => {
  const name = (id) => `S${id}`;
  const route = (from, wbCash, rest) => ({ cash: 5000, creditUsed: 0, ownedUsed: 0, steps: [{ kind: 'warbond', from, to: 4, cash: wbCash }, { kind: 'standard', from: 4, to: 5, cash: rest }] });
  const best = route(2, 3000, 2000);
  assert.equal(conceptTieNotes(best, [best, route(3, 2500, 2500)], { concept: new Set([3]), name }).size, 0, 'same route cost, different step cost: no "same price"');
  assert.equal(conceptTieNotes(best, [best, route(3, 3000, 2000)], { concept: new Set([3]), name }).size, 1);
});

test('versusText names an unknown ship instead of printing an id', () => {
  const r = (from) => ({ cash: 3000, creditUsed: 0, ownedUsed: 0, steps: [{ kind: 'warbond', from, to: 4, cash: 3000 }] });
  assert.match(versusText(r(2), r(3), 'cash', { concept: new Set([3]) }), /unknown ship is a concept ship/);
});
