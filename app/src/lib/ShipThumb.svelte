<script>
  import { thumbSize, thumbFile, shipPicture } from './view/thumb.mjs';
  import { backend } from './backend.js';
  import { ui } from './state.svelte.js';

  // ship: a planner ship ({ id, name, image: { s, l } | null, manufacturer }) or null for an unknown one.
  // label: alt text for the rare placement with no ship name beside it; empty (decorative) otherwise.
  let { ship = null, size = 'xs', label = '' } = $props();
  const sz = $derived(thumbSize(size));
  // The local file ({ s, l } names under images/): the small one for xs/s/m, the large one for card and hero. A ship the picture sync has not
  // reached shows the signed feed's picture (ui.feed.ships, filled as the feed's pictures arrive), so pictures are there before any sync.
  const src = $derived(backend.imageSrc(thumbFile(shipPicture(ship, ui.feed.ships), sz)));
  // The src that failed to load; a different picture gets a fresh chance.
  let failedSrc = $state(null);
  const showImage = $derived(!!src && failedSrc !== src);
</script>

<span class="thumb {sz}" aria-hidden={showImage || label ? undefined : 'true'} role={!showImage && label ? 'img' : undefined} aria-label={!showImage && label ? label : undefined}>
  {#if showImage}
    <img {src} alt={label} loading="lazy" decoding="async" onerror={() => { failedSrc = src; }} />
  {:else}
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.5 14.2 9l7.3 4.2v2.3L14.5 13.8l-.4 3.7 2.4 1.6v1.9L12 19.6 7.5 21v-1.9l2.4-1.6-.4-3.7-7 1.7v-2.3L9.8 9z" fill="currentColor"/></svg>
  {/if}
</span>

<style>
  .thumb { display: inline-flex; align-items: center; justify-content: center; flex: none; overflow: hidden; vertical-align: middle; background: var(--glass); border: 1px solid var(--glass-border); border-radius: 3px; box-sizing: border-box; aspect-ratio: 2 / 1; }
  .xs { width: 32px; height: 16px; }
  .s { width: 64px; height: 32px; border-radius: 4px; }
  .m { width: 160px; height: 80px; border-radius: 6px; }
  .card, .hero { display: flex; width: 100%; height: auto; border-radius: 6px; }
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
  /* The shared placeholder: one neutral ship silhouette for every ship without a picture. */
  .icon { width: 50%; max-width: 40px; height: 70%; color: var(--muted); opacity: 0.55; }
  .xs .icon { width: 12px; }
</style>
