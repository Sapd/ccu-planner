<script>
  import { ui } from './state.svelte.js';
  import { backend } from './backend.js';

  // A small link button that opens an RSI page in the user's browser. Nothing is sent by the app.
  let { href, label, title, aria = label } = $props();
  const hint = $derived(title ?? (/^(Buy on|Watch on)/.test(label) ? 'Opens RSI in your browser. Add it to the cart there.' : 'Opens RSI in your browser.'));
  let failed = $state(false);

  async function open(e) {
    e.stopPropagation();
    failed = false;
    try { await backend.openExternal(href); if (/^Buy on/.test(label)) { ui.bought = true; ui.notice = 'After buying on RSI, sync to update your hangar.'; } } catch { failed = true; }
  }
</script>

<button type="button" class="rsi" class:failed title={hint} aria-label="{aria} (opens browser)" onclick={open}>{label} ↗</button>

<style>
  .rsi { flex: none; padding: 0 6px; background: none; border: 1px solid transparent; border-radius: 4px; color: var(--muted); font: inherit; font-size: 12px; line-height: 1.6; cursor: pointer; opacity: .7; }
  .rsi:hover, .rsi:focus-visible { color: var(--accent); border-color: var(--accent); opacity: 1; }
  .failed { color: #f85149; }
</style>
