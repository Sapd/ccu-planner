<script>
  import { shipName } from '$logic/ships.mjs';
  import { upgradeToolUrl, hangarUrl } from '$logic/links.mjs';
  import { usd } from '$logic/format.mjs';
  import ShipThumb from './ShipThumb.svelte';
  import RsiLink from './RsiLink.svelte';
  import { localToday } from '$logic/availability.mjs';
  import { sessionOf } from '$logic/session.mjs';
  import { routeAdvice } from '$logic/advice.mjs';

  // A free-standing route (the plan explorer): no goal, so every step stays in route order and
  // none is "buy now" or "wait". The warnings come from routeAdvice with the app's expected prices, like on every other page, but without a
  // goal: Today and the goal pages also drop an alert when waiting would not make that goal's plan dearer (priceChange.mjs waitingPenalty,
  // which needs a goal), so this list can show an alert a goal page leaves out.
  let { app, route } = $props();
  const ships = $derived(app.data.ships);
  const name = (id) => shipName(ships, id);
  const owned = $derived(new Map(app.data.owned.map((o) => [o.copyId, o])));
  const warnings = $derived(route ? routeAdvice(null, null, route, { ships, expected: app.expected, avail: sessionOf(app).avail(localToday()) }).alerts.map((a) => a.text) : []);
</script>

{#each warnings as w}<p class="warn">{w}</p>{/each}
{#if route}
  <section>
    <h4>Route</h4>
    {#each route.steps as s}
      {@const c = s.copyId ? owned.get(s.copyId) : null}
      <div class="step {s.kind}" data-from={s.from} data-to={s.to}>
        <span class="path"><ShipThumb ship={ships.get(s.to) ?? null} size="xs" /> <span class="names">{name(s.from)} → {name(s.to)}</span></span>
        <span class="side">
        {#if s.kind === 'owned'}
          <span class="meta">Owned CCU
            {#if c}· paid {usd(c.paid?.cents)} · {c.giftable ? 'giftable' : 'not giftable'}{/if}
            {#if s.otherCopies}· +{s.otherCopies} more copies{/if}</span>
        {:else}
          <span class="meta">{s.kind === 'warbond' ? 'Warbond' : 'Standard'} {usd(s.cash)}</span>
        {/if}
        {#if s.kind === 'owned'}
          <RsiLink href={hangarUrl()} label="Hangar" aria="Open {name(s.from)} to {name(s.to)} in the RSI hangar" />
        {:else}
          <RsiLink href={upgradeToolUrl({ from: s.from, to: s.to })} label="Buy on RSI" aria="Buy {name(s.from)} to {name(s.to)} on RSI" />
        {/if}
        </span>
      </div>
    {/each}
  </section>
{/if}

<style>
  h4 { margin: 12px 0 4px; color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; }
  .step { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; padding: 6px 10px; margin: 3px 0; background: var(--glass); border: 1px solid var(--glass-border); border-left: 3px solid var(--glass-border); border-radius: 4px; }
  .step.owned { border-left-color: var(--own); }
  .step.standard { border-left-color: var(--wait); }
  .step.warbond { border-left-color: var(--now); }
  .path { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 12em; }
  .names { min-width: 0; overflow-wrap: anywhere; }
  .meta { color: var(--muted); }
  .side { display: flex; gap: 8px; align-items: baseline; }
  .step:not(:hover):not(:focus-within) :global(.rsi) { opacity: .45; }
  .warn { margin: 6px 0; padding: 6px 10px; border: 1px solid var(--warn); color: var(--warn); border-radius: 4px; }
</style>
