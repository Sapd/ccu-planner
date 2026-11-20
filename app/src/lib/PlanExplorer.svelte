<script>
  import { t } from '$logic/i18n.mjs';
  import { planRoutes, summarize, incomingCount } from '$logic/planner.mjs';
  import { excludedCopies } from '$logic/goals.mjs';
  import { routeLine, noRouteMessage, OBJECTIVE_CHOICE } from '$logic/describe.mjs';
  import { shipName } from '$logic/ships.mjs';
  import ShipPicker from './ShipPicker.svelte';
  import Steps from './Steps.svelte';
  import GlassPanel from './ui/GlassPanel.svelte';
  import { parseCreditUsd, parseBounded } from './view/explorer.mjs';
  import { usd } from '$logic/format.mjs';
  import { untrack } from 'svelte';

  let { app } = $props();
  const ships = $derived(app.data.ships);

  let from = $state(null);
  let to = $state(null);
  let creditText = $state(untrack(() => ((app.plans.profile?.credit ?? 0) / 100 ? String((app.plans.profile.credit ?? 0) / 100) : '')));
  let kText = $state('3');
  let maxText = $state('25');
  let objective = $state('cash');
  let noOwned = $state(false);
  let noWarbond = $state(false);
  let result = $state.raw(null);

  const credit = $derived(parseCreditUsd(creditText));
  const k = $derived(parseBounded(kText, 1, 5));
  const maxSteps = $derived(parseBounded(maxText, 1, 25));
  const problem = $derived(
    from == null || to == null ? t('Pick both ships.')
    : from === to ? t('From and to must differ.')
    : credit == null ? t('RSI store credit must be an amount in dollars, zero or more.')
    : k == null ? t('Alternatives must be 1 to 5.')
    : maxSteps == null ? t('Longest route must be 1 to 25 upgrades.') : null,
  );

  function run(e) {
    e.preventDefault();
    if (problem) return;
    const routes = planRoutes(app.graph, { base: from, target: to, credit, maxSteps, allowOwned: !noOwned, allowWarbond: !noWarbond, objective, excludeCopies: excludedCopies(app.plans) }, k);
    result = { from, to, routes, none: routes.length ? null : noRouteMessage(shipName(ships, to), incomingCount(app.graph, to)) };
  }
</script>

<div class="explorer">
  <GlassPanel>
  <h2>{t('Find a route between two ships')}</h2>
  <p class="intro">{t('Pick the ship you start from and the ship you want. The planner shows the best ways to get there, without creating a goal.')}</p>
  <form onsubmit={run}>
    <ShipPicker {ships} bind:value={from} label={t('From')} id="px-from" />
    <ShipPicker {ships} bind:value={to} label={t('To')} id="px-to" />
    <label>{t('RSI store credit available ($)')} <input inputmode="decimal" bind:value={creditText} placeholder="0" /><span class="fieldnote">{t('Applies to eligible Standard purchases.')}</span></label>
    <label>{t('Alternatives to show (1–5)')} <input inputmode="numeric" bind:value={kText} /></label>
    <label>{t('Longest route (upgrades)')} <input inputmode="numeric" bind:value={maxText} /></label>
    <label>{t('Cheapest means')} <select bind:value={objective}>{#each Object.entries(OBJECTIVE_CHOICE) as [v, text] (v)}<option value={v}>{t(text)}</option>{/each}</select></label>
    <label class="check"><input type="checkbox" bind:checked={noOwned} /> {t('Don’t use CCUs I own')}</label>
    <label class="check"><input type="checkbox" bind:checked={noWarbond} /> {t('Don’t use Warbond upgrades')}</label>
    <button type="submit" disabled={!!problem}>{t('Plan##verb')}</button>
  </form>
  {#if problem}<p class="hint">{problem}</p>{/if}
  </GlassPanel>

  {#if result}
    <h3>{shipName(ships, result.from)} → {shipName(ships, result.to)}</h3>
    {#if result.none}<p class="none">{result.none}</p>{/if}
    {#each result.routes as r, i}
      {@const s = summarize(r, ships, result.from, result.to)}
      <GlassPanel class="route">
        <h4>{t('Route {n}', { n: i + 1 })}</h4>
        <p class="line">{routeLine(r)}{#if s.savingsVsStandard != null} · {t('saves {amount} vs direct Standard', { amount: usd(s.savingsVsStandard) })}{/if}</p>
        <Steps {app} route={r} />
      </GlassPanel>
    {/each}
  {/if}
</div>

<style>
  .explorer { display: flex; flex-direction: column; gap: 14px; }
  h2 { margin: 0 0 10px; font-size: 18px; }
  h3 { margin: 0; font-size: 16px; }
  form { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
  form > :global(.picker) { width: 220px; }
  label { display: grid; gap: 4px; color: var(--muted); font-size: 12px; }
  .fieldnote { font-size: 12px; max-width: 24ch; }
  label input:not([type='checkbox']) { width: 110px; }
  select { max-width: 260px; }
  .intro { margin: 0 0 12px; color: var(--muted); }
  .check { display: flex; align-items: center; gap: 6px; }
  button[type='submit'] { padding: 7px 16px; border-color: var(--accent); }
  .hint { color: var(--warn); font-size: 12px; margin: 8px 0 0; }
  .none { color: var(--warn); }
  :global(.route) h4 { margin: 0; }
  .line { margin: 4px 0; color: var(--muted); }
</style>
