import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './support/mcp-world.mjs';
import { copy } from './support/ladder.mjs';
import { TOOLS, toolsFor, ToolError } from '../src/mcp/tools.mjs';

const tool = (name) => TOOLS.find((t) => t.name === name).handler;
const run = (name, deps, args = {}, ctx = {}) => tool(name)(deps, args, ctx);
// Pulse(1) $50, Hercules(2) $75, Carrack(3) $100, Liberator(4) $150, Ironclad(5) $200
const base = (extra = {}) => world({ goals: [{ base: 1, target: 4, mode: 'finish' }, { base: 1, target: 3 }], owned: [copy('x', 1, 3)], ...extra });

test('the tool table: write tools only with allowWrites, the sync tools always', () => {
  const names = (o) => toolsFor(o).map((t) => t.name);
  const read = ['today', 'goals', 'goal', 'changes_since_sync', 'what_if', 'check_offer', 'compare_ccugame', 'hangar_ccus_into', 'virtual_ccus', 'owned_ccus', 'lti_tokens', 'settings', 'sale_events', 'melt_advice', 'alternative_routes', 'sync_hangar', 'sync_store'];
  assert.deepEqual(names({}), read);
  assert.deepEqual(names({ allowWrites: true }), [...read, 'add_goal', 'remove_goal', 'accept', 'lock', 'unlock', 'set_credit', 'price_override', 'set_start', 'set_token_settings', 'mark_token', 'exclude_copy', 'set_virtual_ccu', 'remove_virtual_ccu', 'set_via', 'release', 'set_mode', 'set_objective', 'set_priority', 'set_availability', 'set_offer_end', 'add_sale_event', 'remove_sale_event', 'accept_fleet', 'import_goals']);
});

test('no tool source mentions anything that buys, melts, gifts, applies or touches the cart', () => {
  // The server has no such code: the only RSI access is the read-only client through the shared sync core.
  for (const t of TOOLS) assert.doesNotMatch(`${t.name} ${t.raw}`, /\b(buyback|addToCart|applyUpgrade|reclaim|gift\(|melt\()/i);
});

test('today: the buy list with ship names, counts and payment', async () => {
  const w = base();
  const r = await run('today', w.deps);
  assert.match(r.text, /Carrack → Liberator Standard \$50/);
  assert.match(r.text, /store credit works/);
  assert.equal(r.data.empty, false);
  assert.ok(r.data.buy.length > 0);
  for (const row of r.data.buy) assert.ok(row.fromName && row.toName && row.count >= 1 && row.payment);
});

test('today: no goals', async () => {
  const r = await run('today', world({ goals: [] }).deps);
  assert.match(r.text, /No goals yet/);
});

test('goals and goal: names, cost alone vs shared, steps with their state', async () => {
  const w = base();
  const g = await run('goals', w.deps);
  assert.match(g.text, /Liberator \[c1\]/);
  assert.match(g.text, /Carrack \[c2\]/);
  assert.equal(g.data.goals.length, 2);
  assert.equal(g.data.totalCash, g.data.goals.reduce((n, x) => n + (x.cash ?? 0), 0));
  const byName = await run('goal', w.deps, { goal: 'carrack' });
  const byId = await run('goal', w.deps, { goal: 'c2' });
  assert.equal(byName.text, byId.text);
  assert.match(byName.text, /Route, step by step/);
  assert.match(byName.text, /Cost:/);
  assert.ok(byName.data.steps.length > 0);
  for (const s of byName.data.steps) assert.ok(s.fromName && s.toName);
  const lib = await run('goal', w.deps, { goal: 'Liberator' });
  assert.ok(lib.data.sharedExtra == null || typeof lib.data.sharedExtra === 'number');
  await assert.rejects(run('goal', w.deps, { goal: 'Idris' }), ToolError);
});

test('goal: a goal that pays more because another goal holds the CCU says who and what', async () => {
  const w = world({ goals: [{ base: 1, target: 4, priority: 'high' }, { base: 1, target: 3 }], owned: [copy('x', 1, 3)] });
  const r = await run('goal', w.deps, { goal: 'Carrack' });
  assert.match(r.text, /more than on its own/);
  assert.match(r.text, /Liberator uses your Pulse → Carrack CCU/);
  assert.ok(r.data.aloneCash < r.data.cash);
});

test('changes_since_sync: nothing to compare without a snapshot', async () => {
  const r = await run('changes_since_sync', base().deps);
  assert.equal(r.data.changes, null);
  assert.match(r.text, /nothing to compare/);
});

test('what_if: each kind of change, nothing saved', async () => {
  const w = base();
  const rev = w.disk.plans.rev;
  const add = await run('what_if', w.deps, { add_goal: { target: 'Ironclad' } });
  assert.match(add.text, /Ironclad/);
  assert.match(add.text, /nothing was saved/);
  assert.equal(add.data.added.length, 1);
  const rem = await run('what_if', w.deps, { remove_goal: 'Carrack' });
  assert.match(rem.text, /^Without Carrack/);
  const buy = await run('what_if', w.deps, { buy: { from: 'Pulse', to: 'Hercules', price: 10, kind: 'warbond', copies: 2 } });
  assert.match(buy.text, /2 copies \(\$20\)/);
  assert.equal(buy.data.purchase.copies, 2);
  const price = await run('what_if', w.deps, { price: { ship: 'Liberator', price: 200 } });
  assert.match(price.text, /If Liberator cost \$200 \(RSI: \$150\)/);
  assert.equal(w.disk.plans.rev, rev);
  assert.deepEqual(w.saves, []);
});

test('what_if: exactly one change, bounded copies, unknown ships, cancellation', async () => {
  const w = base();
  await assert.rejects(run('what_if', w.deps, {}), /exactly one change/);
  await assert.rejects(run('what_if', w.deps, { remove_goal: 'c1', add_goal: { target: 'Ironclad' } }), /exactly one change/);
  await assert.rejects(run('what_if', w.deps, { buy: { from: 'Pulse', to: 'Hercules', price: 10, copies: 50 } }), /At most 5/);
  await assert.rejects(run('what_if', w.deps, { add_goal: { target: 'Nonexistent' } }), ToolError);
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(run('what_if', w.deps, { remove_goal: 'c1' }, { signal: ac.signal }), /Cancelled/);
});

test('check_offer: structured and free text', async () => {
  const w = base();
  const r = await run('check_offer', w.deps, { from: 'Pulse', to: 'Carrack', price: 20, kind: 'warbond' });
  assert.match(r.text, /Pulse → Carrack Warbond \$20/);
  assert.match(r.text, /You own 1 copy of this CCU/);
  assert.equal(r.data.offers[0].copies.length, 1);
  const t = await run('check_offer', w.deps, { text: 'Pulse → Hercules $20\nnot an offer at all' });
  assert.equal(t.data.offers.length, 1);
  assert.match(t.text, /assumed Warbond/);
  await assert.rejects(run('check_offer', w.deps, { text: 'hello' }), /No offer found/);
  await assert.rejects(run('check_offer', w.deps, { from: 'Pulse' }), /Give from, to and price/);
  await assert.rejects(run('check_offer', w.deps, { from: 'Liberator', to: 'Pulse', price: 5 }), /does not cost more/);
});

test('compare_ccugame: reads only the given .json file', async () => {
  const w = base();
  const path = fileURLToPath(new URL('./fixtures/ccugame-compare-chains.json', import.meta.url));
  const r = await run('compare_ccugame', w.deps, { path });
  assert.match(r.text, /Matched/);
  assert.ok(r.data.rows.length > 0);
  await assert.rejects(run('compare_ccugame', w.deps, { path: '/etc/hosts' }), /\.json/);
  await assert.rejects(run('compare_ccugame', w.deps, { path: '/no/such/file.json' }), /Could not read/);
  const bad = { ...w.deps, readFile: () => '{"nope":1}' };
  await assert.rejects(run('compare_ccugame', bad, { path: 'x.json' }), ToolError);
});

test('hangar_ccus_into: the owned copies and what each is used for', async () => {
  const w = base();
  const r = await run('hangar_ccus_into', w.deps, { ship: 'Carrack' });
  assert.match(r.text, /You own 1 CCU\(s\) into Carrack/);
  assert.match(r.text, /Pulse → Carrack x1/);
  assert.equal(r.data.groups[0].fromName, 'Pulse');
  const none = await run('hangar_ccus_into', w.deps, { ship: 'Ironclad' });
  assert.equal(none.data.total, 0);
});

test('sync tools: a clear message without a stored session, progress with one', async () => {
  const w = base();
  await assert.rejects(run('sync_store', w.deps, {}), /No stored RSI session.*never asks for or accepts a password/);
  assert.deepEqual(w.state.runs, []);
  w.state.syncAvailable = true;
  const events = [];
  const r = await run('sync_store', w.deps, { full: true }, { progress: (e) => events.push(e) });
  assert.deepEqual(w.state.runs, [{ cmd: 'upgrades', options: { full: true } }]);
  assert.deepEqual(events.map((e) => e.done), [1, 2]);
  assert.match(r.text, /Store sync finished: 3 request\(s\)/);
  await run('sync_hangar', w.deps, {});
  assert.equal(w.state.runs[1].cmd, 'hangar');
});

test('sync tools: errors become tool errors, an expired session asks to sign in, one sync at a time', async () => {
  const w = base();
  w.state.syncAvailable = true;
  w.deps.sync.run = async () => { throw new Error('RSI session missing or expired. Run: npm run login'); };
  await assert.rejects(run('sync_hangar', w.deps, {}), /No stored RSI session/);
  w.deps.sync.run = async () => { throw new Error('boom'); };
  await assert.rejects(run('sync_hangar', w.deps, {}), /Hangar sync failed: boom/);
  let release;
  w.deps.sync.run = () => new Promise((r) => { release = () => r({ requests: 0, seconds: 0 }); });
  const first = run('sync_hangar', w.deps, {});
  await assert.rejects(run('sync_store', w.deps, {}), /already running/);
  release();
  await first;
});

test('write tools: each saves through the revisioned save, one rev up', async () => {
  const w = base();
  const rev = w.disk.plans.rev;
  const add = await run('add_goal', w.deps, { target: 'Ironclad', priority: 'high' });
  assert.match(add.text, /Goal added: Ironclad \[c3\]/);
  assert.equal(w.disk.plans.rev, rev + 1);
  assert.equal(w.disk.plans.chains.c3.priority, 'high');
  await run('lock', w.deps, { goal: 'Ironclad' });
  assert.equal(w.disk.plans.chains.c3.lock, 'on');
  await run('unlock', w.deps, { goal: 'c3' });
  assert.equal(w.disk.plans.chains.c3.lock, 'off');
  await run('set_credit', w.deps, { dollars: 12.5 });
  assert.equal(w.disk.plans.profile.credit, 1250);
  const acc = await run('accept', w.deps, { goal: 'Carrack' });
  assert.match(acc.text, /Reserved the current best chain of Carrack/);
  assert.equal(w.disk.plans.chains.c2.accepted.rev, 1);
  await run('remove_goal', w.deps, { goal: 'c3' });
  assert.equal(w.disk.plans.chains.c3, undefined);
  assert.equal(w.disk.plans.rev, rev + 6);
  const po = await run('price_override', w.deps, { ship: 'Liberator', price: 200, note: 'announced' });
  assert.equal(w.disk.overrides.ships[4].msrp, 20000);
  assert.match(po.text, /expected price \$200 \(RSI today \$150\)/);
  await run('price_override', w.deps, { ship: 'Liberator', clear: true });
  assert.equal(w.disk.overrides.ships[4], undefined);
  await assert.rejects(run('price_override', w.deps, { ship: 'Liberator' }), /Give price/);
});

test('write tools: a stale document is refused and never overwritten', async () => {
  const w = base();
  const load = w.deps.load;
  // Another writer saves between this tool's read and its save.
  w.deps.load = () => { const app = load(); w.disk.plans = { ...w.disk.plans, rev: w.disk.plans.rev + 1, marker: 'other writer' }; return app; };
  await assert.rejects(run('set_credit', w.deps, { dollars: 5 }), /changed on disk.*Nothing was written/);
  assert.equal(w.disk.plans.marker, 'other writer');
  assert.equal(w.disk.plans.profile.credit, 0);
  assert.deepEqual(w.saves, []);
});

test('write tools: invalid input is a tool error and writes nothing', async () => {
  const w = base();
  await assert.rejects(run('add_goal', w.deps, { target: 'Ironclad', start: 'Ironclad' }), /start and target must differ/);
  await assert.rejects(run('add_goal', w.deps, { target: 'Nonexistent' }), ToolError);
  await assert.rejects(run('accept', w.deps, { goal: 'zzz' }), ToolError);
  assert.deepEqual(w.saves, []);
});

test('what_if buy: a purchase the store could not make is refused with the reason', async () => {
  const w = base();
  await assert.rejects(run('what_if', w.deps, { buy: { from: 'Liberator', to: 'Pulse', price: 5 } }), (e) => e instanceof ToolError && /does not cost more than Liberator/.test(e.message));
  await assert.rejects(run('what_if', w.deps, { buy: { from: 'Pulse', to: 'Pulse', price: 5 } }), (e) => e instanceof ToolError && /to itself/.test(e.message));
});

test('goal edits save the selected start, preferences and route-through ship, and release held resources', async () => {
  const w = base({ goals: [{ base: 1, target: 4 }] });
  const call = (name, args) => run(name, w.deps, { goal: 'Liberator', ...args });
  const chain = () => w.disk.plans.chains.c1;
  await call('accept');
  let r = await call('set_via', { ship: 'Hercules' });
  assert.match(r.text, /route through Hercules.*Released: Liberator/);
  assert.deepEqual(r.data.released, ['c1']);
  assert.equal(chain().accepted, null);
  assert.equal(chain().via, 2);
  await call('set_via', {});
  assert.equal(chain().via, undefined);
  await call('accept');
  assert.match((await call('release')).text, /Liberator.*released/);
  assert.equal(chain().accepted, null);
  w.app.data.lti.push({ pledgeId: 'p1', ship: 1 });
  for (const [args, start, text] of [
    [{ pledge_id: 'p1' }, { kind: 'token', pledgeId: 'p1' }, /p1/],
    [{}, { kind: 'token' }, /any LTI/],
    [{ ship: 'Carrack' }, { kind: 'ship', ship: 3 }, /Carrack/],
  ]) {
    assert.match((await call('set_start', args)).text, text);
    assert.deepEqual(chain().start, start);
  }
  for (const [field, value] of [['objective', 'allin'], ['priority', 'high'], ['mode', 'finish']]) {
    const result = await call('set_' + field, { [field]: value });
    assert.match(result.text, new RegExp(field + ' ' + value));
    assert.equal(chain()[field], value);
  }
  const count = w.saves.length;
  for (const name of ['set_start', 'set_via', 'release', 'set_objective', 'set_priority', 'set_mode']) {
    await assert.rejects(call(name, { goal: 'absent' }), /No goal matches/);
  }
  assert.equal(w.saves.length, count);
  assert.equal(w.disk.plans.rev, count);
});

test('LTI tokens, marks and settings distinguish catalog limit from price paid', async () => {
  const w = base();
  w.app.data.lti.push({ pledgeId: 'p1', name: 'Carrack', ship: 3, paidCents: 500, msrpCents: 10000 });
  const settings = await run('set_token_settings', w.deps, { limit: 50.25, use: ['p1'], never: [] });
  assert.match(settings.text, /\$50.25.*Use: p1/);
  assert.deepEqual(w.disk.plans.profile.tokens, { limitCents: 5025, use: ['p1'], never: [] });
  let r = await run('lti_tokens', w.deps);
  assert.match(r.text, /p1.*Carrack.*paid \$5, catalog \$100.*outside limit.*use/);
  assert.equal(r.data.tokens[0].withinLimit, false);
  r = await run('mark_token', w.deps, { pledge_id: 'p1', mark: 'never' });
  assert.match(r.text, /p1: never/);
  assert.deepEqual(w.disk.plans.profile.tokens, { limitCents: 5025, use: [], never: ['p1'] });
  await run('mark_token', w.deps, { pledge_id: 'p1', mark: 'clear' });
  assert.deepEqual(w.disk.plans.profile.tokens.never, []);
  await assert.rejects(run('mark_token', w.deps, { pledge_id: 'missing', mark: 'use' }), /Unknown/);
  await assert.rejects(run('set_token_settings', w.deps, {}), /Give a token limit/);
  assert.deepEqual(w.saves, ['plans', 'plans', 'plans']);
});

test('owned copies show proposed use and exclusion reports the reservation released', async () => {
  const w = base({ goals: [{ base: 1, target: 4 }] });
  const read = () => run('owned_ccus', w.deps);
  let r = await read();
  assert.match(r.text, /x.*Pulse → Carrack.*paid \$1.*allowed.*Liberator/);
  assert.equal(r.data.copies[0].goals[0].goalId, 'c1');
  await run('accept', w.deps, { goal: 'Liberator' });
  r = await run('exclude_copy', w.deps, { copy_id: 'x', excluded: true });
  assert.match(r.text, /Released: Liberator \[c1\]/);
  assert.deepEqual(r.data.released, ['c1']);
  assert.equal(w.disk.plans.chains.c1.accepted, null);
  assert.deepEqual(w.disk.plans.profile.excludedCopies, ['x']);
  assert.equal((await read()).data.copies[0].excluded, true);
  await run('exclude_copy', w.deps, { copy_id: 'x', excluded: false });
  assert.deepEqual(w.disk.plans.profile.excludedCopies, []);
  await assert.rejects(run('exclude_copy', w.deps, { copy_id: 'missing', excluded: true }), /Unknown owned copy/);
  assert.deepEqual(w.saves, ['plans', 'plans', 'plans']);
});

test('virtual CCU lifecycle includes zero price, expiry and replacement by ID', async () => {
  const w = base();
  const args = { from: 'Pulse', to: 'Ironclad', price: 1.25, copies: 2, note: 'Trade', expires: '2026-11-19' };
  let r = await run('set_virtual_ccu', w.deps, args);
  assert.match(r.text, /v1.*Pulse → Ironclad.*2 × \$1.25/);
  assert.deepEqual(w.disk.plans.profile.virtualCcus, [r.data]);
  assert.equal(r.data.cents, 125);
  r = await run('virtual_ccus', w.deps);
  assert.match(r.text, /expires 2026-11-19 · Trade/);
  assert.equal(r.data.ccus[0].expired, false);
  await run('set_virtual_ccu', w.deps, { ...args, id: 'v1', price: 0, expires: '2026-11-18' });
  r = await run('virtual_ccus', w.deps);
  assert.match(r.text, /expired 2026-11-18/);
  assert.equal(r.data.ccus[0].cents, 0);
  assert.equal(r.data.ccus[0].expired, true);
  await assert.rejects(run('set_virtual_ccu', w.deps, { ...args, copies: 100 }), /between 1 and 99/);
  assert.match((await run('remove_virtual_ccu', w.deps, { id: 'v1' })).text, /Removed virtual CCU v1/);
  assert.deepEqual(w.disk.plans.profile.virtualCcus, []);
  await assert.rejects(run('remove_virtual_ccu', w.deps, { id: 'v1' }), /unknown virtual CCU/);
  assert.equal(w.disk.plans.rev, 3);
});

test('settings report credit, prices, marks and offer notes; clearing a mark keeps price', async () => {
  const w = base({ credit: 500 });
  await run('price_override', w.deps, { ship: 'Ironclad', price: 300 });
  let r = await run('set_availability', w.deps, { ship: 'Ironclad', value: 'event-only', note: 'IAE' });
  assert.match(r.text, /Ironclad availability: event-only/);
  assert.equal(w.disk.overrides.ships[5].availabilityNote, 'IAE');
  const args = { from: 'Pulse', to: 'Ironclad' };
  r = await run('set_offer_end', w.deps, { ...args, end: '2026-12-01' });
  assert.match(r.text, /Pulse → Ironclad.*2026-12-01/);
  assert.equal(w.disk.overrides.pairs['1-5'].until, '2026-12-01');
  await run('set_offer_end', w.deps, { ...args, end: 'soon' });
  r = await run('settings', w.deps);
  assert.match(r.text, /credit \$5.*Token limit \$80/s);
  assert.match(r.text, /Ironclad expected price \$300.*event-only IAE.*Pulse → Ironclad ends soon/s);
  assert.equal(r.data.offers[0].soon, true);
  assert.equal(r.data.ships[0].availability, 'event-only');
  assert.equal(r.data.tokens.limitCents, 8000);
  await run('set_offer_end', w.deps, { ...args, end: 'clear' });
  await run('set_availability', w.deps, { ship: 'Ironclad', value: 'clear' });
  assert.equal(w.disk.overrides.pairs, undefined);
  assert.equal(w.disk.overrides.ships[5].msrp, 30000);
  assert.equal(w.disk.overrides.ships[5].availability, undefined);
  await assert.rejects(run('set_availability', w.deps, { ship: 'missing', value: 'regular' }), /No single ship/);
  await assert.rejects(run('set_offer_end', w.deps, { ...args, end: '2026-02-30' }), /needs a day/);
  assert.deepEqual(w.saves, Array(6).fill('overrides'));
});

test('sale events list feed and local dates but save only user events', async () => {
  const w = base();
  w.disk['sale-events'].events.push({ id: 'feed:iae', name: 'IAE', from: '2026-11-20', to: '2026-11-30', source: 'feed' });
  let r = await run('sale_events', w.deps);
  assert.match(r.text, /IAE \[feed:iae\].*feed/);
  assert.equal(r.data.events[0].source, 'feed');
  await assert.rejects(run('remove_sale_event', w.deps, { id: 'feed:iae' }), /unknown sale event/);
  const args = { name: 'Expo', from: '2026-12-01', to: '2026-12-05' };
  r = await run('add_sale_event', w.deps, args);
  assert.match(r.text, /Added Expo \[e1\].*2026-12-05/);
  assert.deepEqual(w.disk['sale-events'].events, [{ id: 'e1', ...args }]);
  await assert.rejects(run('add_sale_event', w.deps, { ...args, to: '2026-11-30' }), /end before/);
  assert.match((await run('remove_sale_event', w.deps, { id: 'e1' })).text, /Removed sale event e1/);
  assert.deepEqual(w.disk['sale-events'].events, []);
  assert.deepEqual(w.saves, ['sale-events', 'sale-events']);
});

test('reserve fleet in one save, leaving existing and unroutable goals alone', async () => {
  const w = base({ goals: [{ base: 1, target: 4 }, { base: 1, target: 3 }, { start: { kind: 'token' }, target: 5 }] });
  await run('accept', w.deps, { goal: 'Carrack' });
  const previous = w.disk.plans.chains.c2.accepted;
  const r = await run('accept_fleet', w.deps);
  assert.match(r.text, /Reserved: Liberator/);
  assert.deepEqual(r.data.ids, ['c1']);
  assert.ok(w.disk.plans.chains.c1.accepted);
  assert.deepEqual(w.disk.plans.chains.c2.accepted, previous);
  assert.equal(w.disk.plans.chains.c3.accepted, null);
  await assert.rejects(run('accept_fleet', w.deps), /No unreserved goals/);
  assert.deepEqual(w.saves, ['plans', 'plans']);
});

test('import goals saves only resolved new rows and a retry leaves the revision alone', async () => {
  const w = base();
  w.deps.readFile = (path, cap) => {
    assert.equal(path, '/exports/chains.json');
    assert.equal(cap, 5 * 1024 * 1024);
    return JSON.stringify({ chains: ['Carrack', 'Ironclad', 'Ironclad', 'Unknown'].map(toShipName => ({
      fromShipName: 'Pulse', toShipName, options: { optimizationTarget: 'longTerm' },
    })) });
  };
  const args = { path: '/exports/chains.json' };
  const r = await run('import_goals', w.deps, args);
  assert.match(r.text, /Imported 1 goal.*Ironclad \[c3\]/s);
  assert.deepEqual(r.data.skipped.map(x => x.status), ['exists', 'exists', 'needs-ship']);
  const c = w.disk.plans.chains.c3;
  assert.equal(c.target, 5);
  assert.deepEqual(c.start, { kind: 'ship', ship: 1 });
  assert.equal(c.mode, 'watch');
  assert.match((await run('import_goals', w.deps, args)).text, /Imported 0/);
  await assert.rejects(run('import_goals', w.deps, { path: 'relative.json' }), /absolute path/);
  assert.deepEqual(w.saves, ['plans']);
});

test('melt advice shows candidates and the proposed credit plan without saving', async () => {
  const w = base({ goals: [{ base: 1, target: 3, mode: 'finish' }], owned: [copy('spare', 4, 5, 5000)] });
  w.disk.overrides.ships[5] = { availability: 'regular' };
  await run('accept', w.deps, { goal: 'Carrack' });
  const r = await run('melt_advice', w.deps);
  assert.match(r.text, /spare.*Liberator → Ironclad.*\$50.*suggested/);
  assert.equal(r.data.melt[0].copyId, 'spare');
  assert.equal(r.data.newMoneyBefore, 5000);
  assert.equal(r.data.newMoneyAfter, 0);
  assert.deepEqual(w.saves, ['plans']);
});

test('alternative routes compare the goal’s constrained routes without saving', async () => {
  const w = base({ offers: [{ from: 1, to: 2, kind: 'warbond', cash: 500 }] });
  w.disk.plans.chains.c1.via = 2;
  const r = await run('alternative_routes', w.deps, { goal: 'Liberator', count: 2 });
  assert.match(r.text, /1\. .*new money.*Pulse → Hercules/);
  assert.equal(r.data.routes.length, 2);
  for (const route of r.data.routes) assert.ok(route.steps.some(s => s.to === 2));
  await assert.rejects(run('alternative_routes', w.deps, { goal: 'absent' }), /No goal matches/);
  assert.deepEqual(w.saves, []);
});
