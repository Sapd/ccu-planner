// The Hangar's "Other pledges" view: paints, equipment and the rest as one list with filters. Pure.
import { matchesQuery } from '../../../../src/logic/search.mjs';
import { pledgeSearchText } from './hangar.mjs';

export const OTHER_CATEGORIES = ['paint', 'equipment', 'other'];

/** The pledges of this view: everything that is not a ship, a package or an upgrade. */
export const otherPledges = (pledges) => pledges.filter((p) => OTHER_CATEGORIES.includes(p.category));

/** The pledges whose name, makers and item titles have every word of the query. */
export const searchPledges = (list, query) => list.filter((p) => matchesQuery(pledgeSearchText(p), query));

export const OTHER_GROUPS = [
  { id: 'kind', label: 'Kind', options: [
    { id: 'paint', label: 'Paints', test: (p) => p.category === 'paint' },
    { id: 'equipment', label: 'Equipment', test: (p) => p.category === 'equipment' },
    { id: 'other', label: 'Other', test: (p) => p.category === 'other' },
  ] },
  { id: 'gift', label: 'Giftable', options: [{ id: 'gift', label: 'Giftable', test: (p) => p.giftable }] },
  { id: 'reclaim', label: 'Reclaimable', options: [{ id: 'reclaim', label: 'Reclaimable', test: (p) => p.reclaimable }] },
];
