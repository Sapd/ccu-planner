// The New goal form: what it can say about the starting ship before anything is saved. Pure.

/** 'chosen' (the user picks the ship), 'auto' (the planner picks a cheap LTI ship) or 'none' (it would have no starting ship). */
export const starterState = ({ fixed, poolCount }) => (fixed ? 'chosen' : poolCount > 0 ? 'auto' : 'none');

/** The sample's working example: an Alpha -> Beta chain that the sample's owned CCU completes. null outside the sample. */
export function sampleExample(ships) {
  const by = (name) => [...ships.values()].find((s) => s.name === name)?.id ?? null;
  const base = by('Alpha');
  const target = by('Beta');
  return base != null && target != null ? { base, target } : null;
}

/** "Alpha → Beta": the two ends of the chain, with where the start comes from. null until a goal ship is picked. */
export function endpointsText({ state, startName, startPoolName, targetName }) {
  if (!targetName) return null;
  if (state === 'chosen') return startName ? `Start ${startName} (your choice) → goal ${targetName}` : `Start: pick a ship → goal ${targetName}`;
  if (state === 'auto') return `Start ${startPoolName ?? 'your cheapest LTI ship'} (picked by the planner) → goal ${targetName}`;
  return `No starting ship yet → goal ${targetName}`;
}
