// The Hangar's "Other pledges" view: paints, equipment and the rest as one list with filters. Pure.
import { matchesQuery } from '../../../../src/logic/search.mjs';
import { pledgeSearchText } from './hangar.mjs';
import { N_ } from '../../../../src/logic/i18n.mjs';

export const OTHER_CATEGORIES = ['paint', 'equipment', 'other'];

/** The pledges of this view: everything that is not a ship, a package or an upgrade. */
export const otherPledges = (pledges) => pledges.filter((p) => OTHER_CATEGORIES.includes(p.category));

/** The pledges whose name, makers and item titles have every word of the query. */
export const searchPledges = (list, query) => list.filter((p) => matchesQuery(pledgeSearchText(p), query));

export const OTHER_GROUPS = [
  { id: 'kind', label: N_('Kind'), options: [
    { id: 'paint', label: N_('Paints'), test: (p) => p.category === 'paint' },
    { id: 'equipment', label: N_('Equipment'), test: (p) => p.category === 'equipment' },
    { id: 'other', label: N_('Other'), test: (p) => p.category === 'other' },
  ] },
  { id: 'gift', label: N_('Giftable'), options: [{ id: 'gift', label: N_('Giftable'), test: (p) => p.giftable }] },
  { id: 'reclaim', label: N_('Reclaimable'), options: [{ id: 'reclaim', label: N_('Reclaimable'), test: (p) => p.reclaimable }] },
];
