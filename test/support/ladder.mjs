// A small account for the phase-4 tests: ships 1..5 priced $50..$200, Standard offers for every pair, and helpers.
import { buildGraph } from '../../src/logic/planner.mjs';
import { newState, addChain } from '../../src/logic/chains.mjs';

export const MSRP = { 1: 5000, 2: 7500, 3: 10000, 4: 15000, 5: 20000 };
export const NAMES = { 1: 'Pulse', 2: 'Hercules', 3: 'Carrack', 4: 'Liberator', 5: 'Ironclad' };
export const ships = new Map(Object.entries(MSRP).map(([id, msrp]) => [Number(id), { id: Number(id), name: NAMES[id], msrp, concept: false }]));
export const standard = () => {
  const out = [];
  for (const f of [1, 2, 3, 4, 5]) for (const t of [1, 2, 3, 4, 5]) if (MSRP[t] > MSRP[f]) out.push({ from: f, to: t, kind: 'standard', cash: MSRP[t] - MSRP[f] });
  return out;
};
export const copy = (copyId, from, to, cents = 100) => ({ copyId, from, to, paid: { cents }, giftable: false, meltable: true, extras: [] });

/** An app object ({ plans, graph, data, overrides, saleEvents, expected }) with the given goals, owned copies and extra offers. */
export function setup({ owned = [], offers = [], credit = 0, goals }) {
  const plans = newState();
  plans.profile.credit = credit;
  const ids = goals.map((g) => addChain(plans, g).id);
  const all = [...standard(), ...offers];
  const data = { ships, offers: all, owned, lti: [] };
  const graph = buildGraph(data);
  return { app: { plans, graph, data, overrides: { rev: 0, ships: {} }, saleEvents: { rev: 0, events: [] }, expected: all }, ids };
}

/** Freezes a value and everything reachable from it, Map and Set contents included. */
export function deepFreeze(x, seen = new Set()) {
  if (x === null || typeof x !== 'object' || seen.has(x)) return x;
  seen.add(x);
  if (x instanceof Map) for (const [k, v] of x) { deepFreeze(k, seen); deepFreeze(v, seen); }
  else if (x instanceof Set) for (const v of x) deepFreeze(v, seen);
  for (const v of Object.values(x)) deepFreeze(v, seen);
  return Object.freeze(x);
}
