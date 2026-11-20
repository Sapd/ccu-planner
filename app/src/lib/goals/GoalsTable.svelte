<script>
  import { LEVEL_TEXT, noTokenHelp } from '$logic/describe.mjs';
  import { usd } from '$logic/format.mjs';
  import { goalRow, nextSort, sortRows, ariaSort, progressText } from '../view/goalTable.mjs';
  import ShipThumb from '../ShipThumb.svelte';
  import StateChip from '../ui/StateChip.svelte';
  import JourneyBar from '../ui/JourneyBar.svelte';

  // The goals as one compact table, grouped by planning level (group rows), one price per goal.
  // levels: [{ priority, goals: todayView goals }]; ship(id) -> ship; onOpen(goalId); noRouteTitle(goal) -> tooltip.
  let { levels, currentId = null, ship, onOpen, noRouteTitle = () => '', grouped = true, label = 'Your goals, in planning order' } = $props();
  let sort = $state(null);
  const groups = $derived(levels.map((l) => ({ priority: l.priority, rows: sortRows(l.goals.map((g) => ({ ...goalRow(g), goal: g })), sort) })));
  const click = (key) => { sort = nextSort(sort, key); };
  const arrow = (key) => (sort?.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const titleOf = (r) => (r.goal.status === 'no-token' ? noTokenHelp(r.goal.start) : r.goal.status === 'no-route' ? noRouteTitle(r.goal) : r.nowCash != null ? `Reserved at ${usd(r.left)}; ${usd(r.nowCash)} at today's prices.${r.cheaperBy ? ' Open the goal to switch to the cheaper chain.' : ''}` : undefined);
</script>

<div class="gt">
<table class="goaltable" aria-label={label}>
  <thead>
    <tr>
      <th scope="col" class="img"><span class="sr">Ship</span></th>
      <th scope="col" class="goal">Goal</th>
      <th scope="col" class="num" aria-sort={ariaSort(sort, 'left')}><button type="button" class="sortbtn" onclick={() => click('left')} title="New cash still needed in the shared plan. Sort by it.">Left{arrow('left')}</button></th>
      <th scope="col" class="prog" aria-sort={ariaSort(sort, 'progress')}><button type="button" class="sortbtn" onclick={() => click('progress')} title="Upgrades owned out of the whole chain. Sort by it.">Progress{arrow('progress')}</button></th>
      <th scope="col" class="state"><span class="sr">What to do next</span></th>
    </tr>
  </thead>
  {#each groups as g (g.priority)}
    <tbody>
      {#if grouped}<tr class="group {g.priority}"><th scope="colgroup" colspan="5" title={LEVEL_TEXT[g.priority].help}>{LEVEL_TEXT[g.priority].title} <span class="gn">{g.rows.length}</span></th></tr>{/if}
      {#each g.rows as r (r.id)}
        <tr class="row" class:active={r.id === currentId} data-goal={r.id}>
          <td class="img"><ShipThumb ship={ship(r.goal.targetId)} size="s" /></td>
          <th scope="row" class="goal" title={[r.name, r.from, titleOf(r)].filter(Boolean).join(' · ')}>
            <button type="button" class="open" aria-current={r.id === currentId ? 'true' : undefined} onclick={() => onOpen(r.id)}>
              <span class="nm">{r.name}</span>{#if r.from}<span class="from">{r.from}</span>{/if}
            </button>
          </th>
          <td class="num"><span class="left" class:none={r.left == null} title={titleOf(r)}>{r.left == null ? '–' : usd(r.left)}</span>{#if r.cheaperBy}<span class="possible" role="img" aria-label="A chain {usd(r.cheaperBy)} cheaper is available" title="A chain {usd(r.cheaperBy)} cheaper is available">↓</span>{/if}</td>
          <td class="prog">
            {#if r.total && !r.flag}<span class="bar" title={progressText(r)}><JourneyBar bar={r.bar} label={progressText(r)} /></span>{/if}
          </td>
          <td class="state">
            {#if r.flag}
              <span class="flag {r.flag.tone}">{r.flag.text}</span>
            {:else if r.chip}
              <StateChip state={r.chip.state} count={r.chip.count} />
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  {/each}
</table>
</div>

<style>
  .goaltable { width: 100%; border-collapse: collapse; font-size: 13px; }
  .goaltable th, .goaltable td { border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding: 6px 6px; text-align: left; vertical-align: middle; font-weight: 400; }
  thead th { font-size: 12px; color: var(--muted); font-weight: 600; padding-bottom: 4px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .sortbtn { background: none; border: 0; padding: 0; font: inherit; font-weight: 600; color: var(--muted); }
  .sortbtn:hover:not(:disabled) { background: none; color: var(--text); }
  .num { text-align: right; width: 5.4em; white-space: nowrap; }
  .img { width: 44px; padding-right: 0; }
  .img :global(.thumb) { width: 44px; height: 22px; }
  .group th { padding-top: 12px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); border-bottom: 1px solid var(--glass-border); }
  .group.accepted th { color: var(--held); }
  .gn { font-weight: 400; font-variant-numeric: tabular-nums; }
  /* The start sits under the ship name in a narrow pane and beside it (one line per goal) once the table is wide. Never wraps: ellipsis. */
  .goal { max-width: 0; width: 100%; }
  .open { display: grid; gap: 0; width: 100%; min-width: 0; text-align: left; background: none; border: 0; padding: 2px 0; font: inherit; color: var(--text); }
  .open:hover:not(:disabled) { background: none; }
  .open:hover .nm { text-decoration: underline; }
  .nm { min-width: 0; font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .from { min-width: 0; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .left { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .possible { margin-left: 4px; font-size: 13px; font-weight: 700; color: var(--now); }
  .left.none { color: var(--muted); font-weight: 400; }
  .prog { width: 64px; }
  .bar { display: block; width: 56px; }
  .state { white-space: nowrap; width: 1%; }
  .flag { font-size: 12px; font-weight: 600; }
  .flag.warn { color: var(--warn); } .flag.own { color: #a9b6c9; }
  .row.active > td, .row.active > th { background: rgba(76, 194, 255, 0.1); }
  .row.active td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
  .gt { container-type: inline-size; }
  @container (min-width: 640px) {
    .open { display: flex; align-items: baseline; gap: 8px; }
    .from { flex: 1 1 0; }
    .nm { flex: 0 1 auto; }
  }
</style>
