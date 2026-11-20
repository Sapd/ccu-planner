// Ship lookup helpers. Pure: no file or network access.

import { t } from './i18n.mjs';
export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Exact ship ID, exact normalized name, or a unique normalized substring. */
export function findShip(ships, query) {
  if (/^\d+$/.test(String(query))) return ships.get(Number(query)) ?? null;
  const q = norm(query);
  const all = [...ships.values()];
  return all.find((s) => norm(s.name) === q)
    ?? (all.filter((s) => norm(s.name).includes(q)).length === 1 ? all.find((s) => norm(s.name).includes(q)) : null);
}

/** Display name of a ship ID; "unknown ship" when the ship is not in the catalog (never the raw id). */
export function shipName(ships, id) {
  return ships.get(id)?.name ?? t('unknown ship');
}

/** goalName(id) for a plans document: the goal's label, or 'another goal' for a holder that is not a saved goal. Never an id. */
export const goalNamer = (plans, ships) => (id) => (plans?.chains?.[id] ? goalLabel(plans.chains[id], ships) : t('another goal'));

/** The name a goal goes by everywhere: its target ship, like the Goals and Today headlines. chain.name stays as stored (the CLI shows it). Never the id. */
export const goalLabel = (chain, ships) => ships?.get(chain?.target)?.name ?? chain?.name ?? t('a goal');
