<script>
  import { t } from '$logic/i18n.mjs';
  import { ui } from './state.svelte.js';
  import { backend } from './backend.js';

  // A small link button that opens an RSI page in the user's browser. Nothing is sent by the app.
  let { href, label, title, aria = label } = $props();
  // The caller's label is already in the shown language: compare with the translated texts.
  const isBuy = $derived(label === t('Buy on RSI'));
  const hint = $derived(title ?? (isBuy || label === t('Watch on RSI') ? t('Opens RSI in your browser. Add it to the cart there.') : t('Opens RSI in your browser.')));
  let failed = $state(false);

  async function open(e) {
    e.stopPropagation();
    failed = false;
    try { await backend.openExternal(href); if (isBuy) { ui.bought = true; ui.notice = t('After buying on RSI, sync to update your hangar.'); } } catch { failed = true; }
  }
</script>

<button type="button" class="rsi" class:failed title={hint} aria-label={t('{label} (opens browser)', { label: aria })} onclick={open}>{label} ↗</button>

<style>
  .rsi { flex: none; padding: 0 6px; background: none; border: 1px solid transparent; border-radius: 4px; color: var(--muted); font: inherit; font-size: 12px; line-height: 1.6; cursor: pointer; opacity: .7; }
  .rsi:hover, .rsi:focus-visible { color: var(--accent); border-color: var(--accent); opacity: 1; }
  .failed { color: #f85149; }
</style>
