// Ship picker search. Pure.
import { norm } from '../../../../src/logic/ships.mjs';

/** Exact normalized name first, then prefix, then substring; ties by msrp ascending (unknown last). */
export function searchShips(ships, query, limit = 8) {
  const q = norm(query);
  if (!q) return [];
  const rank = (s) => {
    const n = norm(s.name);
    return n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3;
  };
  const msrp = (s) => s.msrp ?? Infinity;
  return [...ships.values()]
    .map((s) => [rank(s), s])
    .filter(([r]) => r < 3)
    .sort(([ra, a], [rb, b]) => ra - rb || msrp(a) - msrp(b) || String(a.name).localeCompare(String(b.name)))
    .slice(0, limit)
    .map(([, s]) => s);
}
