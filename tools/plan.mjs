// node tools/plan.mjs --from "Cutter Rambler" --to "Polaris" [--credit 50] [--k 3] [--max-steps 25] [--no-owned] [--no-warbond] [--objective cash|allin]
// node tools/plan.mjs --status

import { loadPlannerData, findShip } from '../src/data.mjs';
import { buildGraph, planRoutes, summarize, incomingCount } from '../src/logic/planner.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes(`--${n}`);
import { usd } from '../src/logic/format.mjs';
import { noRouteMessage } from '../src/logic/describe.mjs';

const data = loadPlannerData();
const { ships, offers, owned, review, meta } = data;

if (flag('status')) {
  console.log(JSON.stringify(meta, null, 2));
  console.log(`owned CCUs matched by item ID: ${owned.filter((o) => o.matchMethod === 'item-id').length}, by name: ${owned.filter((o) => o.matchMethod === 'name').length}`);
  for (const r of review) console.log(`needs review: ${r.pledgeId} ${r.name} (${r.reason})`);
  process.exit(0);
}

const base = findShip(ships, opt('from'));
const target = findShip(ships, opt('to'));
if (!base || !target) {
  console.error(`unknown ship: ${!base ? opt('from') : opt('to')} (use the exact store name or ship ID)`);
  process.exit(2);
}

const graph = buildGraph({ offers, owned, ships });
const t0 = performance.now();
const routes = planRoutes(graph, {
  base: base.id,
  target: target.id,
  credit: Math.round(Number(opt('credit', 0)) * 100),
  maxSteps: Number(opt('max-steps', 25)),
  allowOwned: !flag('no-owned'),
  allowWarbond: !flag('no-warbond'),
  objective: opt('objective', 'cash'),
}, Number(opt('k', 3)));
const ms = performance.now() - t0;

console.log(`${base.name} (${usd(base.msrp)}) -> ${target.name} (${usd(target.msrp)}) · store checked ${meta.catalogAt?.slice(0, 16)} · hangar ${meta.hangarAt?.slice(0, 16)}`);
if (!routes.length) {
  console.log(noRouteMessage(target.name, incomingCount(graph, target.id)));
  process.exit(1);
}
routes.forEach((r, i) => {
  const s = summarize(r, ships, base.id, target.id);
  console.log(`\nRoute ${i + 1}: ${usd(r.cash)} new cash${r.creditUsed ? ` + ${usd(r.creditUsed)} credit` : ''} · ${r.ownedUsed} owned CCU(s)${r.ownedBasis ? ` worth ${usd(r.ownedBasis)}${r.unknownBasis ? ' + unknown' : ''}` : ''} · all-in ${usd(r.allIn)} · ${r.purchases} purchase(s) · saves ${usd(s.savingsVsStandard)} vs direct standard`);
  for (const st of r.steps) {
    const from = ships.get(st.from)?.name;
    const to = ships.get(st.to)?.name;
    const what = st.kind === 'owned'
      ? `OWNED  pledge ${st.copyId} (${st.edition}, paid ${usd(st.paid?.cents)}${st.giftable ? ', giftable' : ''}${st.matchMethod === 'name' ? ', matched by name' : ''})`
      : `${st.kind === 'warbond' ? 'BUY WB' : 'BUY   '} ${usd(st.cash)}${st.title ? ` ${st.title}` : ''}`;
    console.log(`  ${from} -> ${to}: ${what}`);
  }
});
console.log(`\n(${ms.toFixed(0)} ms, ${offers.length} offers, ${owned.length} owned CCUs)`);
