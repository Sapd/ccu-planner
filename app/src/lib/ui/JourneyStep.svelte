<script>
  import { upgradeToolUrl, hangarUrl } from '$logic/links.mjs';
  import { waitReasonText, wouldHelpLine, onSaleText, urgencyReasonText, FILLER_LABEL, stepKindLabel, virtualStepText, VIRTUAL_CHIP } from '$logic/describe.mjs';
  import { usd } from '$logic/format.mjs';
  import ShipThumb from '../ShipThumb.svelte';
  import RsiLink from '../RsiLink.svelte';
  import StateChip from './StateChip.svelte';
  import BuyWhatIf from '../BuyWhatIf.svelte';

  // item: one journey step ({ step, state, lock, reason, alert, seen }); ships: Map.
  // below: the Warbond price (cents) under which this pair would get cheaper, or null; onExpand: called when a wait step opens.
  // copy: the owned CCU record for an owned step ({ copyId, paid, giftable }) or null.
  // needed: "Needed because <goal> uses <what>" for a purchase only the shared plan makes, or null.
  // app: the planner app; with it a buy step offers "If I buy this".
  // others: the other copies of this owned upgrade with the goals that use them ({ copyId, goals: [{ goalId, name }] }).
  let { item, ships, below = null, copy = null, others = [], needed = null, onExpand, app = null, number = null, phrase = '', onViewCopy = null } = $props();
  const s = $derived(item.step);
  const name = (id) => ships.get(id)?.name ?? 'unknown ship';
  let open = $state(false);
  const uid = $props.id();

  // Built in script: Svelte trims the spaces at the edges of {#if} blocks, which glued the " · " parts together.
  const ownTail = $derived([
    copy ? `paid ${usd(copy.paid?.cents)}` : null,
    copy ? (copy.giftable ? 'giftable' : 'not giftable') : null,
    s.otherCopies ? `+${s.otherCopies} more copies` : null,
  ].filter(Boolean).map((t) => ` · ${t}`).join(''));
  const seenLine = $derived(item.seen ? waitReasonText('seen', { event: item.seen.event, seen: item.seen, cash: s.cash }) : null);
  const toggle = () => { open = !open; if (open && item.state === 'wait') onExpand?.(item); };
</script>

<div class="row {item.state}" class:calm={item.urgency === 'norush'} data-from={s.from} data-to={s.to} tabindex="-1">
  <div class="line">
    <button type="button" class="rowbtn" aria-expanded={open} aria-controls="det-{uid}" onclick={toggle}>
      {#if phrase}<span class="sr">{phrase}</span>{/if}
      {#if number}<span class="no" title="Step {number}" aria-hidden={phrase ? 'true' : undefined}>{number}</span>{/if}
      <!-- One picture per step: the ship you get. Both names stay as text, beside it at any width. -->
      <span class="pair" aria-hidden={phrase ? 'true' : undefined}>
        <ShipThumb ship={ships.get(s.to) ?? null} size="s" />
        <span class="names"><span class="nm">{name(s.from)}</span> <span aria-hidden="true">→</span> <span class="nm">{name(s.to)}</span></span>
      </span>
      <span class="chipcell"><span aria-hidden={phrase ? 'true' : undefined}><StateChip state={item.state === 'now' && item.urgency === 'norush' ? 'norush' : item.state} lock={item.lock} text={item.state === 'wait' && item.filler ? FILLER_LABEL : item.state === 'now' && s.virtual && !item.lock ? VIRTUAL_CHIP : null} /></span>{#if item.alert}<span class="warnmark" role="img" aria-label="Alert: {item.alert}" title={item.alert}>!</span>{/if}</span>
      <span class="cost" aria-hidden={phrase ? 'true' : undefined}>{#if item.state !== 'own'}<b class="price">{usd(s.cash)}</b><span class="kind">{stepKindLabel(s)}</span>{/if}</span>
      <span class="chev" aria-hidden="true">{open ? '▾' : '›'}</span>
    </button>
    {#if item.state === 'now' && !s.virtual}
      <span class="act"><RsiLink href={upgradeToolUrl({ from: s.from, to: s.to })} label="Buy on RSI" aria="Buy {name(s.from)} to {name(s.to)} on RSI" /></span>
    {/if}
  </div>
  {#if open}
    <div class="det" id="det-{uid}">
      {#if item.alert}<p class="alert">{item.alert}</p>{/if}
      {#if item.lock && item.reason}<p class="why">{item.reason}</p>{/if}
      {#if item.trade}<p class="why" data-trade>{item.trade}</p>{/if}
      {#if item.state === 'now' && item.urgency === 'today' && item.urgencyReasons?.length}<p class="why">Buy now: {item.urgencyReasons.map(urgencyReasonText).join(', ')}.</p>{/if}
      {#if item.state === 'now' && item.urgency === 'norush' && (item.since || item.until)}<p class="why">{onSaleText(item)}</p>{/if}
      {#if item.cover}<p class="why">{item.cover}</p>{/if}
      {#if needed}<p class="why needed">{needed}</p>{/if}
      {#if item.state === 'own'}
        <p class="why">Owned CCU{ownTail}</p>
        {#if others.length}
          <ul class="copies" data-other-copies>
            {#each others as o, i (o.copyId)}
              <li>Copy {i + 2}: {o.goals.length ? `used by ${o.goals.map((g) => g.name).join(', ')}` : 'not used by any goal'}{#if onViewCopy} <button type="button" class="more" onclick={() => onViewCopy(o.copyId)}>View in Hangar</button>{/if}</li>
            {/each}
          </ul>
        {/if}
        <p class="links">
          {#if copy && onViewCopy}<button type="button" class="more" data-view-copy onclick={() => onViewCopy(copy.copyId)}>View this copy in Hangar</button>{/if}
          <RsiLink href={hangarUrl()} label="Open on RSI" aria="Open {name(s.from)} to {name(s.to)} in the RSI hangar" />
        </p>
      {:else if item.state === 'wait'}
        <div class="expand">
          <p>{item.reason}</p>
          {#if item.slot?.count}<p class="slot" data-slot>Ships in this range: {item.slot.examples.map((x) => x.name).join(', ')}{item.slot.count > item.slot.examples.length ? ` and ${item.slot.count - item.slot.examples.length} more` : ''}.</p>{/if}
          {#if seenLine && seenLine !== item.reason}<p>{seenLine}</p>{/if}
          {#if below != null}<p>{wouldHelpLine(usd(below))}</p>{/if}
        </div>
      {:else if s.virtual}
        <p class="why" data-virtual-step>{virtualStepText(s)}</p>
      {:else if app && item.state === 'now'}
        <div class="whatif"><BuyWhatIf {app} from={s.from} to={s.to} kind={s.kind} cash={s.cash} /></div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .copies { margin: 4px 0 0; padding-left: 18px; color: var(--muted); font-size: 13px; }
  .row { position: relative; padding: 0 12px; border-radius: 10px; background: rgba(8, 12, 20, 0.35); border: 1px solid var(--glass-border); border-left: 4px solid var(--own); }
  .row.now { border-left-color: var(--now); }
  .row.now.calm { border-left-color: var(--accent); }
  .row.wait { border-left-color: var(--wait); }
  .line { display: flex; align-items: center; gap: 8px; }
  /* The whole row is the toggle: a plain button that looks like the row. */
  .rowbtn { flex: 1 1 auto; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 8px 0; text-align: left; background: none; border: 0; border-radius: 8px; color: inherit; font: inherit; cursor: pointer; }
  .rowbtn:hover:not(:disabled) { background: none; }
  .rowbtn:hover .nm { text-decoration: underline; }
  .rowbtn:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .pair { display: inline-flex; align-items: center; gap: 8px; flex: 1 1 300px; min-width: 0; }
  .names { min-width: 0; overflow-wrap: anywhere; }
  .nm { overflow-wrap: anywhere; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .no { font-variant-numeric: tabular-nums; color: var(--muted); font-weight: 600; min-width: 2ch; }
  .chipcell { min-width: 7em; display: inline-flex; align-items: center; gap: 6px; }
  .warnmark { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; background: var(--warn); color: #10141d; font-size: 11px; font-weight: 800; line-height: 1; cursor: help; }
  .cost { display: inline-flex; align-items: baseline; justify-content: flex-end; gap: 6px; min-width: 9em; }
  .price { font-variant-numeric: tabular-nums; }
  .kind { font-size: 12px; color: var(--muted); }
  .chev { margin-left: auto; width: 1.2em; text-align: center; color: var(--muted); font-size: 16px; }
  .act { flex: none; display: flex; align-items: center; }
  .more { font-size: 12px; padding: 2px 10px; }
  .det { padding: 0 0 8px; }
  p { margin: 6px 0 0; font-size: 13px; }
  .alert { color: var(--warn); }
  .why { color: var(--muted); }
  .whatif { margin-top: 6px; }
  .links { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 6px 0 0; }
  .row:focus { outline: 2px solid var(--focus); outline-offset: 2px; }
  .row:focus:not(:focus-visible) { outline-color: var(--focus); }
  .expand { margin-top: 6px; padding: 6px 10px; border-radius: 8px; background: rgba(76, 194, 255, 0.1); }
  .expand p { margin: 2px 0; }
  .row:not(:hover):not(:focus-within) :global(.rsi) { opacity: 0.75; }
</style>
