// Pure navigation helpers for the shell.
import { initials } from './thumb.mjs';
import { whenText } from '../../../../src/logic/describe.mjs';

export const SECTIONS = ['today', 'goals', 'hangar', 'store'];
export const SECTION_LABEL = { today: 'Today', goals: 'Goals', hangar: 'Hangar', store: 'Store' };
export const ADVANCED = [['graphs', 'Upgrade map'], ['explorer', 'Compare routes'], ['prices', 'Price assumptions']];

/** What ShipHero draws: the large local picture, else the small one, else the manufacturer initials. */
export function heroSource(ship) {
  const file = ship?.image?.l ?? ship?.image?.s ?? null;
  return file ? { kind: 'image', file } : { kind: 'initials', text: initials(ship?.manufacturer) };
}

/** One plain line under each Advanced menu item, so a newcomer knows what it is for. */
export const ADVANCED_HINT = {
  graphs: 'A map of the upgrade routes between ships',
  explorer: 'Try any ship-to-ship route without making a goal',
  prices: 'What each upgrade is expected to cost, and what is on sale',
};

/** Title row of every page: what the page is called and, in one plain sentence, what it is for. */
export const PAGE_INFO = {
  today: { title: 'Today', purpose: 'What to buy now, what to wait for, and why.' },
  goals: { title: 'Goals', purpose: 'The ships you want: where each one stands and what to do next.' },
  hangar: { title: 'Hangar', purpose: 'Everything you own on your RSI account.' },
  store: { title: 'Store', purpose: 'Upgrades on sale right now, and which of them matter for your goals.' },
  graphs: { title: 'Upgrade map', purpose: 'A map of the upgrade routes between ships.' },
  explorer: { title: 'Compare routes', purpose: 'Try any ship-to-ship route without making a goal.' },
  prices: { title: 'Price assumptions', purpose: 'What the planner assumes each upgrade costs, and which ships it treats as always on sale.' },
};

/** When a sync last finished, in the app's one date format ("today, 14:05"), or "never". */
export const stampLabel = (value, now = new Date()) => whenText(value, now) ?? 'never';

/** True when a sync stamp is missing or more than `days` days old. Only then the header stamps turn orange; a day-old sync is ordinary. */
export const stampIsStale = (value, now = new Date(), days = 2) => !value || now.getTime() - new Date(value).getTime() > days * 86_400_000;
