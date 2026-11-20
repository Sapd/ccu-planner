<script>
  import { onMount } from 'svelte';
  import * as echarts from 'echarts/core';
  import { BarChart } from 'echarts/charts';
  import { GridComponent, TooltipComponent } from 'echarts/components';
  import { CanvasRenderer } from 'echarts/renderers';
  import { meltHeadline, meltHeadlinePlain, meltEventHint, noEventsNoticeApp, meltWithoutNote, MELT_IDLE_APP, MELT_NOTE, meltPlanLinesApp, meltPickLineApp, meltReasonPlain, MELT_CANDIDATE_PLAIN, noMatchesText } from '$logic/describe.mjs';
  import { shipName, goalLabel } from '$logic/ships.mjs';
  import { parseCreditUsd } from './view/explorer.mjs';
  import { candidateBars, meltView } from './view/hangar.mjs';
  import { usd } from '$logic/format.mjs';
  import { hangarUrl } from '$logic/links.mjs';
  import ShipThumb from './ShipThumb.svelte';
  import RsiLink from './RsiLink.svelte';
  import GlassPanel from './ui/GlassPanel.svelte';
  import Fold from './goals/Fold.svelte';
  import { matchesQuery, searchText } from '$logic/search.mjs';

  import { dispatch, goSection, ui } from './state.svelte.js';

  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

  // `query`: the Hangar's search text.
  let { app, query = '' } = $props();
  const ships = $derived(app.data.ships);
  const name = (id) => shipName(ships, id);
  const ship = (id) => ships.get(id) ?? null;
  const view = $derived(meltView(app));
  const p = $derived(view.plan);
  const lines = $derived(meltPlanLinesApp(p, name, (id) => (app.plans.chains[id] ? goalLabel(app.plans.chains[id], ships) : 'a goal')));
  const idle = $derived(!p.finishChains.length && !p.locks.length);
  const searching = $derived(query.trim() !== '');
  let keptOpen = $state(false);
  $effect(() => { if (searching) keptOpen = true; }); // matches among kept items must not hide in the closed fold
  const rowText = (c) => searchText(name(c.copy.from), name(c.copy.to));
  const candidates = $derived(p.candidates.filter((c) => matchesQuery(rowText(c), query)));
  const kept = $derived(view.kept.filter((c) => matchesQuery(rowText(c), query)));
  const bars = $derived(candidateBars(candidates, ships));

  // Credit pool, typed in dollars and applied on change.
  const stored = $derived(app.plans.profile.credit ?? 0);
  let creditText = $derived(String(stored / 100)); // writable: follows the stored credit until you type
  let busy = false;
  let creditError = $state(null);
  async function commitCredit() {
    const cents = parseCreditUsd(creditText);
    if (cents == null) { creditError = 'Enter a dollar amount, zero or more.'; return; }
    creditError = null;
    if (cents !== stored) {
      if (busy) return;
      busy = true;
      try { await dispatch({ type: 'setCredit', cents }); } finally { busy = false; }
    }
    creditText = String((app.plans.profile.credit ?? 0) / 100);
  }

  let el;
  let chart;
  const token = (n, fallback) => (el ? getComputedStyle(el).getPropertyValue(n).trim() : '') || fallback;
  function option(list) {
    const muted = token('--muted', '#a3afc2');
    const line = token('--glass-border', 'rgba(255,255,255,0.12)');
    return {
      backgroundColor: 'transparent', animation: false,
      grid: { left: 56, right: 16, top: 16, bottom: 110 },
      tooltip: { trigger: 'axis', formatter: (items) => `${esc(list[items[0].dataIndex].label)}<br/>${usd(list[items[0].dataIndex].paid)}` },
      xAxis: { type: 'category', data: list.map((b) => b.label), axisLabel: { color: muted, rotate: 40, interval: 0 }, axisLine: { lineStyle: { color: line } } },
      yAxis: { type: 'value', axisLabel: { color: muted, formatter: (v) => usd(v) }, splitLine: { lineStyle: { color: line } } },
      series: [{ type: 'bar', data: list.map((b) => b.paid), itemStyle: { color: token('--accent', '#4cc2ff') } }],
    };
  }
  onMount(() => {
    chart = echarts.init(el);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => { ro.disconnect(); chart.dispose(); chart = null; };
  });
  $effect(() => {
    const list = bars;
    if (chart && list.length) chart.setOption(option(list), true);
  });
</script>

<GlassPanel class="worthmelt" id="worth-melting" aria-labelledby="melt-title">
  <div class="top">
    <h2 id="melt-title">Worth melting</h2>
    {#if p.candidates.length}<span class="total">{usd(p.candidateCredit)} store credit · {p.candidates.length} CCU{p.candidates.length === 1 ? '' : 's'}</span>{/if}
  </div>
  <p class="head">{meltHeadlinePlain({ count: p.candidates.length, credit: p.candidateCredit })}</p>
  <div class="how"><Fold title="How we decide"><p class="muted">{meltHeadline(p, view.hasOverrides)}</p></Fold></div>
  {#if noEventsNoticeApp(app.saleEvents)}<p class="warn" data-hint="no-events">{noEventsNoticeApp(app.saleEvents)} <button type="button" onclick={() => { ui.storeTab = 'upgrades'; goSection('store'); }}>Open Store</button></p>{/if}
  {#if view.hintEvent}<p class="muted" data-hint="event">{meltEventHint(view.hintEvent)}</p>{/if}
  {#if meltWithoutNote(view.without)}<p class="muted">{meltWithoutNote(view.without)}</p>{/if}

  <label class="credit">Store credit available $
    <input type="text" inputmode="decimal" bind:value={creditText} onchange={commitCredit} aria-label="Store credit in dollars" aria-invalid={creditError ? 'true' : undefined} />
  </label>
  {#if creditError}<p class="err" role="alert">{creditError}</p>{/if}

  <h3>Plan</h3>
  {#if idle}
    <p class="muted">{MELT_IDLE_APP} Set a goal to finish mode to plan a melt.</p>
  {:else}
    {#each lines as l, i (i)}<p class="line">{l}</p>{/each}
    {#each p.melt as m (m.copy.copyId)}
      <div class="pick" data-copy={m.copy.copyId} data-from={m.copy.from} data-to={m.copy.to}><ShipThumb ship={ship(m.copy.from)} size="xs" /><ShipThumb ship={ship(m.copy.to)} size="xs" /><span>{meltPickLineApp(m, name)}</span></div>
    {/each}
    {#if p.melt.length}<p class="muted">{MELT_NOTE} Re-sync the hangar afterwards.</p>{/if}
  {/if}

  <h3>Candidates ({searching ? `${candidates.length} of ${p.candidates.length}` : p.candidates.length})</h3>
  {#if p.candidates.length}<p class="muted">{MELT_CANDIDATE_PLAIN}</p>{/if}
  <div class="chart" bind:this={el} hidden={!bars.length}></div>
  {#if !bars.length}<p class="muted">{searching && p.candidates.length ? noMatchesText(query) : 'No candidates.'}</p>{/if}
  <table>
    <tbody>
      {#each candidates as c (c.copy.copyId)}
        <tr data-copy={c.copy.copyId} data-from={c.copy.from} data-to={c.copy.to}>
          <td><span class="pair"><ShipThumb ship={ship(c.copy.from)} size="xs" /><ShipThumb ship={ship(c.copy.to)} size="xs" /><span>{name(c.copy.from)} → {name(c.copy.to)}</span></span></td>
          <td class="num">{usd(c.paid)}</td>
          <td class="muted">Standard today {usd(c.standardNow)}</td>
          <td><RsiLink href={hangarUrl()} label="Hangar" aria="Open {name(c.copy.from)} to {name(c.copy.to)} in the RSI hangar" /></td>
        </tr>
      {/each}
    </tbody>
  </table>

  <div class="kept">
    <Fold bind:open={keptOpen} title={`Kept (${searching ? `${kept.length} of ${view.kept.length}` : view.kept.length})`}>
      <table>
        <tbody>
          {#each kept as c (c.copy.copyId)}
            <tr data-copy={c.copy.copyId} data-from={c.copy.from} data-to={c.copy.to}>
              <td><span class="pair"><ShipThumb ship={ship(c.copy.from)} size="xs" /><ShipThumb ship={ship(c.copy.to)} size="xs" /><span>{name(c.copy.from)} → {name(c.copy.to)}</span></span></td>
              <td class="num">{usd(c.paid)}</td>
              <td class="muted" title={c.keep}>{meltReasonPlain(c.keep)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </Fold>
  </div>
</GlassPanel>

<style>
  :global(.worthmelt) { display: block; }
  .top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  h2 { margin: 0; font-size: 18px; }
  .total { color: var(--accent); font-weight: 700; font-variant-numeric: tabular-nums; }
  .head { margin: 6px 0 4px; }
  .line { margin: 2px 0; }
  .muted { color: var(--muted); }
  .warn { color: var(--warn); margin: 4px 0; }
  h3 { margin: 18px 0 6px; color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  .credit { display: flex; align-items: center; gap: 6px; color: var(--muted); margin: 10px 0; }
  input { width: 6em; }
  .err { color: var(--warn); margin: 0 0 8px; }
  .pick { display: flex; align-items: center; gap: 4px; padding: 2px 0 2px 16px; }
  .pick span:last-child { margin-left: 4px; }
  .pair { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .how { margin: 6px 0; }
  .chart { height: 300px; width: 100%; }
  .chart[hidden] { display: none; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 6px 8px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .kept { margin-top: 14px; }
</style>
