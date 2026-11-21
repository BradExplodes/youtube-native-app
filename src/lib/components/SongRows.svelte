<script lang="ts">
  // A short list of songs (search results, an artist's top songs). Not virtualized:
  // for long lists use TrackList.
  import { arrowNav } from "$lib/a11y";
  import Artwork from "./Artwork.svelte";
  import { Heart, Play } from "@lucide/svelte";
  import ArtistLinks from "./ArtistLinks.svelte";
  import Equalizer from "./Equalizer.svelte";
  import { setLiked } from "$lib/actions";
  import { songMenu } from "$lib/menus";
  import { openAlbum } from "$lib/open";
  import { likes } from "$lib/stores/likes.svelte";
  import { menu } from "$lib/stores/menu.svelte";
  import { player } from "$lib/stores/player.svelte";
  import type { Track } from "$lib/ytm/types";

  let { tracks, play, numbered = false }: { tracks: Track[]; play: (index: number) => void; numbered?: boolean } =
    $props();

  const current = $derived(player.playback?.videoId);
  const playing = $derived(!!player.playback?.playing);
</script>

<div class="rows" class:numbered role="table" use:arrowNav={{ selector: ".row" }}>
  {#each tracks as t, i (t.videoId + i)}
    {@const isCurrent = t.videoId === current}
    {@const liked = likes.get(t.videoId)}
    <div
      class="row"
      class:current={isCurrent}
      class:unavailable={!t.available}
      role="row"
      tabindex="0"
      ondblclick={() => t.available && play(i)}
      onkeydown={(e) => e.key === "Enter" && t.available && play(i)}
      oncontextmenu={(e) => menu.show(e, songMenu(t, { play: () => play(i) }))}
    >
      <span class="art">
        <Artwork src={t.thumbnail} kind="song" />
        {#if isCurrent}
          <span class="overlay eq"><Equalizer {playing} size={14} /></span>
        {/if}
        <button
          class="overlay play"
          aria-label="Play {t.title}"
          disabled={!t.available}
          onclick={() => play(i)}
          ondblclick={(e) => e.stopPropagation()}
        >
          <Play size={16} fill="currentColor" strokeWidth={0} />
        </button>
      </span>
      {#if numbered}<span class="num">{i + 1}</span>{/if}
      <span class="meta">
        <span class="title truncate">{t.title}</span>
        <span class="artist truncate">
          {#if t.explicit}<span class="explicit" title="Explicit">E</span>{/if}
          <ArtistLinks artists={t.artists} />
        </span>
      </span>
      <span class="album truncate">
        {#if t.album}<button class="link" onclick={() => openAlbum(t.album!.id)}>{t.album.name}</button>{/if}
      </span>
      <button
        class="like"
        class:on={liked}
        aria-label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
        title={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
        onclick={() => setLiked(t, !liked)}
        ondblclick={(e) => e.stopPropagation()}
      >
        <Heart size={16} fill={liked ? "currentColor" : "none"} />
      </button>
      <span class="dur">{t.duration ?? ""}</span>
    </div>
  {/each}
</div>

<style>
  .rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row {
    display: grid;
    grid-template-columns: 44px minmax(0, 5fr) minmax(0, 3fr) 30px 48px;
    align-items: center;
    gap: 14px;
    height: 58px;
    padding: 0 12px 0 7px;
    border-radius: var(--radius);
    color: var(--muted);
    transition: background 0.12s;
  }
  .numbered .row {
    grid-template-columns: 44px 18px minmax(0, 5fr) minmax(0, 3fr) 30px 48px;
  }
  .row:hover,
  .row:focus-visible {
    background: rgb(255 255 255 / 0.05);
    outline: none;
  }
  .row.current {
    background: linear-gradient(90deg, var(--accent-soft), transparent 70%);
  }
  .row.current .title {
    color: var(--accent);
  }
  .row.unavailable {
    opacity: 0.35;
  }
  .art {
    position: relative;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-3);
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.5);
    color: var(--text);
  }
  .play {
    opacity: 0;
  }
  .row:hover .play:not(:disabled),
  .row:focus-visible .play:not(:disabled) {
    opacity: 1;
  }
  .num {
    min-width: 14px;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .title {
    color: var(--text);
  }
  .artist {
    margin-top: 2px;
    font-size: 12.5px;
  }
  .explicit {
    display: inline-grid;
    place-items: center;
    width: 14px;
    height: 14px;
    margin-right: 4px;
    border-radius: 3px;
    font-size: 9px;
    font-weight: 600;
    background: rgb(255 255 255 / 0.18);
    color: var(--text);
    vertical-align: 1px;
  }
  .album {
    font-size: 13px;
  }
  .link {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    color: inherit;
  }
  .link:hover {
    color: var(--text);
    text-decoration: underline;
  }
  /* Liked songs always show a filled heart; others show an outline on hover. */
  .like {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    color: var(--muted);
    opacity: 0;
    transition:
      opacity 0.12s,
      color 0.12s;
  }
  .row:hover .like,
  .row:focus-within .like,
  .like.on {
    opacity: 1;
  }
  .like:hover {
    color: var(--text);
  }
  .like.on {
    color: var(--accent);
  }
  .dur {
    text-align: right;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
</style>
