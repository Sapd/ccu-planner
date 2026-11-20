<script>
  import { STATE_LABEL } from '$logic/describe.mjs';

  // bar: { unit: 'steps', own, now, norush, optional, wait }: one unit everywhere, upgrades.
  // label: a prefix for the screen-reader text, e.g. "15 of 17 upgrades owned".
  let { bar, label = null } = $props();
  const fmt = (v) => `${v} ${v === 1 ? 'upgrade' : 'upgrades'}`;
  const segs = $derived(['own', 'now', 'norush', 'optional', 'wait'].map((k) => ({ k, v: bar?.[k] ?? 0 })).filter((s) => s.v > 0));
  const done = $derived(segs.length === 1 && segs[0].k === 'own');
</script>

{#if done}
  <span class="done">All upgrades owned</span>
{:else if segs.length}
  <div class="bar" role="img" aria-label={(label ? `${label}. ` : '') + segs.map((s) => `${STATE_LABEL[s.k]}: ${fmt(s.v)}`).join(', ')}>
    {#each segs as s (s.k)}
      <span class="seg {s.k}" style="flex: {s.v} 1 0" title="{STATE_LABEL[s.k]}: {fmt(s.v)}"></span>
    {/each}
  </div>
{/if}

<style>
  .bar { display: flex; gap: 2px; height: 8px; border-radius: 999px; overflow: hidden; background: rgba(255, 255, 255, 0.08); }
  .seg { min-width: 4px; }
  .own { background: var(--own); } .now { background: var(--now); } .norush { background: var(--accent); } .optional { background: var(--muted); } .wait { background: var(--wait); }
  .done { color: #a9b6c9; font-weight: 600; }
</style>
