<script>
  import { heroSource } from '../view/nav.mjs';
  import { initials } from '../view/thumb.mjs';
  import { backend } from '../backend.js';

  // ship: { name, image: { s, l } | null, manufacturer } | null; height in px; children render over the picture.
  let { ship = null, height = 220, children } = $props();
  const hero = $derived(heroSource(ship));
  const src = $derived(hero.kind === 'image' ? backend.imageSrc(hero.file) : null);
  let failedSrc = $state(null);
  const showImage = $derived(!!src && failedSrc !== src);
  const text = $derived(initials(ship?.manufacturer));
</script>

<div class="hero" style="min-height: {height}px">
  {#if showImage}
    <img {src} alt="" decoding="async" onerror={() => { failedSrc = src; }} />
  {:else}
    <span class="ini" aria-hidden="true">{text}</span>
  {/if}
  <div class="shade"></div>
  {#if children}<div class="over">{@render children()}</div>{/if}
</div>

<style>
  .hero { position: relative; overflow: hidden; border-radius: var(--radius); background: linear-gradient(135deg, #1d2b4a, #0a0e16); border: 1px solid var(--glass-border); }
  img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: right center; }
  .ini { position: absolute; right: 24px; top: 50%; transform: translateY(-50%); font-size: 72px; font-weight: 800; color: rgba(255, 255, 255, 0.12); }
  .shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(10, 14, 22, 0.92) 0%, rgba(10, 14, 22, 0.6) 55%, rgba(10, 14, 22, 0.15) 100%); }
  .over { position: relative; height: 100%; box-sizing: border-box; padding: 18px 22px; display: flex; flex-direction: column; justify-content: flex-end; }
</style>
