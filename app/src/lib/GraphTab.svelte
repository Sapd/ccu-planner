<script>
  import { t, N_ } from '$logic/i18n.mjs';
  import * as echarts from 'echarts/core';
  import { GraphChart } from 'echarts/charts';
  import { TooltipComponent } from 'echarts/components';
  import { CanvasRenderer } from 'echarts/renderers';
  import { sessionOf } from '$logic/session.mjs';
  import { subgraph, chainContext, takenFor, shipY, priceRanks } from './view/subgraph.mjs';
  import { usd } from '$logic/format.mjs';
  import { goalNamer } from '$logic/ships.mjs';
  import ShipThumb from './ShipThumb.svelte';
  import DecisionGraph from './DecisionGraph.svelte';
  import GlassPanel from './ui/GlassPanel.svelte';
  import GoalPicker from './goals/GoalPicker.svelte';
  import ShipPicker from './ShipPicker.svelte';

  echarts.use([GraphChart, TooltipComponent, CanvasRenderer]);
  let { app, chain = null } = $props();
  let kinds = $state(['owned', 'warbond', 'standard']);
  let min = $state('');
  let max = $state('');
  let onlyChainEdges = $state(false);
  let showWanted = $state(false);
  let selected = $state(null);
  // Decision explains the chain's route; it is the default whenever a chain is selected.
  let picked = $state('decision');
  const mode = $derived(chain ? picked : 'network');
  const ships = $derived(app.data.ships);
  const name = (id) => ships.get(id)?.name ?? String(id);
  const context = $derived(mode === 'network' ? chainContext(app, chain?.id ?? null) : null);
  const wanted = $derived(mode === 'network' && chain && showWanted ? sessionOf(app).wanted(chain.id) : null);
  const EMPTY = { nodes: [], edges: [], hidden: 0 };
  const view = $derived(mode !== 'network' ? EMPTY : subgraph(app, { chainId: chain?.id ?? null, kinds: new Set(kinds),
    minMsrp: min == null || min === '' ? -Infinity : Number(min) * 100,
    maxMsrp: max == null || max === '' ? Infinity : Number(max) * 100,
    onlyChainEdges: !!chain && onlyChainEdges, showWanted }, context, wanted));
  const taken = $derived(takenFor(sessionOf(app), chain?.id));
  const goalName = $derived(goalNamer(app.plans, ships));
  const incident = $derived(selected == null ? [] : [...app.graph.edges.values()].flat().filter((e) => e.from === selected || e.to === selected));
  // Kinds and roles as the drawing names them (the raw words are the data; they are shown through t()).
  const kindText = (k) => ({ owned: t('owned'), warbond: t('warbond'), standard: t('standard') }[k] ?? k);
  const roleText = (r) => ({ base: t('base'), target: t('target'), route: t('route'), other: t('other') }[r] ?? r);
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  let el = $state();
  let chart;
  let ready = $state(false);

  function option(v) {
    const css = getComputedStyle(el);
    const color = (key) => css.getPropertyValue(`--${key}`).trim();
    // Kind colours: owned = own (grey), Warbond = now (green), Standard = wait (purple).
    const KIND = { owned: 'own', warbond: 'now', standard: 'wait' };
    const kindColor = (k) => color(KIND[k] ?? 'muted');
    const ranks = priceRanks(v.nodes);
    return {
      animation: false, backgroundColor: 'transparent',
      tooltip: { trigger: 'item', formatter: ({ data: d, dataType }) => {
        if (dataType !== 'edge') return `${esc(d.name)}<br/>${usd(d.msrp)}${d.concept ? `<br/>${esc(t('Concept'))}` : ''}<br/>${esc(roleText(d.role))}`;
        return `${esc(name(d.from))} → ${esc(name(d.to))}<br/>${d.hypothetical ? esc(t('Wanted: below {amount}', { amount: usd(d.cash) })) : usd(d.cash)} · ${esc(kindText(d.kind))}${d.copyId != null ? `<br/>${esc(t('Owned CCU · paid {amount}', { amount: usd(d.paid) }))}` : ''}${d.skuId != null ? `<br/>${esc(t('SKU {id}', { id: d.skuId }))}` : ''}${d.reservedBy ? `<br/>${esc(t('Reserved by {name}', { name: goalName(d.reservedBy) }))}` : ''}${d.onRoute ? `<br/>${esc(t('Best route'))}` : ''}`;
      } },
      series: [{ id: 'network', type: 'graph', layout: 'none', roam: true, scaleLimit: { min: 0.3, max: 8 },
        left: 50, right: 70, top: 40, bottom: 40, edgeSymbol: ['none', 'arrow'], edgeSymbolSize: 5,
        label: { show: false, position: 'right', color: color('text'), fontSize: 10 },
        emphasis: { focus: 'adjacency', label: { show: true } },
        data: v.nodes.map((n) => ({ ...n, id: String(n.id), shipId: n.id,
          x: ranks.get(n.msrp) * 1000,
          // Names for the ships that matter (base, target, route) and for the one you clicked.
          label: { show: n.role !== 'other' || n.id === selected, fontWeight: n.id === selected ? 'bold' : 'normal' },
          y: shipY(n.id) * 450, symbolSize: n.id === selected ? 18 : n.role === 'other' ? 7 : 14,
          itemStyle: { color: color(n.role === 'base' ? 'own' : n.role === 'target' ? 'link' : n.role === 'route' ? 'text' : 'muted'),
            borderColor: color('text'), borderWidth: n.concept ? 2 : 0 } })),
        links: v.edges.map((e) => ({ ...e, source: String(e.from), target: String(e.to),
          lineStyle: { color: e.hypothetical ? color('now') : e.reservedBy ? color('muted') : kindColor(e.kind),
            width: e.onRoute ? 4 : 1, opacity: e.onRoute ? 1 : 0.45,
            type: e.hypothetical || e.reservedBy ? 'dashed' : 'solid', curveness: e.kind === 'owned' ? 0.08 : e.kind === 'warbond' ? -0.08 : 0 } })),
      }],
    };
  }
  // The chart lives only while the Network view is shown.
  $effect(() => {
    if (!el) return;
    let c = null;
    // Initialise only once the container has a size (echarts warns and draws nothing at 0x0).
    const start = () => {
      c = chart = echarts.init(el);
      c.on('click', (p) => { if (p.dataType === 'node') selected = p.data.shipId; });
      ready = true;
    };
    const sized = () => el.clientWidth > 0 && el.clientHeight > 0;
    if (sized()) start();
    let initialResize = !!c;
    const ro = new ResizeObserver(() => {
      if (!c) { if (sized()) start(); return; }
      if (initialResize) { initialResize = false; return; }
      c.resize();
    });
    ro.observe(el);
    return () => { ro.disconnect(); ready = false; c?.dispose(); chart = null; };
  });
  $effect(() => { const v = view; if (ready && chart) chart.setOption(option(v)); });
</script>

<GlassPanel>
<div class="head">
  <h2>{mode === 'decision' ? t('Why this route') : t('All ships and upgrades')}</h2>
  <GoalPicker {app} />
</div>
<div class="modes" role="group" aria-label={t('Graph mode')}>
  <button class:active={mode === 'decision'} aria-pressed={mode === 'decision'} disabled={!chain} onclick={() => { picked = 'decision'; }}>{t('Decision')}</button>
  <button class:active={mode === 'network'} aria-pressed={mode === 'network'} onclick={() => { picked = 'network'; }}>{t('Network')}</button>
</div>
{#if mode === 'decision'}
  <DecisionGraph {app} {chain} />
{:else}
<div class="controls">
  {#each ['owned', 'warbond', 'standard'] as kind (kind)}
    <label class={kind}><input type="checkbox" bind:group={kinds} value={kind} />{kindText(kind)}</label>
  {/each}
  <label>{t('Min MSRP $')} <input class="price" type="number" min="0" bind:value={min} /></label>
  <label>{t('Max MSRP $')} <input class="price" type="number" min="0" bind:value={max} /></label>
  <label><input type="checkbox" bind:checked={onlyChainEdges} disabled={!chain} />{t('Only route edges')}</label>
  <label><input type="checkbox" bind:checked={showWanted} disabled={!chain} />{t('Show wanted')}</label>
</div>
<div class="inspect">
  <ShipPicker {ships} bind:value={selected} id="inspect-ship" label={t('Inspect a ship')} />
  {#if selected != null}<button type="button" onclick={() => { selected = null; }}>{t('Clear')}</button>{/if}
</div>
<p class="hint">{t('Price increases left to right. Thick edges: best route · dashed grey: reserved by another goal · dashed green: wanted. Scroll to zoom; drag to pan. Click a ship, or pick one in “Inspect a ship”, for its CCUs.')}</p>
{#if view.hidden}<p class="hint">{t('{n} more upgrades are not drawn. Narrow the price range or the kinds to see them.', { n: view.hidden })}</p>{/if}
<div class="network">
  <div class="chart" bind:this={el} role="img" aria-label={t('CCU network graph. Use Inspect a ship to explore it with the keyboard.')}></div>
  <aside class:has={selected != null}>
    {#if selected != null}
      <ShipThumb ship={ships.get(selected) ?? null} size="m" />
      <h3>{name(selected)} · {usd(ships.get(selected)?.msrp)}</h3>
      {#each [[N_('In'), 'to'], [N_('Out'), 'from']] as [label, field] (label)}
        <h4>{t(label)}</h4>
        <ul>
          {#each incident.filter((e) => e[field] === selected) as e}
            <li class={e.kind}>{name(e.from)} → {name(e.to)} · {kindText(e.kind)} · {usd(e.cash)}
              {#if e.skuId != null}<span>{t('SKU {id}', { id: e.skuId })}</span>{/if}
              {#each e.copies ?? [] as c}<span>{t('Owned CCU · paid {amount}', { amount: usd(c.paid?.cents) })}{taken.has(c.copyId) ? ` · ${t('reserved by {name}', { name: goalName(taken.get(c.copyId)) })}` : ''}</span>{/each}
            </li>
          {:else}<li>{t('None')}</li>{/each}
        </ul>
      {/each}
    {:else}<p class="hint">{t('Select a ship to list all its incoming and outgoing CCUs.')}</p>{/if}
  </aside>
</div>
{#if !view.nodes.length}<p class="hint">{t('No ships in this price range.')}</p>{/if}
{/if}
</GlassPanel>

<style>
  .head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 16px; margin-bottom: 4px; }
  h2 { margin: 0; font-size: 18px; }
  .modes { display: inline-flex; margin-bottom: 10px; }
  .modes button { border-radius: 0; }
  .modes button:first-child { border-radius: 8px 0 0 8px; }
  .modes button:last-child { border-radius: 0 8px 8px 0; border-left: 0; }
  .modes button.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 18%, transparent); font-weight: 600; }
  .head :global(.pick) { margin-bottom: 0; }
  .controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  label { display: flex; align-items: center; gap: 4px; }
  .price { width: 6em; }
  .inspect { display: flex; align-items: flex-end; gap: 8px; margin-top: 8px; max-width: 420px; }
  .inspect :global(.picker) { flex: 1; }
  .hint { color: var(--muted); margin: 6px 0; }
  .network { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 16px; }
  .chart { width: 100%; height: 560px; min-width: 0; }
  aside { max-height: 560px; overflow: auto; border-left: 1px solid var(--glass-border); padding-left: 12px; }
  h3, h4 { margin: 8px 0; }
  ul { padding-left: 16px; }
  li { margin-bottom: 8px; }
  li span { display: block; color: var(--muted); }
  .owned { color: var(--own); } .standard { color: var(--wait); } .warbond { color: var(--now); }
  /* Narrow: the clicked ship's details sit above the drawing, so the click's result is on screen. */
  @media (max-width: 1000px) {
    .network { grid-template-columns: minmax(0, 1fr); }
    aside { order: -1; max-height: 240px; border-left: 0; padding-left: 0; border-bottom: 1px solid var(--glass-border); }
    aside:not(.has) { display: none; }
  }
</style>
