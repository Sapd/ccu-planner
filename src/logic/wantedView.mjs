// Groups the items of a wantedWarbonds() result for display (CLI and app).
//
//   createsRoute  pairs that would make a route where there is none today
//   ties          needOff 0: any discount helps; grouped by target ship
//   needs         a discount of at least sharePct of Standard is needed; grouped
//                 by target ship, in the order of the (share-sorted) input,
//                 sharePct taken from the group's first item

/**
 * @param {{ wanted?: object[] }} result
 * @param {{ sortNeeds?: boolean }} [opts] sortNeeds (default true): order `needs` by ascending sharePct, ties in input order
 * @returns {{ createsRoute: object[], ties: {to:number, items:object[]}[], needs: {to:number, sharePct:number, items:object[]}[] }} */
export function groupWanted(result, { sortNeeds = true } = {}) {
  const createsRoute = [];
  const ties = new Map();
  const needs = new Map();
  for (const x of result.wanted ?? []) {
    if (x.createsRoute) { createsRoute.push(x); continue; }
    const tie = x.needOff === 0;
    const groups = tie ? ties : needs;
    if (!groups.has(x.to)) groups.set(x.to, tie ? { to: x.to, items: [] } : { to: x.to, sharePct: Math.round((100 * x.needOff) / x.standard), items: [] });
    groups.get(x.to).items.push(x);
  }
  const needList = [...needs.values()];
  if (sortNeeds) needList.sort((a, b) => a.sharePct - b.sharePct); // Array sort is stable: input order breaks ties
  return { createsRoute, ties: [...ties.values()], needs: needList };
}

/** Slack typed in dollars -> cents, or null when empty, negative or not a number. */
export function parseSlackUsd(text) {
  const t = String(text ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
