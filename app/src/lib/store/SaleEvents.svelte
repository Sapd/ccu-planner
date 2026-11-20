<script>
  import { noEventsNoticeStore } from '$logic/describe.mjs';
  import { isDay } from '$logic/availability.mjs';
  import { eventSource, feedIsStale } from '$logic/feed.mjs';
  import { dispatch, ui } from '../state.svelte.js';
  import Fold from '../goals/Fold.svelte';

  // The sale events list with add / remove. Shown on the Store page only; Advanced > Price assumptions links there.
  let { app } = $props();
  const events = $derived(app.saleEvents.events);
  // The feed's publisher stopped (its newest data is over 30 days old): its events stay, but may be out of date.
  const feedStale = $derived(!ui.sample && feedIsStale(ui.feed.generatedAt));
  let evName = $state('');
  let evFrom = $state('');
  let evTo = $state('');
  let busy = $state(false);
  const evProblem = $derived(!evName.trim() ? 'Enter a name.' : !isDay(evFrom) || !isDay(evTo) ? 'Dates are YYYY-MM-DD.' : evFrom > evTo ? 'The event cannot end before it starts.' : null);
  async function addEvent(e) {
    e.preventDefault();
    if (evProblem || busy) return;
    busy = true;
    try { await dispatch({ type: 'setSaleEvent', name: evName.trim(), from: evFrom, to: evTo }); } finally { busy = false; }
    evName = ''; evFrom = ''; evTo = '';
  }
  const removeEvent = (id) => dispatch({ type: 'removeSaleEvent', id });
</script>

<div class="saleevents">
  <p class="muted">Upgrades bought only because of an event may disappear after it. Events marked "CCU Planner feed" are kept up to date for you; an event you add with the same name or dates replaces the feed's.</p>
  <div class="how"><Fold title="How we decide"><p class="muted">Melt and buy-later treat a ship as regular only once a sync saw it on sale on at least 2 days, 7 or more days apart, outside every event.</p></Fold></div>
  {#if feedStale}<p class="note" data-hint="feed-stale">The CCU Planner feed has not been updated since {ui.feed.generatedAt.slice(0, 10)}, so its sale events may be out of date. Add events yourself if you know of one.</p>{/if}
  {#if noEventsNoticeStore(app.saleEvents)}<p class="note" data-hint="no-events">{noEventsNoticeStore(app.saleEvents)}</p>{/if}
  {#each events as ev (ev.id)}
    <div class="row" data-event={ev.id}>
      <span>{ev.name} · {ev.from} to {ev.to} <small class="src" data-source={eventSource(ev)}>{eventSource(ev) === 'feed' ? 'CCU Planner feed' : 'added by you'}</small></span>
      {#if eventSource(ev) === 'you'}<button type="button" onclick={() => removeEvent(ev.id)} aria-label="Remove sale event {ev.name}">Remove</button>{/if}
    </div>
  {:else}
    <p class="muted">No sale events set.</p>
  {/each}
  <form class="add" onsubmit={addEvent}>
    <label>Name <input bind:value={evName} placeholder="e.g. Anniversary sale" /></label>
    <label>From <input bind:value={evFrom} placeholder="YYYY-MM-DD" /></label>
    <label>To <input bind:value={evTo} placeholder="YYYY-MM-DD" /></label>
    <button type="submit" class="primary" disabled={!!evProblem || busy}>Add sale event</button>
    {#if evProblem && (evName || evFrom || evTo)}<p class="muted prob">{evProblem}</p>{/if}
  </form>
</div>

<style>
  p { margin: 4px 0; }
  .muted { color: var(--muted); }
  .note { color: var(--text); }
  .row { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--glass-border); }
  .how { margin: 8px 0; }
  .src { color: var(--muted); margin-left: 6px; }
  .add { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; margin-top: 12px; }
  .prob { flex-basis: 100%; margin: 0; }
  label { display: grid; gap: 4px; color: var(--muted); font-size: 12px; }
</style>
