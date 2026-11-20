<script>
  import { onMount } from 'svelte';
  import { lang } from './lib/i18n.svelte.js';
  import { t } from '$logic/i18n.mjs';
  import { ui, load } from './lib/state.svelte.js';
  import { loadPending, applyPending } from './lib/pending-import.svelte.js';
  import Shell from './lib/Shell.svelte';
  import SyncMenu from './lib/SyncMenu.svelte';
  import ImportScreen from './lib/ImportScreen.svelte';

  onMount(async () => { await loadPending(); await load(); await applyPending(); });
</script>

<!-- A language switch renders every page again in the new language. -->
{#key lang.code}
  {#if !ui.loaded}
    <p class="status">{t('Loading…')}</p>
  {:else if ui.app}
    <Shell />
  {:else}
    {#if ui.notice}<p class="status error">{ui.notice}</p>{/if}
    <header class="first-sync"><strong>CCU Planner</strong><SyncMenu /></header>
    <ImportScreen />
  {/if}
{/key}

<style>
  .first-sync { display: flex; align-items: center; gap: 16px; padding: 16px 24px; }
  .status { padding: 24px; color: var(--muted); }
  .error { color: #f85149; }
</style>
