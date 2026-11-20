// Choosing which chain a goal's numbers describe: the reserved chain (the accepted route) or the proposed chain (the
// planner's best route now). Pure: names, steps and cents in, wording out.
import { loc, N_ } from './i18n.mjs';
import { edgeKey } from './planner.mjs';
import { usd } from './format.mjs';

export const PROPOSED_LABEL = N_('Proposed chain');
export const RESERVED_LABEL = N_('Reserved chain');

/** "Proposed chain · $45". */
export const proposedLabel = loc('proposedLabel', (cash) => `${PROPOSED_LABEL} · ${usd(cash)}`);
/** "Reserved chain · $50". */
export const reservedLabel = loc('reservedLabel', (cash) => `${RESERVED_LABEL} · ${usd(cash)}`);

/**
 * What switching to the proposed chain does to the new cash needed, in words that match the numbers: "Saves" only when
 * the proposed chain needs less, never when the total is the same.
 */
export const RESERVED_STAYS = N_('Your reserved chain stays in place until you switch.');

function proposedEffectTextEn(reservedCash, proposedCash) {
  const stays = RESERVED_STAYS;
  if (reservedCash == null || proposedCash == null) return stays;
  const d = reservedCash - proposedCash;
  if (d > 0) return `Saves ${usd(d)} in new cash. ${stays}`;
  if (d < 0) return `Needs ${usd(-d)} more new cash. ${stays}`;
  return `Needs the same new cash with different steps. ${stays}`;
}
export const proposedEffectText = loc('proposedEffectText', proposedEffectTextEn);

/**
 * The steps and held copies that differ between the reserved and the proposed chain.
 * dropped: steps only the reserved chain has; added: steps only the proposed chain has; released: owned copies the
 * reserved chain holds that the proposed chain would not (they become free for other goals); claimed: copies the
 * proposed chain would newly reserve.
 */
export function chainChanges(reserved, proposed) {
  if (!reserved || !proposed) return { dropped: [], added: [], released: [], claimed: [] };
  const rKeys = new Set(reserved.steps.map(edgeKey));
  const pKeys = new Set(proposed.steps.map(edgeKey));
  const rCopies = new Set(reserved.steps.filter((s) => s.copyId).map((s) => s.copyId));
  const pCopies = new Set(proposed.steps.filter((s) => s.copyId).map((s) => s.copyId));
  return {
    dropped: reserved.steps.filter((s) => !pKeys.has(edgeKey(s))),
    added: proposed.steps.filter((s) => !rKeys.has(edgeKey(s))),
    released: reserved.steps.filter((s) => s.copyId && !pCopies.has(s.copyId)),
    claimed: proposed.steps.filter((s) => s.copyId && !rCopies.has(s.copyId)),
  };
}

const kindText = (s) => (s.kind === 'owned' ? 'owned upgrade' : s.kind === 'warbond' ? `Warbond ${usd(s.cash)}` : `Standard ${usd(s.cash)}`);

/**
 * The lines listing what changes on a switch, one per step: "Dropped: A → B (owned upgrade, free for other goals)".
 * A step that stays but whose copy changes shows up as released or claimed copy. `name` maps a ship id to its name.
 */
function changeLinesEn(changes, name) {
  const pair = (s) => `${name(s.from)} → ${name(s.to)}`;
  const lines = [];
  for (const s of changes.dropped) lines.push(`Dropped: ${pair(s)} (${kindText(s)}${s.copyId ? ', free for other goals' : ''})`);
  for (const s of changes.added) lines.push(`Added: ${pair(s)} (${kindText(s)}${s.copyId ? ', newly reserved' : ''})`);
  const droppedKeys = new Set(changes.dropped.map(edgeKey));
  const addedKeys = new Set(changes.added.map(edgeKey));
  for (const s of changes.released) if (!droppedKeys.has(edgeKey(s))) lines.push(`Released: the copy of ${pair(s)} you own (free for other goals)`);
  for (const s of changes.claimed) if (!addedKeys.has(edgeKey(s))) lines.push(`Reserved: a different copy of ${pair(s)}`);
  return lines;
}
export const changeLines = loc('changeLines', changeLinesEn);

/**
 * The one-line banner above a goal's chain when a proposed chain differs from the reserved one.
 * "Cheaper chain" is only said when the proposed chain really needs less new cash.
 * @returns {{ tone: 'better'|'worse'|'same', text: string }}
 */
function proposedBannerEn(reservedCash, proposedCash, changedSteps = 0) {
  const d = reservedCash - proposedCash;
  const diff = changedSteps ? ` · ${changedSteps} ${changedSteps === 1 ? 'step differs' : 'steps differ'}` : '';
  if (d > 0) return { tone: 'better', text: `Cheaper chain: ${usd(proposedCash)} instead of ${usd(reservedCash)}${diff}` };
  if (d < 0) return { tone: 'worse', text: `A different chain is proposed: ${usd(proposedCash)} instead of ${usd(reservedCash)}${diff}` };
  return { tone: 'same', text: `A different chain is proposed with the same new cash, ${usd(proposedCash)}${diff}` };
}
export const proposedBanner = loc('proposedBanner', proposedBannerEn);

/** The banner text while the proposed chain is shown in place of the reserved one: "Showing proposed chain · $45". */
export const comparingBanner = loc('comparingBanner', (proposedCash) => `Showing proposed chain · ${usd(proposedCash)}`);
