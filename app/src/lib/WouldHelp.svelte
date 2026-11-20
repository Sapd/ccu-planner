<script>
  import { t } from '$logic/i18n.mjs';
  import { onDestroy, untrack } from 'svelte';
  import { groupWanted, parseSlackUsd } from '$logic/wantedView.mjs';
  import { shipName } from '$logic/ships.mjs';
  import { upgradeToolUrl } from '$logic/links.mjs';
  import { usd } from '$logic/format.mjs';
  import ShipThumb from './ShipThumb.svelte';
  import RsiLink from './RsiLink.svelte';
  import JobStatus from './ui/JobStatus.svelte';
  import { Job } from './jobs.svelte.js';

  let { app, chain } = $props();
  const ships = $derived(app.data.ships);
  const name = (id) => shipName(ships, id);

  // Slack is typed in dollars and applied on change, so the (slow) search runs
  // once per committed value, not once per keystroke.
  let slackText = $state('10');
  let slack = $state(1000); // cents, last valid value
  const commit = () => {
    const c = parseSlackUsd(slackText);
    if (c == null) slackText = String(slack / 100);
    else slack = c;
  };

  // The search is slow (each pair is a full route search): it runs in a worker, with progress and a Cancel button.
  const job = new Job();
  $effect(() => {
    const current = app; // read outside untrack: a changed plan or data runs the search again (the same question is not restarted)
    const args = { chainId: chain.id, slack };
    untrack(() => job.start(current, 'wanted', args));
  });
  onDestroy(() => job.cancel());
  const result = $derived(job.status === 'done' ? job.value : null);
  const groups = $derived(result ? groupWanted(result) : null);
  const maxStd = $derived(Math.max(1, ...(result?.wanted ?? []).map((x) => x.standard)));
  const target = $derived(ships.get(chain.target));
  const label = $derived(result?.objective === 'allin' ? t('all-in') : t('new money'));

  const ITEMS = 4, TIES = 8, NEEDS = 12;
  let expandedFor = $state(null); // chain id whose lists are expanded
  const showAll = $derived(expandedFor === chain.id);
  const pct = (cents) => `${Math.min(100, (100 * cents) / maxStd).toFixed(1)}%`;
</script>

{#snippet watch(x)}<RsiLink href={upgradeToolUrl({ from: x.from, to: x.to })} label={t('Watch on RSI')} aria={t('Watch {from} to {to} on RSI', { from: name(x.from), to: name(x.to) })} />{/snippet}

{#snippet bar(x)}
  <div class="row" data-from={x.from} data-to={x.to}>
    <span class="label">{name(x.from)} → {name(x.to)}</span>
    <span class="meta">{t('below {below} (Std {std})', { below: usd(x.below), std: usd(x.standard) })}{x.onBestRoute ? ' *' : ''} {@render watch(x)}</span>
    <div class="bar" title={t('Standard {std}, a Warbond below {below} helps', { std: usd(x.standard), below: usd(x.below) })}>
      <i class="std" style:width={pct(x.standard)}></i>
      <i class="mark" style:left={pct(x.below)}></i>
    </div>
  </div>
{/snippet}

{#snippet group(g, how)}
  <div class="group" data-to={g.to}>
    <div class="ghead"><ShipThumb ship={ships.get(g.to) ?? null} size="s" /> → {name(g.to)} <span class="how">{how}</span></div>
    {#each g.items.slice(0, ITEMS) as x (`${x.from}-${x.to}`)}{@render bar(x)}{/each}
    {#if g.items.length > ITEMS}
      <details>
        <summary>{t('+{n} more', { n: g.items.length - ITEMS })}</summary>
        {#each g.items.slice(ITEMS) as x (`${x.from}-${x.to}`)}{@render bar(x)}{/each}
      </details>
    {/if}
  </div>
{/snippet}

<div class="wh">
  <JobStatus {job} what={t('Looking for offers that would help')} />
  {#if result}
    <p class="muted">{t('Which Warbonds RSI offers next is unknown; this only says what a Warbond would have to cost to help. Today: {today}.', { today: result.best ? `${usd(result.bestCost)} ${label}` : t('no route') })}</p>

    {#if result.truncated}<p class="muted" data-truncated>{t('Checked the {checked} most promising of {candidates} pairs.', { checked: result.checked, candidates: result.candidates })}</p>{/if}
    {#if !result.wanted.length}
      <p class="muted">{t('No pair where a new Warbond would help.')}</p>
    {:else if groups.createsRoute.length}
      <h4>{t('Would create a route')}</h4>
      <p class="muted">{target?.concept ? t("RSI sells no upgrade into {ship} today (concept ship: its price rises before release, so any upgrade into it locks today's price, Standard included).", { ship: target?.name ?? name(chain.target) }) : t('RSI sells no upgrade into {ship} today.', { ship: target?.name ?? name(chain.target) })}</p>
      {#each groups.createsRoute.slice(0, showAll ? undefined : NEEDS) as x (`${x.from}-${x.to}`)}
        <div class="row" data-from={x.from} data-to={x.to}>
          <span class="label">{name(x.from)} → {name(x.to)}</span>
          <span class="meta">{t('up to {below}', { below: usd(x.below) })} {@render watch(x)}</span>
          <div class="bar"><i class="std" style:width={pct(x.standard)}></i><i class="mark" style:left={pct(x.below)}></i></div>
        </div>
      {/each}
      {#if groups.createsRoute.length > NEEDS && !showAll}<button onclick={() => { expandedFor = chain.id; }}>{t('Show all {n}', { n: groups.createsRoute.length })}</button>{/if}
    {:else}
      <h4>{t('Any discount helps')}</h4>
      {#each groups.ties.slice(0, showAll ? undefined : TIES) as g (g.to)}{@render group(g, '')}{:else}<p class="muted">{t('(none)')}</p>{/each}
      {#if groups.needs.length}
        <h4>{t('Would help if discounted enough')}</h4>
        {#each groups.needs.slice(0, showAll ? undefined : NEEDS) as g (g.to)}{@render group(g, t('needs {pct}% off', { pct: g.sharePct }))}{/each}
      {/if}
      {#if !showAll && (groups.ties.length > TIES || groups.needs.length > NEEDS)}
        <button onclick={() => { expandedFor = chain.id; }}>{t('Show all')}</button>
      {/if}
      {#if result.wanted.some((x) => x.onBestRoute)}<p class="muted">{t("* Standard bridge on today's route")}</p>{/if}
    {/if}

    <h4>{t('On sale near this route')}</h4>
    <label class="slack">{t('At most $')}
      <input type="text" inputmode="decimal" bind:value={slackText} onchange={commit} /> {t('more')}
    </label>
    {#each result.holding as h (`${h.from}-${h.to}`)}
      <div class="row" data-from={h.from} data-to={h.to}>
        <span class="label">{name(h.from)} → {name(h.to)}</span>
        <span class="meta">{t('Warbond {cash} (Standard {std}) · route {extra} more today', { cash: usd(h.cash), std: usd(h.standard), extra: usd(h.extra) })} {@render watch(h)}</span>
      </div>
    {:else}
      <p class="muted">{t('Nothing on sale within {amount} of the best route.', { amount: usd(slack) })}</p>
    {/each}
  {/if}
</div>

<style>
  h4 { margin: 12px 0 4px; color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; }
  .muted, .meta { color: var(--muted); }
  .group { margin: 8px 0; }
  .ghead { font-weight: 600; display: flex; align-items: center; gap: 8px; }
  .how { color: var(--accent); font-weight: 400; margin-left: 6px; }
  .row { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; padding: 3px 0; }
  .bar { grid-column: 1 / -1; position: relative; height: 6px; background: rgba(255, 255, 255, 0.1); border-radius: 3px; }
  .std { position: absolute; left: 0; top: 0; bottom: 0; background: var(--warn); border-radius: 3px; opacity: .55; }
  .mark { position: absolute; top: -2px; bottom: -2px; width: 3px; margin-left: -1px; background: var(--accent); border-radius: 1px; }
  details summary { cursor: pointer; color: var(--muted); }
  .slack { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; margin-bottom: 6px; }
  input { width: 5em; }
  button { margin-top: 6px; }
</style>
