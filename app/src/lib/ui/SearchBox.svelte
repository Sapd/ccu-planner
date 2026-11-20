<script module>
  // One window listener for every SearchBox: "/" outside text fields focuses the first visible one on the page.
  const boxes = new Set();
  const typing = (t) => t instanceof Element && (t.closest('input, textarea, select') || t.isContentEditable);
  function onSlash(e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || typing(e.target)) return;
    const first = [...boxes]
      .filter((el) => el.isConnected && el.getClientRects().length > 0)
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))[0];
    if (!first) return;
    e.preventDefault();
    first.focus();
    first.select();
  }
  function register(el) {
    if (!boxes.size) window.addEventListener('keydown', onSlash);
    boxes.add(el);
    return () => { boxes.delete(el); if (!boxes.size) window.removeEventListener('keydown', onSlash); };
  }
</script>

<script>
  import { onMount } from 'svelte';

  let { value = $bindable(''), placeholder = 'Search', label = 'Search', shown = null, total = null } = $props();
  let input = $state(null);
  onMount(() => register(input));
  const active = $derived(String(value ?? '').trim() !== '');
  const onkeydown = (e) => { if (e.key === 'Escape' && value) { e.preventDefault(); e.stopPropagation(); value = ''; } };
</script>

<div class="searchbox">
  <input bind:this={input} type="search" bind:value {placeholder} aria-label={label} {onkeydown} autocomplete="off" spellcheck="false" />
  {#if active && shown != null && total != null}<span class="count" role="status">{shown} of {total}</span>{/if}
  {#if !active}<kbd class="hint" aria-hidden="true">/</kbd>{/if}
</div>

<style>
  .searchbox { /* The page area (.main) has 18px padding: stick that far above the top and pad it back, with an opaque
     background so scrolling rows never show above the bar. */
    position: sticky; top: -18px; z-index: var(--z-sticky); display: flex; align-items: center; gap: 10px; padding: 24px 0 6px; background: rgba(10, 14, 22, 0.8); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); }
  input { flex: 1; min-width: 0; max-width: 420px; padding: 6px 10px; }
  input:focus { border-color: var(--accent); }
  .count { color: var(--muted); font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .hint { color: var(--muted); font: inherit; font-size: 12px; border: 1px solid var(--glass-border); border-radius: 4px; padding: 0 6px; }
</style>
