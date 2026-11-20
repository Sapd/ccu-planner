// Pure navigation helpers for the shell.
import { initials, shipPictures, thumbFile } from './thumb.mjs';
import { whenText } from '../../../../src/logic/describe.mjs';
import { t, N_ } from '../../../../src/logic/i18n.mjs';

export const SECTIONS = ['today', 'goals', 'hangar', 'store'];
export const SECTION_LABEL = { today: N_('Today'), goals: N_('Goals'), hangar: N_('Hangar'), store: N_('Store') };
export const ADVANCED = [['graphs', N_('Upgrade map')], ['explorer', N_('Compare routes')], ['prices', N_('Price assumptions')]];

/**
 * What ShipHero draws: the pictures to try in order (the picture sync's large one, else its small one, then the signed feed's),
 * else the manufacturer initials. feedShips/sample as for shipPictures, so the banner has a picture before any picture sync.
 */
export function heroSource(ship, feedShips = {}, { sample = false } = {}) {
  const files = shipPictures(ship, feedShips, { sample }).map((p) => thumbFile(p, 'hero')).filter(Boolean);
  return files.length ? { kind: 'image', file: files[0], files } : { kind: 'initials', text: initials(ship?.manufacturer) };
}

/** One plain line under each Advanced menu item, so a newcomer knows what it is for. */
export const ADVANCED_HINT = {
  graphs: N_('A map of the upgrade routes between ships'),
  explorer: N_('Try any ship-to-ship route without making a goal'),
  prices: N_('What each upgrade is expected to cost, and what is on sale'),
};

/** Title row of every page: what the page is called and, in one plain sentence, what it is for. */
export const PAGE_INFO = {
  today: { title: N_('Today'), purpose: N_('What to buy now, what to wait for, and why.') },
  goals: { title: N_('Goals'), purpose: N_('The ships you want: where each one stands and what to do next.') },
  hangar: { title: N_('Hangar'), purpose: N_('Everything you own on your RSI account.') },
  store: { title: N_('Store'), purpose: N_('Upgrades on sale right now, and which of them matter for your goals.') },
  graphs: { title: N_('Upgrade map'), purpose: N_('A map of the upgrade routes between ships.') },
  explorer: { title: N_('Compare routes'), purpose: N_('Try any ship-to-ship route without making a goal.') },
  prices: { title: N_('Price assumptions'), purpose: N_('What the planner assumes each upgrade costs, and which ships it treats as always on sale.') },
};

/** When a sync last finished, in the app's one date format ("today, 14:05"), or "never". */
export const stampLabel = (value, now = new Date()) => whenText(value, now) ?? t('never');

/** True when a sync stamp is missing or more than `days` days old. Only then the header stamps turn orange; a day-old sync is ordinary. */
export const stampIsStale = (value, now = new Date(), days = 2) => !value || now.getTime() - new Date(value).getTime() > days * 86_400_000;
