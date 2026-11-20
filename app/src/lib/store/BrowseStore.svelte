<script>
  import { onMount } from 'svelte';
  import { ui, loadCatalog } from '../state.svelte.js';
  import { sync } from '../sync-actions.svelte.js';
  import { backend } from '../backend.js';
  import { ownedFleet } from '$logic/hangar.mjs';
  import { noMatchesText } from '$logic/describe.mjs';
  import { STORES, storeItems, storeCounts, annotate, visibleGroups, browseSelOf, searchItems, sortItems, SORTS, sortId, cardView, catalogAge, emptyStoreReason } from '../view/storeBrowser.mjs';
  import { applyFilters, optionCounts, toggleOption, setRange, activeFilters, removeFilter, resetGroup, resetAll, resultsText } from '../view/filters.mjs';
  import { stampIsStale } from '../view/nav.mjs';
  import GlassPanel from '../ui/GlassPanel.svelte';
  import SearchBox from '../ui/SearchBox.svelte';
  import FilterColumn from '../hangar/FilterColumn.svelte';
  import FilterBar from '../hangar/FilterBar.svelte';
  import CatalogCard from './CatalogCard.svelte';

  // app: the planner's data. The parent keys this component by ui.sample, so the state below is read again when the sample is entered or left.
  let { app } = $props();
  onMount(() => { if (!ui.ownLoaded) loadCatalog(); });

  // The store, search, sort and filters are kept for the session (ui.browse), like the Hangar's.
  let store = $state(STORES.some((s) => s.id === ui.browse.store) ? ui.browse.store : 'pledge');
  let query = $state(ui.browse.query);
  let sort = $state(sortId(ui.browse.sort));
  let sel = $state(browseSelOf(ui.browse.sel));
  let panelOpen = $state(false); // the filter panel of the narrow layout
  $effect(() => { ui.browse.store = store; ui.browse.query = query; ui.browse.sort = sort; ui.browse.sel = sel; });

  // Sample data has no catalog of its own: it shows the empty state and cannot refresh.
  const doc = $derived(ui.sample ? null : ui.catalog.doc);
  const canRefresh = $derived(backend.canSyncCatalog() && !ui.sample);
  // Only this tab's own sync says "Refreshing"; another sync running only keeps the button disabled.
  const refreshing = $derived(ui.syncBusy && /^store.catalog/.test(ui.syncProgress?.phase ?? ''));
  const refresh = () => sync('store-catalog');

  const ownedIds = $derived(new Set(ownedFleet(app.data.pledges ?? [], app.data.ships).map((f) => f.shipId).filter((id) => id != null)));
  const goalIds = $derived(new Set(Object.values(app.plans.chains).map((c) => c.target).filter((id) => id != null)));
  const all = $derived(doc ? annotate(doc.items, { ships: app.data.ships, owned: ownedIds, goals: goalIds }) : []);
  const counts = $derived(storeCounts(all));
  const inStore = $derived(storeItems(all, store));
  const searched = $derived(searchItems(inStore, query));
  const groups = $derived(visibleGroups(inStore, sel));
  const shown = $derived(sortItems(applyFilters(searched, groups, sel), sort));
  const optCounts = $derived(optionCounts(searched, groups, sel));
  const active = $derived(activeFilters(groups, sel));
  const cards = $derived(shown.map((i) => ({ key: i.id, card: cardView(i, store) })));
  const searching = $derived(query.trim() !== '');
  // The count of the open store is on its chip: the bar repeats it only once a search or a filter narrows the list.
  const countText = $derived(active.length || searching ? resultsText(shown.length, inStore.length, 'items') : '');
  const storeLabel = $derived(STORES.find((s) => s.id === store)?.label ?? '');
  const stale = $derived(stampIsStale(doc?.fetchedAt));
  const signedIn = $derived(doc?.signedIn === true);
  // A public catalog never has Subscriber or Concierge items: their chips show no number (a 0 would read as "RSI has none").
  const chipCount = (s) => (counts[s.id] || signedIn || s.id === 'pledge' ? counts[s.id] : null);
  const emptyText = $derived(emptyStoreReason(store, signedIn)
    ?? (!inStore.length ? `RSI lists nothing in the ${storeLabel} for this account right now.` : searching && !active.length ? noMatchesText(query) : 'No items match these filters.'));
  const pick = (id) => { store = id; panelOpen = false; };
</script>

<div class="browse">
  {#if !ui.catalog.loaded}
    <!-- the catalog file is being read -->
  {:else if !doc}
    <GlassPanel aria-label="No store catalog">
      {#if ui.sample}
        <p class="muted">The sample has no store catalog.</p>
      {:else}
        <p class="muted">Download RSI's whole store to browse it here, about 5 minutes. {backend.catalogNeedsSignIn() ? 'Sign in to RSI first (Sync menu).' : 'Sign in first to include the Subscriber store and Concierge items.'}</p>
        {#if canRefresh}<p><button type="button" class="primary" disabled={ui.syncBusy} onclick={refresh}>{refreshing ? 'Refreshing…' : 'Refresh store catalog'}</button></p>{/if}
      {/if}
      {#if ui.catalog.error}<p class="err" role="alert">{ui.catalog.error}</p>{/if}
    </GlassPanel>
  {:else}
    <p class="age" class:stale><span>{catalogAge(doc.fetchedAt, signedIn, new Date(), ui.catalog.source)}</span>
      {#if canRefresh} · <button type="button" class="link" disabled={ui.syncBusy} onclick={refresh}>{refreshing ? 'Refreshing…' : ui.catalog.source === 'feed' ? 'Refresh from RSI' : 'Refresh'}</button>{/if}</p>

    <div class="views" role="group" aria-label="Store">
      {#each STORES as s (s.id)}
        <button type="button" class="chip-btn" class:active={store === s.id} aria-pressed={store === s.id} data-store={s.id} onclick={() => pick(s.id)}>{s.label}{#if chipCount(s) != null} <span class="n">{chipCount(s)}</span>{/if}</button>
      {/each}
    </div>

    <SearchBox bind:value={query} label="Search the store" placeholder="Search ships, gear, paints" />

    <div class="body">
      <div class="barwrap">
        <FilterBar {active} {countText} bind:panelOpen panelId="browse-filters" onremove={(a) => { sel = removeFilter(groups, sel, a); }} onreset={() => { sel = resetAll(groups); }} />
        <label class="sort">Sort <select bind:value={sort} aria-label="Sort the store">{#each SORTS as o (o.id)}<option value={o.id}>{o.label}</option>{/each}</select></label>
      </div>
      <aside id="browse-filters" class="side" class:open={panelOpen} aria-label="Filters">
        <FilterColumn {groups} {sel} counts={optCounts} label="Filter the store"
          ontoggle={(g, o) => { sel = toggleOption(sel, g, o); }} onreset={(g) => { sel = resetGroup(groups, sel, g); }} onrange={(g, k, v) => { sel = setRange(sel, g, k, v); }} />
      </aside>
      <div class="results">
        {#if cards.length}
          <ul class="grid" aria-label={storeLabel}>
            {#each cards as c (c.key)}<li><CatalogCard card={c.card} /></li>{/each}
          </ul>
        {:else}
          <p class="muted" data-empty-store={store}>{emptyText}</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .browse { display: flex; flex-direction: column; gap: 12px; }
  .muted, .err { margin: 0 0 8px; }
  .muted { color: var(--muted); }
  .err { color: var(--warn); }
  .age { margin: 0; color: var(--muted); font-size: 13px; }
  .age.stale { color: var(--warn); }
  .link { background: none; border: 0; padding: 0; color: var(--link); text-decoration: underline; }
  .views { display: flex; gap: 6px; flex-wrap: wrap; }
  .views .chip-btn { font-size: 14px; padding: 4px 14px; }
  .n { opacity: 0.75; }
  .body { display: grid; grid-template-columns: 210px minmax(0, 1fr); grid-template-areas: "side bar" "side results"; column-gap: 16px; row-gap: 10px; align-items: start; }
  .barwrap { grid-area: bar; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; }
  .sort { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 13px; }
  .side { grid-area: side; position: sticky; top: 70px; max-height: calc(100vh - 90px); overflow-y: auto; padding: 4px 6px 12px 2px; }
  .results { grid-area: results; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; }
  @media (max-width: 820px) {
    .body { grid-template-columns: minmax(0, 1fr); grid-template-areas: "bar" "side" "results"; row-gap: 8px; }
    .side { display: none; position: static; max-height: none; background: var(--glass); border: 1px solid var(--glass-border); border-radius: 10px; padding: 12px; }
    .side.open { display: block; }
    .side :global(.col) { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px 16px; }
  }
</style>
