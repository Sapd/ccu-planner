// Whole-hangar view of RSI pledges. Pure: no file or network access.

import { norm } from './ships.mjs';

const PACKAGE_ITEM = /Star Citizen Digital Download|Squadron 42|Game Package/i;
const kindOf = (p, kind) => (p.items ?? []).filter((it) => it.kind === kind);

/** 'ccu' | 'ship' | 'package' | 'paint' | 'equipment' | 'other' */
export function classifyPledge(pledge) {
  if (pledge.upgrade) return 'ccu';
  const items = pledge.items ?? [];
  if (items.some((it) => it.kind === 'Ship')) return items.some((it) => PACKAGE_ITEM.test(it.title ?? '')) ? 'package' : 'ship';
  if (items.length && items.every((it) => it.kind === 'Skin')) return 'paint';
  if (items.length && items.every((it) => it.kind === 'FPS Equipment' || it.kind === 'Component')) return 'equipment';
  return 'other';
}

/** USD when the currency is USD or unknown (null): the one rule for totals and labels. */
export const isUsd = (value) => !!value && value.cents != null && (value.currency === 'USD' || value.currency == null);

// Reviewed alias names (aliases.items[].itemName) -> shipId on the normalized title; null when aliases disagree.
export function aliasShipId(aliases, title) {
  const q = norm(title);
  const ids = new Set(Object.values(aliases?.items ?? {}).filter((a) => norm(a.itemName) === q).map((a) => a.shipId));
  return ids.size === 1 ? [...ids][0] : null;
}

/** Strict ship lookup: exact normalized name only, null when none or several match. No substring fallback. */
export function findShipExact(ships, title) {
  const q = norm(title);
  const hits = [...ships.values()].filter((s) => norm(s.name) === q);
  return hits.length === 1 ? hits[0] : null;
}

// Catalog ships named in the pledge name; names inside a longer matched name are dropped.
function mentionedShips(ships, name) {
  const hay = ` ${norm(name)} `;
  const hits = [...ships.values()].map((s) => norm(s.name)).filter((n) => n && hay.includes(` ${n} `));
  return hits.filter((n) => !hits.some((o) => o !== n && o.includes(n)));
}

/** @param {Map<number,{id:number,name:string,manufacturer?:{name:string}|string}>} ships */
export function pledgeView(pledge, ships, aliases = null) {
  const items = (pledge.items ?? []).map((it) => ({ title: it.title, kind: it.kind ?? null, liner: it.liner ?? null, image: it.image ?? null }));
  const shipItems = items.filter((it) => it.kind === 'Ship');
  const shipList = shipItems.map((it) => {
    const shipId = aliasShipId(aliases, it.title) ?? findShipExact(ships, it.title)?.id ?? null;
    const m = shipId != null ? ships.get(shipId)?.manufacturer : null;
    return { title: it.title, shipId, manufacturer: (typeof m === 'string' ? m : m?.name) ?? it.liner ?? null };
  });
  const contained = shipItems.map((it) => norm(it.title));
  const named = mentionedShips(ships, pledge.name);
  const upgraded = named.length > 0 && contained.length > 0
    && !named.some((n) => contained.some((c) => c === n || c.includes(n) || n.includes(c)));
  return {
    pledgeId: pledge.pledgeId,
    name: pledge.name,
    category: classifyPledge(pledge),
    value: pledge.value ?? null,
    configurationValue: pledge.configurationValue ?? null,
    created: pledge.created ?? null,
    giftable: !!pledge.canGift,
    reclaimable: !!pledge.canReclaim,
    buybackable: !pledge.notBuybackable,
    ships: shipList,
    insurance: kindOf(pledge, 'Insurance')[0]?.title ?? null,
    items,
    image: pledge.image ?? null,
    upgraded,
  };
}

export const CATEGORIES = ['ccu', 'ship', 'package', 'paint', 'equipment', 'other'];

/** { count, byCategory, totalValue (USD cents), giftable, ships } */
export function hangarSummary(pledges) {
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  let totalValue = 0, giftable = 0, ships = 0;
  for (const p of pledges) {
    byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
    if (isUsd(p.value)) totalValue += p.value.cents;
    if (p.giftable) giftable++;
    ships += p.ships.length;
  }
  return { count: pledges.length, byCategory, totalValue, giftable, ships };
}

/** Months of an insurance title ("120 Months Insurance" → 120); Infinity for lifetime; 0 when unknown. */
const insuranceMonths = (title) => (!title ? 0 : /lifetime|\bLTI\b/i.test(title) ? Infinity : Number(/(\d+)\s*month/i.exec(title)?.[1] ?? 0));

/**
 * The ships you own, one entry per ship: from every ship and package pledge (CCUs, paints and items are not ships).
 * An upgraded pledge counts as the ship it holds now. Biggest ships (by store price) first, then by name.
 * @returns {{ key: string, shipId: number|null, name: string, manufacturer: string|null, count: number, pledgeIds: string[], insurance: string|null, lti: boolean }[]}
 */
export function ownedFleet(pledges, ships) {
  const byKey = new Map();
  for (const p of pledges) {
    if (p.category !== 'ship' && p.category !== 'package') continue;
    for (const s of p.ships) {
      const key = s.shipId != null ? `id:${s.shipId}` : `name:${norm(s.title)}`;
      const e = byKey.get(key) ?? { key, shipId: s.shipId, name: (s.shipId != null ? ships.get(s.shipId)?.name : null) ?? s.title, manufacturer: s.manufacturer ?? null, count: 0, pledgeIds: [], insurance: null };
      e.count++;
      e.pledgeIds.push(String(p.pledgeId));
      if (insuranceMonths(p.insurance) > insuranceMonths(e.insurance)) e.insurance = p.insurance;
      byKey.set(key, e);
    }
  }
  const msrp = (e) => (e.shipId != null ? ships.get(e.shipId)?.msrp ?? 0 : 0);
  return [...byKey.values()]
    .map((e) => ({ ...e, lti: insuranceMonths(e.insurance) === Infinity }))
    .sort((a, b) => msrp(b) - msrp(a) || a.name.localeCompare(b.name));
}
