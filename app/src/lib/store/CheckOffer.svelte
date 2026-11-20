<script>
  import { t } from '$logic/i18n.mjs';
  import { onDestroy } from 'svelte';
  import { Job } from '../jobs.svelte.js';
  import { parseOfferText } from '$logic/offerCheck.mjs';
  import { parseSlackUsd } from '$logic/wantedView.mjs';
  import { usd } from '$logic/format.mjs';
  import ShipPicker from '../ShipPicker.svelte';
  import JobStatus from '../ui/JobStatus.svelte';
  import OfferVerdict from './OfferVerdict.svelte';

  // "Check an offer": what a CCU offer (picked here, or pasted from the CCU Game Discord post) means for your goals.
  // Each offer is a what-if on the worker: nothing is saved or bought.
  let { app } = $props();
  const ships = $derived(app.data.ships);
  const name = (id) => ships.get(id)?.name ?? t('unknown ship');

  let from = $state(null);
  let to = $state(null);
  let priceText = $state('');
  let kind = $state('warbond');
  let pasted = $state('');
  let cards = $state.raw([]); // { key, offer, job, app }; raw: `app` is compared by identity to see whether a card is outdated
  let unmatched = $state([]);
  let note = $state(null);
  let seq = 0;

  const cents = $derived(parseSlackUsd(priceText.replace(/^\s*\$/, '')));
  const problem = $derived(from == null || to == null ? t('Pick both ships.') : from === to ? t('The two ships must differ.') : cents == null ? t('Type the price in dollars.') : null);

  // offer: { from, to, kind, cash }; assumed: the text did not say the kind (a daily deal is taken as a Warbond)
  function add(offer, assumed = false) {
    const job = new Job();
    cards = [{ key: ++seq, offer, assumed, job, app }, ...cards];
    job.start(app, 'checkOffer', offer);
  }
  function setKind(card, kind) {
    const offer = { ...card.offer, kind };
    cards = cards.map((c) => (c === card ? { ...c, offer, assumed: false, app } : c));
    card.job.start(app, 'checkOffer', offer);
  }
  function checkPicked(e) {
    e.preventDefault();
    if (problem) return;
    add({ from, to, kind, cash: cents });
  }
  function readText() {
    const r = parseOfferText(pasted, ships);
    unmatched = r.unmatched;
    note = r.offers.length ? null : t('No offers found in that text.');
    for (const o of [...r.offers].reverse()) add({ from: o.from, to: o.to, kind: o.kind, cash: o.cash }, o.kindAssumed);
  }
  // A card answers for the data it was asked on; after a sync or an edit it can be asked again.
  function recheck(card) {
    cards = cards.map((c) => (c === card ? { ...c, app } : c));
    card.job.start(app, 'checkOffer', card.offer);
  }
  function remove(card) {
    card.job.cancel();
    cards = cards.filter((c) => c !== card);
  }
  onDestroy(() => { for (const c of cards) c.job.cancel(); });
</script>

<div class="check">
  <p class="help">{t('Paste a deal (for example from the CCU Game daily post) to see whether it is worth it for your goals. Nothing is bought or saved.')}</p>
  <label class="paste">{t('Paste the deal text')}
    <textarea rows="4" bind:value={pasted} placeholder="Guardian ($250 MSRP, $235 WB): $5 from the Scorpius Antares"></textarea>
  </label>
  <p><button type="button" class="primary" disabled={!pasted.trim()} onclick={readText}>{t('Check it')}</button></p>
  {#if note}<p class="hint">{note}</p>{/if}
  {#if unmatched.length}
    <p class="hint">{t('Could not read:')}</p>
    <ul class="unmatched">{#each unmatched as u, i (i)}<li>{u.line} <span class="why">({u.reason})</span></li>{/each}</ul>
  {/if}

  <details>
    <summary>{t('Or pick the two ships yourself')}</summary>
    <form onsubmit={checkPicked}>
      <ShipPicker {ships} bind:value={from} label={t('Upgrade from')} id="offer-from" />
      <ShipPicker {ships} bind:value={to} label={t('Upgrade to')} id="offer-to" />
      <label>{t('Price $')} <input inputmode="decimal" bind:value={priceText} placeholder="5" size="6" /></label>
      <label>{t('Kind')} <select bind:value={kind}><option value="warbond">{t('Warbond')}</option><option value="standard">{t('Standard')}</option></select></label>
      <button type="submit" disabled={!!problem}>{t('Check')}</button>
    </form>
    {#if problem && (from != null || to != null || priceText)}<p class="hint">{problem}</p>{/if}
  </details>

  {#each cards as card (card.key)}
    {@const r = card.job.status === 'done' ? card.job.value : null}
    {@const stale = card.app !== app}
    <article class="card" class:stale data-offer="{card.offer.from}-{card.offer.to}">
      <header>
        <b>{name(card.offer.from)} → {name(card.offer.to)}</b>
        <span class="kind">{card.offer.kind === 'warbond' ? t('Warbond') : t('Standard')}</span>
        <span class="price">{usd(card.offer.cash)}</span>
        <button type="button" class="x" aria-label={t('Remove this check')} onclick={() => remove(card)}>×</button>
      </header>
      {#if card.assumed}
        <p class="assumed" data-assumed>{t('Kind not stated; assumed {kind}.', { kind: card.offer.kind === 'warbond' ? t('Warbond') : t('Standard') })}
          <button type="button" onclick={() => setKind(card, card.offer.kind === 'warbond' ? 'standard' : 'warbond')}>{t('Use {kind} instead', { kind: card.offer.kind === 'warbond' ? t('Standard') : t('Warbond') })}</button></p>
      {/if}
      <JobStatus job={card.job} what={t('Checking')} />
      {#if stale && card.job.status !== 'running'}
        <p class="outdated" data-outdated>{t('Outdated: your data or goals changed since this check.')} <button type="button" onclick={() => recheck(card)}>{t('Check again')}</button></p>
      {/if}
      {#if r}
        <div class="result"><OfferVerdict {r} {name} /></div>
      {/if}
    </article>
  {/each}
</div>

<style>
  .help { margin: 0 0 8px; color: var(--muted); font-size: 13px; }
  form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px 14px; }
  form :global(.picker) { min-width: 220px; flex: 1 1 220px; }
  label { display: grid; gap: 4px; color: var(--muted); font-size: 12px; }
  .hint { margin: 6px 0 0; color: var(--warn); font-size: 12px; }
  details { margin-top: 8px; }
  summary { cursor: pointer; color: var(--muted); }
  textarea { width: 100%; box-sizing: border-box; margin-top: 6px; }
  .unmatched { margin: 0; padding-left: 18px; font-size: 13px; }
  .why { color: var(--muted); }
  .card { margin-top: 10px; padding: 10px 12px; border-radius: 10px; background: rgba(8, 12, 20, 0.35); border: 1px solid var(--glass-border); }
  header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
  .kind { font-size: 12px; color: var(--muted); border: 1px solid var(--glass-border); border-radius: 999px; padding: 0 8px; }
  .price { font-variant-numeric: tabular-nums; }
  .x { margin-left: auto; padding: 0 8px; }
  .stale .result { opacity: 0.55; }
  .assumed { margin: 6px 0 0; color: var(--muted); font-size: 13px; }
  .assumed button { margin-left: 8px; font-size: 12px; padding: 2px 10px; }
  .outdated { margin: 6px 0 0; color: var(--warn); font-size: 13px; }
  .outdated button { margin-left: 8px; font-size: 12px; padding: 2px 10px; }
  .result { margin-top: 8px; }
  .paste { margin-bottom: 6px; }
  .paste textarea { margin-top: 2px; }
</style>
