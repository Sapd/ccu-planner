<script>
  import GlassPanel from './ui/GlassPanel.svelte';
  import Onboarding from './Onboarding.svelte';
  import { WELCOME_TEXT } from './view/firstRun.mjs';
  import { backend } from './backend.js';
  import { load } from './state.svelte.js';

  let dir = $state('');
  let result = $state(null);
  let error = $state(null);
  let busy = $state(false);

  async function proceed() {
    error = null;
    try { await load(); } catch (e) { error = e?.message ?? String(e); }
  }

  async function run() {
    busy = true; error = null;
    try {
      result = await backend.importLegacy(dir);
    } catch (e) {
      error = e?.message ?? String(e);
    } finally { busy = false; }
  }
</script>

<main class="import">
<GlassPanel class="card">
  <h1>Welcome to CCU Planner</h1>
  <p class="lead">Plan your Star Citizen ship upgrades without overpaying.</p>
  <p class="what">{WELCOME_TEXT}</p>
  <Onboarding welcome />
  <details class="move">
    <summary>Move data from another copy of CCU Planner</summary>
    <p class="muted">Choose the data folder of an older install or of another computer (it contains a file named catalog.json). This copies that planner's data here. It is not the CCU Game import.</p>
    <label>Data folder
      <input type="text" bind:value={dir} spellcheck="false" placeholder="Folder that contains catalog.json" />
    </label>
    <button type="button" class="primary" onclick={run} disabled={busy || !dir.trim()}>Copy the data</button>
  {#if error}<p class="error">{error}</p>{/if}
  </details>
  {#if result}
    <p>Copied {result.copied.length} files{result.skipped.length ? `, kept ${result.skipped.join(', ')}` : ''}.</p>
    <ul>{#each result.copied as f (f)}<li>{f}</li>{/each}</ul>
    <button type="button" class="primary" onclick={proceed}>Continue</button>
  {/if}
</GlassPanel>
</main>

<style>
  .import { max-width: 640px; margin: 80px auto; padding: 0 24px; }
  .import :global(.card) { display: grid; gap: 18px; padding: 28px 28px 24px; }
  h1 { margin: 0; font-size: 24px; }
  .what { margin: 0; }
  .move summary { cursor: pointer; color: var(--muted); }
  .move { display: grid; gap: 8px; }
  .muted { color: var(--muted); margin: 6px 0; font-size: 13px; }
  .lead { margin: 0; color: var(--muted); }
  label { display: grid; gap: 4px; color: var(--muted); }
  input { padding: 8px 10px; }
  .primary { justify-self: start; padding: 8px 18px; background: var(--accent); color: var(--on-accent); border-color: transparent; font-weight: 700; }
  .error { color: var(--warn); margin: 0; }
  ul { margin: 0; padding-left: 20px; color: var(--muted); }
</style>
