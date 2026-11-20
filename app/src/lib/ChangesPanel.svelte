<script>
  import { sessionOf } from '$logic/session.mjs';
  import { changesSinceSync } from '$logic/changes.mjs';
  import { changesHeadline, goalChangeLine, changesGoalLines } from '$logic/describe.mjs';
  import GlassPanel from './ui/GlassPanel.svelte';

  // "Since last sync": what the total and each goal's cost did since the data last changed, and why.
  let { app } = $props();
  const c = $derived(changesSinceSync(sessionOf(app), app.data.planSnapshots));
  const name = (id) => app.data.ships.get(id)?.name ?? 'unknown ship';
  const lines = $derived(c ? c.goals.map((g) => goalChangeLine(g, { name })) : []);
  const goalLines = $derived(c ? changesGoalLines(c) : []);
  const hasDetail = $derived(lines.length > 0 || goalLines.length > 0);
  // Open when the total moved; one line when it did not. The user's click wins.
  let toggled = $state(null);
  const open = $derived(hasDetail && (toggled ?? (c?.totalDelta !== 0 || goalLines.length > 0)));
</script>

{#if c}
  <GlassPanel id="since-sync" class="changes" aria-label="Since last sync">
    <h2>
      <span class="what">Since last sync</span>
      <span class="head" class:up={c.totalDelta > 0} class:down={c.totalDelta < 0}>{changesHeadline(c)}</span>
      {#if hasDetail}
        <button type="button" class="more" aria-expanded={open} aria-controls="since-sync-detail" onclick={() => { toggled = !open; }}>{open ? 'Hide' : 'Details'} {open ? '▴' : '▾'}</button>
      {/if}
    </h2>
    {#if open}
      <ul id="since-sync-detail">
        {#each lines as line, i (i)}<li>{line}</li>{/each}
        {#each goalLines as line, i (i)}<li>{line}</li>{/each}
      </ul>
    {/if}
  </GlassPanel>
{/if}

<style>
  h2 { margin: 0; font-size: 15px; display: flex; align-items: center; gap: 4px 12px; flex-wrap: wrap; }
  .what { color: var(--muted); font-weight: 600; }
  .head { font-weight: 700; }
  .head.up { color: var(--warn); }
  .head.down { color: var(--now); }
  .more { font-size: 12px; padding: 2px 10px; }
  ul { margin: 8px 0 0; padding-left: 18px; display: grid; gap: 4px; font-size: 14px; }
</style>
