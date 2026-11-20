<script>
  import { filtersButtonText } from '../view/filters.mjs';

  // Above the results: the Filters button (narrow layout), the result count, one removable chip per active filter and "Reset all".
  // active: activeFilters() entries; panelOpen (bindable): the narrow filter panel; panelId: id of that panel.
  let { active, countText, panelOpen = $bindable(false), panelId, onremove, onreset } = $props();
</script>

<div class="bar">
  <button type="button" class="fbtn" aria-expanded={panelOpen} aria-controls={panelId} onclick={() => { panelOpen = !panelOpen; }}>{filtersButtonText(active.length)}</button>
  <span class="count" role="status" aria-live="polite">{countText}</span>
  {#each active as a (a.id)}
    <button type="button" class="chip" onclick={() => onremove(a)} aria-label="Remove filter: {a.label}">{a.label} <span aria-hidden="true">×</span></button>
  {/each}
  {#if active.length}<button type="button" class="resetall" onclick={onreset}>Reset all</button>{/if}
</div>

<style>
  .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; min-height: 28px; }
  .count { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; margin-right: 4px; }
  .chip { display: inline-flex; gap: 6px; align-items: center; padding: 1px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: rgba(8, 12, 20, 0.55); border: 1px solid var(--accent); color: var(--accent); }
  .resetall { background: none; border: none; padding: 0 4px; color: var(--muted); text-decoration: underline; font-size: 12px; }
  .fbtn { display: none; }
  @media (max-width: 820px) { .fbtn { display: inline-block; } }
</style>
