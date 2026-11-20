<script>
  import { todayView } from './view/today.mjs';
  import { usd } from '$logic/format.mjs';
  import { shortDay } from '$logic/availability.mjs';
  import { noRouteMessage, eventRiskText, heroBuyTitle, heroGoalsLine, nothingWhyText, todayNothingHeadline, onlyOptionalText, BUY_GROUPS, waitingHeadline, meltTipText } from '$logic/describe.mjs';
  import { incomingCount } from '$logic/planner.mjs';
  import { ui, goSection, openGoal } from './state.svelte.js';
  import GlassPanel from './ui/GlassPanel.svelte';
  import ShipHero from './ui/ShipHero.svelte';
  import StateChip from './ui/StateChip.svelte';
  import GoalsTable from './goals/GoalsTable.svelte';
  import Term from './ui/Term.svelte';
  import Explainer from './ui/Explainer.svelte';
  import Onboarding from './Onboarding.svelte';
  import ImportSummary from './ImportSummary.svelte';
  import ChangesPanel from './ChangesPanel.svelte';
  import TodayBuy from './TodayBuy.svelte';

  let { app } = $props();
  const v = $derived(todayView(app));
  const ships = $derived(app.data.ships);
  const ship = (id) => ships.get(id) ?? null;
  const name = (id) => ships.get(id)?.name ?? 'unknown ship';
  const goalName = (id) => v.goals.find((g) => g.goalId === id)?.targetName ?? 'a goal';
  const hero = $derived(v.hero.shipId != null ? ship(v.hero.shipId) : null);
  const anyNoRoute = $derived(v.goals.some((g) => g.status === 'no-route'));
  const anyNoToken = $derived(v.goals.some((g) => g.status === 'no-token'));
  const noRouteTitle = (g) => noRouteMessage(name(g.targetId), incomingCount(app.graph, g.targetId));

  const riskCount = $derived(v.waiting.notices.filter((n) => n.eventOnly).length);
  const NOTICE_LIMIT = 3;
  let showAllNotices = $state(false);
  const shownNotices = $derived(showAllNotices ? v.waiting.notices : v.waiting.notices.slice(0, NOTICE_LIMIT));
  const GROUPS = ['today', 'norush', 'optional'];
  // The goal list stays closed: the Goals tab is where the table lives.
  let goalsOpen = $state(false);
</script>

<div class="today">
  <ImportSummary />
  {#if v.empty}
    <GlassPanel class="empty">
      <h2 class="headline">Welcome</h2>
      <Explainer inline />
      <Onboarding {app} />
    </GlassPanel>
  {:else}
    <ChangesPanel {app} />
    <ShipHero ship={hero} height={110}>
        {#if v.hero.nothing}
          <h2 class="headline">{todayNothingHeadline(v.hero.nothingWhy)}</h2>
          <p class="sub">{#if v.hero.nothingWhy === 'no-rush' && v.hero.otherCount > 0}{onlyOptionalText(v.hero.otherCount, usd(v.hero.otherCash))}{#if riskCount > 0 && v.waiting.event}{' '}{eventRiskText(riskCount, v.waiting.event)}{/if}{:else}{riskCount > 0 && v.waiting.event ? eventRiskText(riskCount, v.waiting.event) : nothingWhyText(v.hero.nothingWhy, { waitCount: v.waiting.count, anyNoRoute, anyNoToken })}{#if v.hero.otherLine}{' '}{v.hero.otherLine}{/if}{/if}</p>
        {:else}
          <h2 class="headline">{heroBuyTitle(v.hero.buyCount, usd(v.hero.buyCash))}</h2>
          <p class="sub">{heroGoalsLine(v.hero.goalsTouched.map(goalName))}{#if v.hero.otherLine} · {v.hero.otherLine}{/if}</p>
        {/if}
    </ShipHero>

    {#if v.buyList.creditLine}<p class="credit" data-credit>{v.buyList.creditLine}</p>{/if}
    {#each GROUPS as g (g)}
      {#if v.buyList[g].length}
        <GlassPanel class="buygroup {g}">
          <h2 title={BUY_GROUPS[g].help}><StateChip state={g === 'today' ? 'now' : g} />{#if g === 'today'} {BUY_GROUPS[g].title}{/if}</h2>
          <ul class="buys">
            {#each v.buyList[g] as row (row.key)}<TodayBuy {app} {row} {ships} />{/each}
          </ul>
        </GlassPanel>
      {/if}
    {/each}

    {#if v.waiting.count > 0}
      <GlassPanel class="waiting">
        <h2><button type="button" class="foldbtn" aria-expanded={goalsOpen} aria-controls="today-goals" onclick={() => { goalsOpen = !goalsOpen; }}><StateChip state="wait" /> {waitingHeadline(v.waiting.count, v.waiting.goals.length)} <span class="chev" aria-hidden="true">{goalsOpen ? '▾' : '▸'}</span></button></h2>
        {#if v.waiting.event}<p class="event">{v.waiting.event.name} ends {shortDay(v.waiting.event.to)}</p>{/if}
        {#each shownNotices as n (n.from + '>' + n.to)}
          <p class="line">{name(n.from)} → {name(n.to)}: {n.text}</p>
        {/each}
        {#if v.waiting.notices.length > NOTICE_LIMIT}
          <p><button type="button" class="more" aria-expanded={showAllNotices} onclick={() => { showAllNotices = !showAllNotices; }}>{showAllNotices ? 'Show fewer' : `Show ${v.waiting.notices.length - NOTICE_LIMIT} more`}</button></p>
        {/if}
        {#if goalsOpen}
          <div id="today-goals" class="goalsbody"><GoalsTable levels={[{ priority: 'normal', goals: v.goals }]} grouped={false} label="Your goals" ship={ship} onOpen={openGoal} {noRouteTitle} /></div>
        {/if}
      </GlassPanel>
    {/if}

    {#if v.melt}
      <GlassPanel class="melt">
        <span>{meltTipText(v.melt.count, usd(v.melt.credit))}<Term term="melt" /></span>
        <button type="button" onclick={() => goSection('hangar')}>See in Hangar</button>
      </GlassPanel>
    {/if}
  {/if}
</div>

<style>
  .today { display: flex; flex-direction: column; gap: 14px; }
  .headline { display: block; margin: 0 0 4px; font-size: 26px; line-height: 1.2; }
  h2 { margin: 0 0 6px; font-size: 16px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  p { margin: 0; }
  .sub { font-size: 16px; }
  .more { margin-top: 6px; background: rgba(76, 194, 255, 0.14); border-color: rgba(76, 194, 255, 0.4); padding: 4px 14px; }
  .credit { color: var(--muted); font-size: 13px; }
  .buys { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .event { font-weight: 600; margin-bottom: 4px; }
  .line { color: var(--muted); font-size: 13px; margin-top: 2px; }
  :global(.melt) { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  :global(.empty) { text-align: center; padding: 48px 16px; }
  .foldbtn { display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 0; background: none; border: 0; color: inherit; font: inherit; font-weight: inherit; cursor: pointer; text-align: left; }
  .foldbtn:hover:not(:disabled) { background: none; }
  .foldbtn:focus-visible { outline: 2px solid var(--focus); outline-offset: 4px; border-radius: 6px; }
  .chev { color: var(--muted); }
  .goalsbody { margin-top: 10px; }
</style>
