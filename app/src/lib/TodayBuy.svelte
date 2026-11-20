<script>
  import { plannedBuyText } from '$logic/whatifText.mjs';
  import { usd } from '$logic/format.mjs';
  import { upgradeToolUrl } from '$logic/links.mjs';
  import { shortDay } from '$logic/availability.mjs';
  import { BEST_DIFFERS_PLAIN, DONT_LOCK_LABEL, OFFER_NOTE, KIND_HELP } from '$logic/describe.mjs';
  import { offerNoteAction, clearOfferNoteAction } from './view/today.mjs';
  import { dispatch, openStep } from './state.svelte.js';
  import ShipThumb from './ShipThumb.svelte';
  import RsiLink from './RsiLink.svelte';
  import BuyWhatIf from './BuyWhatIf.svelte';

  // One purchase on Today as two lines: the goal it serves and the pair with its price, then one outcome sentence.
  // Everything else (why, what-if, the offer's end date) is behind "Why?".
  let { app, row, ships } = $props();
  const name = (id) => ships.get(id)?.name ?? 'unknown ship';
  const uid = $props.id();
  let open = $state(false);
  let busy = $state(false);
  let draft = $state('');
  const act = async (action) => { busy = true; try { await dispatch(action); } finally { busy = false; } };

  const goalNames = $derived(row.goals.map((g) => g.name));
  const outside = $derived(row.steps.filter((b) => b.outsideReserved).map((b) => row.goals.find((g) => g.goalId === b.goalId)?.name).filter(Boolean));
  const outcome = $derived(plannedBuyText({ cash: row.cash, goals: goalNames, lock: row.lock, outside }));
  const fallback = $derived(`A step of ${goalNames.length === 1 ? `${goalNames[0]}'s chain` : `the chains of ${goalNames.join(' and ')}`}.`);
</script>

<li class="buy" data-pair="{row.from}-{row.to}">
  <p class="for">
    {#each row.goals as g (g.goalId)}
      <button type="button" class="goalchip" data-for-goal={g.goalId} aria-label="Open the {name(row.from)} to {name(row.to)} step in the chain for {g.name}" onclick={() => openStep(g.goalId, row.from, row.to)}>For {g.name} <span aria-hidden="true">→</span></button>
    {/each}
    <button type="button" class="kind" aria-label="{row.kind === 'warbond' ? 'Warbond' : 'Standard'}: {KIND_HELP[row.kind]}" title={KIND_HELP[row.kind]}>{row.kind === 'warbond' ? 'Warbond' : 'Standard'}</button>
    {#if row.count > 1}<span class="count">{row.countText}</span>{/if}
  </p>
  <div class="pairrow">
    <span class="pair"><ShipThumb ship={ships.get(row.from) ?? null} size="s" /> <span class="nm">{name(row.from)}</span> <span aria-hidden="true">→</span> <ShipThumb ship={ships.get(row.to) ?? null} size="s" /> <span class="nm">{name(row.to)}</span></span>
    <span class="cash"><b class="price" data-price>{usd(row.cash)}</b>{#if row.standardText}<span class="std">{row.standardText}</span>{/if}</span>
    <RsiLink href={upgradeToolUrl({ from: row.from, to: row.to })} label="Buy on RSI" aria="Buy {name(row.from)} to {name(row.to)} on RSI" />
  </div>
  <p class="outcome" data-outcome>{outcome ?? fallback}
    <button type="button" class="whybtn" aria-expanded={open} aria-controls="why-{uid}" onclick={() => { open = !open; }}>Why? {open ? '▴' : '▾'}</button></p>
  {#if open}
    <div class="whybody" id="why-{uid}">
      <p data-detail>{row.detail}</p>
      {#if row.reasonTexts.length}<p>{row.reasonTexts.join(', ')}</p>{/if}
      {#if row.onSale}<p data-onsale>{row.onSale}</p>{/if}
      {#each row.trades as t (t.goalId)}
        <p data-trade>{row.trades.length > 1 ? `${t.goalName}: ` : ''}{t.text}
          <button type="button" disabled={busy} onclick={() => act(t.action)}>{DONT_LOCK_LABEL}{row.trades.length > 1 ? ` (${t.goalName})` : ''}</button></p>
      {/each}
      {#each row.needed as n (n)}<p data-needed>{n}</p>{/each}
      {#if row.tie}<p data-tie>{row.tie}</p>{/if}
      {#if row.steps.some((b) => b.differs)}<p data-differs>{BEST_DIFFERS_PLAIN}</p>{/if}
      <BuyWhatIf {app} from={row.from} to={row.to} kind={row.kind} cash={row.cash} />
      {#if !row.lock}
        <p class="note">
          {#if row.note}
            Your note: {row.note.soon ? 'ends soon' : `runs until ${shortDay(row.note.until)}`}
            <button type="button" disabled={busy} onclick={() => act(clearOfferNoteAction(row))}>{OFFER_NOTE.clear}</button>
          {:else}
            <label>{OFFER_NOTE.until}
              <input type="date" bind:value={draft} aria-label="Runs until, for {name(row.from)} to {name(row.to)}" />
            </label>
            <button type="button" disabled={busy || !draft} onclick={() => act(offerNoteAction(row, { until: draft }))}>Save</button>
            <button type="button" disabled={busy} onclick={() => act(offerNoteAction(row, { soon: true }))}>{OFFER_NOTE.soon}</button>
          {/if}
        </p>
      {/if}
    </div>
  {/if}
</li>

<style>
  .buy { display: grid; gap: 6px; padding: 10px 12px; border-radius: 10px; background: rgba(8, 12, 20, 0.35); border: 1px solid var(--glass-border); list-style: none; }
  p { margin: 0; }
  .for { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 13px; }
  .goalchip { padding: 1px 10px; border-radius: 999px; border: 1px solid var(--accent); background: none; color: var(--accent); font-size: 13px; font-weight: 600; cursor: pointer; }
  .goalchip:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .kind { background: none; font-family: inherit; padding: 1px 10px; border-radius: 999px; border: 1px solid var(--glass-border); color: var(--muted); font-size: 12px; cursor: help; }
  .count { color: var(--muted); font-variant-numeric: tabular-nums; }
  .pairrow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
  .pair { display: inline-flex; align-items: center; gap: 8px; flex: 1 1 320px; min-width: 0; flex-wrap: wrap; font-size: 15px; }
  .nm { overflow-wrap: anywhere; }
  .cash { display: grid; justify-items: end; min-width: 5em; }
  .price { font-size: 20px; font-variant-numeric: tabular-nums; }
  .std { color: var(--muted); font-size: 12px; }
  .outcome { color: var(--muted); font-size: 13px; }
  .whybtn { margin-left: 6px; font-size: 12px; padding: 0 10px; }
  .whybody { display: grid; gap: 6px; padding: 8px 10px; border-radius: 8px; background: rgba(76, 194, 255, 0.08); font-size: 13px; color: var(--muted); }
  .whybody button { margin-left: 8px; font-size: 12px; padding: 2px 10px; }
  .note { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
  .note label { display: inline-flex; align-items: center; gap: 6px; }
</style>
