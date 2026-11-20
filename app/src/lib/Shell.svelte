<script>
  import { ui, dismissNotice, pickSection, pickAdvanced, leaveSample, openGlossary, load } from './state.svelte.js';
  import { currencyProblem } from '$logic/format.mjs';
  import Glossary from './Glossary.svelte';
  import SyncMenu from './SyncMenu.svelte';
  import { ADVANCED, ADVANCED_HINT, PAGE_INFO, stampLabel, stampIsStale } from './view/nav.mjs';
  import Page from './ui/Page.svelte';
  import SectionNav from './ui/SectionNav.svelte';
  import TodayPage from './TodayPage.svelte';
  import GoalsPage from './GoalsPage.svelte';
  import PlanExplorer from './PlanExplorer.svelte';
  import HangarTab from './HangarTab.svelte';
  import GraphTab from './GraphTab.svelte';
  import PricesTab from './PricesTab.svelte';
  import WarbondsTab from './WarbondsTab.svelte';
  import CheckOffer from './store/CheckOffer.svelte';
  import SaleEvents from './store/SaleEvents.svelte';
  import BrowseStore from './store/BrowseStore.svelte';
  import GoalsActions from './goals/GoalsActions.svelte';
  import Fold from './goals/Fold.svelte';
  import GlassPanel from './ui/GlassPanel.svelte';
  import Explainer from './ui/Explainer.svelte';
  import { onMount, tick } from 'svelte';
  import { localToday, shortDay } from '$logic/availability.mjs';
  import { runningFeedEvent } from '$logic/feed.mjs';
  import { startFeed } from './state.svelte.js';
  import { shouldShowExplainer } from './view/firstRun.mjs';
  import { updater, startUpdater, checkForUpdate, restartToUpdate } from './updater.svelte.js';
  import { checkLine } from './view/updater.mjs';
  import { hangarHealth } from './view/health.mjs';
  import { todayView } from './view/today.mjs';
  import { openNeedsReview } from './state.svelte.js';

  let today = $state(new Date());
  // Reads the saved data again (not a sync): the Reload button of Today's old hero lives beside the data dates now.
  let reloading = $state(false);
  async function reload() {
    reloading = true;
    try { await load(); } finally { reloading = false; }
  }
  let explainerOpen = $state(false);
  let helpBtn = $state(null);
  let helpEl = $state(null);
  let helpOpen = $state(false);
  let notesOpen = $state(false);
  // First open (after the import's Continue or with existing data): show it unless already seen.
  onMount(() => {
    let st = null;
    try { st = localStorage; } catch { /* storage unavailable */ }
    // The sample opens on its chain with no extra definition on top; the tour is in Help.
    if (ui.skipTour) ui.skipTour = false;
    else if (!ui.sample && shouldShowExplainer(st)) explainerOpen = true;
    const timer = setInterval(() => today = new Date(), 60_000);
    const stopUpdater = startUpdater();
    const stopFeed = startFeed(); // sale events and the public store catalog from the signed feed; offline is silent
    return () => { clearInterval(timer); stopUpdater(); stopFeed(); };
  });
  const closeExplainer = () => { explainerOpen = false; helpBtn?.focus(); };

  // A store account that pays in another currency than USD gets this message instead of a plan.
  const wrongCurrency = $derived(currencyProblem(ui.app.data?.pricing));
  const chain = $derived(ui.selected ? ui.app.plans.chains[ui.selected] : null);
  const meta = $derived(ui.app.data?.meta ?? {});
  // Upgrades in the hangar the planner could not read: plans cannot use them. Not shown for the sample's made-up hangar.
  const health = $derived(ui.sample || !ui.app.data ? null : hangarHealth(ui.app.data, todayView(ui.app).goals));
  const HEALTH_KEY = 'ccu.hangarHealthDismissed';
  let healthDismissed = $state((() => { try { return localStorage.getItem(HEALTH_KEY); } catch { return null; } })());
  const dismissHealth = () => { healthDismissed = health.key; try { localStorage.setItem(HEALTH_KEY, health.key); } catch { /* storage unavailable: hidden for this session */ } };
  const stamp = (value) => stampLabel(value, today);
  // Orange only when the data is really old (over two days); "yesterday" is grey like everything else in the header.
  const stale = $derived(stampIsStale(meta.catalogAt, today) || stampIsStale(meta.hangarAt, today));
  // The deal checker is closed until asked for (header button). Sale events stays closed too; a link from Prices opens it.
  let saleOpen = $state(false);
  $effect(() => {
    if (!ui.focusSaleEvents) return;
    ui.focusSaleEvents = false;
    saleOpen = true;
    tick().then(() => { const el = document.querySelector('#sale-events > summary'); el?.scrollIntoView({ block: 'start' }); el?.focus(); });
  });
  // One line while a sale event from the feed is on: the planner already counts it (it is merged into the sale events), the line says where it comes from.
  const feedRunning = $derived(ui.app ? runningFeedEvent(ui.app.saleEvents, localToday(today)) : null);
  let checkEl = $state(null);
  const openChecker = async () => { ui.store.checkOpen = !ui.store.checkOpen; if (ui.store.checkOpen) { await tick(); checkEl?.querySelector('textarea')?.focus(); } };
  const STORE_TABS = [{ id: 'upgrades', label: 'Upgrades' }, { id: 'browse', label: 'Browse store' }];
  const browseOffers = () => document.getElementById('store-offers')?.scrollIntoView({ block: 'start' });
  let menuOpen = $state(false);
  let advEl = $state(null);
  let advBtn = $state(null);
  const openAdvanced = (key) => { pickAdvanced(key); menuOpen = false; advBtn?.focus(); };
  const onkeydown = (e) => {
    if (e.key === 'Escape' && menuOpen) { menuOpen = false; advBtn?.focus(); }
    else if (e.key === 'Escape' && helpOpen) { helpOpen = false; helpBtn?.focus(); }
  };
  const onhelpfocusout = (e) => { if (helpOpen && e.relatedTarget && !helpEl?.contains(e.relatedTarget)) helpOpen = false; };
  const onwindowclick = (e) => {
    if (menuOpen && !advEl?.contains(e.target)) menuOpen = false;
    if (helpOpen && !helpEl?.contains(e.target)) helpOpen = false;
  };
  // Close the disclosure when focus leaves it.
  // relatedTarget is null when a click lands on a non-focusable spot (Safari does not focus buttons): only a real move of focus out of the menu closes it.
  const onfocusout = (e) => { if (menuOpen && e.relatedTarget && !advEl?.contains(e.relatedTarget)) menuOpen = false; };
</script>

<svelte:window {onkeydown} onclick={onwindowclick} />

<div class="shell">
  <header class="bar">
    <strong class="app">CCU Planner</strong>
    <SectionNav current={ui.advanced ? null : ui.section} onselect={pickSection} />
    <div class="adv" bind:this={advEl} {onfocusout}>
      <button type="button" class="advbtn" bind:this={advBtn} class:active={!!ui.advanced} aria-expanded={menuOpen} onclick={() => { menuOpen = !menuOpen; }}>Advanced ▾</button>
      {#if menuOpen}
        <ul class="menu">
          {#each ADVANCED as [key, label] (key)}
            <li><button type="button" class:active={ui.advanced === key} onclick={() => openAdvanced(key)}><span class="lbl">{label}</span><span class="hintline">{ADVANCED_HINT[key]}</span></button></li>
          {/each}
        </ul>
      {/if}
    </div>
    <span class="grow"></span>
    {#if updater.status === 'ready'}
      <span class="upd" role="status">
        <button type="button" class="primary" onclick={restartToUpdate}>Update {updater.version} ready · Restart</button>
        {#if updater.error}<span class="uperr" role="alert">{updater.error}</span>{/if}
        {#if updater.notes}<button type="button" class="linkbtn" aria-expanded={notesOpen} onclick={() => { notesOpen = !notesOpen; }}>What's new</button>{/if}
        {#if notesOpen && updater.notes}<div class="notes">{updater.notes}</div>{/if}
      </span>
    {/if}
    <small class="stamps" class:stale>Store: {stamp(meta.catalogAt)} · Hangar: {stamp(meta.hangarAt)}</small>
    {#if !ui.sample}<button type="button" class="reload" disabled={reloading} aria-label="Reload the saved data" title="Reads the saved store and hangar data again. To get fresh prices, run Sync, then Store." onclick={reload}>{reloading ? '…' : '↻'}</button>{/if}
    <SyncMenu />
    <div class="adv" bind:this={helpEl} onfocusout={onhelpfocusout}>
      <button type="button" class="helpbtn" bind:this={helpBtn} aria-expanded={helpOpen} onclick={() => { helpOpen = !helpOpen; menuOpen = false; }}>Help ▾</button>
      {#if helpOpen}
        <ul class="menu right">
          <li><button type="button" onclick={() => { helpOpen = false; explainerOpen = true; }}><span class="lbl">How CCUs work</span><span class="hintline">Three short steps: what a CCU is and why chaining and waiting pay</span></button></li>
          <li><button type="button" onclick={(e) => { helpOpen = false; openGlossary('', helpBtn); }}><span class="lbl">Look up a term</span><span class="hintline">What the words in the planner mean</span></button></li>
          {#if updater.desktop}
            <li><button type="button" disabled={updater.status === 'checking' || updater.status === 'downloading'} onclick={() => checkForUpdate(true)}><span class="lbl">Check for updates</span><span class="hintline" role="status">{checkLine(updater.status, updater.current, updater.version, updater.error)}</span></button></li>
            {#if updater.current}<li class="ver">CCU Planner {updater.current}</li>{/if}
          {/if}
        </ul>
      {/if}
    </div>
  </header>
  {#if ui.notice}
    <div class="notice" role="alert">{ui.notice} {#if ui.bought}<button disabled={ui.syncBusy} onclick={() => window.dispatchEvent(new CustomEvent('sync-hangar'))}>Bought it? Sync hangar</button>{/if} <button onclick={dismissNotice}>Dismiss</button></div>
  {/if}
  {#if health && health.key !== healthDismissed}
    <div class="health" role="status" data-hangar-health>{health.text} <button type="button" onclick={() => openNeedsReview()}>Show them</button> <button type="button" onclick={dismissHealth}>Dismiss</button></div>
  {/if}
  {#if ui.sample}
    <div class="sample" role="status"><b>Sample data</b> — made-up ships, not your account. Changes you make here are forgotten when you leave. <button type="button" onclick={leaveSample}>Leave sample data</button></div>
  {/if}
  <div class="body">
    {#if wrongCurrency}
      <main class="main"><div class="currency" role="alert"><h1>Your store account is not supported yet</h1><p>{wrongCurrency}</p></div></main>
    {:else if ui.advanced === 'explorer'}
      <main class="main"><Page {...PAGE_INFO.explorer}><PlanExplorer app={ui.app} /></Page></main>
    {:else if ui.advanced === 'prices'}
      <main class="main"><Page {...PAGE_INFO.prices}><PricesTab app={ui.app} /></Page></main>
    {:else if ui.advanced === 'graphs'}
      <main class="main"><Page {...PAGE_INFO.graphs} wide><GraphTab app={ui.app} {chain} /></Page></main>
    {:else if ui.section === 'today'}
      <main class="main"><Page {...PAGE_INFO.today}><TodayPage app={ui.app} /></Page></main>
    {:else if ui.section === 'goals'}
      <main class="main">
        <Page {...PAGE_INFO.goals} wide>
          {#snippet actions()}<GoalsActions app={ui.app} />{/snippet}
          <GoalsPage app={ui.app} />
        </Page>
      </main>
    {:else if ui.section === 'hangar'}
      <main class="main">
        <Page {...PAGE_INFO.hangar} wide>
          {#snippet actions()}<button type="button" class="primary" disabled={ui.syncBusy || ui.sample} title={ui.sample ? 'Sync is off while you look at sample data' : undefined} onclick={() => window.dispatchEvent(new CustomEvent('sync-hangar'))}>Sync hangar</button>{/snippet}
          <HangarTab app={ui.app} />
        </Page>
      </main>
    {:else if ui.section === 'store'}
      <main class="main">
        <Page {...PAGE_INFO.store}>
          {#snippet actions()}
            {#if ui.storeTab === 'upgrades'}
              <button type="button" onclick={browseOffers}>Browse offers</button>
              <button type="button" class="primary" aria-expanded={ui.store.checkOpen} aria-controls="store-check" onclick={openChecker}>Check a deal</button>
            {/if}
          {/snippet}
          <div class="store">
            <div class="tabs" role="group" aria-label="Store view">
              {#each STORE_TABS as t (t.id)}
                <button type="button" class="tab" class:active={ui.storeTab === t.id} aria-pressed={ui.storeTab === t.id} data-store-tab={t.id} onclick={() => { ui.storeTab = t.id; }}>{t.label}</button>
              {/each}
            </div>
            {#if ui.storeTab === 'browse'}
              {#key ui.sample}<BrowseStore app={ui.app} />{/key}
            {:else}
            {#if feedRunning}
              <p class="feednote" role="status" data-sale-feed>{feedRunning.name} is on until {shortDay(feedRunning.to)}. The planner counts it as a sale event; it comes from the CCU Planner feed.</p>
            {/if}
            {#if ui.store.checkOpen}
              <div id="store-check" bind:this={checkEl}>
                <GlassPanel>
                  <h2 class="checkh">Check a deal</h2>
                  <CheckOffer app={ui.app} />
                </GlassPanel>
              </div>
            {/if}
            <div id="store-offers"><WarbondsTab app={ui.app} /></div>
            <Fold id="sale-events" title={`Sale events (${ui.app.saleEvents.events.length})`} bind:open={saleOpen}><SaleEvents app={ui.app} /></Fold>
            <p class="more"><button type="button" class="linkbtn" onclick={() => { pickAdvanced('prices'); }}>Price assumptions → Advanced</button></p>
            {/if}
          </div>
        </Page>
      </main>
    {/if}
  </div>
</div>
{#if explainerOpen}<Explainer onclose={closeExplainer} returnTo={helpBtn} />{/if}
{#if ui.glossary !== null}<Glossary />{/if}

<style>
  .shell { display: flex; flex-direction: column; height: 100vh; min-width: 0; }
  .bar { position: relative; z-index: var(--z-bar); display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 4px 18px; background: rgba(10, 14, 22, 0.55); border-bottom: 1px solid var(--glass-border); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); }
  .app { font-size: 15px; margin-right: 8px; }
  .grow { flex: 1; }
  .stamps { color: var(--muted); font-size: 11px; }
  .stamps.stale { color: var(--warn, #e6ad48); }
  .helpbtn { background: none; border: 0; color: var(--muted); font-weight: 600; font-size: 15px; padding: 8px 10px; }
  .menu.right { left: auto; right: 0; }
  .adv { position: relative; }
  .advbtn { background: none; border: 0; color: var(--muted); font-weight: 600; font-size: 15px; padding: 8px 14px; }
  .advbtn.active { color: var(--text); }
  .menu { position: absolute; top: 100%; left: 0; z-index: var(--z-popover); margin: 0; padding: 6px; list-style: none; min-width: 200px; background: #121a2b; border: 1px solid var(--glass-border); border-radius: 10px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); }
  .menu { min-width: 260px; }
  .menu button { display: block; width: 100%; text-align: left; background: none; border: 0; padding: 8px 10px; }
  .lbl { display: block; font-weight: 600; }
  .hintline { display: block; color: var(--muted); font-size: 12px; font-weight: 400; }
  .menu button.active { color: var(--accent); }
  .store { display: flex; flex-direction: column; gap: 12px; }
  .tabs { display: flex; gap: 22px; border-bottom: 1px solid var(--glass-border); }
  .tab { background: none; border: 0; border-bottom: 3px solid transparent; border-radius: 0; margin-bottom: -1px; padding: 6px 2px; font-size: 16px; font-weight: 700; color: var(--muted); }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .more { margin: 0; }
  .feednote { margin: 0; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--glass-border); color: var(--text); }
  .checkh { margin: 0 0 8px; font-size: 16px; }
  .linkbtn { background: none; border: 0; padding: 4px 0; color: var(--link); text-decoration: underline; }
  .sample { padding: 8px 18px; background: rgba(76, 194, 255, 0.18); border-bottom: 1px solid rgba(76, 194, 255, 0.4); }
  .sample button { margin-left: 8px; }
  .currency { max-width: 640px; padding: 18px 22px; border-radius: 12px; background: #3d1414; border: 2px solid #f85149; }
  .currency h1 { margin: 0 0 8px; font-size: 20px; }
  .currency p { margin: 0; font-size: 16px; }
  .notice { padding: 8px 18px; background: #3d2b00; color: var(--warn); }
  .notice button { margin-left: 8px; }
  .health { padding: 8px 18px; background: #3d2b00; color: var(--warn); border-bottom: 1px solid rgba(255, 196, 0, 0.35); }
  .health button { margin-left: 8px; }
  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: auto 1fr; }
  .main { grid-column: -2 / -1; padding: 18px; overflow: auto; min-width: 0; }
  @media (max-width: 1023px) {
    .body { display: block; overflow: auto; }
    .main { overflow: visible; }

  }
  .upd { position: relative; display: inline-flex; align-items: center; gap: 8px; }
  .upd .primary { padding: 3px 10px; font-size: 13px; }
  .uperr { margin: 0 8px; font-size: 13px; color: var(--warn, #f0b36b); }
  .notes { position: absolute; top: 100%; right: 0; z-index: var(--z-popover); margin-top: 6px; width: 320px; max-height: 260px; overflow: auto; white-space: pre-wrap; padding: 10px 12px; font-size: 13px; background: #121a2b; border: 1px solid var(--glass-border); border-radius: 10px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); }
  .ver { padding: 6px 10px 2px; color: var(--muted); font-size: 12px; }
  .reload { padding: 2px 8px; font-size: 14px; line-height: 1; }
</style>
