import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteReuse } from '../src/logic/routeReuse.mjs';

const route = (...copyIds) => ({ steps: copyIds.map((copyId) => ({ copyId })), start: { token: null } });
const set = (...x) => new Set(x);

test('an empty cache has no answer', () => {
  assert.equal(createRouteReuse().lookup('g', set('a'), 100), null);
});

test('the same blocked copies and credit give the stored route, even a stored "no route"', () => {
  const r = createRouteReuse();
  const found = route('x');
  r.store('g', set('a'), 100, { route: found, noToken: false });
  assert.equal(r.lookup('g', set('a'), 100).route, found);
  r.store('h', set('a'), 100, { route: null, noToken: true });
  assert.deepEqual(r.lookup('h', set('a'), 100), { route: null, noToken: true });
});

test('more blocked copies keep the route while it uses none of the new ones; a newly blocked route copy is a miss', () => {
  const r = createRouteReuse();
  const found = route('x');
  r.store('g', set('a'), 100, { route: found, noToken: false });
  assert.equal(r.lookup('g', set('a', 'b'), 100).route, found, 'b is not on the route');
  assert.equal(r.lookup('g', set('a', 'x'), 100), null, 'x is on the route and now blocked');
  assert.equal(r.lookup('g', set('a', 'b', 'x'), 100), null);
});

test('a copy the route already used while it was blocked does not count as new', () => {
  const r = createRouteReuse();
  const found = route('a');
  r.store('g', set('a'), 100, { route: found, noToken: false });
  // 'a' was blocked at the time and the route used it: this can only be a stored route that did not see it as blocked.
  assert.equal(r.lookup('g', set('a', 'b'), 100).route, found);
});

test('less blocked, other credit or another goal is a miss; a stored "no route" is not reused when more is blocked', () => {
  const r = createRouteReuse();
  r.store('g', set('a', 'b'), 100, { route: route('x'), noToken: false });
  assert.equal(r.lookup('g', set('a'), 100), null, 'fewer blocked: a better route may exist');
  assert.equal(r.lookup('g', set('a', 'b'), 99), null, 'credit differs');
  assert.equal(r.lookup('other', set('a', 'b'), 100), null);
  r.store('n', set('a'), 100, { route: null, noToken: false });
  assert.equal(r.lookup('n', set('a', 'b'), 100), null, 'noToken/no-route answers are only reused for the same situation');
});

test('a token on the route counts as a used copy', () => {
  const r = createRouteReuse();
  const found = { steps: [], start: { token: { copyId: 'token:1' } } };
  r.store('g', set(), 100, { route: found, noToken: false });
  assert.equal(r.lookup('g', set('b'), 100).route, found);
  assert.equal(r.lookup('g', set('token:1'), 100), null);
});
