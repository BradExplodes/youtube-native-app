<script lang="ts">
  // The shelves of Home, Explore, a genre or the charts: rows of cards that scroll
  // sideways, blocks of songs, and genre buttons.
  import { arrowNav } from "$lib/a11y";
  import SongRows from "./SongRows.svelte";
  import TileCard from "./TileCard.svelte";
  import { openLink, playSingle } from "$lib/open";
  import type { Shelf } from "$lib/ytm/types";

  let { shelves }: { shelves: Shelf[] } = $props();

  const tileKey = (t: Shelf["tiles"][number], i: number) => `${i}:${t.browseId ?? t.videoId ?? t.playlistId ?? ""}`;
</script>

{#each shelves as shelf, si (`${si}:${shelf.title}`)}
  <section class="shelf">
    {#if shelf.title || shelf.strapline || shelf.more}
      <div class="head">
        <div class="titles">
          {#if shelf.strapline}<div class="eyebrow strap">{shelf.strapline}</div>{/if}
          {#if shelf.title}<h2>{shelf.title}</h2>{/if}
        </div>
        {#if shelf.more}
          <button class="show-all" onclick={() => openLink(shelf.more!)}>See all</button>
        {/if}
      </div>
    {/if}

    {#if shelf.tracks.length}
      <!-- Songs play on their own, followed by a radio of similar music (as on YouTube Music). -->
      <div class="songs">
        <SongRows tracks={shelf.tracks} play={(i) => playSingle(shelf.tracks[i].videoId)} compact />
      </div>
    {:else if shelf.tiles.length}
      <div
        class={shelf.grid ? "card-grid" : "carousel"}
        use:arrowNav={{ selector: ".card", orientation: shelf.grid ? "grid" : "horizontal" }}
      >
        {#each shelf.tiles as t, i (tileKey(t, i))}
          <div class="slot" class:wide={t.kind === "video"}><TileCard tile={t} /></div>
        {/each}
      </div>
    {:else}
      <div class="buttons" class:wrap={shelf.grid} use:arrowNav={{ selector: ".genre", orientation: "grid" }}>
        {#each shelf.buttons as b, i (`${i}:${b.title}`)}
          <button class="genre" class:striped={!!b.color} style:--stripe={b.color} onclick={() => openLink(b.link)}>
            <span class="truncate">{b.title}</span>
          </button>
        {/each}
      </div>
    {/if}
  </section>
{/each}

<style>
  .shelf {
    margin-bottom: 36px;
  }
  .head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
  }
  .titles {
    min-width: 0;
  }
  .strap {
    margin-bottom: 4px;
  }
  h2 {
    margin: 0;
    font-size: 22px;
    font-weight: var(--weight-display);
    letter-spacing: -0.01em;
  }
  .show-all {
    flex: none;
    color: var(--muted);
    font-size: 13px;
    font-weight: 500;
  }
  .show-all:hover {
    color: var(--text);
    text-decoration: underline;
  }

  /* Songs: columns of four rows that scroll sideways, like Quick picks on YouTube Music. */
  .songs :global(.rows.compact) {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(4, auto);
    grid-auto-columns: minmax(280px, calc((100% - 24px) / 3));
    column-gap: 12px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    padding-bottom: 6px;
  }

  /* Cards: one row that scrolls sideways (wheel + Shift, trackpad, or the scrollbar)… */
  .carousel {
    display: flex;
    gap: 4px;
    margin: 0 -12px;
    padding-bottom: 6px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }
  .carousel .slot {
    flex: 0 0 184px;
    min-width: 0;
  }
  .carousel .slot.wide {
    flex-basis: 264px;
  }
  /* …or a grid that wraps (a genre's playlists). */
  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(172px, 1fr));
    gap: 4px;
    margin: 0 -12px;
  }
  .slot > :global(.card) {
    width: 100%;
  }

  /* Genre and mood buttons: four rows that scroll sideways, or a grid that wraps. */
  .buttons {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(4, auto);
    grid-auto-columns: 196px;
    gap: 10px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    padding-bottom: 6px;
  }
  .buttons.wrap {
    grid-auto-flow: row;
    grid-template-rows: none;
    grid-template-columns: repeat(auto-fill, minmax(196px, 1fr));
    overflow-x: visible;
  }
  .genre {
    display: flex;
    align-items: center;
    min-width: 0;
    height: 48px;
    padding: 0 16px;
    border-radius: var(--radius);
    background: var(--surface-2);
    font-weight: 500;
    text-align: left;
    transition: background 0.15s;
  }
  .genre.striped {
    border-left: 6px solid var(--stripe);
    padding-left: 12px;
  }
  .genre:hover {
    background: var(--surface-3);
  }
</style>
