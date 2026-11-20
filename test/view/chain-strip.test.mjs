import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainStrip, stripText, stripState } from '../../app/src/lib/view/chainStrip.mjs';

const st = (state, from, to, cash = 0, urgency = null) => ({ state, urgency, step: { from, to, cash } });
const name = (id) => ({ 1: 'Pulse', 2: 'Syulen', 3: 'Spartan', 4: 'Reliant Sen', 5: '600i' })[id];

test('the strip has one stop per segment end and collapses runs of owned upgrades', () => {
  const steps = [st('wait', 1, 2, 4000), st('own', 2, 3), st('wait', 3, 4, 500), st('own', 4, 5)];
  const s = chainStrip(steps);
  assert.deepEqual(s.nodes, [1, 2, 3, 4, 5]);
  assert.deepEqual(s.segments.map((x) => [x.kind, x.label, x.sub]), [['wait', '$40', 'Wait'], ['own', 'Owned', null], ['wait', '$5', 'Wait'], ['own', 'Owned', null]]);
  assert.equal(stripText(s, name), 'Pulse, $40 Wait, Syulen, Owned, Spartan, $5 Wait, Reliant Sen, Owned, 600i');
});

test('a run of owned steps is one segment naming how many; the stops inside it are left out', () => {
  const s = chainStrip([st('wait', 1, 2, 4000), st('own', 2, 3), st('own', 3, 4), st('own', 4, 5)]);
  assert.deepEqual(s.nodes, [1, 2, 5]);
  assert.deepEqual(s.segments[1], { kind: 'own', label: '3 owned', sub: null, count: 3 });
});

test('purchases show their real urgency; an empty chain has no strip', () => {
  assert.equal(stripState(st('now', 1, 2, 1, 'norush')), 'norush');
  assert.equal(stripState(st('now', 1, 2, 1, 'today')), 'now');
  assert.equal(stripState(st('now', 1, 2, 1, 'optional')), 'optional');
  assert.equal(stripState(st('wait', 1, 2, 1)), 'wait');
  assert.deepEqual(chainStrip([]), { nodes: [], segments: [] });
  assert.equal(chainStrip([st('now', 1, 2, 2000, 'norush')]).segments[0].sub, 'On sale');
});

import { stepPhrase } from '../../src/logic/describe.mjs';
test('the spoken phrase of a chain step names the number, the pair and the state', () => {
  assert.equal(stepPhrase({ index: 2, total: 19, fromName: 'Syulen', toName: 'Spartan', state: 'own' }), 'Step 2 of 19. Upgrade Syulen to Spartan. Upgrade owned.');
  assert.equal(stepPhrase({ index: 1, total: 19, fromName: 'Pulse', toName: 'Syulen', state: 'wait' }), 'Step 1 of 19. Upgrade Pulse to Syulen. Wait.');
  assert.equal(stepPhrase({ index: 3, total: 4, fromName: 'A', toName: 'B', state: 'now', lock: true }), 'Step 3 of 4. Upgrade A to B. Buy now · locks the price.');
  assert.equal(stepPhrase({ index: 3, total: 4, fromName: 'A', toName: 'B', state: 'norush' }), 'Step 3 of 4. Upgrade A to B. On sale.');
});
