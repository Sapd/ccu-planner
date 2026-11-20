<script>
  import { t } from '$logic/i18n.mjs';
  import { untrack, tick } from 'svelte';
  import { OBJECTIVE_CHOICE } from '$logic/describe.mjs';
  import { usd } from '$logic/format.mjs';
  import { dispatch, ui } from '../state.svelte.js';
  import { goalLabel } from '$logic/ships.mjs';
  import { VIA_HELP } from '$logic/describe.mjs';
  import ShipPicker from '../ShipPicker.svelte';

  // chain: the saved goal; allIn: its all-in figure in cents (what you already paid counted too) or null.
  // ships: Map id -> ship (for the remove question). Start, how to buy, priority and lock are in QuickSettings.
  let { chain, allIn = null, ships } = $props();
  let confirmRemove = $state(false);
  const set = (type, value) => dispatch({ type, chainId: chain.id, value });
  const objective = $derived(chain.objective ?? 'cash');
  // "Route through this ship": picking a ship saves it at once; the planner then only shows routes that pass through it.
  let via = $state(untrack(() => chain.via ?? null));
  $effect(() => { via = chain.via ?? null; });
  let viaError = $state(null);
  const setVia = async (ship) => {
    viaError = null;
    try {
      const released = await dispatch({ type: 'setVia', chainId: chain.id, ship });
      if (released?.length) ui.notice = t('Released the reserved chain of {goal}: it did not pass through {ship}.', { goal: goalLabel(chain, ships), ship: ships.get(ship)?.name ?? t('that ship') });
    } catch (e) { viaError = e?.message ?? String(e); }
    // A refused choice (the app shows why) leaves the field on the saved ship.
    await tick();
    via = chain.via ?? null;
  };
</script>

<div class="settings">
  <div class="row">
    <label>{t('What counts')}
      <select value={objective} onchange={(e) => set('setObjective', e.currentTarget.value)}>
        {#each Object.entries(OBJECTIVE_CHOICE) as [v, l] (v)}<option value={v}>{t(l)}</option>{/each}
      </select>
    </label>
    <p class="allin">{t('All-in, including what you already paid:')} <b>{usd(allIn)}</b></p>
  </div>

  <div class="via" data-via>
    <ShipPicker {ships} bind:value={via} label={t('Route through this ship (optional)')} id="via-{chain.id}" onpick={(sh) => setVia(sh.id)} />
    {#if chain.via != null}<button type="button" onclick={() => { via = null; setVia(null); }}>{t('Clear')}</button>{/if}
    <p class="help">{t(VIA_HELP)}</p>
    {#if viaError}<p class="err" role="alert">{viaError}</p>{/if}
  </div>

  <div class="remove">
    {#if confirmRemove}
      <span>{t('Remove {goal}?', { goal: goalLabel(chain, ships) })}</span>
      <button type="button" class="danger" onclick={() => dispatch({ type: 'remove', chainId: chain.id })}>{t('Yes, remove')}</button>
      <button type="button" onclick={() => { confirmRemove = false; }}>{t('Cancel')}</button>
    {:else}
      <button type="button" class="danger" onclick={() => { confirmRemove = true; }}>{t('Remove goal')}</button>
    {/if}
  </div>
</div>

<style>
  .settings { display: flex; flex-direction: column; gap: 14px; }
  .row { display: flex; flex-wrap: wrap; gap: 14px; align-items: end; }
  .row label { display: grid; gap: 4px; color: var(--muted); font-size: 12px; }
  .allin { margin: 0; }
  .via { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: end; }
  .via .help { flex-basis: 100%; margin: 0; color: var(--muted); font-size: 12px; }
  .via .err { flex-basis: 100%; margin: 0; color: var(--warn); }
  .remove { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .danger { border-color: var(--warn); color: var(--warn); }
</style>
