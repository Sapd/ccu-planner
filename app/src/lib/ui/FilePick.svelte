<script>
  // A real button that opens the file chooser; the hidden file input carries the accessible name for assistive technology.
  let { label, inputLabel, accept = '.json', disabled = false, onfile } = $props();
  let input = $state(null);
  function change(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ''; // the same file can be chosen again
    if (file) onfile(file);
  }
</script>

<button type="button" {disabled} onclick={() => input?.click()}>{label}</button>
<input bind:this={input} type="file" {accept} hidden aria-label={inputLabel} onchange={change} />
