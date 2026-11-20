<script>
  import { sessionOf } from '$logic/session.mjs';
  import { warbondTargets, warbondSources, recentWarbondEvents, hangarShipIds, upgradeIntoIds, scopeOffers, filterWarbondTargets } from '$logic/warbonds.mjs';
  import { shipName, goalLabel } from '$logic/ships.mjs';
  import { upgradeToolUrl } from '$logic/links.mjs';
  import { usd } from '$logic/format.mjs';
  import { keyed } from './view/hangar.mjs';
  import { storeVerdicts, VERDICT_LABEL, VERDICT_HELP } from './view/store.mjs';
  import { todayView } from './view/today.mjs';
  import { ui, openHangarUpgrades } from './state.svelte.js';
  import InlineCheck from './store/InlineCheck.svelte';
  import ShipThumb from './ShipThumb.svelte';
  import RsiLink from './RsiLink.svelte';
  import GlassPanel from './ui/GlassPanel.svelte';
  import SearchBox from './ui/SearchBox.svelte';
  import { noMatchesText, whenText } from '$logic/describe.mjs';
  import Fold from './goals/Fold.svelte';

  let { app } = $props();
  const ships = $derived(app.data.ships);
  const offers = $derived(app.data.offers);
  const name = (id) => shipName(ships, id);
  const goalName = (id) => (app.plans.chains[id] ? goalLabel(app.plans.chains[id], ships) : 'a goal');
  const ship = (id) => ships.get(id) ?? null;

  const WINDOWS = [[24, '24 h'], [168, '7 d'], [720, '30 d']];
  // Search, filters and opened cards are kept for the session (ui.store): the page is rebuilt on every visit.
  let hours = $state(ui.store.hours);
  let query = $state(ui.store.query);
  let onlyMine = $state(ui.store.onlyMine);
  // Which Warbond source ships to list: all, the ships in the hangar, or the ships you own an upgrade into.
  let scope = $state(ui.store.scope);
  $effect(() => { ui.store.hours = hours; ui.store.query = query; ui.store.onlyMine = onlyMine; ui.store.scope = scope; });
  const SCOPES = [['all', 'All source ships'], ['hangar', 'Ships in my hangar'], ['upgrade', 'Ships I have an upgrade into']];

  // The planner's verdict per offer comes from the journeys Today shows, so the two pages agree.
  const verdicts = $derived(storeVerdicts(todayView(app).goals));
  const verdictOf = (to) => verdicts.ships.get(to) ?? null;
  const own = $derived({ hangar: hangarShipIds(app.data), upgradeInto: upgradeIntoIds(app.data) });
  const usage = $derived(sessionOf(app).warbondUsage());
  // The scope applies to the individual source offers, so the cards, their counts, the cheapest caption and the sources shown agree.
  const scoped = $derived(scopeOffers(offers, scope, own));
  const all = $derived(warbondTargets(scoped, ships, { session: sessionOf(app), history: app.data.history ?? [], now: Date.now(), hours, usage }));
  const total = $derived(scoped.reduce((n, o) => n + (o.kind === 'warbond' ? 1 : 0), 0));
  const recent = $derived(recentWarbondEvents(app.data.history ?? [], offers, hours));
  // The "new" count in the summary follows the scope like the other two numbers; the fold below lists every source ship.
  const newInScope = $derived(scope === 'all' ? recent.appeared.length : recentWarbondEvents(app.data.history ?? [], scoped, hours).appeared.length);
  const sourcesOf = $derived(new Map(all.map((t) => [t.to, warbondSources(scoped, ships, t.to, { ...own, usage })])));
  const shown = $derived(
    filterWarbondTargets(all, ships, scoped, query)
      .filter((t) => !onlyMine || verdictOf(t.to)),
  );
  const cards = $derived(keyed(shown, (t) => t.to));
  const searching = $derived(query.trim() !== '');
  // True only when the search text itself (not the checkboxes) leaves nothing.
  const queryEmptied = $derived(searching && filterWarbondTargets(all, ships, scoped, query).length === 0);
  const appeared = $derived(keyed(recent.appeared, (e) => `${e.skuId}:${e.fromId}:${e.at}`));
  const gone = $derived(keyed(recent.disappeared, (e) => `${e.skuId}:${e.fromId}:${e.at}`));
  const windowLabel = $derived(WINDOWS.find(([h]) => h === hours)?.[1] ?? `${hours} h`);
  // What matters to your goals comes first; the rest starts as a short list.
  const isMine = (t) => !!verdictOf(t.to);
  const mineCards = $derived(cards.filter((c) => isMine(c.item)));
  const otherCards = $derived(cards.filter((c) => !isMine(c.item)));
  const OTHER_SHOWN = 20;
  let allOthers = $state(false);
  // A search shows every match; only the unsearched list starts short.
  const otherShown = $derived(allOthers || searching ? otherCards : otherCards.slice(0, OTHER_SHOWN));
  const LIST_MAX = 40;
  const day = (iso) => whenText(iso) ?? '';
  // What your own data says about a source ship: kept apart, because an upgrade into a ship is not the ship.
  const OWN_CELL = { ship: '✓ ship in hangar', upgrade: '↗ upgrade into it' };
  // The best source's ownership is a small chip after the line, not a parenthesis in it.
  const ownText = (o) => ({ ship: 'ship owned', upgrade: 'owned upgrade' }[o] ?? null);
  const bestLine = (t, best, verdict) => [
    `${t.sources} source ${t.sources === 1 ? 'ship' : 'ships'}`,
    `best: ${name(t.cheapest.from)}`,
    verdict ? `for ${goalsText(verdict)}` : null,
  ].filter(Boolean).join(' · ');
  const goalsText = (v) => v?.goals.map((g) => g.name).join(', ') ?? '';
  // Every source of a card saves the same when the Standard price is the same step: say it once in the header.
  const sameSaving = (sources) => {
    const first = sources[0]?.saving;
    return first != null && first > 0 && sources.every((x) => x.saving === first) ? first : null;
  };
  const checkKey = (from, to) => `${from}-${to}`;
</script>

{#snippet event(e, sign)}
  <div class="ev" data-from={e.fromId} data-to={e.toId}>
    <span class="sign">{sign}</span>
    <ShipThumb ship={ship(e.fromId)} size="xs" /> {name(e.fromId)} → {name(e.toId)}
    <span class="muted">{usd(e.cash)} · {day(e.at)}</span>
  </div>
{/snippet}

{#snippet offerCard(t)}
    {@const sources = sourcesOf.get(t.to) ?? []}
    {@const isOpen = !!ui.store.open[t.to]}
    {@const verdict = verdictOf(t.to)}
    {@const vkey = verdict ? verdict.verdict : 'none'}
    {@const best = sources.find((x) => x.from === t.cheapest.from)}
    {@const flat = sameSaving(sources)}
    {@const showSaves = flat == null && sources.some((x) => x.saving != null)}
    <GlassPanel as="section" class="card" data-to={t.to} data-verdict-kind={vkey}>
      <button class="head" aria-expanded={isOpen} aria-controls="wb-src-{t.to}" onclick={() => { ui.store.open[t.to] = !isOpen; }}>
        <ShipThumb ship={ship(t.to)} size="m" />
        <span class="info">
          <span class="title">
            <span class="name">{t.name}</span>
            {#if t.concept}<span class="tag concept">Concept</span>{/if}
            {#if t.newSince}<span class="tag new" title="Appeared {day(t.newSince)}">New</span>{/if}
          </span>
          <span class="line">
            {bestLine(t, best, verdict)}
            {#if ownText(best?.ownership)}<span class="tag own" title={best.ownership === 'ship' ? 'You own the best source ship' : 'You own an upgrade into the best source ship, not the ship itself'}>{ownText(best.ownership)}</span>{/if}
          </span>
        </span>
        <span class="fig">
          <span class="from">from <strong class="big" data-testid="wb-from">{usd(t.cheapest.cash)}</strong></span>
          {#if t.cheapest.saving != null && t.cheapest.saving > 0}
            <span class="minus" title="Standard {usd(t.cheapest.standard)}">−{usd(t.cheapest.saving)}</span>
          {:else if t.cheapest.saving == null}
            <span class="muted small">no Standard offer</span>
          {/if}
        </span>
        {#if verdict}<span class="verdict {vkey}" title={VERDICT_HELP[vkey]} data-verdict-chip>{VERDICT_LABEL[vkey]}</span>{/if}
        <span class="chev">{isOpen ? 'Hide' : 'Details'} <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span></span>
      </button>
      {#if isOpen}
        <div class="sources" id="wb-src-{t.to}">
          <p class="srchead">
            <span>{flat != null ? `All sources save ${usd(flat)} against Standard.` : 'Warbond against Standard price, cheapest first.'}</span>
            <button type="button" class="linkbtn" data-hangar-upgrades onclick={() => openHangarUpgrades(t.name, `Back to ${t.name} offers`)}>See matching upgrades in my hangar</button>
          </p>
          <div class="tablewrap">
            <table>
              <thead><tr><th scope="col">From</th><th scope="col" class="num">Warbond</th><th scope="col" class="num">Standard</th>{#if showSaves}<th scope="col" class="num">Saves</th>{/if}<th scope="col">You own</th><th scope="col">Plan</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
              <tbody>
                {#each keyed(sources, (x) => x.from) as { item: x, key: k } (k)}
                  {@const inPlan = verdicts.pairs.get(checkKey(x.from, t.to))}
                  {@const ck = checkKey(x.from, t.to)}
                  <tr class:plan={!!inPlan} data-from={x.from} data-to={t.to}>
                    <th scope="row" class="fromcell"><ShipThumb ship={ship(x.from)} size="s" /> <span>{x.fromName}</span></th>
                    <td class="num price">{usd(x.cash)}</td>
                    <td class="num muted">{x.standard != null ? usd(x.standard) : '–'}</td>
                    {#if showSaves}<td class="num" class:muted={!(x.saving > 0)}>{x.saving != null ? (x.saving > 0 ? usd(x.saving) : 'none') : ''}</td>{/if}
                    <td>{#if x.ownership}<span class="tag own" title={x.ownership === 'ship' ? 'Ship owned' : 'Own an upgrade into this ship, not the ship itself'}>{OWN_CELL[x.ownership]}</span>{/if}</td>
                    <td>{#if inPlan}<span class="tag plan" title="{inPlan.verdict === 'plan' ? 'Today lists this step to buy' : 'A step of'} {goalsText(inPlan)}">{inPlan.verdict === 'plan' ? 'In your plan' : 'Helps a goal'}</span>{/if}</td>
                    <td class="acts">
                      <button type="button" class="more" aria-expanded={!!ui.store.checks[ck]} onclick={() => { ui.store.checks[ck] = !ui.store.checks[ck]; }}>Check against my goals</button>
                      <RsiLink href={upgradeToolUrl({ from: x.from, to: t.to })} label="Buy on RSI" aria="Buy {x.fromName} to {t.name} on RSI" />
                    </td>
                  </tr>
                  {#if ui.store.checks[ck]}
                    <tr class="checkrow"><td colspan={showSaves ? 7 : 6}><InlineCheck {app} from={x.from} to={t.to} kind="warbond" cash={x.cash} /></td></tr>
                  {/if}
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/if}
    </GlassPanel>
{/snippet}

<div class="warbonds">
  <GlassPanel as="header">
    <h2>On sale now</h2>
    <p class="summary">
      <strong data-testid="wb-targets">{all.length}</strong> {all.length === 1 ? 'ship has' : 'ships have'} Warbond upgrades on sale
      (<strong data-testid="wb-offers">{total}</strong> {total === 1 ? 'offer' : 'offers'} in all) · <strong data-testid="wb-new">{newInScope}</strong> new in the last {windowLabel}
    </p>
    {#if scope !== 'all'}<p class="summary" data-scope-note>Counting only offers from {scope === 'hangar' ? 'ships in your hangar' : 'ships you own an upgrade into'}.</p>{/if}
    <div class="controls">
      <label class="chk"><input type="checkbox" bind:checked={onlyMine} /> only my goals</label>
      <span class="seg" role="group" aria-label="Source ships to list"><span class="muted segname">Upgrade from</span>
        {#each SCOPES as [id, label] (id)}
          <button class="chip-btn" class:active={scope === id} aria-pressed={scope === id} data-scope={id} onclick={() => { scope = id; }}>{label}</button>
        {/each}
      </span>
    </div>
  </GlassPanel>

  <SearchBox bind:value={query} label="Search the Store" placeholder="Search ships or manufacturers" shown={shown.length} total={all.length} />

  {#if mineCards.length}
    <h3 class="grp">For your goals ({mineCards.length})</h3>
    {#each mineCards as { item: t, key } (key)}{@render offerCard(t)}{/each}
  {:else if all.length && !queryEmptied}
    <p class="muted nomine">None of the Warbond offers on sale now is a step of your goals.</p>
  {/if}
  {#if otherCards.length}
    <h3 class="grp">{mineCards.length ? 'Other offers' : 'All offers'} ({otherCards.length})</h3>
    {#each otherShown as { item: t, key } (key)}{@render offerCard(t)}{/each}
    {#if otherCards.length > OTHER_SHOWN && !searching}
      <p><button type="button" aria-expanded={allOthers} onclick={() => { allOthers = !allOthers; }}>{allOthers ? `Show only the first ${OTHER_SHOWN}` : `Show all ${otherCards.length}`}</button></p>
    {/if}
  {/if}
  {#if !cards.length}
    <p class="muted">{!all.length ? 'No Warbond offers on sale.' : queryEmptied ? noMatchesText(query) : 'No ships match the filters.'}</p>
  {/if}
  <Fold title="Offers that appeared ({recent.appeared.length}) or ended ({recent.disappeared.length}) in the last {windowLabel}">
  <span class="seg" role="group" aria-label="Time window"><span class="muted segname">Show the last</span>
    {#each WINDOWS as [h, label] (h)}
      <button class="chip-btn" class:active={hours === h} aria-pressed={hours === h} onclick={() => { hours = h; }}>{label}</button>
    {/each}
  </span>
  <p class="muted">Many offers end together when a sale finishes, so a big number of ended offers is normal.{scope !== 'all' ? ' These lists cover every source ship, not only the ones chosen above.' : ''}</p>
  {#if !(app.data.history ?? []).length}
    <p class="muted">No offer history yet. It is recorded on each refresh.</p>
  {:else}
    <div class="cols">
      <div>
        {#each appeared.slice(0, LIST_MAX) as { item: e, key } (key)}{@render event(e, '+')}{:else}<p class="muted">No Warbond appeared.</p>{/each}
        {#if appeared.length > LIST_MAX}<p class="muted">+{appeared.length - LIST_MAX} more</p>{/if}
      </div>
      <div>
        {#each gone.slice(0, LIST_MAX) as { item: e, key } (key)}{@render event(e, '−')}{:else}<p class="muted">No offer disappeared.</p>{/each}
        {#if gone.length > LIST_MAX}<p class="muted">+{gone.length - LIST_MAX} more</p>{/if}
      </div>
    </div>
  {/if}
  </Fold>
</div>

<style>
  .warbonds { display: flex; flex-direction: column; gap: 12px; }
  h2 { margin: 0 0 4px; font-size: 18px; }
  h3 { margin: 0 0 8px; color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  .summary { margin: 0 0 8px; color: var(--muted); }
  .summary strong { color: var(--text); }
  .muted { color: var(--muted); }
  .controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  .seg { display: inline-flex; gap: 6px; }
  .chk { display: flex; gap: 4px; align-items: center; color: var(--muted); font-size: 12px; }
  :global(.warbonds .card) { padding: 0; }
  .head { display: flex; gap: 12px; align-items: center; width: 100%; padding: 10px 14px; background: none; border: 0; border-radius: var(--radius); font: inherit; text-align: left; }
  .head:hover:not(:disabled) { background: rgba(255, 255, 255, 0.05); }
  .info { display: grid; gap: 4px; flex: 1; min-width: 0; }
  .title { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .name { font-weight: 600; }
  .line { color: var(--muted); font-size: 13px; }
  .fig { display: grid; justify-items: end; gap: 0; min-width: 7.5em; }
  .big { font-size: 24px; font-weight: 800; color: var(--now); font-variant-numeric: tabular-nums; }
  .from { color: var(--muted); font-size: 13px; }
  .minus { color: var(--now); font-weight: 600; font-variant-numeric: tabular-nums; }
  .small { font-size: 12px; }
  .verdict { flex: none; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--muted); color: var(--muted); font-size: 12px; font-weight: 600; white-space: nowrap; }
  .verdict.plan { color: var(--now); border-color: var(--now); }
  .verdict.helps { color: var(--accent); border-color: var(--accent); }
  .segname { align-self: center; margin-right: 4px; font-size: 12px; }
  .chev { color: var(--accent); font-size: 13px; white-space: nowrap; }
  .grp { margin: 6px 0 0; font-size: 15px; font-weight: 600; text-transform: none; letter-spacing: 0; color: var(--text); }
  .nomine { margin: 0; }
  .tag.new { color: var(--now); border-color: var(--now); }
  .tag.concept, .tag.used { color: var(--text); border-color: var(--accent); }
  .tag.target { color: var(--text); border-color: var(--now); }
  .tag.own { color: var(--text); border-color: var(--own); }
  .tag.plan { color: var(--text); border-color: var(--now); }
  .sources { padding: 0 14px 10px; border-top: 1px solid var(--glass-border); }
  .srchead { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 16px; margin: 8px 0; color: var(--muted); font-size: 13px; }
  .linkbtn { background: none; border: 0; padding: 0; color: var(--link); text-decoration: underline; font: inherit; cursor: pointer; }
  .tablewrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; font-size: 12px; font-weight: 600; color: var(--muted); padding: 4px 8px; }
  td, th[scope='row'] { padding: 4px 8px; border-top: 1px solid var(--glass-border); vertical-align: middle; }
  th[scope='row'] { font-weight: 400; color: var(--text); font-size: 14px; }
  .fromcell { display: flex; align-items: center; gap: 8px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .price { color: var(--now); font-weight: 700; }
  tr.plan { background: rgba(63, 185, 80, 0.08); }
  .acts { display: flex; gap: 6px; align-items: center; justify-content: flex-end; white-space: nowrap; }
  .more { font-size: 12px; padding: 2px 10px; }
  .checkrow td { border-top: 0; padding-bottom: 10px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .ev { display: flex; gap: 6px; align-items: center; padding: 3px 0; border-bottom: 1px solid var(--glass-border); font-size: 13px; }
  .sign { width: 12px; color: var(--muted); }
  @media (max-width: 1023px) { .cols { grid-template-columns: 1fr; } }
</style>
