<script>
  import { evaluateAccepted, diffRoutes } from '$logic/chains.mjs';
  import { sessionOf } from '$logic/session.mjs';
  import { localToday } from '$logic/availability.mjs';
  import { incomingCount } from '$logic/planner.mjs';
  import { shipName, goalNamer } from '$logic/ships.mjs';
  import { cashBreakdown } from '$logic/journey.mjs';
  import { reservationItems, reservationLines, reservationSummary, HELD_FOLD_AFTER, reserveHeading, reservedHeading, NOTHING_HELD } from '$logic/reservation.mjs';
  import { proposedBanner, comparingBanner, RESERVED_STAYS, chainChanges, changeLines } from '$logic/chainChoice.mjs';
  import { goalCostLines, issueLine, noRouteMessage, goalStatusText, noTokenHelp, TOKEN_HELP, ownedRunText, stepNumber, stepPhrase, CHAIN_ORDER_NOTE, FIGURE_HELP, NO_SALES_SEEN, estimateText, estimateHowText, cashCutText, breakdownLines, NEW_CASH_LABEL, LIST_VALUE_LABEL, SALES_CASH_LABEL, otherWaysTitle, bestDiffers, BEST_DIFFERS_LABEL, neededBecauseText, acceptedStatusText, acceptedStatusLine, goalNextText, sharedEffectShort, sharedEffectParts, ACCEPT_THIS_HELP, NO_TOKEN_TITLE, NO_TOKEN_OTHER } from '$logic/describe.mjs';
  import { neededBecause } from '$logic/sharedEffect.mjs';
  import { todayView } from './view/today.mjs';
  import { copyUsers, otherCopies } from './view/copyUse.mjs';
  import { chainProgress, progressText } from './view/goalTable.mjs';
  import { usd } from '$logic/format.mjs';
  import { tokenPool, tokenSettings } from '$logic/tokens.mjs';
  import { onDestroy, untrack } from 'svelte';
  import { Job } from './jobs.svelte.js';
  import { dispatch, goSection, ui, openChainMap, openHangarCopy } from './state.svelte.js';
  import Fold from './goals/Fold.svelte';
  import { locateStep } from './view/focus.mjs';
  import { tick } from 'svelte';
  import GlassPanel from './ui/GlassPanel.svelte';
  import ShipHero from './ui/ShipHero.svelte';
  import JourneyBar from './ui/JourneyBar.svelte';
  import StateChip from './ui/StateChip.svelte';
  import ChainStrip from './ChainStrip.svelte';
  import JourneyStep from './ui/JourneyStep.svelte';
  import Tabs from './ui/Tabs.svelte';
  import WithoutGoal from './goals/WithoutGoal.svelte';
  import OwnedInto from './goals/OwnedInto.svelte';
  import GoalSettings from './goals/GoalSettings.svelte';
  import QuickSettings from './goals/QuickSettings.svelte';
  import TokenLimit from './goals/TokenLimit.svelte';
  import Proposals from './Proposals.svelte';
  import Staircase from './Staircase.svelte';
  import WouldHelp from './WouldHelp.svelte';

  let { app, chain } = $props();
  const ships = $derived(app.data.ships);
  const name = (id) => shipName(ships, id);
  const goalName = $derived(goalNamer(app.plans, ships));
  const session = $derived(sessionOf(app));
  const avail = $derived(session.avail(localToday()));

  // The same journey Today shows for this goal.
  const goal = $derived(todayView(app).goals.find((g) => g.goalId === chain.id) ?? null);
  const j = $derived(goal?.journey ?? null);
  const noRoute = $derived(goal?.status === 'no-route');
  const noToken = $derived(goal?.status === 'no-token');
  const stuck = $derived(noRoute || noToken);
  const pool = $derived(tokenPool(app.data.lti ?? [], tokenSettings(app.plans)));
  const owned = $derived(new Map(app.data.owned.map((o) => [o.copyId, o])));
  // For an owned step: the other copies of the same upgrade and the goals that use them.
  const users = $derived(copyUsers(todayView(app).goals));
  const othersOf = (step) => (step.kind === 'owned' && step.otherCopies ? otherCopies(app.data.owned, step, users) : []);

  const prop = $derived(session.proposal(chain.id, 3));
  const best = $derived(prop.routes[0] ?? null);
  const ev = $derived(chain.accepted ? evaluateAccepted(app.plans, chain.id, app.data) : null);
  const allIn = $derived(chain.accepted ? (chain.accepted.allIn ?? null) : (best?.allIn ?? null));
  // One chain at a time: the reserved chain when the goal has one (the price the plan total, the Goals list and Today count),
  // else the proposed chain (the best route now). "Compare" shows the proposed chain in place of the reserved one.
  // Every number that depends on the route (cash figures, progress, next step, chart) follows this one selection.
  let comparing = $state(false);
  // Comparing never outlives the choice it belongs to: it ends when the goal changes or when nothing differs any more.
  $effect(() => { chain.id; untrack(() => { comparing = false; }); });
  $effect(() => { if (!differs) comparing = false; });
  const differs = $derived(bestDiffers(chain.accepted, best, diffRoutes));
  const showProposed = $derived(differs && comparing);
  const jv = $derived(showProposed ? j : (goal?.counted ?? j));
  const f = $derived(jv?.figures ?? null);
  const selected = $derived(chain.accepted && !showProposed ? chain.accepted : best);
  const changes = $derived(differs ? chainChanges(chain.accepted, best) : null);
  const changeText = $derived(changes ? changeLines(changes, name) : []);
  const banner = $derived(differs ? proposedBanner(chain.accepted.cash, best.cash, changes.dropped.length + changes.added.length) : null);
  const prog = $derived(chainProgress(jv));
  const breakdown = $derived(jv && selected ? cashBreakdown(jv.steps, selected, (id) => owned.get(id)?.paid?.cents ?? null) : null);
  // The figures that are not the one big number, one line each, inside the fold.
  const figureLines = $derived.by(() => {
    if (!f) return [];
    const lines = [`${LIST_VALUE_LABEL} ${f.fullPrice == null ? 'unknown' : usd(f.fullPrice)} (comparison, not money saved)`];
    // Only when sharing makes this goal dearer than it would be alone.
    const alone = goalCostLines(f.today, goal?.aloneCash ?? null)?.alone;
    if (alone) lines.push(alone);
    if (watch && anyWait) {
      if (f.salesSeen) lines.push(`${SALES_CASH_LABEL}: ${usd(f.ifSales)}${f.today > f.ifSales ? ` (${cashCutText(usd(f.today - f.ifSales))})` : ''}`);
      else if (f.estimate) lines.push(estimateText(f.estimate.typical));
    }
    return lines;
  });
  const anyWait = $derived(!!jv?.steps.some((x) => x.state === 'wait'));
  const total = $derived(jv?.steps.length ?? 0);
  const goalTitle = $derived(goal?.targetName ?? name(chain.target));
  // What the reservation holds: the reserved chain's items when one exists, else what reserving the proposed chain would hold.
  const heldItems = $derived(reservationItems(chain.accepted ?? best, (id) => owned.get(id)?.paid?.cents ?? null));
  const heldLines = $derived(reservationLines(heldItems, name));
  const heldSummary = $derived(reservationSummary(heldItems, name));
  const watch = $derived((chain.mode ?? 'watch') === 'watch');
  // The bottom of the goal view: one panel with tabs instead of a stack of folds. Owned CCUs only when there are some.
  const ownedCount = $derived([...app.graph.edges.values()].reduce((n, edges) => n + edges.filter((e) => e.kind === 'owned' && e.to === chain.target).reduce((m, e) => m + e.copies.length, 0), 0));
  const detailTabs = $derived([
    { key: 'routes', label: otherWaysTitle(prop.routes.length) },
    ...(ownedCount ? [{ key: 'owned', label: `Owned CCUs into it (${ownedCount})` }] : []),
    { key: 'without', label: 'If I remove this goal' },
    { key: 'cheaper', label: 'What would make it cheaper' },
    { key: 'chart', label: 'Price chart' },
    { key: 'settings', label: 'What counts · route · remove' },
  ]);

  // What sharing costs this goal, and the buy steps that only exist because another goal holds what its alone route uses.
  const fx = $derived(session.sharedEffect(chain.id));
  const shareLine = $derived(sharedEffectShort(fx));
  const shareParts = $derived(sharedEffectParts(fx, { name }));
  const neededFor = (it) => {
    const why = chain.accepted ? null : neededBecause(fx, it.step);
    return why ? neededBecauseText(why, { name }) : null;
  };

  // The would-help search is slow: it runs in a worker, and only once a waiting step is opened (the same search the
  // "What would make it cheaper" section shows, so the worker answers it once).
  let wantNeeded = $state(false);
  const wantedJob = new Job();
  $effect(() => {
    if (!wantNeeded) return;
    const current = app; // read outside untrack: a changed plan or data runs the search again
    const args = { chainId: chain.id, slack: 1000 };
    untrack(() => wantedJob.start(current, 'wanted', args));
  });
  onDestroy(() => wantedJob.cancel());
  const wanted = $derived(wantedJob.status === 'done' ? wantedJob.value : null);
  const belowFor = (step) => wanted?.wanted.find((x) => x.from === step.from && x.to === step.to)?.below ?? null;

  // Which chain the rows belong to; keys the expanded owned runs.
  const chainKey = $derived(showProposed || !chain.accepted ? 'best' : 'accepted');
  let openRuns = $state([]); // 'from-to' keys of expanded owned runs
  const toggleRun = (key) => { openRuns = openRuns.includes(key) ? openRuns.filter((k) => k !== key) : [...openRuns, key]; };
  const statusLine = $derived(chain.accepted ? acceptedStatusLine({ status: ev?.status, acceptedCash: chain.accepted.cash, nowCash: ev?.cash ?? null, bestCash: best?.cash ?? null, differs }) : { text: '', better: null });
  let quick = $state(null);
  let detailEl = $state(null);
  let moreOpen = $state(false);
  // "Choose a starting ship" lives in the settings inside the fold: open the fold first.
  async function chooseStart() { moreOpen = true; await tick(); quick?.chooseFixedStart(); }
  const viewCopy = (copyId) => openHangarCopy(copyId, `Back to ${goalTitle}`);
  // A link from Today lands on one step: expand the run that holds it, then focus the row.
  $effect(() => {
    const target = ui.focusStep;
    if (!target || target.goalId !== chain.id || !jv) return;
    ui.focusStep = null;
    comparing = true; // Today's steps belong to the proposed chain
    const at = locateStep(jv.groups, jv.steps, target.from, target.to);
    if (at?.run) { const key = `${chainKey}-${at.run.from}-${at.run.to}`; if (!openRuns.includes(key)) openRuns = [...openRuns, key]; }
    tick().then(() => tick()).then(() => {
      const row = detailEl?.querySelector(`.chain [data-from="${target.from}"][data-to="${target.to}"]`);
      row?.scrollIntoView({ block: 'center' });
      row?.focus();
    });
  });
  const phraseOf = (it, i) => stepPhrase({ index: i + 1, total, fromName: name(it.step.from), toName: name(it.step.to), state: it.state === 'now' && it.urgency === 'norush' ? 'norush' : it.state, lock: it.lock });
  const nextLine = $derived(jv && !stuck ? goalNextText(jv.steps, name) : null);
  let acceptBusy = $state(false);
  async function acceptPlan() {
    if (!best) return;
    acceptBusy = true;
    try { await dispatch({ type: 'accept', chainId: chain.id, route: best }); comparing = false; } finally { acceptBusy = false; }
  }
  let acceptedBusy = $state(false);
  async function release() {
    acceptedBusy = true;
    try { await dispatch({ type: 'release', chainId: chain.id }); comparing = false; } finally { acceptedBusy = false; }
  }
</script>

<div class="detail" bind:this={detailEl}>
  <ShipHero ship={ships.get(chain.target) ?? null} height={68}>
      <h2>{goal?.targetName ?? name(chain.target)}</h2>
      {#if goal?.startLine}<p class="start">{goal.startLine}</p>{/if}
      {#if chain.via != null}<p class="start" data-via-line>Routed through {name(chain.via)} (change it under Settings)</p>{/if}
      {#if stuck}<p class="route">{goal ? goalStatusText(goal) : ''}</p>{/if}
  </ShipHero>

  {#if noToken}
    <GlassPanel class="notoken">
      <h3 class="notitle">{NO_TOKEN_TITLE}</h3>
      <p class="warnline">{noTokenHelp(chain.start, { ltiCount: (app.data.lti ?? []).length, poolCount: pool.length, limitCents: tokenSettings(app.plans).limitCents })}</p>
      <button type="button" class="primary" onclick={chooseStart}>Choose a starting ship</button>
      <details class="otherways">
        <summary>Other ways</summary>
        <p class="note">{NO_TOKEN_OTHER}</p>
        <div class="ways">
          <TokenLimit plans={app.plans} />
          <div><button type="button" onclick={() => goSection('hangar')}>Open the Hangar</button></div>
        </div>
        <p class="note">{TOKEN_HELP}</p>
      </details>
    </GlassPanel>
  {:else if noRoute}
    <GlassPanel class="noroute">
      <p>{noRouteMessage(name(chain.target), incomingCount(app.graph, chain.target))}</p>
    </GlassPanel>
  {/if}

  {#if !stuck && jv && selected}
    <ChainStrip steps={jv.steps} {ships} />
    <p class="maplink"><button type="button" class="linkbtn" data-chain-map onclick={() => openChainMap(chain.id, `Back to ${goalTitle}`)}>View this chain on the map</button></p>

    <GlassPanel class="choice">
      {#if differs}
        <div class="banner {showProposed ? 'same' : banner.tone}" data-banner>
          <span class="btext">{showProposed ? comparingBanner(best.cash) : banner.text}</span>
          <span class="bbtns">
            {#if showProposed}
              <button type="button" onclick={() => { comparing = false; }}>Back to reserved</button>
            {:else}
              <button type="button" onclick={() => { comparing = true; }}>Compare</button>
            {/if}
            {#if statusLine.better}<button type="button" class="primary" disabled={acceptedBusy || acceptBusy} onclick={acceptPlan}>Switch</button>{/if}
          </span>
        </div>
        {#if showProposed}
          <div class="compare" id="compare-{chain.id}" data-compare>
            {#if changeText.length}<ul data-changes>{#each changeText as line, n (n)}<li>{line}</li>{/each}</ul>{/if}
            <p class="note" data-effect>{RESERVED_STAYS}</p>
          </div>
        {/if}
      {/if}
      <div class="moneyrow">
        <p class="money"><b class="bigfig" data-left>{f ? usd(f.today) : ''}</b> <span>new cash still needed</span> <span class="sep" aria-hidden="true">·</span> <span data-progress>{progressText(prog)}</span>{#if chain.accepted} <StateChip state="reserved" />{/if}</p>
        {#if !chain.accepted && best}<button type="button" class="primary" disabled={acceptBusy} title={ACCEPT_THIS_HELP} onclick={acceptPlan}>Reserve this chain</button>{/if}
      </div>
      {#if prog.own < prog.total}<div class="progress"><JourneyBar bar={jv.bar} /></div>{/if}
      {#if nextLine}<p class="next" data-next>{nextLine}</p>{/if}
      {#if chain.accepted && ev && ev.status !== 'ok'}
        <p class="st {ev.status}" data-reservation-status>{statusLine.text}</p>
        {#if ev.issues.length}<ul class="issues">{#each ev.issues as i, n (n)}<li>{issueLine(i, { name, goalName })}</li>{/each}</ul>{/if}
      {/if}
    </GlassPanel>

    <section class="chain" aria-label="The chain, step by step">
      {#if jv.steps.some((x) => x.state === 'own')}<p class="note chainnote" data-chain-note>{CHAIN_ORDER_NOTE}</p>{/if}
      <ol class="journey" role="list">
        {#each jv.groups as g (g.kind === 'step' ? `s${g.index}` : `r${g.from}`)}
          {#if g.kind === 'step'}
            {@const it = jv.steps[g.index]}
            <li><JourneyStep item={it} {ships} {app} number={stepNumber(g.index + 1, total)} phrase={phraseOf(it, g.index)} copy={owned.get(it.step.copyId) ?? null} others={othersOf(it.step)} below={belowFor(it.step)} needed={neededFor(it)} onExpand={() => { wantNeeded = true; }} onViewCopy={viewCopy} /></li>
          {:else}
            {@const key = `${chainKey}-${g.from}-${g.to}`}
            <li class="run">
              <button type="button" class="runbtn" aria-expanded={openRuns.includes(key)} onclick={() => toggleRun(key)}>
                {ownedRunText({ first: g.from + 1, last: g.to + 1, total, fromName: name(jv.steps[g.from].step.from), toName: name(jv.steps[g.to].step.to), count: g.count })} {openRuns.includes(key) ? '▾' : '›'}
              </button>
              {#if openRuns.includes(key)}
                <ol class="runsteps" role="list">
                  {#each jv.steps.slice(g.from, g.to + 1) as it, i (g.from + i)}
                    <li><JourneyStep item={it} {ships} number={stepNumber(g.from + i + 1, total)} phrase={phraseOf(it, g.from + i)} copy={owned.get(it.step.copyId) ?? null} others={othersOf(it.step)} onViewCopy={viewCopy} /></li>
                  {/each}
                </ol>
              {/if}
            </li>
          {/if}
        {/each}
      </ol>
    </section>
  {/if}

  {#snippet heldList()}
    {#if !heldLines.length}<p class="note">{NOTHING_HELD}</p>
    {:else if heldLines.length > HELD_FOLD_AFTER}
      <details class="heldfold" data-held-fold><summary>Holds {heldSummary}</summary><ul class="held">{#each heldLines as line, n (n)}<li>{line}</li>{/each}</ul></details>
    {:else}<ul class="held">{#each heldLines as line, n (n)}<li>{line}</li>{/each}</ul>{/if}
  {/snippet}

  <!-- Everything secondary lives in this one fold: how the total adds up, the reservation, the settings and the other views. -->
  <Fold title="More: how the total adds up · reservation · settings" bind:open={moreOpen}>
    {#if !stuck && jv && selected}
      <section class="sec" data-breakdown aria-label="How the total adds up">
        <h3>How the total adds up</h3>
        {#if breakdown}{#each breakdownLines(breakdown) as line, n (n)}<p>{line}</p>{/each}{/if}
        {#each figureLines as line, n (n)}<p data-comparison={n === 0 ? '' : undefined}>{line}</p>{/each}
        <p><b>{NEW_CASH_LABEL}:</b> {FIGURE_HELP.today}</p>
        <p><b>{LIST_VALUE_LABEL}:</b> {FIGURE_HELP.fullPrice}</p>
        {#if watch && anyWait && f}
          {#if f.salesSeen}<p><b>{SALES_CASH_LABEL}:</b> {FIGURE_HELP.ifSales}</p>
          {:else if f.estimate}<div data-estimate><p><b>How the estimate works</b></p>{#each estimateHowText(f.estimate.typical, f.estimate.low, f.estimate.high, f.estimate.n) as line, n (n)}<p>{line}</p>{/each}</div>
          {:else}<p>{NO_SALES_SEEN}</p>{/if}
        {/if}
      </section>

      <section class="sec reserve" aria-label="Reservation" data-reservation>
        {#if chain.accepted}
          <h3>{reservedHeading(goalTitle, heldLines.length > 0)}</h3>
          {@render heldList()}
          {#if ev?.status === 'ok'}<p class="st ok" data-reservation-status>{statusLine.text}</p>{/if}
          <p class="releaserow"><button type="button" disabled={acceptedBusy} onclick={release}>Release reservation</button>
            <span class="note">{heldLines.length ? `Releases the ${heldLines.length === 1 ? 'item' : `${heldLines.length} items`} listed above.` : 'Nothing of yours is held, so nothing else is released.'}</span></p>
        {:else if best}
          <h3>{reserveHeading(goalTitle, heldLines.length > 0)}</h3>
          {@render heldList()}
          <p class="releaserow"><span class="note">{ACCEPT_THIS_HELP}</span></p>
        {/if}
      </section>
    {/if}

    <section class="sec" aria-label="Settings">
      <h3>Settings</h3>
      <QuickSettings bind:this={quick} {chain} {pool} {ships} startLine={goal?.startLine ?? null} />
    </section>

    {#if shareLine}
      <div class="share" data-share>
        <p>{shareLine}</p>
        {#if shareParts.length}<details><summary>See which</summary><ul>{#each shareParts as part, n (n)}<li>{part}</li>{/each}</ul></details>{/if}
      </div>
    {/if}

    <Tabs tabs={detailTabs} bind:value={ui.goalTab} label="More about this goal">
      {#snippet children(key)}
        {#if key === 'routes'}
          {#if differs}<p class="note">{BEST_DIFFERS_LABEL}</p>{/if}
          <Proposals {chain} {ships} routes={prop.routes} />
        {:else if key === 'owned'}
          <OwnedInto {app} {chain} />
        {:else if key === 'without'}
          <WithoutGoal {app} {chain} />
        {:else if key === 'cheaper'}
          <WouldHelp {app} {chain} />
        {:else if key === 'chart'}
          <p class="note">For the {selected && selected === chain.accepted ? 'reserved' : 'proposed'} chain shown above.</p>
          <Staircase route={selected} {ships} />
        {:else if key === 'settings'}
          <GoalSettings {chain} {allIn} {ships} />
        {/if}
      {/snippet}
    </Tabs>
  </Fold>
</div>

<style>
  .detail { display: flex; flex-direction: column; gap: 12px; }
  h2 { margin: 0; font-size: 22px; }
  .start { margin: 2px 0 0; font-size: 13px; color: var(--muted); }
  .route { margin: 4px 0 0; color: var(--muted); }
  .warnline { margin: 0 0 12px; color: var(--warn); font-size: 15px; }
  .ways { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-start; }
  :global(.noroute) p { margin: 0; color: var(--warn); font-size: 15px; }
  .issues { margin: 6px 0 0; padding-left: 18px; color: var(--warn); }
  .journey, .runsteps { display: flex; flex-direction: column; gap: 8px; list-style: none; margin: 0; padding: 0; }
  .runsteps { margin-top: 8px; }
  .runbtn { width: 100%; text-align: left; padding: 8px 12px; border-radius: 10px; color: var(--muted); border-left: 4px solid var(--own); }
  .maplink { margin: -4px 0 0; }
  .linkbtn { background: none; border: 0; padding: 2px 0; color: var(--link); text-decoration: underline; font: inherit; cursor: pointer; }
  .note { color: var(--muted); font-size: 13px; margin: 6px 0; }
  .share { font-size: 14px; color: var(--text); }
  .share p { margin: 0; }
  .share summary { cursor: pointer; color: var(--muted); font-size: 13px; }
  .share ul { margin: 4px 0 0; padding-left: 18px; color: var(--muted); font-size: 13px; }
  .notitle { margin: 0 0 6px; font-size: 17px; }
  .otherways { margin-top: 12px; }
  .otherways summary { cursor: pointer; color: var(--muted); }
  .chain { display: flex; flex-direction: column; gap: 8px; }
  .chainnote { margin: 0; }
  .held { margin: 0 0 8px; padding-left: 18px; font-size: 14px; }
  .heldfold { margin: 0 0 8px; font-size: 14px; }
  .heldfold summary { cursor: pointer; }
  .heldfold .held { margin-top: 6px; }
  .releaserow { margin: 10px 0 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .releaserow .note { margin: 0; }
  .st { margin: 6px 0 0; font-size: 13px; color: var(--muted); }
  .st.ok { color: var(--accent); } .st.repriced { color: var(--warn); } .st.blocked { color: #ff7b72; }
  .banner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; padding: 8px 12px; margin-bottom: 8px; border-radius: 10px; border: 1px solid var(--glass-border); background: rgba(8, 12, 20, 0.45); }
  .banner.better { border-color: var(--now); }
  .btext { font-weight: 600; }
  .bbtns { display: inline-flex; gap: 8px; }
  .moneyrow { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; }
  .money { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; font-size: 14px; }
  .bigfig { font-size: 26px; font-weight: 800; line-height: 1.1; font-variant-numeric: tabular-nums; color: var(--now); }
  .sep, [data-progress] { color: var(--muted); }
  .progress { margin-top: 8px; }
  .next { margin: 8px 0 0; font-weight: 600; }
  .compare { margin: 0 0 8px; padding: 8px 12px; border-radius: 10px; background: rgba(8, 12, 20, 0.35); }
  .compare ul { margin: 0 0 6px; padding-left: 18px; font-size: 13px; color: var(--muted); }
  .compare .note { margin: 0; }
  .sec { display: grid; gap: 4px; padding: 10px 0; border-top: 1px solid var(--glass-border); }
  .sec:first-child { border-top: 0; padding-top: 0; }
  .sec h3 { margin: 0 0 2px; font-size: 14px; }
  .sec p { margin: 0; font-size: 13px; color: var(--muted); max-width: 70ch; }
  .sec p.st.ok { color: var(--accent); }
  .share { padding: 10px 0; border-top: 1px solid var(--glass-border); }
  .sec :global(.quick) { padding: 0; border: 0; background: none; backdrop-filter: none; -webkit-backdrop-filter: none; }
</style>
