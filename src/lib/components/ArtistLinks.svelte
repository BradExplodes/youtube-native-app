<script lang="ts">
  // "A, B, C" where each artist with a page is a link to it.
  import { canOpenArtist, openArtist } from "$lib/open";
  import type { ArtistRef } from "$lib/ytm/types";

  /** `tabbable: false` keeps the links out of the Tab order (rows that are one tab stop). */
  let { artists, tabbable = true }: { artists: ArtistRef[]; tabbable?: boolean } = $props();
</script>

{#each artists as a, i (i)}{#if i > 0}, {/if}{#if canOpenArtist(a.id)}<button
      class="artist-link"
      tabindex={tabbable ? undefined : -1}
      onclick={(e) => {
        e.stopPropagation();
        openArtist(a.id!);
      }}
      ondblclick={(e) => e.stopPropagation()}>{a.name}</button
    >{:else}{a.name}{/if}{/each}

<style>
  .artist-link {
    color: inherit;
    font-size: inherit;
  }
  .artist-link:hover {
    color: var(--text);
    text-decoration: underline;
  }
</style>
