// Planner data from raw RSI data. Pure: the caller reads the files (see
// src/data.mjs in Node, or the app's Rust backend) and passes them in.
//
// RawData = { catalog, details, upgrades, hangar, buyback, history, plans, overrides }
//   catalog   catalog.json
//   details   ship-details.json or null
//   upgrades  every upgrades/<fromId>.json content, as an array
//   hangar    hangar.json or null
//   buyback   buyback.json or null
//   history   offer-history.jsonl text ('' when absent)
//   saleHistory  sale-history.json or null (days each ship was seen on sale)
//   saleEvents   sale-events.json or null (the sale events you maintain)
//   warbondPrices  warbond-prices.json or null (lowest Warbond price seen per pair)
//   planSnapshots  plan-snapshots.json or null (the shared plan after each sync, written by scripts/sync.mjs)
//   plans, overrides  carried for callers; not used here

import { t } from './i18n.mjs';
import { norm } from './ships.mjs';
import { shipImageUrl, shipThumbs } from './images.mjs';
import { pledgeView } from './hangar.mjs';
import { ltiShips } from './tokens.mjs';
import { hasStandardSku } from './availability.mjs';
import { limitedShares } from './urgency.mjs';
import { normalizePricing } from './format.mjs';

// Items that are not part of the ship identity (insurance, paint, ...).
const EXTRA = /insurance|name reservation|paint|poster|jacket|figurine|model|decal|flair|trophy|coin|plaque/i;

/**
 * The two ships of an upgrade pledge title, "Upgrade - <from> to <to> <Warbond|Standard> Edition", by exact normalized
 * store name only. Null unless exactly one way of splitting at " to " names two known, unambiguous ships.
 * @param {string} name pledge title
 * @param {Map<string, number|null>} shipByName normalized store name -> ship ID (null = ambiguous)
 */
export function titleShips(name, shipByName) {
  const m = /^Upgrade - (.+) (?:Warbond|Standard) Edition$/i.exec(String(name ?? '').trim());
  if (!m) return null;
  const parts = m[1].split(' to ');
  const found = [];
  for (let i = 1; i < parts.length; i++) {
    const from = shipByName.get(norm(parts.slice(0, i).join(' to ')));
    const to = shipByName.get(norm(parts.slice(i).join(' to ')));
    if (from && to && from !== to) found.push({ from, to });
  }
  return found.length === 1 ? found[0] : null;
}

/** offer-history.jsonl text -> events. Blank and unreadable lines are skipped; a missing history gives []. */
export function parseHistory(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) out.push(v);
    } catch { /* a damaged line must not hide the rest */ }
  }
  return out;
}

/**
 * @param {object} raw RawData
 * @param {object} aliases parsed src/logic/aliases.json: { items: { [itemId]: { shipId } } }
 */
export function buildPlannerData(raw, aliases) {
  const catalog = raw.catalog;
  const ships = new Map(catalog.ships.map((s) => [s.id, { id: s.id, name: s.name, msrp: s.msrp, owned: s.owned, concept: s.flyableStatus === 'Concept', onSale: (s.skus?.length ?? 0) > 0, standard: hasStandardSku(s), manufacturer: s.manufacturer?.name ?? null, image: shipThumbs(raw.images?.images?.[s.id], s.id), imageUrl: shipImageUrl(raw.images?.images?.[s.id]?.url) }]));
  const details = raw.details ?? { details: {} };
  const hangar = raw.hangar ?? { entries: {} };
  const aliasItems = aliases?.items ?? {};

  // SKU titles (Standard/Warbond Edition) from offer details.
  const skuTitle = new Map();
  const skuLimited = new Map();
  for (const d of Object.values(details.details)) for (const s of d.skus) { skuTitle.set(s.id, s.title); skuLimited.set(s.id, !!s.limitedTimeOffer); }

  // When each offer (source ship + SKU) was first seen, from the offer history.
  const history = parseHistory(raw.history);
  // The EARLIEST "appeared" event of an offer, not the latest: the offer began then, and a later re-listing
  // (it vanished for a sync and came back) must not make an old Warbond look new. historyFrom is the
  // first event in the file: offers that appeared in the first sync were not "new", the history just began.
  const firstSeen = new Map();
  let historyFrom = null;
  for (const e of history) {
    if (typeof e.at === 'string' && (historyFrom == null || e.at < historyFrom)) historyFrom = e.at;
    if (e.event === 'appeared' && !firstSeen.has(`${e.fromId}:${e.skuId}`)) firstSeen.set(`${e.fromId}:${e.skuId}`, e.at);
  }

  // Item ID -> ship ID from offer details: items present in every SKU of a ship,
  // minus extras (insurance, paint, poster, name reservation, ...). An item that
  // remains for exactly one ship is that ship's item (e.g. "600i Exploration
  // Module" for 600i Explorer). Fallback: exact normalized name.
  const owners = new Map();
  for (const [shipId, d] of Object.entries(details.details)) {
    const sets = d.skus.map((s) => new Set((s.items ?? []).filter((it) => !EXTRA.test(it.title)).map((it) => it.id)));
    const common = sets.length ? [...sets[0]].filter((id) => sets.every((x) => x.has(id))) : [];
    for (const id of common) owners.set(id, [...(owners.get(id) ?? []), Number(shipId)]);
  }
  const itemToShip = new Map();
  for (const [itemId, list] of owners) if (list.length === 1) itemToShip.set(itemId, { shipId: list[0], method: 'item-id' });
  const shipByName = new Map();
  for (const s of ships.values()) {
    const k = norm(s.name);
    shipByName.set(k, shipByName.has(k) ? null : s.id); // null = ambiguous
  }
  const resolveItem = (item) => {
    if (itemToShip.has(item.id)) return itemToShip.get(item.id);
    if (aliasItems[item.id]) return { shipId: aliasItems[item.id].shipId, method: 'alias' };
    const byName = shipByName.get(norm(item.name));
    return byName ? { shipId: byName, method: 'name' } : null;
  };
  const unknownItem = (items) => {
    if (items.some((it) => shipByName.get(norm(it.name)) === null || (owners.get(it.id)?.length ?? 0) > 1)) return null;
    return items[0]?.name;
  };

  // Store offers.
  const offers = [];
  let inferredKinds = 0;
  for (const u of raw.upgrades) {
    for (const t of u.targets) {
      for (const s of t.skus) {
        if (!s.available || s.upgradeUsdCents == null) continue;
        const title = skuTitle.get(s.id) ?? null;
        let kind;
        if (title) kind = /warbond/i.test(title) ? 'warbond' : 'standard';
        else {
          // Unknown title: a price below the msrp delta is treated as a cash-only discount.
          const delta = (ships.get(t.toId)?.msrp ?? 0) - (ships.get(u.fromId)?.msrp ?? 0);
          kind = s.upgradeUsdCents < delta ? 'warbond' : 'standard';
          inferredKinds++;
        }
        offers.push({
          from: u.fromId, to: t.toId, kind, cash: s.upgradeUsdCents, skuId: s.id, title, fetchedAt: u.fetchedAt,
          limited: skuLimited.get(s.id) ?? null, firstSeen: firstSeen.get(`${u.fromId}:${s.id}`) ?? null,
        });
      }
    }
  }

  // Owned CCU copies from the hangar.
  const owned = [];
  const review = [];
  for (const e of Object.values(hangar.entries)) {
    if (e.goneSince) continue;
    const p = e.data;
    const u = p.upgrade;
    if (!u || u.parseError) continue;
    const shipItems = (items) => items.filter((it) => !EXTRA.test(it.name));
    const resolveOf = (items) => items.map((it) => ({ it, r: resolveItem(it) })).filter((x) => x.r);
    const uniqueShips = (list) => [...new Map(list.map((x) => [x.r.shipId, x])).values()];
    const matchItems = shipItems(u.match_items);
    const targetItems = shipItems(u.target_items);
    const from = uniqueShips(resolveOf(matchItems)).map((x) => x.r);
    const to = uniqueShips(resolveOf(targetItems));
    // RSI names hangar items its own way ("Hercules Starlifter M2"), but the pledge title uses the store's names
    // ("Upgrade - M2 Hercules to Liberator Warbond Edition"). A side the items cannot resolve takes the title's ship;
    // a side they resolve must agree with it.
    const title = titleShips(p.name, shipByName);
    let fromId = from.length === 1 ? from[0].shipId : null;
    let toId = to.length === 1 ? to[0].r.shipId : null;
    const conflict = title && ((fromId != null && fromId !== title.from) || (toId != null && toId !== title.to));
    const fromTitle = title && !conflict && fromId == null;
    const toTitle = title && !conflict && toId == null;
    if (fromTitle) fromId = title.from;
    if (toTitle) toId = title.to;
    if (fromId == null || toId == null || conflict) {
      const unknownShip = !conflict && from.length <= 1 && to.length <= 1
        ? (fromId == null ? unknownItem(matchItems) : null) ?? (toId == null ? unknownItem(targetItems) : null)
        : null;
      review.push({
        pledgeId: p.pledgeId, name: p.name,
        ...(unknownShip ? { unknownShip } : {}),
        // Review entries survive language switches with the mapped Hangar data.
        get reason() {
          if (conflict) return t('the item IDs and the title name different ships');
          if (unknownShip) return t('RSI’s upgrade tool does not sell {name}. Plans cannot use this upgrade.', { name: unknownShip });
          return t('from matches {from}, ship targets {to}', { from: from.length, to: to.length });
        },
        match: u.match_items, target: u.target_items,
        // The side that did resolve, so a plan can say which goal an unreadable upgrade may belong to.
        fromShip: from.length === 1 ? from[0].shipId : null, toShip: to.length === 1 ? to[0].r.shipId : null,
      });
      continue;
    }
    const byName = fromTitle || toTitle || from[0].method === 'name' || to[0].r.method === 'name';
    owned.push({
      copyId: String(p.pledgeId),
      from: fromId,
      to: toId,
      name: p.name,
      edition: /warbond/i.test(p.name) ? 'Warbond' : /standard/i.test(p.name) ? 'Standard' : 'Other',
      paid: p.value,
      giftable: p.canGift,
      meltable: p.canReclaim,
      matchMethod: fromTitle || toTitle ? 'title' : byName ? 'name' : 'item-id',
      extras: toTitle ? u.target_items.filter((it) => EXTRA.test(it.name)).map((it) => it.name) : u.target_items.filter((it) => it.id !== to[0].it.id).map((it) => it.name),
    });
  }

  // Every pledge in the hangar, with its category (ships keep their manufacturer for display).
  const shipsWithMaker = new Map(catalog.ships.map((s) => [s.id, { id: s.id, name: s.name, manufacturer: s.manufacturer }]));
  const pledges = Object.values(hangar.entries).filter((e) => !e.goneSince && e.data).map((e) => pledgeView(e.data, shipsWithMaker, aliases));

  const buybackEntries = raw.buyback?.entries;
  const buyback = Array.isArray(buybackEntries) ? buybackEntries : Object.values(buybackEntries ?? {});

  // The store's currency: callers that load data (the app, the CLI) hand it to setPricing() so money() uses it, and refuse
  // accounts the planner does not support (currencyProblem). Building data never changes the formatter.
  const pricing = normalizePricing(catalog.app?.pricing);

  return {
    pricing, ships, offers, owned, review, buyback, pledges, history, lti: ltiShips(hangar, ships, aliases),
    saleHistory: raw.saleHistory ?? null, saleEvents: raw.saleEvents ?? null, warbondPrices: raw.warbondPrices ?? null,
    planSnapshots: Array.isArray(raw.planSnapshots?.snapshots) ? raw.planSnapshots.snapshots : [],
    meta: {
      catalogAt: catalog.fetchedAt, hangarAt: hangar.lastSync, hangarFullAt: hangar.lastFullSync,
      offers: offers.length, inferredKinds, limitedShare: limitedShares(offers), historyFrom, owned: owned.length, review: review.length,
    },
  };
}
