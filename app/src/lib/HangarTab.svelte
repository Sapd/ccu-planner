<script>
  import { t, tn } from '$logic/i18n.mjs';
  import { hangarRows, meltView, buybackRows, keyed, pledgeOverview, pledgeById, HANGAR_VIEWS as VIEWS } from './view/hangar.mjs';
  import { usd } from '$logic/format.mjs';
  import { selOf, applyFilters, optionCounts, toggleOption, setRange, activeFilters, removeFilter, resetGroup, resetAll, resultsText, nextSort, sortBy } from './view/filters.mjs';
  import { standardPrices } from '$logic/melt.mjs';
  import { ccuRows, ccuResult, CCU_GROUPS, CCU_SORT_FIRST, ccuSortValue } from './view/ccuTable.mjs';
  import { ownedCards, goalCards, fleetItems, fleetCountText, FLEET_GROUPS } from './view/fleet.mjs';
  import { otherPledges, searchPledges, OTHER_GROUPS } from './view/otherPledges.mjs';
  import { todayView } from './view/today.mjs';
  import { spentCents, savedSummary, copiesInUse, markInUse, unusedSummary } from './view/hangarSummary.mjs';
  import PledgeDetail from './PledgeDetail.svelte';
  import RsiLink from './RsiLink.svelte';
  import MeltTab from './MeltTab.svelte';
  import GlassPanel from './ui/GlassPanel.svelte';
  import SearchBox from './ui/SearchBox.svelte';
  import FilterColumn from './hangar/FilterColumn.svelte';
  import FilterBar from './hangar/FilterBar.svelte';
  import ShipsGrid from './hangar/ShipsGrid.svelte';
  import UpgradesTable from './hangar/UpgradesTable.svelte';
  import OtherList from './hangar/OtherList.svelte';
  import VirtualCcus from './hangar/VirtualCcus.svelte';
  import { matchesQuery, searchText } from '$logic/search.mjs';
  import { noMatchesText } from '$logic/describe.mjs';
  import TokenPanel from './goals/TokenPanel.svelte';
  import Term from './ui/Term.svelte';
  import Fold from './goals/Fold.svelte';
  import { tokenPool, tokenSettings } from '$logic/tokens.mjs';
  import { ownedFleet } from '$logic/hangar.mjs';
  import { hangarUrl, buybackUrl } from '$logic/links.mjs';
  import { scrollBehavior } from './view/motion.mjs';
  import { ui, openGoalFrom, dispatch } from './state.svelte.js';
  import { tick } from 'svelte';

  let { app } = $props();
  const ship = (id) => (id == null ? null : app.data.ships.get(id) ?? null);
  const view = $derived(hangarRows(app.data, app.plans));
  const buyback = $derived(buybackRows(app.data));
  const pledges = $derived(app.data.pledges ?? []);
  const overview = $derived(pledgeOverview(pledges));
  const fleet = $derived(ownedFleet(pledges, app.data.ships));
  // "Worth melting" goes first when there are candidates (Today's melt tip lands here), otherwise last.
  const meltFirst = $derived(meltView(app).plan.candidates.length > 0);
  const tokenCfg = $derived(tokenSettings(app.plans));
  const ltiIds = $derived(new Set((app.data.lti ?? []).map((tk) => tk.pledgeId)));
  const poolIds = $derived(new Set(tokenPool(app.data.lti ?? [], tokenCfg).map((tk) => tk.pledgeId)));

  // The view, search, filters, sort and opened groups are kept for the session (ui.hangar): the page is rebuilt on every visit.
  const viewCount = $derived({ ships: overview.chips.ships, ccu: overview.chips.ccu, other: overview.chips.others });
  const startView = () => {
    const v = ['ships', 'ccu', 'other'].includes(ui.hangar.chip) ? ui.hangar.chip : 'other';
    // Nothing chosen yet and the first view is empty: open the first one that has something.
    return !ui.hangar.picked && !viewCount[v] ? (['ships', 'ccu', 'other'].find((id) => viewCount[id]) ?? v) : v;
  };
  let current = $state(startView());
  let query = $state(ui.hangar.query);
  let sort = $state(ui.hangar.sort);
  let fleetSel = $state(selOf(ui.hangar.sel.fleet, FLEET_GROUPS));
  let ccuSel = $state(selOf(ui.hangar.sel.ccu, CCU_GROUPS));
  let otherSel = $state(selOf(ui.hangar.sel.other, OTHER_GROUPS));
  let showMatch = $state(ui.hangar.showMatch);
  let expanded = $state([...ui.hangar.expanded]); // copyId of the groups opened to their single copies
  let panelOpen = $state(false); // the filter panel of the narrow layout
  $effect(() => {
    ui.hangar.chip = current; ui.hangar.query = query; ui.hangar.sort = sort;
    ui.hangar.sel = { fleet: fleetSel, ccu: ccuSel, other: otherSel };
    ui.hangar.showMatch = showMatch; ui.hangar.expanded = [...expanded];
  });
  const pickView = (id) => { current = id; ui.hangar.picked = true; panelOpen = false; };
  const searching = $derived(query.trim() !== '');

  let openId = $state(null);
  // A reserved CCU's pledge shows which goal holds it, with a link to that chain.
  const openGoal = $derived(openId == null ? null : (view.rows.find((r) => String(r.copyId) === String(openId) && r.reservedBy) ?? null));
  const openPledge = $derived(openId == null ? null : pledgeById(pledges, openId));
  // The owned CCU copy behind the open pledge (copy id = pledge id), for "Don't use this copy in plans".
  const openCopy = $derived(openId == null ? null : (view.rows.find((r) => String(r.copyId) === String(openId)) ?? null));
  async function setExcluded(excluded) {
    const released = await dispatch({ type: 'excludeCopy', copyId: String(openCopy.copyId), excluded });
    if (released?.length) ui.notice = t('Released the reserved chain of {names}: it used this copy.', { names: released.map((id) => app.plans.chains[id]?.name ?? id).join(', ') });
  }
  const goChain = (id) => openGoalFrom(id, t('Back to Hangar'));

  // ---- Ships ----
  const ownedC = $derived(ownedCards(fleet, pledges, app.data.ships, poolIds));
  const goalC = $derived(current === 'ships' ? goalCards(todayView(app).goals, app.data.ships) : []);
  const fleetAll = $derived(fleetItems(ownedC, goalC, query));
  const fleetShown = $derived(applyFilters(fleetAll, FLEET_GROUPS, fleetSel));
  const fleetTotal = $derived(ownedC.length + goalC.length);
  const fleetCounts = $derived(optionCounts(fleetAll, FLEET_GROUPS, fleetSel));

  // ---- Upgrades ----
  // The same plan the Goals page shows (todayView is kept per day): a copy is in use when a goal holds it or its chain uses it.
  const used = $derived(copiesInUse(todayView(app).goals));
  const ccuAll = $derived(markInUse(ccuRows(view.rows, app.data.ships, standardPrices(app.data.offers ?? [])), used));
  const saved = $derived(savedSummary(ccuAll));
  const unused = $derived(unusedSummary(ccuAll));
  const showUnused = () => { query = ''; ccuSel = selOf({ use: ['unused'] }, CCU_GROUPS); pickView('ccu'); };
  const ccuSearched = $derived(ccuAll.filter((r) => matchesQuery(searchText(r.fromName, r.toName), query)));
  const ccuRes = $derived(ccuResult(ccuAll, view.review, ccuSel, query));
  // No sort chosen: To (A to Z), then From. A chosen sort keeps that order for the ties.
  const DEFAULT_SORT = { key: 'to', dir: 'asc' };
  const ccuGroups = $derived(sortBy(sortBy(ccuRes.groups, { key: 'from', dir: 'asc' }, ccuSortValue), sort ?? DEFAULT_SORT, ccuSortValue));
  const ccuCounts = $derived.by(() => {
    const c = optionCounts(ccuSearched, CCU_GROUPS, ccuSel);
    c.use = { ...c.use, review: view.review.filter((r) => matchesQuery(searchText(r.name, r.reason), query)).length };
    return c;
  });
  const reviewList = $derived(keyed(ccuRes.review, (r) => r.pledgeId));
  const onSort = (key) => { sort = nextSort(sort ?? DEFAULT_SORT, key, CCU_SORT_FIRST[key] ?? 'asc') ?? DEFAULT_SORT; };
  const toggleGroup = (id) => { expanded = expanded.includes(id) ? expanded.filter((x) => x !== id) : [...expanded, id]; };

  // ---- Other pledges ----
  const otherAll = $derived(otherPledges(pledges));
  const otherSearched = $derived(searchPledges(otherAll, query));
  const otherShown = $derived(keyed(applyFilters(otherSearched, OTHER_GROUPS, otherSel), (p) => p.pledgeId));
  const otherCounts = $derived(optionCounts(otherSearched, OTHER_GROUPS, otherSel));
  const backList = $derived(buyback.filter((b) => matchesQuery(searchText(b.name, b.contained), query)));
  const backs = $derived(keyed(backList, (b) => b.id));

  // ---- The open view's filter column and bar ----
  const cfg = $derived(current === 'ccu'
    ? { groups: CCU_GROUPS, sel: ccuSel, counts: ccuCounts, noun: 'upgrades', filterLabel: t('Filter upgrades'), shown: ccuRes.shown, total: ccuRes.total }
    : current === 'other'
      ? { groups: OTHER_GROUPS, sel: otherSel, counts: otherCounts, noun: 'pledges', filterLabel: t('Filter pledges'), shown: otherShown.length, total: otherAll.length }
      : { groups: FLEET_GROUPS, sel: fleetSel, counts: fleetCounts, noun: 'ships', filterLabel: t('Filter ships'), shown: fleetShown.length, total: fleetTotal });
  const setSel = (next) => { if (current === 'ccu') ccuSel = next; else if (current === 'other') otherSel = next; else fleetSel = next; };
  const active = $derived(activeFilters(cfg.groups, cfg.sel));
  const countText = $derived(current === 'ships' ? fleetCountText(fleetShown, fleetAll, overview.chips.ships)
    : current === 'ccu' && ccuRes.groups.length !== ccuRes.copies.length ? `${resultsText(cfg.shown, cfg.total, cfg.noun)} · ${tn(ccuRes.groups.length, '{n} row', '{n} rows')}`
    : resultsText(cfg.shown, cfg.total, cfg.noun));
  // With a search that finds nothing here, say where it would find something.
  const elsewhere = $derived(!searching || cfg.shown > 0 ? [] : [
    ['ships', t('Ships'), fleetItems(ownedC, [], query).length],
    ['ccu', t('Upgrades'), ccuSearched.length],
    ['other', t('Other pledges'), otherSearched.length],
  ].filter(([id, , n]) => id !== current && n > 0));

  // A link from a goal's owned step: open the group that holds that copy, scroll to it and focus it.
  $effect(() => {
    const id = ui.focusCopy;
    if (!id) return;
    const group = ccuGroups.find((g) => g.copyId === id || g.members?.some((m) => m.copyId === id));
    if (!group) { ui.focusCopy = null; return; } // a copy that is not listed (filtered out) is not looked for later
    ui.focusCopy = null;
    if (group.copyId !== id && !expanded.includes(group.copyId)) expanded = [...expanded, group.copyId];
    tick().then(() => tick()).then(() => {
      const row = document.querySelector(group.copyId === id ? `tr[data-copy="${group.copyId}"]` : `tr[data-member="${id}"]`);
      row?.scrollIntoView({ block: 'center' });
      row?.focus();
    });
  });
  const empty = $derived(overview.summary.count === 0);
</script>

<div class="hangar">
  {#if empty}
    <GlassPanel class="emptyhangar" aria-label={t('Hangar empty')}>
      <p class="big"><b>{t('Your hangar is empty.')}</b></p>
      <p class="muted">{ui.sample ? t('This sample has no pledges in this part.') : t('Open Sync and choose Hangar to load your pledges.')}</p>
    </GlassPanel>
  {:else}
    <div class="views" role="group" aria-label={t('Hangar category')}>
      {#each VIEWS as v (v.id)}
        <button type="button" class="chip-btn" class:active={current === v.id} aria-pressed={current === v.id} data-chip={v.id} onclick={() => pickView(v.id)}>{t(v.label)} <span class="n">{viewCount[v.id]}</span></button>
      {/each}
    </div>
    {#if meltFirst}<div id="hangar-melt"><MeltTab {app} query={query} /></div>{/if}
    <GlassPanel class="hsummary" aria-label={t('Hangar summary')}>
      <span><b>{overview.summary.count}</b> {tn(overview.summary.count, 'pledge', 'pledges')}</span>
      <span class="sep" aria-hidden="true">·</span>
      <span title={t('What you paid for your pledges (their melt value on RSI). Gifted pledges count as $0.')}>{t('Spent')} <b>{usd(spentCents(pledges))}</b></span>
      {#if ccuAll.length}
        <span class="sep" aria-hidden="true">·</span>
        <span title={t('Sum of the Saving column of your upgrades: what the same upgrades would cost today as Standard upgrades, minus what you paid. Estimates where RSI sells no Standard version today.')}><b>≈ {usd(saved.cents)}</b> {t('saved')}</span>
        {#if unused.count}
          <span class="sep" aria-hidden="true">·</span>
          <button type="button" class="link" data-unused onclick={showUnused} title={t('Upgrades no goal holds or uses in its current chain. Opens them in Upgrades.')}><b>{unused.count}</b> {unused.count === 1 ? t('upgrade not in use') : t('upgrades not in use')}{unused.paid ? ` (${usd(unused.paid)})` : ''}</button>
        {/if}
      {/if}
      {#if !meltFirst}<span class="sep" aria-hidden="true">·</span><button type="button" class="link small" data-melt-status onclick={() => document.getElementById('hangar-melt')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })}>{t('Worth melting (0)')}</button>{/if}
      <Term term="hangar-money" />
    </GlassPanel>

    <SearchBox bind:value={query} label={t('Search the hangar')} placeholder={current === 'ccu' ? t('Search upgrades by ship') : t('Search ships, manufacturers, items')} />

    <div class="body">
      <div class="barwrap">
  <FilterBar {active} {countText} bind:panelOpen panelId="hangar-filters" onremove={(a) => setSel(removeFilter(cfg.groups, cfg.sel, a))} onreset={() => setSel(resetAll(cfg.groups))} />
      </div>
      <aside id="hangar-filters" class="side" class:open={panelOpen} aria-label={t('Filters')}>
        <FilterColumn groups={cfg.groups} sel={cfg.sel} counts={cfg.counts} label={cfg.filterLabel}
          ontoggle={(g, o) => setSel(toggleOption(cfg.sel, g, o))} onreset={(g) => setSel(resetGroup(cfg.groups, cfg.sel, g))} onrange={(g, k, v) => setSel(setRange(cfg.sel, g, k, v))} />
      </aside>
      <div class="results">

        {#if elsewhere.length}
          <p class="muted searchnote">{t('No match here. Found in')}{' '}{#each elsewhere as [id, label, n], i (id)}{i ? ', ' : ''}<button type="button" class="link" onclick={() => pickView(id)}>{label} ({n})</button>{/each}.</p>
        {/if}

        {#if current === 'ships'}
          {#if fleetShown.length}
            <ShipsGrid items={fleetShown} {ship} onopen={(id) => { openId = id; }} ongoal={goChain} />
          {:else if !elsewhere.length}
            <p class="muted">{searching && fleetTotal ? noMatchesText(query) : active.length ? t('No ships match these filters.') : t('No ships in your hangar yet.')}</p>
          {/if}
          <Fold title={t('Starting ships (cheap LTI ships): {n} available', { n: poolIds.size })}><TokenPanel {app} /></Fold>
        {:else if current === 'ccu'}
          <p class="muted tabletools" data-ccu-counts>{tn(view.rows.length + view.review.length, '{n} upgrade pledge', '{n} upgrade pledges')} · {t('{n} matched', { n: view.rows.length })} · {tn(view.review.length, '{n} needs review', '{n} need review')}
            <label class="chk"><input type="checkbox" bind:checked={showMatch} /> {t('Show how each was matched')}</label>
            <RsiLink href={hangarUrl()} label={t('Open hangar')} aria={t('Open your hangar on RSI')} /></p>
          {#if ccuRes.copies.length || !ccuRes.showReview}
            <UpgradesTable groups={ccuGroups} sort={sort ?? DEFAULT_SORT} empty={view.rows.length === 0 && !searching && !active.length ? t('You have no upgrade pledges.') : t('No upgrades match.')} {ship} {expanded} {showMatch} onsort={onSort} ontoggle={toggleGroup} onopen={(id) => { openId = id; }} ongoal={goChain} />
          {/if}
          {#if ccuRes.showReview}
            <h4>{t('Needs review')}</h4>
            {#each reviewList as { item: r, key } (key)}
              <div class="item" data-pledge={r.pledgeId}><b>{r.name}</b> <span class="muted">· {r.reason}</span> <RsiLink href={hangarUrl()} label={t('Hangar')} aria={t('Open {name} in the RSI hangar', { name: r.name })} /></div>
            {:else}
              <p class="muted">{searching && view.review.length ? noMatchesText(query) : t('Nothing needs review.')}</p>
            {/each}
          {/if}
          <VirtualCcus {app} />
        {:else}
          {#if otherShown.length}
            <OtherList items={otherShown} onopen={(id) => { openId = id; }} />
          {:else if !elsewhere.length}
            <p class="muted">{searching && otherAll.length ? noMatchesText(query) : active.length ? t('No pledges match these filters.') : t('Nothing in this category.')}</p>
          {/if}
          <h4>{t('Buy-back ({count})', { count: searching ? t('{shown} of {total}', { shown: backList.length, total: buyback.length }) : buyback.length })}</h4>
          {#each backs as { item: b, key } (key)}
            <div class="item" data-buyback={b.id}><b>{b.name}</b> <span class="muted">· {b.contained ?? ''}{b.reclaimDate ? ` · ${t('reclaimed {date}', { date: b.reclaimDate })}` : ''}</span> <RsiLink href={buybackUrl(b.id)} label={t('Buy back')} aria={t('Buy back {name} on RSI', { name: b.name })} /></div>
          {:else}
            <p class="muted">{searching && buyback.length ? noMatchesText(query) : t('No buy-back items.')}</p>
          {/each}
        {/if}
      </div>
    </div>

    {#if !meltFirst}<div id="hangar-melt"><MeltTab {app} query={query} /></div>{/if}
  {/if}
</div>

{#if openPledge}
  {#key openPledge.pledgeId}<PledgeDetail pledge={openPledge} ships={app.data.ships} token={ltiIds.has(String(openPledge.pledgeId)) ? { settings: tokenCfg, inPool: poolIds.has(String(openPledge.pledgeId)) } : null} onclose={() => { openId = null; }} goal={openGoal ? { id: openGoal.reservedBy, name: openGoal.reservedByName } : null} ongoal={(id) => openGoalFrom(id, t('Back to Hangar'))} copy={openCopy ? { excluded: openCopy.excluded } : null} onexclude={setExcluded} />{/key}
{/if}

<style>
  .hangar { display: flex; flex-direction: column; gap: 12px; }
  .views { display: flex; gap: 6px; flex-wrap: wrap; }
  .views .chip-btn { font-size: 15px; padding: 5px 16px; }
  .n { opacity: 0.75; }
  h4 { margin: 10px 0 0; color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  .item { padding: 6px 0; border-bottom: 1px solid var(--glass-border); }
  .muted { color: var(--muted); }
  :global(.hsummary) { display: flex; gap: 4px 10px; flex-wrap: wrap; align-items: baseline; padding-block: 8px; font-size: 14px; }
  :global(.hsummary) b { font-size: 17px; }
  .sep { color: var(--muted); }
  .small { color: var(--muted); font-size: 13px; }
  .searchnote { margin: 0; font-size: 13px; }
  .tabletools { margin: 0; display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
  .chk { display: inline-flex; gap: 6px; align-items: center; }
  .link { background: none; border: none; padding: 0; color: var(--text); text-decoration: underline dotted; }
  /* The filter column on the left, the results beside it. Narrow: the column is a panel the Filters button opens. */
  .body { display: grid; grid-template-columns: 210px minmax(0, 1fr); grid-template-areas: "side bar" "side results"; column-gap: 16px; row-gap: 10px; align-items: start; }
  .barwrap { grid-area: bar; }
  .side { grid-area: side; position: sticky; top: 70px; max-height: calc(100vh - 90px); overflow-y: auto; padding: 4px 6px 12px 2px; }
  .results { grid-area: results; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  @media (max-width: 820px) {
    .body { grid-template-columns: minmax(0, 1fr); grid-template-areas: "bar" "side" "results"; row-gap: 8px; }
    .side { display: none; position: static; max-height: none; background: var(--glass); border: 1px solid var(--glass-border); border-radius: 10px; padding: 12px; }
    .side.open { display: block; }
    .side :global(.col) { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px 16px; }
  }
</style>
