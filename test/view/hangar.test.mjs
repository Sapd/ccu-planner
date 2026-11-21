import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, addChain } from '../../src/logic/chains.mjs';
import { hangarRows, buybackRows, candidateBars, parsePriceUsd, priceRows, conceptShips } from '../../app/src/lib/view/hangar.mjs';

const ships = new Map([[1, { id: 1, name: 'A', msrp: 5000, concept: false, onSale: true }], [2, { id: 2, name: 'B', msrp: 7500, concept: true, onSale: false }]]);
const copy = (copyId, from, to, extra = {}) => ({ copyId, from, to, paid: { cents: 1500 }, giftable: true, meltable: true, matchMethod: 'item-id', extras: [], ...extra });

test('hangarRows marks reserved copies, falls back to unknown ship and passes review through', () => {
  const plans = newState();
  const c = addChain(plans, { name: 'G', base: 1, target: 2 });
  plans.chains[c.id].accepted = { steps: [{ kind: 'owned', from: 1, to: 2, copyId: 'k1' }], cash: 0 };
  const review = [{ pledgeId: 9, name: 'Odd', reason: 'x' }];
  const { rows, review: out } = hangarRows({ ships, owned: [copy('k1', 1, 2), copy('k2', 1, 99, { paid: null, giftable: false })], review }, plans);
  assert.equal(rows[0].reservedBy, c.id);
  assert.equal(rows[1].reservedBy, null);
  assert.equal(rows[1].toName, 'unknown ship');
  assert.equal(rows[1].paid, null);
  assert.equal(rows[0].fromName, 'A');
  assert.equal(out, review);
});

test('buyback rows skip gone entries', () => {
  const r = buybackRows({ buyback: [{ data: { buybackPledgeId: 1, name: 'X' }, firstSeen: 'a' }, { data: { buybackPledgeId: 2, name: 'Y' }, firstSeen: 'b', goneSince: 'c' }] });
  assert.deepEqual(r.map((x) => x.id), [1]);
});

test('candidate bars, price parsing, price rows and concept list', () => {
  const bars = candidateBars([{ copy: { copyId: 'a', from: 1, to: 2 }, paid: 500 }, { copy: { copyId: 'b', from: 1, to: 99 }, paid: 900 }], ships);
  assert.deepEqual(bars.map((b) => [b.copyId, b.label, b.paid]), [['b', 'A → unknown ship', 900], ['a', 'A → B', 500]]);
  assert.equal(parsePriceUsd('175'), 17500);
  assert.equal(parsePriceUsd('0'), null);
  assert.equal(parsePriceUsd('abc'), null);
  const rows = priceRows({ ships }, { ships: { 2: { msrp: 9000, note: null } } }, [{ from: 1, to: 2, assumed: true }, { from: 1, to: 2 }]);
  assert.deepEqual([rows[0].name, rows[0].today, rows[0].affected], ['B', 7500, 1]);
  assert.deepEqual(conceptShips(ships), [{ id: 2, name: 'B', msrp: 7500, onSale: false }]);
});

import { keyed, meltView } from '../../app/src/lib/view/hangar.mjs';
import { memoized, MEMO_MAX } from '../../src/logic/session.mjs';
import { meltHeadline, meltPlanLines, meltPickLine, priceLine } from '../../src/logic/describe.mjs';

const fakeApp = (rev = 1, credit = 0) => ({ data: { ships }, plans: { rev, profile: { credit } }, overrides: { rev: 0, ships: {} } });

test('meltView returns the cached object for the same key and recomputes for a new one', () => {
  const app = fakeApp();
  let n = 0;
  const compute = () => ({ n: ++n });
  const a = meltView(app, { compute });
  assert.equal(meltView(app, { compute }), a);
  assert.equal(n, 1);
  const b = meltView({ ...app, plans: { rev: 2, profile: { credit: 0 } } }, { compute });
  assert.notEqual(b, a);
  assert.equal(n, 2);
});

test('memoized evicts the oldest entry past the cap and a hit refreshes recency', () => {
  assert.equal(MEMO_MAX, 16);
  const memo = new Map();
  let n = 0;
  const get = (k) => memoized(memo, k, () => ({ k, n: ++n }), 2);
  const a = get('a'); get('b');
  assert.equal(get('a'), a); // refresh a; b is now oldest
  get('c');
  assert.deepEqual([...memo.keys()], ['a', 'c']);
  assert.equal(n, 3);
  get('b');
  assert.equal(n, 4);
});

test('keyed keeps ids and disambiguates missing or duplicate ones', () => {
  const k = keyed([{ id: 5 }, { id: 5 }, {}, { id: 7 }], (x) => x.id).map((x) => x.key);
  assert.deepEqual(k, ['5', '5#1', 'item#2', '7']);
  assert.equal(new Set(k).size, k.length);
});

test('melt and price wording is pinned', () => {
  const name = (id) => ({ 1: 'A', 2: 'B' })[id] ?? `#${id}`;
  const p = {
    candidates: [1, 2], candidateCredit: 11500, finishChains: ['c1', 'c2'], locks: [{ chainId: 'c3', step: { from: 1, to: 2, cash: 5000 } }],
    warbond: 2500, standard: 11000, pool: 1000, newMoneyBefore: 12500, newMoneyAfter: 2500, melt: [{}], meltCredit: 11000, creditLeftAfter: 500,
  };
  assert.equal(meltHeadline(p, false), 'Melt candidates: 2 unused CCU(s), $115 credit (no saving, Standard offer at the last sync, target seen in the store on two syncs clear of any sale, or confirmed, not into a concept ship, no extras, not reserved)');
  assert.ok(meltHeadline(p, true).includes('no saving at current or expected prices'));
  assert.deepEqual(meltPlanLines(p, name), [
    'Lock c3: A -> B $50 Standard now (counted below)',
    'Finish chains c1, c2: Warbond $25 (always new money) + Standard $110 - credit pool $10 = $125 new money',
    'Melt 1 CCU(s) for $110 credit -> new money $25, $5 credit left:',
  ]);
  assert.equal(meltPlanLines({ ...p, locks: [], finishChains: [], melt: [] }, name)[0], 'Locks only: Warbond $25 (always new money) + Standard $110 - credit pool $10 = $125 new money');
  assert.equal(meltPickLine({ copy: { copyId: 'k9', from: 1, to: 99 }, paid: 1500, standardNow: 1500 }, name), 'melt k9: A -> #99 (paid $15, Standard today $15)');
  assert.equal(priceLine('B', 7500, { msrp: 9000, note: 'rise' }, 3), 'B: $75 today -> $90 expected (rise) · changes the expected price of 3 Standard offers');
  assert.equal(priceLine('B', 7500, { msrp: 9000, note: null }, 1), 'B: $75 today -> $90 expected · changes the expected price of 1 Standard offer');
  // An unchanged assumption does not claim a change: it says what it covers.
  assert.equal(priceLine('Prospector', 17500, { msrp: 17500, note: 'announced increase' }, 193), 'Prospector: current and expected ship value both $175. This assumption covers 193 Standard offers. Note: announced increase.');
  assert.equal(priceLine('Prospector', 17500, { msrp: 17500, note: null }, 1), 'Prospector: current and expected ship value both $175. This assumption covers 1 Standard offer.');
});

import { splitAvailability, PLEDGE_CHIPS, plural } from '../../app/src/lib/view/hangar.mjs';

test('splitAvailability keeps ships with no sightings or confirmations apart; the Hangar chip list starts with ships and ends with All', () => {
  const s = splitAvailability([{}, { confirmedOutsideEvents: true }, { lastSeen: '2026-11-18' }]);
  assert.equal(s.unknown.length, 1);
  assert.equal(s.known.length, 2);
  assert.equal(PLEDGE_CHIPS[0].id, 'ships');
  assert.equal(PLEDGE_CHIPS.at(-1).id, 'all');
});

import { HANGAR_VIEWS, pledgeOverview as overviewOf } from '../../app/src/lib/view/hangar.mjs';
test('the Hangar switch is Ships / Upgrades / Other pledges; the overview counts per chip', () => {
  assert.deepEqual(HANGAR_VIEWS.map((v) => v.label), ['Ships', 'Upgrades', 'Other pledges']);
  const p = (category) => ({ category, ships: [], items: [], value: { cents: 100, currency: 'USD' } });
  const o = overviewOf([p('ship'), p('paint'), p('equipment'), p('other'), p('ccu')]);
  assert.equal(o.chips.others, 3);
  assert.equal(o.chips.ships, 1);
});

test('plural says one or many', () => {
  assert.equal(plural(1, 'upgrade', 'upgrades'), '1 upgrade');
  assert.equal(plural(0, 'upgrade', 'upgrades'), '0 upgrades');
});
