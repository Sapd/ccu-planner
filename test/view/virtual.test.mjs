import { test } from 'node:test';
import assert from 'node:assert/strict';
import { virtualRows, virtualForm, syncPrice, formProblem, virtualAction, dollarsToCents, centsToDollars, dayAfter } from '../../app/src/lib/view/virtual.mjs';

const ships = new Map([[1, { id: 1, name: 'Cutlass Black', msrp: 10000 }], [2, { id: 2, name: 'Constellation', msrp: 22500 }]]);

test('dollar texts and cents', () => {
  assert.equal(dollarsToCents('12'), 1200);
  assert.equal(dollarsToCents('$12.5'), 1250);
  assert.equal(dollarsToCents('1,000'), 100000);
  assert.equal(dollarsToCents('abc'), null);
  assert.equal(dollarsToCents('-5'), null);
  assert.equal(centsToDollars(1250), '12.50');
  assert.equal(centsToDollars(1200), '12');
  assert.equal(dayAfter('2026-11-20', 30), '2026-12-20');
});

test('price and savings follow each other from the catalog difference', () => {
  const f = { ...virtualForm(), from: 1, to: 2, price: '100' };
  assert.equal(syncPrice(f, ships, 'price').savings, '25');
  assert.equal(syncPrice({ ...f, savings: '30' }, ships, 'savings').price, '95');
  assert.equal(syncPrice({ ...f, savings: '500' }, ships, 'savings').price, '');
});

test('the form is checked and becomes a setVirtualCcu action', () => {
  assert.match(formProblem(virtualForm()), /source and the target/);
  assert.match(formProblem({ ...virtualForm(), from: 1, to: 1 }), /different/);
  assert.match(formProblem({ ...virtualForm(), from: 1, to: 2, price: 'x' }), /costs/);
  assert.match(formProblem({ ...virtualForm(), from: 1, to: 2, price: '5', copies: 0 }), /Copies/);
  const ok = { ...virtualForm(), from: 1, to: 2, price: '95', copies: '2', expires: '2026-12-20', note: ' from Sam ' };
  assert.equal(formProblem(ok), null);
  assert.deepEqual(virtualAction(ok), { type: 'setVirtualCcu', ccu: { from: 1, to: 2, cents: 9500, copies: 2, expires: '2026-12-20', note: 'from Sam' } });
  assert.equal(virtualAction({ ...ok, id: 'v3' }).ccu.id, 'v3');
});

test('rows show names, savings, expiry and the goals that use each one', () => {
  const plans = { profile: { virtualCcus: [
    { id: 'v1', from: 1, to: 2, cents: 9500, copies: 1, expires: null, note: '' },
    { id: 'v2', from: 1, to: 2, cents: 9000, copies: 1, expires: '2026-11-01', note: 'old' },
  ] } };
  const routes = new Map([['c1', { name: 'Connie', route: { steps: [{ virtual: true, virtualId: 'v1' }] } }]]);
  const rows = virtualRows(plans, ships, routes, '2026-11-20');
  assert.equal(rows[0].fromName, 'Cutlass Black');
  assert.equal(rows[0].savings, 3000);
  assert.deepEqual(rows[0].usedBy, [{ goalId: 'c1', name: 'Connie' }]);
  assert.equal(rows[0].expired, false);
  assert.equal(rows[1].expired, true);
  assert.deepEqual(virtualForm(plans.profile.virtualCcus[0], ships), { id: 'v1', from: 1, to: 2, price: '95', savings: '30', copies: 1, expires: '', note: '' });
});
