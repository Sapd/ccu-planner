<script>
  import { tick } from 'svelte';

  // A tab list with one panel. tabs: [{ key, label }]; value (bindable) is the chosen key; the panel is the children snippet
  // (it receives the key), built only for the chosen tab. Arrow keys, Home and End move between tabs (roving tabindex).
  let { tabs, value = $bindable(), label = 'Sections', children } = $props();
  const uid = $props.id();
  const current = $derived(tabs.some((t) => t.key === value) ? value : (tabs[0]?.key ?? null));
  let list = $state(null);
  async function move(i) {
    const t = tabs[(i + tabs.length) % tabs.length];
    value = t.key;
    await tick();
    list?.querySelector('[role="tab"][aria-selected="true"]')?.focus();
  }
  const onkeydown = (e, i) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); move(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(tabs.length - 1); }
  };
</script>

{#if tabs.length}
  <section class="tabs">
    <div class="list" role="tablist" aria-label={label} bind:this={list}>
      {#each tabs as t, i (t.key)}
        <button type="button" role="tab" id="{uid}-t-{t.key}" aria-selected={t.key === current} aria-controls="{uid}-p" tabindex={t.key === current ? 0 : -1} class:on={t.key === current} onclick={() => { value = t.key; }} onkeydown={(e) => onkeydown(e, i)}>{t.label}</button>
      {/each}
    </div>
    <div class="panel" id="{uid}-p" role="tabpanel" aria-labelledby="{uid}-t-{current}" tabindex="-1">
      {#key current}{@render children(current)}{/key}
    </div>
  </section>
{/if}

<style>
  .tabs { background: var(--glass); border: 1px solid var(--glass-border); border-radius: var(--radius); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); }
  .list { display: flex; flex-wrap: wrap; gap: 2px; padding: 6px 8px 0; border-bottom: 1px solid var(--glass-border); }
  .list button { background: none; border: 0; border-bottom: 2px solid transparent; border-radius: 0; padding: 8px 12px; color: var(--muted); font-weight: 600; font-size: 13px; }
  .list button:hover:not(:disabled) { background: none; color: var(--text); }
  .list button.on { color: var(--text); border-bottom-color: var(--accent); }
  .panel { padding: 14px 16px; }
  .panel:focus { outline: none; }
</style>
