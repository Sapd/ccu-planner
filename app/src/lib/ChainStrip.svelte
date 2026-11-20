<script>
  import { t } from '$logic/i18n.mjs';
  import { chainStrip, stripText } from './view/chainStrip.mjs';
  import ShipThumb from './ShipThumb.svelte';

  // The chain as a subway line: a ship picture per stop, the upgrades between them as coloured segments.
  // steps: a journey's steps; ships: Map id -> ship.
  let { steps, ships } = $props();
  const strip = $derived(chainStrip(steps));
  const name = (id) => ships.get(id)?.name ?? t('unknown ship');
</script>

{#if strip.nodes.length}
  <div class="strip" role="img" aria-label={t('The chain at a glance: {chain}', { chain: stripText(strip, name) })} data-chain-strip>
    {#each strip.nodes as n, i (i)}
      <div class="stop"><ShipThumb ship={ships.get(n) ?? null} size="s" /><span class="nm">{name(n)}</span></div>
      {#if i < strip.segments.length}
        {@const seg = strip.segments[i]}
        <div class="seg {seg.kind}"><span class="lbl">{seg.label}</span><span class="line"></span><span class="sub">{seg.sub ?? ''}</span></div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .strip { display: flex; align-items: flex-start; gap: 0; overflow-x: auto; padding: 4px 2px 6px; scrollbar-width: thin; }
  .stop { flex: none; width: 88px; display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; }
  .nm { font-size: 12px; line-height: 1.2; overflow-wrap: anywhere; }
  .seg { flex: 1 0 70px; min-width: 70px; display: flex; flex-direction: column; align-items: center; margin-top: 2px; color: var(--own); }
  .lbl { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .line { position: relative; display: block; width: 100%; height: 4px; border-radius: 2px; background: currentColor; margin: 2px 0 3px; }
  .line::after { content: ''; position: absolute; right: -1px; top: -4px; border-left: 8px solid currentColor; border-top: 6px solid transparent; border-bottom: 6px solid transparent; }
  .sub { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; min-height: 1em; }
  .own { color: var(--own); } .now { color: var(--now); } .norush { color: var(--accent); } .optional { color: var(--muted); } .wait { color: var(--wait); }
</style>
