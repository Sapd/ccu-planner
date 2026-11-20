<script>
  import { tokenPool, tokenSettings } from '$logic/tokens.mjs';
  import { tokenSummaryText, tokenOptionLabels, TOKEN_HELP } from '$logic/describe.mjs';
  import GlassPanel from '../ui/GlassPanel.svelte';
  import TokenLimit from './TokenLimit.svelte';
  import TokenMark from './TokenMark.svelte';

  // The Hangar's "LTI tokens" panel: the price limit, the pool, and an override for every LTI ship pledge.
  let { app } = $props();
  const settings = $derived(tokenSettings(app.plans));
  const lti = $derived(app.data.lti ?? []);
  const rowLabels = $derived(tokenOptionLabels(lti));
  const pool = $derived(tokenPool(lti, settings));
  const inPool = $derived(new Set(pool.map((t) => t.pledgeId)));
</script>

<GlassPanel class="tokens">
  <h4>Starting ships</h4>
  <p class="muted">{TOKEN_HELP}</p>
  <TokenLimit plans={app.plans} />
  <p class="muted">{pool.length} {pool.length === 1 ? 'starting ship' : 'starting ships'} available{pool.length ? `: ${tokenSummaryText(pool)}` : ''}</p>
  {#if lti.length}
    <ul class="list">
      {#each lti as t (t.pledgeId)}
        <li data-token={t.pledgeId}>
          <span class="nm">{rowLabels.get(t.pledgeId)}
            {#if inPool.has(t.pledgeId)}<span class="badge">Starting ship</span>{/if}</span>
          <TokenMark pledgeId={t.pledgeId} {settings} />
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">No ship pledge with Lifetime Insurance in the hangar.</p>
  {/if}
</GlassPanel>

<style>
  h4 { margin: 0 0 6px; color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  p { margin: 0 0 8px; }
  .muted { color: var(--muted); font-size: 13px; }
  .list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; }
  .badge { margin-left: 6px; padding: 0 8px; border: 1px solid var(--accent); border-radius: 999px; font-size: 12px; color: var(--accent); }
</style>
