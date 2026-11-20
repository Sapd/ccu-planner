import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staircase, tooltipText } from '../../app/src/lib/view/staircase.mjs';

const ships = new Map([[1, { id: 1, msrp: 100 }], [2, { id: 2, msrp: 200 }], [3, { id: 3, msrp: 300 }], [4, { id: 4, msrp: 400, name: 'T' }]]);
test('tooltip uses the hovered data point, also for non-integer axis values', () => {
  const st = staircase({ steps: [{ from: 1, to: 4, kind: 'standard' }] }, ships);
  assert.equal(tooltipText(st, [{ axisValue: 0.97, data: [1, 400] }]), 'T<br/>$4');
  assert.equal(tooltipText(st, [{ data: [0, null] }, { data: [0, 100] }]), '#1<br/>$1'.replace('#1', st.points[0].ship));
  assert.equal(tooltipText(st, []), '');
});

test('tooltip shows the escaped ship image and escapes the name', () => {
  const imgShips = new Map([[1, { id: 1, name: 'A<b>"x"', msrp: 100, image: { s: '1-s.webp', l: '1-l.webp' } }], [2, { id: 2, name: 'B', msrp: 200 }]]);
  const st = staircase({ steps: [{ from: 1, to: 2, kind: 'standard' }] }, imgShips);
  assert.equal(st.points[0].image, '1-s.webp');
  const html = tooltipText(st, [{ data: [0, 100] }], (f) => `/__dev/images/${f}?x=1&y="2"`);
  assert.match(html, /^<img src="\/__dev\/images\/1-s\.webp\?x=1&amp;y=&quot;2&quot;"/);
  assert.ok(!html.includes('robertsspaceindustries'));
  // Without a resolver the picture is left out.
  assert.ok(!tooltipText(st, [{ data: [0, 100] }]).includes('<img'));
  assert.ok(html.includes('A&lt;b&gt;&quot;x&quot;'));
  assert.ok(!html.includes('<b>'));
  assert.equal(tooltipText(st, [{ data: [1, 200] }]), 'B<br/>$2');
});
