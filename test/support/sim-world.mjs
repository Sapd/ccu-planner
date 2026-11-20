// The scenario of the end-to-end simulation: a fresh account, 12 ships, four goals that compete, 45 days of store life.
// Money is in cents. Days are indexes from BASE (day 0 = 2026-11-20).

export const BASE = '2026-11-20';

export const SHIPS = [
  { id: 1, name: 'Aurora ES', msrp: 2500 },
  { id: 2, name: 'Mustang Alpha', msrp: 3000 },
  { id: 3, name: 'P-52 Merlin', msrp: 2000 },
  { id: 4, name: 'Avenger Titan', msrp: 7500 },
  { id: 5, name: 'Freelancer', msrp: 11000 },
  { id: 6, name: 'Cutlass Black', msrp: 11500 },
  { id: 7, name: 'Corsair', msrp: 19000 },
  { id: 8, name: 'Constellation Andromeda', msrp: 24000 },
  // Only sold during the sale event: its Standard upgrades exist on the event days only.
  { id: 9, name: 'Caterpillar', msrp: 31500, eventOnly: true },
  { id: 10, name: 'Zeus Mk II ES', msrp: 15500 },
  { id: 11, name: 'Reclaimer', msrp: 46500 },
  // A concept ship: its price rises to $740 on day 22 (and it is flight ready from then on).
  { id: 12, name: 'Perseus', msrp: 66000, concept: true },
];
export const ID = Object.fromEntries(SHIPS.map((s) => [s.name.split(' ')[0].replace('-', ''), s.id]));

export const SPEC = {
  base: BASE,
  days: 45,
  ships: SHIPS,
  credit: 6000,
  lti: [
    { pledgeId: 'P1', ship: 1, paidCents: 2500 },
    { pledgeId: 'P2', ship: 2, paidCents: 3000 },
    { pledgeId: 'P3', ship: 3, paidCents: 2000 },
  ],
  priceChanges: [
    { day: 22, ship: 12, msrp: 74000, concept: false },
    { day: 28, ship: 6, msrp: 12500 },
  ],
  events: [{ name: 'IAE 2956', from: 5, to: 12 }],
  warbonds: [
    // No event, runs for a month, one in stock: A, B and D all want it.
    { id: 101, from: 4, to: 6, cash: 2000, start: 0, end: 30, stock: 1 },
    // Event Warbond that drops after the event opened.
    { id: 102, from: 6, to: 8, cash: 8000, start: 6, end: 12 },
    // A limited-time offer for two days.
    { id: 103, from: 1, to: 4, cash: 3000, start: 2, end: 3, limited: true },
    // Event Warbond into the event-only ship.
    { id: 104, from: 8, to: 9, cash: 4500, start: 8, end: 12 },
    // A quiet one without an event.
    { id: 105, from: 2, to: 5, cash: 4000, start: 0, end: 18 },
    // Dear one, one in stock.
    { id: 107, from: 6, to: 11, cash: 25000, start: 3, end: 20, stock: 1 },
    // Appears after the event, vanishes on day 23 without anyone announcing it (known: false: the virtual user does not know the end).
    { id: 106, from: 5, to: 7, cash: 1500, start: 14, end: 22, known: false },
  ],
};

export const GOALS = [
  // c1: the one who is in a hurry
  { start: { kind: 'token' }, target: 8, priority: 'normal', mode: 'finish' },
  // c2: pinned to the Mustang Alpha pledge, planned first
  { start: { kind: 'token', pledgeId: 'P2' }, target: 7, priority: 'high' },
  // c3: any starting ship, a target that is only on sale during the event
  { start: { kind: 'token' }, target: 9, priority: 'normal' },
  // c4: a ship the user owns, a concept target, planned last
  { start: { kind: 'ship', ship: 4 }, target: 12, priority: 'low' },
];

export const script = {
  // The event is announced on day 2.
  2: [{ type: 'setSaleEvent', name: 'IAE 2956', from: '2026-11-25', to: '2026-12-02' }],
  // The price rise of the concept ship is announced on day 9: the user sets its expected price.
  9: [{ type: 'setPrice', shipId: 12, cents: 74000, note: 'announced' }],
  // The price rise of the Cutlass Black (day 28) is announced on day 16.
  16: [{ type: 'setPrice', shipId: 6, cents: 12500, note: 'announced' }],
  // A credit top-up.
  30: [{ topUp: 4000 }],
};

// ----- scenario 2: the order of planning changes the total -----
// Ships 1..4 at $10/$20/$40/$70 and one owned CCU Cutlass Black -> Constellation Andromeda. Goal A (created first, so planned first)
// is cheapest with that copy ($10 instead of $15 with a Warbond), but goal B needs it more (it saves B $20). Planning A first
// costs $60 in all, planning B first $45.
export const ORDER_SPEC = {
  base: BASE,
  days: 3,
  credit: 0,
  lti: [],
  events: [],
  owned: [{ copyId: 'k0', from: 2, to: 3, paid: { cents: 1000 } }],
  ships: [
    { id: 1, name: 'Aurora ES', msrp: 1000 },
    { id: 2, name: 'Cutlass Black', msrp: 2000 },
    { id: 3, name: 'Constellation Andromeda', msrp: 4000 },
    { id: 4, name: 'Carrack', msrp: 7000 },
  ],
  warbonds: [{ id: 201, from: 1, to: 3, cash: 1500, start: 0, end: 2 }],
};
export const ORDER_GOALS = [
  { start: { kind: 'ship', ship: 1 }, target: 3 },
  { start: { kind: 'ship', ship: 2 }, target: 4 },
];
