<script>
  // A collapsed section. The body is only built once it is open (the chart and the searches are not free).
  let { title, children, open = $bindable(false), id = undefined } = $props();
</script>

<details class="fold" {id} bind:open>
  <summary>{title}</summary>
  {#if open}<div class="body">{@render children()}</div>{/if}
</details>

<style>
  .fold { background: var(--glass); border: 1px solid var(--glass-border); border-radius: var(--radius); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); }
  summary { cursor: pointer; padding: 10px 16px; font-weight: 600; }
  summary:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; border-radius: var(--radius); }
  .body { padding: 0 16px 14px; }
</style>
