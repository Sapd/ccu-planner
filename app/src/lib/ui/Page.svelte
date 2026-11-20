<script>
  // The frame of every page: one centred column, then a title row (title, one sentence of purpose, the page's main action).
  // wide: the pages that use a second column (Goals, Graphs) may grow past the normal width.
  import BackLink from './BackLink.svelte';
  let { title, purpose = '', wide = false, actions, children } = $props();
</script>

<div class="page" class:wide>
  <BackLink />
  <header class="titlerow">
    <div class="titles">
      <h1>{title}</h1>
      {#if purpose}<p class="purpose">{purpose}</p>{/if}
    </div>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </header>
  {@render children?.()}
</div>

<style>
  .page { display: flex; flex-direction: column; gap: 14px; width: 100%; max-width: var(--page-width); margin-inline: auto; min-width: 0; }
  .page.wide { max-width: var(--page-width-wide); }
  .titlerow { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px 24px; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 22px; line-height: 1.2; }
  .purpose { margin: 2px 0 0; color: var(--muted); font-size: 14px; }
  .actions { display: flex; gap: 8px; align-items: center; }
</style>
