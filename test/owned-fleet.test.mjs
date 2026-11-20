import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedFleet } from '../src/logic/hangar.mjs';

const ships = new Map([
  [1, { id: 1, name: 'Carrack', msrp: 60000 }],
  [2, { id: 2, name: 'Pulse', msrp: 3000 }],
]);
const pledge = (pledgeId, category, list, insurance = null) => ({ pledgeId, category, insurance, ships: list });

test('ownedFleet: one entry per ship, counted across pledges, best insurance kept, biggest first', () => {
  const fleet = ownedFleet([
    pledge(10, 'ship', [{ title: 'Pulse', shipId: 2, manufacturer: 'Mirai' }], '120 Months Insurance'),
    pledge(11, 'ship', [{ title: 'Pulse', shipId: 2, manufacturer: 'Mirai' }], 'Lifetime Insurance'),
    pledge(12, 'package', [{ title: 'Carrack', shipId: 1, manufacturer: 'Anvil' }, { title: 'Mystery Bike', shipId: null, manufacturer: null }], '6 Months Insurance'),
    pledge(13, 'ccu', [{ title: 'Pulse', shipId: 2 }]),
    pledge(14, 'paint', []),
  ], ships);
  assert.deepEqual(fleet.map((e) => [e.name, e.count, e.lti]), [['Carrack', 1, false], ['Pulse', 2, true], ['Mystery Bike', 1, false]]);
  assert.deepEqual(fleet.find((e) => e.name === 'Pulse').pledgeIds, ['10', '11']);
  assert.equal(fleet.find((e) => e.name === 'Pulse').insurance, 'Lifetime Insurance');
});

test('ownedFleet: no ship pledges gives an empty list', () => {
  assert.deepEqual(ownedFleet([], ships), []);
});
