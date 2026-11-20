import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/logic/planner.mjs';
import { newState, addChain, acceptRoute, proposeChain, evaluateAccepted } from '../src/logic/chains.mjs';
import { issueLine } from '../src/logic/describe.mjs';
import { goalNamer } from '../src/logic/ships.mjs';

const ships = new Map([[1, { id: 1, name: 'Pulse', msrp: 5000 }], [2, { id: 2, name: 'Cutlass', msrp: 7500 }], [3, { id: 3, name: 'Galaxy', msrp: 15000 }]]);
const name = (id) => ships.get(id)?.name ?? `#${id}`;
const std = (from, to, cash) => ({ from, to, kind: 'standard', cash });
const wb = (from, to, cash) => ({ from, to, kind: 'warbond', cash, skuId: 9 });

function accepted() {
  const offers = [wb(1, 2, 1000), std(2, 3, 7500)];
  const owned = [{ copyId: 'COPY77', from: 1, to: 2, paid: { cents: 100 } }];
  const graph = buildGraph({ offers, owned });
  const plans = newState();
  const a = addChain(plans, { base: 1, target: 3, name: 'Pulse -> Galaxy' });
  acceptRoute(plans, a.id, proposeChain(plans, a.id, graph, { k: 1 }).routes[0]);
  return { plans, a, offers, owned };
}
const wording = (issue, plans) => issueLine(issue, { name, goalName: goalNamer(plans, ships), arrow: '->' });

test('evaluateAccepted returns objects only, and issueLine words each kind with names, never ids', () => {
  const { plans, a, offers, owned } = accepted();
  // The copy is gone from the hangar and the Standard offer is repriced.
  const gone = evaluateAccepted(plans, a.id, { offers: [std(2, 3, 8000)], owned: [] });
  assert.ok(gone.issues.every((i) => typeof i === 'object'));
  assert.deepEqual(gone.issues.map((i) => i.kind), ['copy-gone', 'repriced']);
  assert.equal(wording(gone.issues[0], plans), 'CCU Pulse -> Cutlass no longer in hangar');
  assert.equal(wording(gone.issues[1], plans), 'Standard Cutlass -> Galaxy repriced $75 -> $80');
  // Another goal holds the same copy.
  const other = addChain(plans, { base: 1, target: 2, name: 'Other' });
  plans.chains[other.id].accepted = { steps: [{ kind: 'owned', from: 1, to: 2, cash: 0, copyId: 'COPY77' }], creditUsed: 0 };
  const shared = evaluateAccepted(plans, a.id, { offers, owned });
  const line = wording(shared.issues.find((i) => i.kind === 'copy-shared'), plans);
  assert.equal(line, 'CCU Pulse -> Cutlass also reserved by Cutlass');
  // An offer that is gone.
  const missing = evaluateAccepted(plans, a.id, { offers: [], owned });
  assert.equal(wording(missing.issues.find((i) => i.kind === 'offer-gone'), plans), 'Standard offer Cutlass -> Galaxy no longer available');
  for (const text of [...gone.issues, ...shared.issues, ...missing.issues].map((i) => wording(i, plans))) {
    assert.doesNotMatch(text, /COPY77|\bc\d\b|#\d/, text);
  }
});

test('goalNamer names a goal by its target ship and calls an unknown holder another goal', () => {
  const { plans, a } = accepted();
  assert.equal(goalNamer(plans, ships)(a.id), 'Galaxy');
  assert.equal(goalNamer(plans, ships)('another goal'), 'another goal');
  assert.equal(goalNamer(plans, ships)('c99'), 'another goal');
});

import { meltPickLine, meltPickLineApp } from '../src/logic/describe.mjs';

test('the app wording of a melt pick has ships and amounts but no copy id; the CLI keeps the id', () => {
  const m = { copy: { copyId: 'COPY77', from: 1, to: 2 }, paid: 500, standardNow: 450 };
  assert.match(meltPickLine(m, name), /COPY77/);
  assert.equal(meltPickLineApp(m, name), 'Melt Pulse -> Cutlass (paid $5, Standard today $4.50)');
});
