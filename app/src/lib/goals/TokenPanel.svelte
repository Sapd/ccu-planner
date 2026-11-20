<script>
  import { t, tn } from '$logic/i18n.mjs';
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
  const inPool = $derived(new Set(pool.map((tk) => tk.pledgeId)));
</script>

<GlassPanel class="tokens">
  <h4>{t('Starting ships')}</h4>
  <p class="muted">{t(TOKEN_HELP)}</p>
  <TokenLimit plans={app.plans} />
  <p class="muted">{tn(pool.length, '{n} starting ship available', '{n} starting ships available')}{pool.length ? `: ${tokenSummaryText(pool)}` : ''}</p>
  {#if lti.length}
    <ul class="list">
      {#each lti as tk (tk.pledgeId)}
        <li data-token={tk.pledgeId}>
          <span class="nm">{rowLabels.get(tk.pledgeId)}
            {#if inPool.has(tk.pledgeId)}<span class="badge">{t('Starting ship')}</span>{/if}</span>
          <TokenMark pledgeId={tk.pledgeId} {settings} />
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">{t('No ship pledge with Lifetime Insurance in the hangar.')}</p>
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
