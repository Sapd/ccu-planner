import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOffer, parseOfferText } from '../src/logic/offerCheck.mjs';
import { setup, copy, deepFreeze, ships } from './support/ladder.mjs';

test('an offer that makes a goal cheaper names the goal and what you save after its price', () => {
  // Carrack from Pulse: Standard $50. Hercules -> Carrack for $10 as a Warbond: $25 Standard + the CCU.
  const { app } = setup({ goals: [{ base: 1, target: 3 }] });
  const r = checkOffer(deepFreeze(app), { from: 2, to: 3, kind: 'warbond', cash: 1000 });
  assert.equal(r.saving, 1500);
  assert.equal(r.verdict, 'Carrack gets $15 cheaper.');
  assert.deepEqual(r.copies, []);
  assert.equal(r.effect.net, -1500);
  assert.deepEqual(r.store, [{ kind: 'standard', cash: 2500 }], 'the store sells the pair as Standard for $25 today');
});

test('you own a copy and no goal needs another', () => {
  const { app } = setup({ owned: [copy('x', 2, 3, 900)], goals: [{ base: 1, target: 3 }] });
  const r = checkOffer(app, { from: 2, to: 3, kind: 'warbond', cash: 1000 });
  assert.equal(r.verdict, 'You own 1; no goal needs another.');
  assert.deepEqual(r.copies, [{ copyId: 'x', paid: 900, giftable: false, usedBy: { goalId: Object.keys(app.plans.chains)[0], goalName: 'Carrack' } }]);
  assert.deepEqual(r.onRoutes.map((x) => [x.goalName, x.kind]), [['Carrack', 'owned']]);
  assert.equal(r.saving, 0);
});

test('you own two and only one is used', () => {
  const { app } = setup({ owned: [copy('x', 2, 3, 900), copy('y', 2, 3, 800)], goals: [{ base: 1, target: 3 }] });
  const r = checkOffer(app, { from: 2, to: 3, kind: 'warbond', cash: 1000 });
  assert.equal(r.verdict, 'You own 2; no goal needs another.');
  assert.deepEqual(r.copies.map((c) => [c.copyId, c.usedBy?.goalName ?? null]), [['y', 'Carrack'], ['x', null]], 'the cheapest-paid copy is used first');
});

test('owning one but another still helps a second goal', () => {
  const { app } = setup({ owned: [copy('x', 2, 3, 900)], goals: [{ base: 1, target: 3 }, { base: 1, target: 3 }] });
  const r = checkOffer(app, { from: 2, to: 3, kind: 'warbond', cash: 1000 });
  assert.match(r.verdict, /^You own 1; another still helps: Carrack gets \$15 cheaper\.$/);
});

test('an offer nothing uses does not make any goal cheaper', () => {
  const { app } = setup({ goals: [{ base: 1, target: 3 }] });
  const r = checkOffer(app, { from: 4, to: 5, kind: 'warbond', cash: 1000 });
  assert.equal(r.verdict, 'Would not make any goal cheaper.');
  assert.deepEqual(r.onRoutes, []);
  assert.equal(r.saving, 0);
});

test('an offer for a pair a route already buys, at a price that is not lower', () => {
  const { app } = setup({ goals: [{ base: 1, target: 3 }] });
  const r = checkOffer(app, { from: 1, to: 3, kind: 'warbond', cash: 5000 });
  assert.equal(r.verdict, 'Carrack already uses Pulse → Carrack; at $50 nothing gets cheaper.');
});

// ---- pasted text ----

const fleet = new Map([
  [1, 'Pulse'], [2, 'Scorpius Antares'], [3, 'Scorpius'], [4, 'Guardian'], [5, 'Guardian MX'], [6, 'Orion'], [7, 'Cutlass Black'], [8, 'Corsair'], [9, 'Pulse LX'],
].map(([id, name]) => [id, { id, name, msrp: id * 1000 }]));

const POST = `**Daily deals - 19 Nov**
> Guardian ($250 MSRP, $235 WB): $5 from the Scorpius Antares
Pulse → Orion $150 (Warbond)
cutlass black to CORSAIR for $12 Standard
guardian mx - $3.50 from the scorpius
Pulse LX to Orion  $20
Some chatter about the sale $$ and nothing else
Mystery Ship to Orion $9
Orion to Corsair
`;

test('parseOfferText reads the deals of a Discord-style post', () => {
  const { offers, unmatched } = parseOfferText(POST, fleet);
  assert.deepEqual(offers.map(({ line, ...o }) => o), [
    { from: 2, to: 4, cash: 500, kind: 'warbond', kindAssumed: true }, // "$5 from the Scorpius Antares"; the WB is a price note in brackets, not the kind
    { from: 1, to: 6, cash: 15000, kind: 'warbond', kindAssumed: false }, // (Warbond) in brackets names the kind
    { from: 7, to: 8, cash: 1200, kind: 'standard', kindAssumed: false },
    { from: 3, to: 5, cash: 350, kind: 'warbond', kindAssumed: true }, // the exact name Scorpius, not Scorpius Antares
    { from: 9, to: 6, cash: 2000, kind: 'warbond', kindAssumed: true }, // Pulse LX is not Pulse
  ]);
  assert.deepEqual(unmatched.map((u) => u.line), ['Mystery Ship to Orion $9', 'Orion to Corsair']);
  assert.match(unmatched[0].reason, /Mystery Ship/);
  assert.equal(unmatched[1].reason, 'no price found');
});

test('parseOfferText on empty text and on lines that are not offers', () => {
  assert.deepEqual(parseOfferText('', fleet), { offers: [], unmatched: [] });
  assert.deepEqual(parseOfferText('Good morning everyone\nWhat a day', fleet), { offers: [], unmatched: [] });
});

test('checkOffer works on what parseOfferText found', () => {
  const { app } = setup({ goals: [{ base: 1, target: 3 }] });
  const { offers } = parseOfferText('Carrack ($100, $90 WB): $10 from the Hercules', ships);
  assert.equal(offers.length, 1);
  const { from, to, kind, cash } = offers[0];
  assert.equal(checkOffer(app, { from, to, kind, cash }).verdict, 'Carrack gets $15 cheaper.');
});

const variants = new Map([
  [1, 'Pulse'], [2, 'Pulse LX'], [3, 'Carrack'], [4, 'Constellation Andromeda'], [5, 'Constellation Aquila'], [6, 'Constellation'], [7, 'Orion'],
].map(([id, name]) => [id, { id, name, msrp: id * 1000 }]));

test('a name with extra words is not matched to the shorter ship', () => {
  const r = parseOfferText('Pulse to Carrack Expedition for $40 WB\nPulse Carbon to Orion $10\nPulse to Orion for $40 WB', variants);
  assert.deepEqual(r.offers.map((o) => [o.from, o.to, o.cash, o.kind, o.kindAssumed]), [[1, 7, 4000, 'warbond', false]]);
  assert.deepEqual(r.unmatched.map((u) => u.line), ['Pulse to Carrack Expedition for $40 WB', 'Pulse Carbon to Orion $10']);
  assert.match(r.unmatched[0].reason, /did you mean Carrack\?/);
  assert.match(r.unmatched[1].reason, /did you mean Pulse\?/);
});

test('Pulse and Pulse LX, and the Constellation variants, each match their own name', () => {
  const r = parseOfferText('Pulse LX to Orion $20\nPulse to Orion $30\nConstellation Aquila to Orion $5\nConstellation to Orion $6\nConstellation Phoenix to Orion $7\nthe Constellation ship to Orion $8', variants);
  assert.deepEqual(r.offers.map((o) => [o.from, o.cash]), [[2, 2000], [1, 3000], [5, 500], [6, 600], [6, 800]]);
  assert.deepEqual(r.unmatched.map((u) => u.line), ['Constellation Phoenix to Orion $7']);
  assert.match(r.unmatched[0].reason, /did you mean Constellation\?/);
});

test('two ships with the same name give no match, and there is no fall back to a shorter name', () => {
  const dup = new Map([[1, { id: 1, name: 'Dupe Ship' }], [2, { id: 2, name: 'Dupe Ship' }], [3, { id: 3, name: 'Dupe' }], [4, { id: 4, name: 'Orion' }]]);
  const r = parseOfferText('Dupe Ship to Orion $5', dup);
  assert.deepEqual(r.offers, []);
  assert.match(r.unmatched[0].reason, /matches several catalog ships/);
});

test('only a bracket made of kind words gives the kind; other brackets are dropped', () => {
  const r = parseOfferText([
    'Orion ($10 MSRP, $9 WB): $5 from the Pulse Standard',
    'Pulse to Carrack for $3 (WB, $9)',
    'Pulse to Carrack for $4 (WB) (Standard)',
    'Pulse to Orion (limited) $150',
    'Pulse to Orion (new!) $151',
    'Pulse to Orion (Aurora MR) $152',
    'Pulse to Carrack $6 (Standard)',
  ].join('\n'), variants);
  assert.deepEqual(r.offers.map((o) => [o.from, o.to, o.cash, o.kind, o.kindAssumed]), [
    [1, 7, 500, 'standard', false],
    [1, 3, 300, 'warbond', false],
    [1, 3, 400, 'warbond', true], // conflicting kinds: not stated
    [1, 7, 15000, 'warbond', true],
    [1, 7, 15100, 'warbond', true],
    [1, 7, 15200, 'warbond', true],
    [1, 3, 600, 'standard', false],
  ]);
});

test('two different prices in one line are reported, the same price twice is fine', () => {
  const r = parseOfferText('$25 - Pulse to Orion $30\n$25 - Pulse to Orion $25\n$25 - Pulse to Orion', variants);
  assert.deepEqual(r.offers.map((o) => o.cash), [2500, 2500]);
  assert.equal(r.unmatched.length, 1);
  assert.match(r.unmatched[0].reason, /two different prices \(\$25 and \$30\)/);
});

test('checkOffer refuses unknown ships, a pair that does not rise in price and a bad price', () => {
  const { app } = setup({ goals: [{ base: 1, target: 3 }] });
  assert.throws(() => checkOffer(app, { from: 99, to: 3, kind: 'warbond', cash: 100 }), /unknown ship 99/);
  assert.throws(() => checkOffer(app, { from: 3, to: 2, kind: 'warbond', cash: 100 }), /does not cost more than Carrack/);
  assert.throws(() => checkOffer(app, { from: 2, to: 3, kind: 'gold', cash: 100 }), /kind must be/);
  assert.throws(() => checkOffer(app, { from: 2, to: 3, kind: 'warbond', cash: 1.5 }), /whole number of cents/);
});

const makers = new Map([
  [1, 'Avenger Titan', 'Aegis Dynamics'], [2, 'Pulse', 'Mirai'], [3, 'Orion', 'RSI'], [4, 'Carrack', 'Anvil Aerospace'], [5, 'Avenger', 'Aegis Dynamics'],
].map(([id, name, manufacturer]) => [id, { id, name, msrp: id * 1000, manufacturer }]));

test('arrows with ">" and common layouts: leading price, trailing kind in brackets, Edition, manufacturer prefix', () => {
  const text = [
    'Pulse -> Orion $20',
    'Pulse => Orion $21',
    '> Pulse → Orion $22',
    '$25 - Pulse to Orion',
    '$26: Pulse -> Orion (Warbond)',
    'Pulse to Orion $27 (Standard)',
    'Pulse to Orion Warbond Edition $28',
    'Aegis Avenger Titan to Carrack for $29',
    'Pulse to Anvil Carrack $30 WB',
    'Mirai Pulse to RSI Orion $31 (Std)',
    'Pulse to Aegis Titan $32',
  ].join('\n');
  const r = parseOfferText(text, makers);
  assert.deepEqual(r.offers.map((o) => [o.from, o.to, o.cash, o.kind, o.kindAssumed]), [
    [2, 3, 2000, 'warbond', true],
    [2, 3, 2100, 'warbond', true],
    [2, 3, 2200, 'warbond', true],
    [2, 3, 2500, 'warbond', true],
    [2, 3, 2600, 'warbond', false],
    [2, 3, 2700, 'standard', false],
    [2, 3, 2800, 'warbond', false],
    [1, 4, 2900, 'warbond', true],
    [2, 4, 3000, 'warbond', false],
    [2, 3, 3100, 'standard', false],
  ]);
  assert.deepEqual(r.unmatched.map((u) => u.line), ['Pulse to Aegis Titan $32']);
});

test('plural kind words in a bracket or a name are kind words, not leftover noise', () => {
  const a = parseOfferText('Pulse to Orion $150 (Warbonds)', fleet);
  assert.equal(a.offers.length, 1, JSON.stringify(a));
  assert.equal(a.offers[0].kind, 'warbond');
  assert.equal(a.offers[0].kindAssumed, false);
  const b = parseOfferText('Pulse to Orion $150 (Standards)', fleet);
  assert.equal(b.offers[0].kind, 'standard');
  assert.equal(b.offers[0].kindAssumed, false);
  const c = parseOfferText('warbonds Pulse to Orion $150', fleet);
  assert.equal(c.offers.length, 1, JSON.stringify(c));
  const d = parseOfferText('$25 - Pulse to Orion $30', fleet);
  assert.match(d.unmatched[0].reason, /two different prices \(\$25 and \$30\)/);
});
