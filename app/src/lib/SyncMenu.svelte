<script>
  import { t, N_ } from '$logic/i18n.mjs';
  import { backendText } from './view/backendErrors.mjs';
  import { ui, loadCatalog } from './state.svelte.js';
  import { onMount, tick } from 'svelte';
  import { stampLabel } from './view/nav.mjs';
  import { checkSession, login as doLogin, logout as doLogout, sync as doSync, answer, cancel } from './sync-actions.svelte.js';
  // The phase names the sync reports (core.mjs / sync-backend.js), shown beside the progress count.
  const PHASES = { hangar: N_('hangar'), buyback: N_('buyback'), upgrades: N_('upgrades'), details: N_('details'), images: N_('images'), 'store-catalog': N_('store catalog'), 'store catalog': N_('store catalog'), 'store catalog pictures': N_('store catalog pictures') };
  const phaseName = (phase) => (PHASES[phase] ? t(PHASES[phase]) : (phase ?? ''));
  let open = $state(false);
  let dialog = $state(null);
  let wrap = $state(null);
  let btn = $state(null);
  let cancelBtn = $state(null);
  // A started sync replaces the menu by the Cancel button: keep the keyboard focus there instead of losing it to the page.
  $effect(() => { if (working) tick().then(() => { const a = document.activeElement; if (!a || a === document.body) cancelBtn?.focus(); }); });
  const meta = $derived(ui.app?.data?.meta ?? {});
  const hangarLast = $derived(t('Last synced: {when}', { when: stampLabel(meta.hangarAt) }));
  const storeLast = $derived(t('Last synced: {when}', { when: stampLabel(meta.catalogAt) }));
  const catalogNote = $derived(ui.ownCatalog?.fetchedAt ? t('Last synced: {when}', { when: stampLabel(ui.ownCatalog.fetchedAt) }) : t('Every RSI store item, for the Browse store tab'));
  const close = (refocus = false) => { if (!open) return; open = false; if (refocus) btn?.focus(); };
  // The menu closes on Escape, on a click outside, when focus leaves it, and when the page or a dialog changes under it.
  const onkeydown = (e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); close(true); } };
  const onwindowclick = (e) => { if (open && !wrap?.contains(e.target)) open = false; };
  const onfocusout = (e) => { if (open && e.relatedTarget && !wrap?.contains(e.relatedTarget)) open = false; };
  $effect(() => { ui.section; ui.advanced; ui.glossary; open = false; });
  const working = $derived(ui.syncBusy);
  $effect(() => { if (ui.confirmation && dialog && !dialog.open) dialog.showModal(); });
  onMount(() => {
    checkSession();
    if (!ui.ownLoaded) loadCatalog(); // for the "Last synced" note of the store catalog
    // The "Bought it? Sync hangar" notice in the Shell.
    const hangar = () => { doSync('hangar'); };
    window.addEventListener('sync-hangar', hangar);
    return () => window.removeEventListener('sync-hangar', hangar);
  });
  // After picking an item the focus goes back to the Sync button (the menu closes under the pointer or the keyboard).
  const login = () => { close(true); doLogin(); };
  const logout = () => { close(true); doLogout(); };
  const sync = (kind) => { close(true); doSync(kind); };
</script>

<svelte:window {onkeydown} onclick={onwindowclick} />

{#if working}
  <div class="progress" role="status">
    <small>{phaseName(ui.syncProgress?.phase)} {ui.syncProgress?.done ?? 0}{ui.syncProgress?.total ? `/${ui.syncProgress.total}` : ''}</small>
    {#if ui.syncResume}<small class="resume">{backendText(ui.syncResume)}</small>{/if}
  </div>
  <button bind:this={cancelBtn} onclick={cancel}>{t('Cancel')}</button>
{:else}
  <div class="sync-menu" bind:this={wrap} {onfocusout}>
    <button bind:this={btn} disabled={ui.signingIn || ui.sample} title={ui.sample ? t('Sync is off while you look at sample data') : undefined} aria-expanded={open} onclick={() => open = !open}>{ui.signingIn ? t('Signing in…') : `${t('Sync')} ▾`}</button>
    {#if open}
      <div class="options">
        <p class="grouptitle">{t('Update your data')}</p>
        <button onclick={() => sync('hangar')}><span class="lbl">{t('Hangar (fast)')}</span><span class="note">{hangarLast}</span></button>
        <button onclick={() => sync('buyback')}><span class="lbl">{t('Buyback')}</span><span class="note">{t('Items you melted that can be bought back')}</span></button>
        <button onclick={() => sync('upgrades')}><span class="lbl">{t('Store (about 1–2 min)')}</span><span class="note">{storeLast}</span></button>
        <button onclick={() => sync('store-catalog')}><span class="lbl">{t('Store catalog (about 5 min)')}</span><span class="note">{catalogNote}</span></button>
        <button onclick={() => sync('images')}><span class="lbl">{t('Ship pictures')}</span><span class="note">{t('Downloads missing ship art')}</span></button>
        <hr />
        <p class="grouptitle">{t('Account')}</p>
        <button onclick={login}><span class="lbl">{ui.session === 'expired' ? t('Sign-in expired — sign in to RSI') : t('Sign in to RSI')}</span></button>
        {#if ui.session !== 'none'}<button onclick={logout}><span class="lbl">{t('Sign out')}</span></button>{/if}
      </div>
    {/if}
  </div>
{/if}
{#if ui.session === 'expired' && !working && !ui.signingIn && !ui.sample}<button onclick={login}>{t('Sign in to RSI')}</button>{/if}

{#if ui.confirmation}
  <dialog bind:this={dialog} aria-labelledby="overwrite-question" oncancel={(e) => { e.preventDefault(); answer(false); }}>
    <p id="overwrite-question">{backendText(ui.confirmation.message)}</p>
    <button onclick={() => answer(false)}>{t('Keep saved hangar')}</button>
    <button onclick={() => answer(true)}>{t('Overwrite')}</button>
  </dialog>
{/if}

<style>
  .progress { display: grid; gap: 2px; }
  .resume { color: var(--muted); }
  dialog { position: fixed; top: 35%; z-index: var(--z-modal); background: #121a2b; color: var(--text); border: 1px solid var(--glass-border); border-radius: 10px; padding: 24px; }
  dialog::backdrop { background: #0009; }
  dialog button { margin-right: 8px; }
  .sync-menu { position: relative; }
  .options { position: absolute; right: 0; top: 100%; min-width: 280px; padding: 6px; background: #121a2b; border: 1px solid var(--glass-border); border-radius: 10px; z-index: var(--z-popover); }
  .grouptitle { margin: 4px 10px 2px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
  hr { border: 0; border-top: 1px solid var(--glass-border); margin: 6px 0; }
  .lbl { display: block; font-weight: 600; }
  .note { display: block; color: var(--muted); font-size: 12px; }
  .options button { display: block; width: 100%; text-align: left; background: none; border: 0; padding: 8px 10px; }
</style>
