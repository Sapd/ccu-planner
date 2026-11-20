<script>
  import RsiLink from '../RsiLink.svelte';
  import { backend } from '../backend.js';

  // One store item: picture, title, price (the sale price large, the old one struck through), at most two tags, and the RSI page link.
  // card: cardView() of the item. The app never buys: the link opens the item's RSI page in the browser.
  let { card } = $props();
  const src = $derived(backend.imageSrc(card.thumb));
  // The src that failed to load; a different picture gets a fresh chance.
  let failedSrc = $state(null);
  const showImage = $derived(!!src && failedSrc !== src);
</script>

<article class="card">
  <span class="pic" aria-hidden="true">
    {#if showImage}
      <img {src} alt="" loading="lazy" decoding="async" onerror={() => { failedSrc = src; }} />
    {:else}
      <svg class="icon" viewBox="0 0 24 24" focusable="false"><path d="M12 2.5 14.2 9l7.3 4.2v2.3L14.5 13.8l-.4 3.7 2.4 1.6v1.9L12 19.6 7.5 21v-1.9l2.4-1.6-.4-3.7-7 1.7v-2.3L9.8 9z" fill="currentColor"/></svg>
    {/if}
  </span>
  <h3 class="title" title={card.title}>{card.title}</h3>
  <p class="price">
    <b>{card.price}</b>
    {#if card.was}<s><span class="sr">was </span>{card.was}</s> <span class="off">{card.off}</span>{/if}
    {#if card.soldOut}<span class="muted">Sold out</span>{/if}
  </p>
  <div class="foot">
    <span class="tags">{#each card.tags as t (t)}<span class="tag">{t}</span>{/each}</span>
    <RsiLink href={card.url} label="View on RSI" aria="View {card.title} on RSI" />
  </div>
</article>

<style>
  .card { display: flex; flex-direction: column; gap: 4px; height: 100%; box-sizing: border-box; padding: 6px; background: var(--glass); border: 1px solid var(--glass-border); border-radius: 10px; backdrop-filter: var(--glass-blur); }
  .card:hover { border-color: var(--accent); }
  .pic { display: flex; align-items: center; justify-content: center; aspect-ratio: 16 / 9; overflow: hidden; border-radius: 6px; background: rgba(8, 12, 20, 0.45); }
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .icon { width: 36px; height: 36px; color: var(--muted); opacity: 0.55; }
  .title { margin: 2px 2px 0; font-size: 14px; font-weight: 700; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.5em; }
  .price { margin: 0 2px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
  .price b { font-size: 18px; font-variant-numeric: tabular-nums; }
  s { color: var(--muted); font-size: 13px; }
  .off { color: var(--now); font-weight: 700; font-size: 13px; }
  .muted { color: var(--muted); font-size: 12px; }
  .foot { margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 26px; }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
