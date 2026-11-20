<script>
  import ShipThumb from './ShipThumb.svelte';
  import ShipPicker from './ShipPicker.svelte';
  import GlassPanel from './ui/GlassPanel.svelte';
  import SearchBox from './ui/SearchBox.svelte';
  import { matchesQuery } from '$logic/search.mjs';
  import { priceLine, assumptionsCoverText, availabilityText, noMatchesText } from '$logic/describe.mjs';
  import { localToday } from '$logic/availability.mjs';
  import { parsePriceUsd, priceRows, conceptShips, availabilityRows, splitAvailability } from './view/hangar.mjs';
  import { usd } from '$logic/format.mjs';
  import { dispatch, openSaleEvents } from './state.svelte.js';
  import Fold from './goals/Fold.svelte';

  let { app } = $props();
  const ships = $derived(app.data.ships);
  let query = $state('');
  const searching = $derived(query.trim() !== '');
  const allRows = $derived(priceRows(app.data, app.overrides, app.expected));
  const rows = $derived(allRows.filter((r) => matchesQuery(r.name, query)));
  const affected = $derived(app.expected.filter((e) => e.assumed).length);
  const allConcepts = $derived(conceptShips(ships));
  const concepts = $derived(allConcepts.filter((s) => matchesQuery(s.name, query)));

  // Availability
  const avail = $derived(availabilityRows(app, localToday()));
  async function markAvailability(shipId, value) {
    await dispatch(value === 'auto' ? { type: 'clearAvailability', shipId } : { type: 'setAvailability', shipId, value });
  }
  const availShown = $derived(avail.filter((r) => matchesQuery(r.name, query)));
  const split = $derived(splitAvailability(availShown));
  let unknownOpen = $state(false);
  $effect(() => { if (searching) unknownOpen = true; });

  let shipId = $state(null);
  let priceText = $state('');
  let note = $state('');
  let busy = $state(false);
  let resets = $state(0);
  const cents = $derived(parsePriceUsd(priceText));
  const problem = $derived(shipId == null ? 'Pick a ship.' : cents == null ? 'Enter a price in dollars above zero.' : null);

  async function add(e) {
    e.preventDefault();
    if (problem || busy) return;
    busy = true;
    try { await dispatch({ type: 'setPrice', shipId, cents, note: note.trim() || undefined }); } finally { busy = false; }
    shipId = null; priceText = ''; note = ''; resets += 1;
  }
  const clear = (id) => dispatch({ type: 'clearPrice', shipId: id });
</script>

<div class="prices">
  <SearchBox bind:value={query} label="Search price assumptions" placeholder="Search ships" shown={rows.length + availShown.length + concepts.length} total={allRows.length + avail.length + allConcepts.length} />

  <p class="saleslink">These are the planner's working assumptions; most people never need to change them. <button type="button" class="linkbtn" onclick={() => openSaleEvents()}>Manage sale dates in Store</button>.</p>

  <GlassPanel>
    <h2>Expected prices ({searching ? `${rows.length} of ${allRows.length}` : rows.length})</h2>
    <p class="muted">{assumptionsCoverText(affected)}</p>
    {#each rows as r (r.shipId)}
      <div class="row" data-ship={r.shipId}>
        <span class="lbl"><ShipThumb ship={ships.get(r.shipId) ?? null} size="s" /><span>{priceLine(r.name, r.today, r.override, r.affected)}</span></span>
        <button type="button" onclick={() => clear(r.shipId)} aria-label="Clear expected price for {r.name}">Clear</button>
      </div>
    {:else}
      <p class="muted">{searching && allRows.length ? noMatchesText(query) : 'No expected prices set.'}</p>
    {/each}

    <form class="add" onsubmit={add}>
      {#key resets}
        <ShipPicker {ships} bind:value={shipId} label="Ship" id="price-ship" />
      {/key}
      <label>Expected price $ <input type="text" inputmode="decimal" bind:value={priceText} /></label>
      <label>Note <input bind:value={note} placeholder="optional" /></label>
      {#if problem && (shipId != null || priceText)}<p class="muted">{problem}</p>{/if}
      <button type="submit" class="primary" disabled={!!problem || busy}>Set expected price</button>
    </form>
  </GlassPanel>

  {#snippet availRow(r)}
    <div class="row" data-avail={r.shipId} data-status={r.status}>
      <span class="lbl"><ShipThumb ship={ships.get(r.shipId) ?? null} size="s" /><span>{r.name}: {availabilityText(r)}</span></span>
      <select value={r.mark} onchange={(e) => markAvailability(r.shipId, e.currentTarget.value)} aria-label="Availability of {r.name}">
        <option value="auto">auto</option>
        <option value="regular">regular</option>
        <option value="event-only">event-only</option>
      </select>
    </div>
  {/snippet}

  <GlassPanel>
    <h2>Ship availability ({searching ? `${availShown.length} of ${avail.length}` : avail.length})</h2>
    <p class="muted">Whether a ship is on sale all year (regular) or only during sales events. The planner learns this from your syncs; set it by hand only if it is wrong.</p>
    {#each split.known as r (r.shipId)}{@render availRow(r)}{:else}
      <p class="muted">{searching && avail.length ? noMatchesText(query) : 'No ship has a verdict yet.'}</p>
    {/each}
    {#if split.unknown.length}
      <Fold title="{split.unknown.length} ships not seen on sale often enough yet" bind:open={unknownOpen}>
        <p class="muted">The planner treats these as unknown until a sync sees them on sale on several days. You can still mark one by hand.</p>
        {#each split.unknown as r (r.shipId)}{@render availRow(r)}{/each}
      </Fold>
    {/if}
  </GlassPanel>

  <GlassPanel>
    <h2>Concept ships ({searching ? `${concepts.length} of ${allConcepts.length}` : concepts.length})</h2>
    {#each concepts as s (s.id)}
      <div class="row" data-ship={s.id}><span class="lbl"><ShipThumb ship={s} size="s" /><span>{s.name}</span></span><span class="muted">{usd(s.msrp)} · {s.onSale ? 'on sale' : 'not on sale'}</span></div>
    {:else}
      <p class="muted">{searching && allConcepts.length ? noMatchesText(query) : 'No concept ships.'}</p>
    {/each}
  </GlassPanel>
</div>

<style>
  .prices { display: flex; flex-direction: column; gap: 14px; }
  h2 { margin: 0 0 6px; font-size: 18px; }
  p { margin: 4px 0; }
  .muted { color: var(--muted); }
  .linkbtn { background: none; border: 0; padding: 0; color: var(--link); text-decoration: underline; }
  .row { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--glass-border); }
  .lbl { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .add { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: end; margin: 12px 0 0; }
  label { display: grid; gap: 4px; color: var(--muted); font-size: 12px; }
</style>
