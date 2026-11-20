<script>
  import { t } from '$logic/i18n.mjs';
  import { offerTile, offerCheckLines } from '$logic/whatifText.mjs';

  // The result of one offer check as a verdict tile: one tone, one headline, one sentence; the details sit behind "Why".
  // r: the checkOffer result; name(id): a ship's name.
  let { r, name } = $props();
  const tile = $derived(offerTile(r));
  const lines = $derived(offerCheckLines(r, name, { effect: false }));
</script>

<div class="tile {tile.tone}" data-verdict data-tone={tile.tone}>
  <span class="head">{tile.head}</span>
  <span class="text">{tile.text}</span>
</div>
<details class="why">
  <summary>{t('Why')}</summary>
  <ul>{#each lines as line, i (i)}<li>{line}</li>{/each}</ul>
</details>

<style>
  .tile { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--muted); background: rgba(8, 12, 20, 0.45); }
  .head { font-size: 22px; font-weight: 800; line-height: 1.2; color: var(--muted); }
  .text { font-size: 14px; }
  .good { border-color: var(--now); } .good .head { color: var(--now); }
  .bad { border-color: #ff7b72; } .bad .head { color: #ff7b72; }
  .why { margin-top: 6px; }
  .why summary { cursor: pointer; color: var(--muted); font-size: 13px; }
  .why summary:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
  ul { margin: 4px 0 0; padding-left: 18px; color: var(--muted); font-size: 13px; }
</style>
