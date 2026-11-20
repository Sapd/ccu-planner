// A fictional account for README screenshots. Prices are illustrative USD pledge values.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { addSaleEvent, emptySaleEvents, localToday } from '../src/logic/availability.mjs';
import { acceptRoute, addChain, newState } from '../src/logic/goals.mjs';
import { buildPlannerData } from '../src/logic/mapping.mjs';
import { buildGraph } from '../src/logic/planner.mjs';
import { emptyOverrides } from '../src/logic/prices.mjs';
import { recordWarbondPrices } from '../src/logic/salePrices.mjs';
import { createSession, planningGraph } from '../src/logic/session.mjs';

// RSI's own ship ids (public upgrade-tool list), so the app finds each ship's picture in the project's data feed.
const RSI_SHIP_ID = { 'Aurora Mk I MR': 4, 'Mustang Alpha': 65, 'Cutter': 242, 'C8X Pisces Expedition': 192, 'Avenger Titan': 102, 'Hull A': 84, 'Gladius': 60, 'Freelancer': 16, 'Cutlass Black': 56, 'C1 Spirit': 234, 'Vulture': 165, 'Constellation Mk IV Taurus': 46, 'Constellation Mk IV Andromeda': 45, 'Corsair': 178, 'Mercury': 168, 'Vanguard Warden': 75, 'C2 Hercules': 162, '600i Explorer': 141, 'Hull C': 41, 'Carrack': 62, 'Liberator': 224, 'Perseus': 217, 'Polaris': 116 };

const ships = [
  ['Aurora Mk I MR', 'Roberts Space Industries', 30, 'regular'],
  ['Mustang Alpha', 'Consolidated Outland', 30, 'regular'],
  ['Cutter', 'Drake Interplanetary', 45, 'regular'],
  ['C8X Pisces Expedition', 'Anvil Aerospace', 45, 'regular'],
  ['Avenger Titan', 'Aegis Dynamics', 60, 'regular'],
  ['Hull A', 'Musashi Industrial and Starflight Concern', 90, 'regular'],
  ['Gladius', 'Aegis Dynamics', 90, 'regular'],
  ['Freelancer', 'Musashi Industrial and Starflight Concern', 110, 'regular'],
  ['Cutlass Black', 'Drake Interplanetary', 110, 'regular'],
  ['C1 Spirit', 'Crusader Industries', 125, 'regular'],
  ['Vulture', 'Drake Interplanetary', 175, 'regular'],
  ['Constellation Mk IV Taurus', 'Roberts Space Industries', 200, 'regular'],
  ['Constellation Mk IV Andromeda', 'Roberts Space Industries', 240, 'regular'],
  ['Corsair', 'Drake Interplanetary', 250, 'event'],
  ['Mercury', 'Crusader Industries', 260, 'event'],
  ['Vanguard Warden', 'Aegis Dynamics', 260, 'event'],
  ['C2 Hercules', 'Crusader Industries', 400, 'event'],
  ['600i Explorer', 'Origin Jumpworks', 475, 'event'],
  ['Hull C', 'Musashi Industrial and Starflight Concern', 500, 'event'],
  ['Carrack', 'Anvil Aerospace', 600, 'event'],
  ['Liberator', 'Anvil Aerospace', 575, 'concept'],
  ['Perseus', 'Roberts Space Industries', 675, 'event'],
  ['Polaris', 'Roberts Space Industries', 975, 'event'],
].map(([name, maker, usd, availability]) => ({
  id: RSI_SHIP_ID[name], name, manufacturer: { name: maker }, msrp: usd * 100, availability,
}));

const byName = new Map(ships.map((ship) => [ship.name, ship]));
const itemId = (ship) => ship.id + 10000;
const standardId = (ship) => ship.id + 20000;
const warbondId = (ship) => ship.id + 30000;
const item = (ship) => ({ id: itemId(ship), name: ship.name });
const money = (usd) => ({ cents: usd * 100, currency: 'USD' });

export async function writeDemoData(dir, now = new Date()) {
  // Keep this sale current whenever the demo is rebuilt.
  const day = (offset) => {
    const date = new Date(now);
    date.setDate(date.getDate() + offset);
    return localToday(date);
  };
  const daysAgo = (days) => new Date(now.getTime() - days * 86400000).toISOString();
  const fetchedAt = daysAgo(0);
  const pricing = { currencyCode: 'USD', currencySymbol: '$', exponent: 2, taxRate: 0 };
  const { doc: saleEvents } = addSaleEvent(emptySaleEvents(), {
    name: 'Ship Expo', from: day(-4), to: day(5),
  });

  const entries = {};
  const addPledge = (pledge, age) => {
    const pledgeId = 170001 + Object.keys(entries).length;
    const created = daysAgo(age);
    entries[pledgeId] = {
      firstSeen: daysAgo(32), lastSeen: fetchedAt,
      data: { pledgeId, created, canReclaim: true, upgrade: null, ...pledge },
    };
    return pledgeId;
  };
  const addShip = (name, value, insurance, age, isPackage = false) => addPledge({
    name: isPackage ? `Package - ${name} Starter Pack` : `Standalone Ship - ${name}`,
    value: money(value), canGift: !isPackage,
    items: [
      { kind: 'Ship', title: name }, { kind: 'Insurance', title: insurance },
      ...(isPackage ? [{ kind: 'Game', title: 'Star Citizen Digital Download' }] : []),
    ],
  }, age);
  const cutter = addShip('Cutter', 40, 'Lifetime Insurance', 310);
  addShip('C8X Pisces Expedition', 40, 'Lifetime Insurance', 212);
  addShip('Cutter', 40, 'Lifetime Insurance', 187);
  addShip('Avenger Titan', 55, '120 Months Insurance', 146);
  addShip('Cutlass Black', 100, '120 Months Insurance', 89);
  addShip('Vulture', 155, '120 Months Insurance', 101);
  addShip('Hull C', 425, 'Lifetime Insurance', 118);
  addShip('Mustang Alpha', 45, '3 Months Insurance', 420, true);
  const ownedNames = new Set(Object.values(entries).map(({ data }) => data.items[0].title));
  addPledge({
    name: 'Paints - Cutter Harbor Gray Paint', value: money(5), canGift: true,
    items: [{ kind: 'Skin', title: 'Cutter Harbor Gray Paint' }],
  }, 65);

  const ownedUpgrades = [
    ['Cutter', 'Hull A', 25, 'Warbond'],
    ['Hull A', 'Freelancer', 10, 'Warbond'],
    ['C8X Pisces Expedition', 'Gladius', 25, 'Warbond'],
    ['Gladius', 'Cutlass Black', 20, 'Standard'],
    ['Cutlass Black', 'Vulture', 45, 'Warbond'],
    ['Vulture', 'Constellation Mk IV Taurus', 15, 'Warbond'],
    ['Corsair', 'C2 Hercules', 105, 'Warbond'],
    ['C2 Hercules', '600i Explorer', 45, 'Warbond'],
    ['600i Explorer', 'Hull C', 25, 'Standard'],
    ['Carrack', 'Perseus', 75, 'Standard'],
    ['Avenger Titan', 'Gladius', 30, 'Standard'],
  ];
  ownedUpgrades.forEach(([from, to, paid, edition], index) => addPledge({
    name: `Upgrade - ${from} to ${to} ${edition} Edition`,
    value: money(paid), canGift: edition === 'Warbond',
    upgrade: { match_items: [item(byName.get(from))], target_items: [item(byName.get(to))] },
  }, 49 + index * 13));

  // Each Warbond is a discount off the target's value, with a $5 minimum CCU price.
  const discounts = new Map([
    ['C1 Spirit', 10],
    ['Corsair', 20],
    ['Mercury', 15],
    ['Carrack', 50],
  ]);
  const standardTitle = (ship) => `${ship.name} Standard Edition`;
  const catalog = {
    fetchedAt, app: { pricing },
    manufacturers: [...new Set(ships.map((ship) => ship.manufacturer.name))].map((name) => ({ name })),
    ships: ships.map(({ availability, ...ship }) => ({
      ...ship, owned: ownedNames.has(ship.name),
      flyableStatus: availability === 'concept' ? 'Concept' : 'Flyable',
      skus: [{ id: standardId(ship), title: standardTitle(ship) }],
    })),
  };
  const details = {
    fetchedAt, shipItem: {}, unresolved: [],
    details: Object.fromEntries(ships.map((ship) => {
      const items = [{ id: itemId(ship), title: ship.name }];
      const skus = [{ id: standardId(ship), title: standardTitle(ship), limitedTimeOffer: false, items }];
      if (discounts.has(ship.name)) {
        skus.push({ id: warbondId(ship), title: `${ship.name} Warbond Edition`, limitedTimeOffer: false, items });
      }
      return [ship.id, { probedFrom: ship.id, skus }];
    })),
  };
  const upgrades = ships.map((from) => ({
    fetchedAt, fromId: from.id, fromName: from.name, pricing,
    targets: ships.filter((to) => to.msrp > from.msrp).map((to) => {
      const price = to.msrp - from.msrp;
      const discounted = price - (discounts.get(to.name) ?? 0) * 100;
      const skus = [{ id: standardId(to), available: true, upgradeUsdCents: price }];
      if (discounted < price && discounted >= 500) {
        skus.push({ id: warbondId(to), available: true, upgradeUsdCents: discounted });
      }
      return { toId: to.id, toName: to.name, skus };
    }),
  }));
  const historicalOffer = (from, to, usd) => ({
    fromId: byName.get(from).id, toId: byName.get(to).id, skuId: warbondId(byName.get(to)), cash: usd * 100,
  });
  const events = [
    { at: daysAgo(48), event: 'appeared', ...historicalOffer('C2 Hercules', '600i Explorer', 45) },
    { at: daysAgo(42), event: 'disappeared', ...historicalOffer('C2 Hercules', '600i Explorer', 45) },
    { at: daysAgo(4), event: 'appeared', ...historicalOffer('Freelancer', 'C1 Spirit', 5) },
    { at: daysAgo(4), event: 'appeared', ...historicalOffer('Hull C', 'Carrack', 50) },
    { at: daysAgo(0.25), event: 'appeared', ...historicalOffer('Constellation Mk IV Taurus', 'Corsair', 30) },
  ];
  const history = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
  const saleHistory = { ships: Object.fromEntries(ships.map((ship) => [
    ship.id, { onSaleDays: ship.availability === 'regular' ? [day(-32), day(-16), day(0)] : [day(-4), day(0)] },
  ])) };
  const overrides = emptyOverrides();
  overrides.pairs = {
    [`${byName.get('Constellation Mk IV Taurus').id}-${byName.get('Corsair').id}`]: { until: day(1) },
  };
  const hangar = { lastSync: fetchedAt, lastFullSync: daysAgo(2), entries };
  const plans = newState();
  plans.profile.credit = 3500;
  plans.profile.virtualCcus = [{
    id: 'v1', from: byName.get('Gladius').id, to: byName.get('Liberator').id,
    cents: 44000, copies: 1, expires: day(21),
  }];
  const goal = (target, start, priority, mode, age) => {
    const chain = addChain(plans, { name: target, start, target: byName.get(target).id, priority, mode });
    chain.createdAt = daysAgo(age);
    return chain;
  };
  const fixed = (name) => ({ kind: 'ship', ship: byName.get(name).id });
  const corsair = goal('Corsair', { kind: 'token', pledgeId: String(cutter) }, 'high', 'watch', 32);
  goal('Constellation Mk IV Andromeda', fixed('Vulture'), 'normal', 'finish', 23);
  goal('Carrack', { kind: 'token' }, 'normal', 'watch', 17);
  goal('Polaris', fixed('Hull C'), 'low', 'watch', 9);

  const data = buildPlannerData({ catalog, details, upgrades, hangar, history, saleHistory });
  const graph = planningGraph(buildGraph(data), plans);
  const session = createSession({ plans, graph, data, overrides, saleEvents });
  const route = session.route(corsair.id);
  if (!route) throw new Error('The demo Corsair goal has no route');
  acceptRoute(plans, corsair.id, route, { acceptedAt: daysAgo(0.1) }, { graph });

  const buyback = { lastSync: fetchedAt, lastFullSync: fetchedAt, entries: {
    180001: { pledgeId: 180001, name: 'Standalone Ship - Aurora Mk I MR', value: money(30), contained: 'Aurora Mk I MR' },
  } };
  const warbondPrices = recordWarbondPrices(null, data.offers, day(0));
  const pastWarbond = historicalOffer('C2 Hercules', '600i Explorer', 45);
  warbondPrices.pairs[`${pastWarbond.fromId}-${pastWarbond.toId}`] = {
    at: day(-48), cash: pastWarbond.cash, skuId: pastWarbond.skuId,
  };
  const files = {
    'catalog.json': catalog,
    'ship-details.json': details,
    'hangar.json': hangar,
    'buyback.json': buyback,
    'plans.json': plans,
    'price-overrides.json': overrides,
    'sale-events.json': saleEvents,
    'sale-history.json': saleHistory,
    'warbond-prices.json': warbondPrices,
    'ship-images.json': { fetchedAt, images: {} },
    'plan-snapshots.json': { version: 1, snapshots: [] },
    'offer-history.jsonl': history,
  };
  await mkdir(path.join(dir, 'upgrades'), { recursive: true });
  await mkdir(path.join(dir, 'images'), { recursive: true });
  const put = (name, value) => writeFile(path.join(dir, name),
    typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  for (const [name, value] of Object.entries(files)) await put(name, value);
  for (const upgrade of upgrades) await put(`upgrades/${upgrade.fromId}.json`, upgrade);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) {
    console.error('Usage: node scripts/demo-data.mjs <new data directory>');
    process.exitCode = 1;
  } else {
    await writeDemoData(path.resolve(process.argv[2]));
  }
}
