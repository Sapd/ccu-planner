<script>
  let { children, as = 'section', class: cls = '', ...rest } = $props();
</script>

<svelte:element this={as} class="glass {cls}" {...rest}>{@render children?.()}</svelte:element>

<style>
  .glass { background: var(--glass); border: 1px solid var(--glass-border); border-radius: var(--radius); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); padding: 14px 16px; }
  @media (max-width: 1023px) { .glass { padding: 12px; } }
</style>
