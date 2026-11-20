<script>
  import { t } from '$logic/i18n.mjs';
  import { untrack } from 'svelte';
  import ShipPicker from '../ShipPicker.svelte';
  import { usd } from '$logic/format.mjs';
  import { virtualForm, syncPrice, formProblem, virtualAction, msrpDelta, dayAfter, NOTE_MAX } from '../view/virtual.mjs';
  import { localToday } from '$logic/availability.mjs';

  // Add or edit one virtual CCU in a modal <dialog>. ccu: the record to edit, or null for a new one.
  // onsave(action) dispatches the setVirtualCcu action and resolves when saved; onclose closes the dialog.
  let { ships, ccu = null, onsave, onclose } = $props();
  let dialog;
  let form = $state(untrack(() => virtualForm(ccu, ships))); // the dialog is keyed by the record it edits
  let error = $state(null); // what saving said went wrong
  let tried = $state(false); // Save was pressed: from then on the form's problem shows, and goes away once fixed
  let busy = $state(false);
  const delta = $derived(msrpDelta(ships, form.from, form.to));
  const problem = $derived(formProblem(form));

  $effect(() => {
    const opener = document.activeElement;
    dialog.showModal();
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  });
  // A new ship pair recomputes the saving from the price you typed.
  $effect(() => {
    const pair = [form.from, form.to];
    untrack(() => { if (pair[0] != null && pair[1] != null) { const next = syncPrice(form, ships, 'price'); form.savings = next.savings; } });
  });

  const save = async (e) => {
    e.preventDefault();
    tried = true;
    if (problem) return;
    busy = true;
    error = null;
    try {
      // The app resolves a refused save with nothing (it shows the reason at the top): keep the dialog and what you typed.
      const saved = await onsave(virtualAction(form));
      if (saved) dialog.close(); else error = t('Not saved. The message at the top of the window says why.');
    } catch (err) { error = err?.message ?? String(err); } finally { busy = false; }
  };
</script>

<dialog bind:this={dialog} aria-labelledby="virtual-title" {onclose} data-virtual-dialog>
  <form onsubmit={save}>
    <header>
      <h3 id="virtual-title">{ccu ? t('Edit virtual CCU') : t('New virtual CCU')}</h3>
      <button type="button" class="x" aria-label={t('Close')} onclick={() => dialog.close()}>×</button>
    </header>
    <p class="muted">{t('An upgrade you expect to get outside the RSI store: from a friend, a trade or a coming sale. Plans use it like a Warbond: its price counts as new cash, and each copy serves one goal.')}</p>
    <ShipPicker {ships} bind:value={form.from} label={t('Source ship')} id="virtual-from" />
    <ShipPicker {ships} bind:value={form.to} label={t('Target ship')} id="virtual-to" />
    {#if delta != null}<p class="muted small">{t('Catalog difference: {amount}', { amount: usd(delta) })}</p>{/if}
    <div class="two">
      <label>{t('Price ($)')}<input inputmode="decimal" bind:value={form.price} oninput={() => { form = syncPrice(form, ships, 'price'); }} aria-describedby="virtual-price-help" data-virtual-price /><span id="virtual-price-help" class="help">{t('What the CCU costs')}</span></label>
      <label>{t('Savings ($)')}<input inputmode="decimal" bind:value={form.savings} disabled={delta == null} oninput={() => { form = syncPrice(form, ships, 'savings'); }} aria-describedby="virtual-savings-help" /><span id="virtual-savings-help" class="help">{t('Follows from the price, or enter it instead')}</span></label>
    </div>
    <div class="two">
      <label>{t('Copies')}<input type="number" min="1" max="99" bind:value={form.copies} /></label>
      <label>{t('Expires (optional)')}
        <span class="row"><input type="date" bind:value={form.expires} aria-describedby="virtual-exp-help" /><button type="button" onclick={() => { form.expires = dayAfter(localToday(), 30); }}>{t('In 30 days')}</button></span>
      </label>
    </div>
    <p id="virtual-exp-help" class="help">{t('After this day plans stop using it. A chain you reserved with it keeps it.')}</p>
    <label>{t('Note (optional)')} <span class="help">{form.note.length}/{NOTE_MAX}</span><input maxlength={NOTE_MAX} bind:value={form.note} /></label>
    {#if (tried && problem) || error}<p class="error" role="alert">{(tried && problem) || error}</p>{/if}
    <footer>
      <button type="button" onclick={() => dialog.close()}>{t('Cancel')}</button>
      <button type="submit" class="primary" disabled={busy}>{t('Save')}</button>
    </footer>
  </form>
</dialog>

<style>
  dialog { width: min(560px, 92vw); max-height: 90vh; padding: 16px; background: #141c2e; color: var(--text); border: 1px solid var(--glass-border); border-radius: var(--radius); }
  dialog::backdrop { background: rgb(0 0 0 / 0.6); }
  form { display: flex; flex-direction: column; gap: 10px; }
  header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
  h3 { margin: 0; font-size: 16px; }
  .x { background: none; border: none; color: var(--muted); font-size: 20px; cursor: pointer; line-height: 1; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
  .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
  .row { display: flex; gap: 6px; align-items: center; }
  .row input { flex: 1; min-width: 0; }
  .help, .muted { color: var(--muted); font-size: 12px; }
  .small { margin: 0; }
  p { margin: 0; }
  .error { color: var(--danger, #ff8a8a); }
  footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
</style>
