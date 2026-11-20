<script>
  import { t, tn } from '$logic/i18n.mjs';
  import { incomingCount } from '$logic/planner.mjs';
  import { sessionOf } from '$logic/session.mjs';
  import { noRouteMessage, noMatchesText, IMPORT_BUTTON, LEVEL_TEXT, ACCEPT_HELP, goalStatusText, acceptedDriftNote, changesDeltaText, plannedTotalText, PLANNED_TOTAL_BASIS } from '$logic/describe.mjs';
  import { changesSinceSync } from '$logic/changes.mjs';
  import { usd } from '$logic/format.mjs';
  import { shipName, goalNamer } from '$logic/ships.mjs';
  import { bulkPreview, NOTHING_HELD } from '$logic/reservation.mjs';
  import { todayView } from './view/today.mjs';
  import { tableSummary } from './view/goalTable.mjs';
  import { ui, openGoal, dispatch, openChanges } from './state.svelte.js';
  import GoalsTable from './goals/GoalsTable.svelte';
  import ShipThumb from './ShipThumb.svelte';
  import GlassPanel from './ui/GlassPanel.svelte';
  import SearchBox from './ui/SearchBox.svelte';
  import { matchesQuery, searchText } from '$logic/search.mjs';
  import Explainer from './ui/Explainer.svelte';
  import GoalDetail from './GoalDetail.svelte';
  import AddChain from './AddChain.svelte';
  import ImportGoals from './goals/ImportGoals.svelte';
  import { tick, onDestroy } from 'svelte';
  import { scrollBehavior } from './view/motion.mjs';

  let { app } = $props();
  const v = $derived(todayView(app));
  const ships = $derived(app.data.ships);
  const ship = (id) => ships.get(id) ?? null;
  // Quick search only earns its place once the card grid is long.
  const SEARCH_MIN = 7;
  let query = $state('');
  const searching = $derived(v.goals.length >= SEARCH_MIN && query.trim() !== '');
  const goalText = (g) => searchText(g.name, ships.get(g.targetId)?.name, ships.get(g.targetId)?.manufacturer?.name ?? ships.get(g.targetId)?.manufacturer);
  const goalsShown = $derived(searching ? v.goals.filter((g) => matchesQuery(goalText(g), query)) : v.goals);
  // Planning order: high, normal, low; inside a level the order the shared plan chose. The first goal gets first pick.
  const session = $derived(sessionOf(app));
  const byId = $derived(new Map(v.goals.map((g) => [g.goalId, g])));
  const levels = $derived(session.levels()
    .map((l) => ({ priority: l.priority, goals: l.ids.map((id) => byId.get(id)).filter((g) => g && (!searching || matchesQuery(goalText(g), query))) }))
    .filter((l) => l.goals.length));
  const tone = (g) => (g.status === 'buy' ? 'now' : g.status === 'norush' ? 'norush' : g.status === 'wait' ? 'wait' : g.status === 'done' ? 'own' : 'warn');
  const changes = $derived(changesSinceSync(session, app.data.planSnapshots));
  // Accepted goals count in the total at their accepted price; say so only for the goals where today's price differs.
  const drift = $derived(v.goals.filter((g) => g.acceptedCash != null && g.cash != null && g.acceptedCash !== g.cash).map((g) => ({ name: g.targetName ?? g.name, accepted: g.acceptedCash, now: g.cash })));
  let strip = $state(null);
  // The open goal's chip stays visible in the strip when the strip scrolls sideways.
  $effect(() => { currentId; tick().then(() => strip?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })); });
  const noRouteTitle = (g) => noRouteMessage(ships.get(g.targetId)?.name ?? t('unknown ship'), incomingCount(app.graph, g.targetId));

  // The open goal: the selected one, else the first.
  const currentId = $derived(app.plans.chains[ui.selected] ? ui.selected : (session.levels()[0]?.ids[0] ?? null));
  const chain = $derived(currentId ? app.plans.chains[currentId] : null);

  let adding = $state(false);
  // "Import from CCU Game" and "Reserve all chains" are buttons of the page header (GoalsActions); their state lives in ui.
  const importing = $derived(ui.importingGoals);
  // The shared plan of all goals; its total is the page header.
  const fleet = $derived(v.goals.length >= 2 ? sessionOf(app).fleet() : null);
  // Reserve all only touches goals that have a route and no reserved chain yet; reserved goals stay as they are.
  const canAcceptAll = $derived(!!fleet && fleet.plans.some((p) => p.route && !app.plans.chains[p.chainId]?.accepted));
  let accepting = $state(false);
  // Reserving everything first shows what each goal would hold; nothing happens until the preview is confirmed.
  const previewing = $derived(ui.reserveAllOpen && canAcceptAll);
  const preview = $derived(fleet && previewing ? bulkPreview(fleet.plans, app.plans.chains, { goalName: goalNamer(app.plans, ships), name: (id) => shipName(ships, id), paidOf: (id) => app.data.owned.find((o) => o.copyId === id)?.paid?.cents ?? null }) : []);
  // Closing the preview puts focus back on the button that opened it (it is gone after Reserve, when nothing is left to reserve).
  const closePreview = () => { ui.reserveAllOpen = false; tick().then(() => document.querySelector('[data-reserve-all]')?.focus()); };
  async function acceptAll() {
    accepting = true;
    try { await dispatch({ type: 'acceptFleet', plans: fleet.plans }); closePreview(); } finally { accepting = false; }
  }
  let previewHead = $state(null);
  // Opening the preview moves focus to its heading, so the keyboard and a screen reader land where it appeared.
  $effect(() => { if (previewing && previewHead) tick().then(() => previewHead?.focus({ preventScroll: true })); });
  // What a page was in the middle of does not outlive it: the import form and the preview start closed on the next visit.
  onDestroy(() => { ui.reserveAllOpen = false; ui.importingGoals = false; });
  // The detail pane: beside the list on wide windows, below it on narrow ones. After a pick, bring it into view
  // only when it is not already on screen (on wide windows it is, so nothing moves).
  let pane = $state(null);
  async function reveal() {
    await tick();
    const r = pane?.getBoundingClientRect();
    if (r && (r.top < 0 || r.top > window.innerHeight * 0.5)) pane.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  }
  const pick = (id) => { openGoal(id); reveal(); };

  // Today's "Pick your first goal ship" opens the form once.
  $effect(() => { if (ui.addingGoal) { adding = true; ui.importingGoals = false; ui.addingGoal = false; reveal(); } });
  $effect(() => { if (ui.importingGoals) { adding = false; reveal(); } });
  $effect(() => { if (ui.reserveAllOpen) reveal(); });
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && previewing && !e.defaultPrevented) closePreview(); }} />

<div class="goals" class:hasback={!!ui.back}>
  {#snippet searchBox()}
    {#if v.goals.length >= SEARCH_MIN}
      <SearchBox bind:value={query} label={t('Search goals')} placeholder={t('Search goals by ship')} shown={goalsShown.length} total={v.goals.length} />
    {/if}
  {/snippet}
  {#snippet tail()}
    {#if fleet}
      <p class="total" data-planned-total><b>{plannedTotalText(fleet.totalCash, v.goals)}</b> · {tableSummary(v.goals.length, v.goals.reduce((n, g) => n + g.buyCount, 0))}{#if changes} · <button type="button" class="link" onclick={openChanges}>{changesDeltaText(changes)}</button>{/if}</p>
      {#if v.goals.some((g) => g.acceptedCash != null) || drift.length}
        <details class="how"><summary>{t('How the total adds up')}</summary>
          {#if v.goals.some((g) => g.acceptedCash != null)}<p class="help">{t(PLANNED_TOTAL_BASIS)}</p>{/if}
          {#if drift.length}<p class="help">{acceptedDriftNote(drift)}</p>{/if}
        </details>
      {/if}
    {/if}
  {/snippet}

  <div class="split">
  <!-- Wide: the list on the left. Narrow: it is replaced by the strip below, so the order on screen is the order of the page. -->
  <div class="top wideonly">
    {@render tail()}
    {@render searchBox()}
    <GoalsTable {levels} {currentId} ship={ship} onOpen={pick} {noRouteTitle} />
    {#if searching && !goalsShown.length}<p class="empty">{noMatchesText(query)}</p>{/if}
  </div>

  <div class="narrowonly head">
    {@render searchBox()}
    <div class="strip" bind:this={strip} role="group" aria-label={t('Switch between your goals')}>
      {#each levels as l (l.priority)}
        <div class="lvl" role="group" aria-label={t(LEVEL_TEXT[l.priority].title)}>
          <span class="lvlname">{t(LEVEL_TEXT[l.priority].title)}</span>
          <div class="chips">
            {#each l.goals as g (g.goalId)}
              <button type="button" class="chipgoal {tone(g)}" aria-pressed={g.goalId === currentId} class:active={g.goalId === currentId} title={goalStatusText(g)} onclick={() => pick(g.goalId)}>
                <ShipThumb ship={ship(g.targetId)} size="s" />
                <span class="gtext"><span class="gname">{g.targetName ?? g.name}</span><span class="gstat">{goalStatusText(g)}</span></span>
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
    {#if searching && !goalsShown.length}<p class="empty">{noMatchesText(query)}</p>{/if}
  </div>

  <div class="pane" bind:this={pane}>
    {#if previewing}
      <GlassPanel>
        <div class="preview" role="region" aria-labelledby="reserve-all-head" data-bulk-preview>
          <p class="help" id="reserve-all-head" tabindex="-1" bind:this={previewHead}><b>{preview.length === 1 ? t('This goal would be reserved.') : t('These {n} goals would be reserved.', { n: preview.length })}</b> {t(ACCEPT_HELP)}</p>
          {#each preview as g (g.chainId)}
            <div class="pgoal"><b>{g.goalName}</b>
              {#if g.lines.length}<ul>{#each g.lines as line, n (n)}<li>{line}</li>{/each}</ul>{:else}<span class="help"> · {t(NOTHING_HELD)}</span>{/if}
            </div>
          {/each}
          <div class="btns">
            <button type="button" class="primary" disabled={accepting || !preview.length} onclick={acceptAll}>{preview.length === 1 ? t('Reserve this chain') : t('Reserve {n} chains', { n: preview.length })}</button>
            <button type="button" onclick={closePreview}>{t('Cancel')}</button>
          </div>
        </div>
      </GlassPanel>
    {/if}

    {#if adding}
      <GlassPanel><AddChain {app} {ships} onclose={() => { adding = false; }} /></GlassPanel>
    {/if}

    {#if importing}
      <GlassPanel><ImportGoals {app} onclose={() => { ui.importingGoals = false; }} /></GlassPanel>
    {/if}

    {#if chain}
      {#key chain.id}<GoalDetail {app} {chain} />{/key}
    {:else if !adding && !importing && !previewing}
      <GlassPanel>
        <Explainer inline />
        <p class="empty">{t('No goals yet. Press “+ New goal” to pick the ship you want.')}</p>
      </GlassPanel>
    {/if}
  </div>

  <div class="narrowonly foot">{@render tail()}</div>
  </div>
</div>

<style>
  .goals.hasback { --stick: 34px; }
  .goals { display: flex; flex-direction: column; gap: 14px; container-type: inline-size; }
  .split { display: flex; flex-direction: column; gap: 14px; }
  .pane { display: flex; flex-direction: column; gap: 14px; min-width: 0; scroll-margin-top: 12px; }
  /* Wide: the goal list stays on the left (scrolling on its own when long), the open goal fills the right. */
  @container (min-width: 960px) {
    .split { display: grid; grid-template-columns: clamp(400px, 34%, 520px) minmax(0, 1fr); align-items: start; }
    .split .top { position: sticky; top: var(--stick, 0px); max-height: calc(100dvh - 110px); overflow-y: auto; padding: 4px 8px 4px 4px; }
  }
  .narrowonly { display: none; }
  /* Narrow: search and the strip come first, then the open goal, then the list's other controls. */
  @container (max-width: 959px) {
    .split .wideonly { display: none; }
    .split .narrowonly { display: flex; flex-direction: column; gap: 10px; }
    .head { position: sticky; top: var(--stick, 0px); z-index: var(--z-strip); padding: 6px 0; background: rgba(10, 14, 22, 0.92); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); }
    .head :global(.searchbox) { position: static; padding: 0; background: none; backdrop-filter: none; }
    .pane { scroll-margin-top: 90px; }
  }
  .strip { display: flex; gap: 14px; overflow-x: auto; scrollbar-width: thin; padding-bottom: 4px; }
  .lvl { display: flex; flex-direction: column; gap: 2px; flex: none; }
  .lvlname { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .chips { display: flex; gap: 8px; }
  .chipgoal { flex: none; display: flex; align-items: center; gap: 8px; padding: 6px 12px 6px 6px; border-radius: 12px; text-align: left; max-width: 240px; background: var(--glass); }
  .chipgoal.active { border-color: var(--accent); background: rgba(76, 194, 255, 0.22); }
  .gtext { display: flex; flex-direction: column; min-width: 0; }
  .gname { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gstat { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .now .gstat { color: var(--now); } .norush .gstat { color: var(--accent); } .wait .gstat { color: var(--wait); } .warn .gstat { color: var(--warn); }
  .top { display: flex; flex-direction: column; gap: 10px; }
  .help { margin: 0; color: var(--muted); font-size: 13px; }
  .link { background: none; border: 0; padding: 0; color: var(--link); text-decoration: underline; cursor: pointer; font: inherit; }
  .btns { display: flex; flex-wrap: wrap; gap: 8px; }
  .total { margin: 0; font-size: 15px; }
  .how summary { cursor: pointer; color: var(--muted); font-size: 13px; }
  .how p { margin: 4px 0 0; }
  .preview { display: grid; gap: 8px; padding: 10px 12px; border-radius: var(--radius); border: 1px solid var(--glass-border); background: var(--glass); }
  .preview p { margin: 0; }
  .preview p:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .pgoal ul { margin: 2px 0 0; padding-left: 18px; font-size: 13px; color: var(--muted); }
  .empty { margin: 0; color: var(--muted); }
</style>
