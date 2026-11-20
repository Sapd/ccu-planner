<script>
  import { valueLabel, keyed } from './view/hangar.mjs';
  import { hangarUrl } from '$logic/links.mjs';
  import ShipThumb from './ShipThumb.svelte';
  import RsiLink from './RsiLink.svelte';
  import TokenMark from './goals/TokenMark.svelte';

  // A modal dialog: <dialog>.showModal() keeps focus inside and closes on Escape.
  // token: for an LTI ship pledge { settings, inPool }, else null.
  // goal: for a CCU a goal reserves ({ id, name }), else null; ongoal(id) opens that goal's chain.
  let { pledge, onclose, ships: shipMap = null, token = null, goal = null, ongoal = null } = $props();
  let dialog;
  const items = $derived(keyed(pledge.items, (it) => it.title));
  const ships = $derived(keyed(pledge.ships, (s) => s.shipId ?? s.title));

  $effect(() => {
    const opener = document.activeElement;
    dialog.showModal();
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  });

  const outside = (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
  };
</script>

<dialog bind:this={dialog} aria-labelledby="pledge-title" {onclose} onclick={outside} data-detail={pledge.pledgeId}>
  <header>
    <h3 id="pledge-title">{pledge.name}</h3>
    <RsiLink href={hangarUrl()} label="Hangar" aria="Open {pledge.name} in the RSI hangar" />
    <button type="button" class="x" aria-label="Close" onclick={() => dialog.close()}>×</button>
  </header>
  <dl>
    <dt>Value</dt><dd>{valueLabel(pledge.value)}</dd>
    {#if pledge.configurationValue}<dt>Configuration value</dt><dd>{valueLabel(pledge.configurationValue)}</dd>{/if}
    <dt>Created</dt><dd>{pledge.created ?? '?'}</dd>
    <dt>Category</dt><dd>{pledge.category}{pledge.upgraded ? ' · upgraded' : ''}</dd>
    {#if pledge.insurance}<dt>Insurance</dt><dd>{pledge.insurance}</dd>{/if}
    <dt>Flags</dt>
    <dd>
      <span class="tag">{pledge.giftable ? 'giftable' : 'not giftable'}</span>
      <span class="tag">{pledge.reclaimable ? 'meltable' : 'not meltable'}</span>
      <span class="tag">{pledge.buybackable ? 'buy-back' : 'no buy-back'}</span>
    </dd>
    {#if goal}<dt>Reserved</dt><dd>for {goal.name} <button type="button" class="gl" data-view-chain onclick={() => { dialog.close(); ongoal?.(goal.id); }}>View {goal.name} chain</button></dd>{/if}
  </dl>
  {#if token}
    <h4>Starting ship {#if token.inPool}<span class="tag tok">Starting ship</span>{/if}</h4>
    <TokenMark pledgeId={String(pledge.pledgeId)} settings={token.settings} />
  {/if}
  {#if pledge.ships.length}
    <h4>Ships</h4>
    {#each ships as { item: s, key } (key)}
      <div class="line" data-ship={s.shipId ?? undefined}>{#if s.shipId != null}<ShipThumb ship={shipMap?.get(s.shipId) ?? null} size="s" />{/if} {s.title} <span class="muted">{s.manufacturer ?? ''}{s.shipId == null ? ' · not matched to the catalog' : ''}</span></div>
    {/each}
  {/if}
  <h4>Items ({pledge.items.length})</h4>
  {#each items as { item: it, key } (key)}
    <div class="line" data-item><b>{it.title}</b> <span class="muted">{it.kind ?? 'other'}{it.liner ? ` · ${it.liner}` : ''}</span></div>
  {:else}
    <p class="muted">No items recorded.</p>
  {/each}
</dialog>

<style>
  dialog { width: min(560px, 92vw); max-height: 85vh; padding: 16px; background: #141c2e; color: var(--text); border: 1px solid var(--glass-border); border-radius: var(--radius); }
  dialog::backdrop { background: rgb(0 0 0 / 0.6); }
  header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
  header :global(.rsi) { margin-left: auto; }
  h3 { margin: 0 0 8px; font-size: 16px; }
  h4 { margin: 14px 0 6px; color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; }
  .x { background: none; border: none; color: var(--muted); font-size: 20px; cursor: pointer; line-height: 1; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
  dt { color: var(--muted); }
  dd { margin: 0; }
  .line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0; border-bottom: 1px solid var(--glass-border); }
  .tag { display: inline-block; margin-right: 4px; padding: 0 6px; border: 1px solid var(--glass-border); border-radius: 999px; font-size: 12px; color: var(--muted); }
  .tag.tok { color: var(--accent); border-color: var(--accent); text-transform: none; }
  .muted { color: var(--muted); }
  .gl { margin-left: 6px; font-size: 12px; padding: 1px 10px; }
</style>
