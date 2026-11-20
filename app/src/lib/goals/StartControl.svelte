<script>
  import { t } from '$logic/i18n.mjs';
  import { untrack, tick } from 'svelte';
  import { startOf } from '$logic/chains.mjs';
  import { tokenOptionLabels, START_TARGET_SAME } from '$logic/describe.mjs';
  import { dispatch } from '../state.svelte.js';
  import ShipPicker from '../ShipPicker.svelte';

  // chain: the saved goal; pool: the usable tokens (tokenPool entries); ships: Map id -> ship.
  let { chain, pool, ships } = $props();
  const uid = $props.id();
  const optionLabels = $derived(tokenOptionLabels(pool));
  const start = $derived(startOf(chain));
  const current = $derived(start.kind === 'ship' ? 'fixed' : start.pledgeId ? `pledge:${start.pledgeId}` : 'any');
  // 'fixed' is chosen before a ship is: nothing is saved until the ship is picked.
  let choosingFixed = $state(false);
  const mode = $derived(choosingFixed ? 'fixed' : current);
  const missing = $derived(start.kind === 'token' && start.pledgeId && !pool.some((tk) => tk.pledgeId === start.pledgeId));
  let fixedShip = $state(untrack(() => (start.kind === 'ship' ? start.ship : null)));

  function choose(v) {
    problem = '';
    if (v === 'fixed') { choosingFixed = true; return; }
    choosingFixed = false;
    dispatch({ type: 'setStart', chainId: chain.id, start: v === 'any' ? { kind: 'token' } : { kind: 'token', pledgeId: v.slice('pledge:'.length) } });
  }
  let problem = $state('');
  // "Choose a starting ship" elsewhere on the page: opens the fixed-ship picker here and puts the cursor in it.
  export function chooseFixed() {
    choosingFixed = true;
    tick().then(() => document.getElementById(`start-ship-${uid}`)?.focus());
  }
  async function pickShip(ship) {
    if (ship.id === chain.target) { problem = t(START_TARGET_SAME); choosingFixed = true; return; }
    problem = '';
    await dispatch({ type: 'setStart', chainId: chain.id, start: { kind: 'ship', ship: ship.id } });
    choosingFixed = false;
  }
</script>

<div class="start">
  <label for="start-{uid}">{t('Starts from')}
    <select id="start-{uid}" value={mode} onchange={(e) => choose(e.currentTarget.value)}>
      <option value="any">{t('Automatic: the cheapest LTI ship you own')}</option>
      {#each pool as tk (tk.pledgeId)}<option value="pledge:{tk.pledgeId}">{optionLabels.get(tk.pledgeId)}</option>{/each}
      {#if missing}<option value="pledge:{start.pledgeId}">{t('The starting ship you picked (not one any more)')}</option>{/if}
      <option value="fixed">{t('A ship I choose…')}</option>
    </select>
  </label>
  {#if mode === 'fixed'}<ShipPicker {ships} bind:value={fixedShip} onpick={pickShip} label={t('Starting ship')} id="start-ship-{uid}" />{/if}
  {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
  {#if chain.accepted}<p class="help" data-start-warning>{t("Changing the start releases this goal's reservation.")}</p>{/if}
</div>

<style>
  .start { display: grid; gap: 8px; max-width: 420px; }
  label { display: grid; gap: 4px; color: var(--muted); font-size: 12px; }
  .problem { margin: 0; color: var(--warn); font-size: 12px; }
  .help { margin: 0; color: var(--muted); font-size: 12px; }
</style>
