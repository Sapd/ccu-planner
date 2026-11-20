import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPledge, pledgeView, hangarSummary } from '../src/logic/hangar.mjs';
import { buildPlannerData } from '../src/logic/mapping.mjs';
import { parseHangarPage } from '../src/parse.mjs';
import raw from './fixtures/raw-small.json' with { type: 'json' };

const ships = new Map([
  [1, { id: 1, name: 'Avenger Titan', manufacturer: { name: 'Aegis Dynamics' } }],
  [2, { id: 2, name: 'A1 Spirit', manufacturer: { name: 'Crusader Industries' } }],
  [3, { id: 3, name: 'Khartu-Al', manufacturer: { name: 'Xi\'an' } }],
  [4, { id: 4, name: 'Avenger Stalker' }],
  [5, { id: 5, name: 'Avenger Warlock' }],
]);
const item = (title, kind = null, liner = null) => ({ title, kind, liner });
const pledge = (name, items, extra = {}) => ({ pledgeId: 1, name, value: { cents: 6300, currency: 'USD' }, canGift: true, canReclaim: true, notBuybackable: false, upgrade: null, items, ...extra });
const titanPack = pledge('Package - Avenger Titan Starter Pack', [
  item('Avenger Titan', 'Ship', 'Aegis Dynamics (AEGS)'), item('Star Citizen Digital Download'), item('Starting Money: 1,000 UEC', 'Credits'),
  item('120 Month Insurance', 'Insurance'), item('Avenger - Blue Paint', 'Skin'), item('Aeroview Hangar'),
]);

test('a ship with digital download is a package with insurance and ship', () => {
  assert.equal(classifyPledge(titanPack), 'package');
  const v = pledgeView(titanPack, ships);
  assert.equal(v.category, 'package');
  assert.equal(v.insurance, '120 Month Insurance');
  assert.equal(v.ships[0].title, 'Avenger Titan');
  assert.equal(v.ships[0].shipId, 1);
  assert.equal(v.ships[0].manufacturer, 'Aegis Dynamics');
  assert.equal(v.items.length, 6);
  assert.equal(v.upgraded, false);
  assert.equal(v.buybackable, true);
});

test('categories: ccu, ship, paint, equipment, other', () => {
  assert.equal(classifyPledge(pledge('Upgrade - A to B', [], { upgrade: { match_items: [] } })), 'ccu');
  assert.equal(classifyPledge(pledge('Standalone', [item('A1 Spirit', 'Ship'), item('Lifetime Insurance', 'Insurance')])), 'ship');
  assert.equal(classifyPledge(pledge('Paint', [item('Blue Paint', 'Skin')])), 'paint');
  assert.equal(classifyPledge(pledge('Gear', [item('Armor', 'FPS Equipment'), item('Gun', 'Component')])), 'equipment');
  assert.equal(classifyPledge(pledge('Poster', [item('Poster', 'Hangar decoration')])), 'other');
  assert.equal(classifyPledge(pledge('Empty', [])), 'other');
});

test('a CCU applied to a pledge marks it upgraded', () => {
  const p = pledge('Standalone Ship - Khartu-Al', [item('A1 Spirit', 'Ship'), item('Lifetime Insurance', 'Insurance')]);
  const v = pledgeView(p, ships);
  assert.equal(v.upgraded, true);
  assert.equal(v.insurance, 'Lifetime Insurance');
  assert.equal(pledgeView(pledge('Standalone Ship - A1 Spirit', [item('A1 Spirit', 'Ship')]), ships).upgraded, false);
});

test('unknown or ambiguous ship titles get shipId null', () => {
  assert.equal(pledgeView(pledge('X', [item('Mystery Hauler', 'Ship', 'Nobody (NOB)')]), ships).ships[0].shipId, null);
  const amb = pledgeView(pledge('X', [item('Avenger', 'Ship', 'Aegis Dynamics (AEGS)')]), ships).ships[0];
  assert.equal(amb.shipId, null);
  assert.equal(amb.manufacturer, 'Aegis Dynamics (AEGS)');
});

test('alias names resolve ships that exact names do not', () => {
  const aliases = { items: { 9: { shipId: 2, itemName: 'Spirit - Variant X', shipName: 'A1 Spirit' } } };
  assert.equal(pledgeView(pledge('X', [item('Spirit - Variant X', 'Ship')]), ships, aliases).ships[0].shipId, 2);
});

test('hangarSummary counts categories and totals cents', () => {
  const list = [
    pledgeView(titanPack, ships),
    pledgeView(pledge('Paint', [item('Blue Paint', 'Skin')], { value: { cents: 1000, currency: 'USD' }, canGift: false }), ships),
    pledgeView(pledge('Odd', [item('Poster', 'Hangar decoration')], { value: { cents: 500, currency: 'Store Credit' } }), ships),
  ];
  const s = hangarSummary(list);
  assert.equal(s.count, 3);
  assert.equal(s.byCategory.package, 1);
  assert.equal(s.byCategory.paint, 1);
  assert.equal(s.byCategory.other, 1);
  assert.equal(s.byCategory.ccu, 0);
  assert.equal(s.totalValue, 7300);
  assert.equal(s.giftable, 2);
  assert.equal(s.ships, 1);
});

test('buildPlannerData returns a pledge view for every non-gone hangar entry and keeps owned unchanged', () => {
  const withHangar = structuredClone(raw);
  const base = buildPlannerData(withHangar, { items: {} });
  assert.ok(Array.isArray(base.pledges));
  const h = { entries: { a: { data: titanPack }, b: { data: { ...titanPack, pledgeId: 2 }, goneSince: '2026-01-01' } } };
  const d = buildPlannerData({ ...withHangar, hangar: h }, { items: {} });
  assert.equal(d.pledges.length, 1);
  assert.equal(d.pledges[0].category, 'package');
});

test('parseHangarPage reads pledge and item pictures, https only', () => {
  const html = `<ul><li>
    <input class="js-pledge-id" value="7"><input class="js-pledge-name" value="Test Pledge">
    <div class="image" style="background-image:url('/media/abc/thumb.jpg')"></div>
    <div class="items">
      <div class="item"><div class="image" style="background-image:url(https://cdn.example.com/a.jpg)"></div><div class="title">Ship A</div><div class="kind">Ship</div></div>
      <div class="item"><img class="image" src="http://insecure.example.com/b.jpg"><div class="title">Thing</div></div>
      <div class="item"><div class="title">Plain</div></div>
    </div></li></ul>`;
  const [p] = parseHangarPage(html);
  assert.equal(p.image, 'https://robertsspaceindustries.com/media/abc/thumb.jpg');
  assert.equal(p.items[0].image, 'https://cdn.example.com/a.jpg');
  assert.equal(p.items[1].image, undefined);
  assert.equal(p.items[2].image, undefined);
  assert.equal(parseHangarPage(html.replace(/<div class="image" style="background-image:url\('\/media[^<]*<\/div>/, ''))[0].image, undefined);
});

import { isUsd } from '../src/logic/hangar.mjs';
import { valueLabel, filterPledges } from '../app/src/lib/view/hangar.mjs';

test('null and USD currency agree in the total and the label', () => {
  assert.equal(isUsd({ cents: 500, currency: null }), true);
  assert.equal(isUsd({ cents: 500, currency: 'USD' }), true);
  assert.equal(isUsd({ cents: 500, currency: 'EUR' }), false);
  const mk = (currency) => pledgeView(pledge('P', [item('Poster', 'Hangar decoration')], { value: { cents: 500, currency } }), ships);
  assert.equal(hangarSummary([mk(null)]).totalValue, 500);
  assert.equal(hangarSummary([mk('USD')]).totalValue, 500);
  assert.equal(hangarSummary([mk('EUR')]).totalValue, 0);
  assert.equal(valueLabel({ cents: 500, currency: null }), valueLabel({ cents: 500, currency: 'USD' }));
  assert.equal(valueLabel({ cents: 500, currency: 'USD' }), '$5');
  assert.equal(valueLabel({ cents: 500, currency: 'EUR' }), 'EUR 5.00');
  assert.equal(valueLabel({ cents: 500, currency: 'Store Credit' }), '500 (Store Credit cents)');
  assert.equal(valueLabel(null), '?');
});

test('ship titles never match by substring; aliases must agree', () => {
  const only = new Map([[1, { id: 1, name: 'Avenger Titan' }]]);
  assert.equal(pledgeView(pledge('X', [item('Titan', 'Ship')]), only).ships[0].shipId, null);
  assert.equal(pledgeView(pledge('X', [item('avenger  TITAN', 'Ship')]), only).ships[0].shipId, 1);
  const conflict = { items: { 1: { shipId: 1, itemName: 'Odd Ship' }, 2: { shipId: 2, itemName: 'odd ship' } } };
  assert.equal(pledgeView(pledge('X', [item('Odd Ship', 'Ship')]), ships, conflict).ships[0].shipId, null);
  const agree = { items: { 1: { shipId: 2, itemName: 'Odd Ship' }, 2: { shipId: 2, itemName: 'odd ship' } } };
  assert.equal(pledgeView(pledge('X', [item('Odd Ship', 'Ship')]), ships, agree).ships[0].shipId, 2);
});

test('ccu wins over package-style pledges; package regex variants', () => {
  const withUpgrade = { ...titanPack, upgrade: { match_items: [] } };
  assert.equal(classifyPledge(withUpgrade), 'ccu');
  for (const t of ['Squadron 42 Digital Download', 'Some Game Package']) {
    assert.equal(classifyPledge(pledge('P', [item('A1 Spirit', 'Ship'), item(t)])), 'package');
  }
  assert.equal(classifyPledge(pledge('P', [item('A1 Spirit', 'Ship'), item('Plain Hangar')])), 'ship');
});

test('filterPledges filters by chip and query', () => {
  const list = [pledgeView(titanPack, ships), pledgeView(pledge('Blue Paint Pack', [item('Blue Paint', 'Skin')]), ships)];
  assert.equal(filterPledges(list, 'all').length, 2);
  assert.deepEqual(filterPledges(list, 'ships').map((p) => p.category), ['package']);
  assert.deepEqual(filterPledges(list, 'paint').map((p) => p.category), ['paint']);
  assert.equal(filterPledges(list, 'all', 'aeroview').length, 1);
  assert.equal(filterPledges(list, 'ships', 'blue').length, 1);
  assert.equal(filterPledges(list, 'ships', 'poster').length, 0);
  assert.equal(filterPledges(list, 'all', '  ').length, 2);
  assert.equal(filterPledges(list, 'all', 'aegis titan').length, 1, 'words may match the name and the manufacturer');
  assert.equal(filterPledges(list, 'all', 'aegis poster').length, 0, 'every word must match the same pledge');
});

test('a page without pictures parses to the old shape (no image keys)', () => {
  const html = '<ul><li><input class="js-pledge-id" value="7"><input class="js-pledge-name" value="P"><div class="items"><div class="item"><div class="title">T</div><div class="kind">Ship</div></div></div></li></ul>';
  const [p] = parseHangarPage(html);
  assert.equal('image' in p, false);
  assert.equal('image' in p.items[0], false);
});
