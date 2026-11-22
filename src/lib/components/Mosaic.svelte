<script lang="ts">
  // Up to four covers in a 2×2 grid, for the app's own mixes (which have no cover of
  // their own). Fewer than four: the first one fills the box.
  import Artwork from "./Artwork.svelte";
  import { sized } from "$lib/ytm/thumbs";

  let { covers }: { covers: string[] } = $props();
</script>

{#if covers.length >= 4}
  <span class="mosaic">
    {#each covers.slice(0, 4) as src, i (i)}
      <span class="cell"><Artwork src={sized(src, 226)} kind="song" lazy /></span>
    {/each}
  </span>
{:else}
  <Artwork src={sized(covers[0], 400)} kind="playlist" lazy />
{/if}

<style>
  .mosaic {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
  }
  .cell {
    position: relative;
    overflow: hidden;
  }
</style>
