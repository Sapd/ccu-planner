<script>
  import { diffRoutes } from '$logic/chains.mjs';
  import { describeDiff, routeLine, ACCEPT_HELP } from '$logic/describe.mjs';
  import { dispatch } from './state.svelte.js';
  import ShipThumb from './ShipThumb.svelte';

  let { chain, routes, ships } = $props();
  let busy = $state(false);
  // Targets of the steps that differ from the accepted route; with no accepted route, of the steps you would buy.
  const stepKey = (s) => `${s.from}>${s.to}:${s.kind}`;
  const changed = (r) => {
    const have = new Set((chain.accepted?.steps ?? []).map(stepKey));
    return r.steps.filter((s) => (chain.accepted ? !have.has(stepKey(s)) : s.kind !== 'owned'));
  };

  async function accept(route) {
    busy = true;
    try { await dispatch({ type: 'accept', chainId: chain.id, route }); } finally { busy = false; }
  }
</script>

{#if routes.length}
  <p class="help">{ACCEPT_HELP}</p>
  <div class="list">
    {#each routes as r, i (i)}
      <div class="prop">
        <div>
          <strong>Proposal {i + 1}</strong> · {describeDiff(diffRoutes(chain.accepted, r))}
          <div class="line">{routeLine(r)}</div>
          <div class="thumbs">{#each changed(r) as s, j (j)}<ShipThumb ship={ships?.get(s.to) ?? null} size="xs" label={ships?.get(s.to)?.name ?? 'unknown ship'} />{/each}</div>
        </div>
        <button disabled={busy} onclick={() => accept(r)}>Reserve</button>
      </div>
    {/each}
  </div>
{:else}
  <p class="none">{describeDiff(diffRoutes(chain.accepted, null)) === 'New plan' ? 'No route with the CCUs and offers left.' : describeDiff(diffRoutes(chain.accepted, null))}</p>
{/if}

<style>
  .prop { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 12px; margin: 6px 0; background: rgba(8, 12, 20, 0.35); border: 1px solid var(--glass-border); border-radius: 10px; }
  .thumbs { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
  .line { color: var(--muted); font-size: 12px; }
  .prop button { padding: 4px 14px; background: var(--accent); color: var(--on-accent); border: 0; font-weight: 700; }
  .prop button:disabled { opacity: .5; }
  .none { color: var(--warn); margin: 0; }
  .help { color: var(--muted); font-size: 13px; margin: 0 0 6px; }
</style>
