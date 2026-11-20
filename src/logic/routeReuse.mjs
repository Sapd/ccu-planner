// The reuse cache of planGoals: remembers each goal's earlier search results so a goal is not
// searched again when an order that leaves it the same situation comes up. Pure.
//
// Invariant (what makes a hit as good as a new search): a goal's search only sees claimed copies
// that matter to it (`seen`) and the credit left. A route found with `seen` blocked is still the
// best route when MORE is blocked, as long as it uses none of the newly blocked copies and the
// credit is the same: blocking more can only remove routes, and the old best one is untouched.
// With the same `seen` (and credit) the answer is the old one; with less blocked it may not be.

/** @returns {{ lookup: (goalId: string, seen: Set<string>, credit: number) => ({ route: object|null, noToken: boolean }|null), store: (goalId: string, seen: Set<string>, credit: number, entry: { route: object|null, noToken: boolean }) => void }} */
export function createRouteReuse() {
  const found = new Map(); // goalId -> [{ seen, credit, route, noToken }]
  const list = (id) => found.get(id) ?? found.set(id, []).get(id);
  return {
    /** An earlier result that answers a search with `seen` blocked and `credit` available, or null. */
    lookup(goalId, seen, credit) {
      for (const f of list(goalId)) {
        if (f.credit !== credit || f.seen.size > seen.size) continue;
        const same = f.seen.size === seen.size;
        let ok = true;
        for (const x of f.seen) if (!seen.has(x)) { ok = false; break; }
        if (!ok) continue;
        if (same) return { route: f.route, noToken: f.noToken };
        if (!f.route) continue;
        const used = [...f.route.steps.map((st) => st.copyId), f.route.start?.token?.copyId];
        if (used.every((id) => !id || f.seen.has(id) || !seen.has(id))) return { route: f.route, noToken: false };
      }
      return null;
    },
    /** Remembers the result of a real search. */
    store(goalId, seen, credit, entry) {
      list(goalId).push({ seen, credit, route: entry.route, noToken: entry.noToken });
    },
  };
}
