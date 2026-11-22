<script lang="ts">
  // An album, playlist, artist, song or video as a card. Clicking opens its page, or
  // plays it (songs and videos).
  import Artwork from "./Artwork.svelte";
  import { Play } from "@lucide/svelte";
  import { playlistMenu, songMenu } from "$lib/menus";
  import { openTile } from "$lib/open";
  import { menu, type MenuEntry } from "$lib/stores/menu.svelte";
  import { player } from "$lib/stores/player.svelte";
  import { sized } from "$lib/ytm/thumbs";
  import type { Tile } from "$lib/ytm/types";

  let { tile }: { tile: Tile } = $props();

  // Songs, videos and mixes without a page of their own play when clicked.
  const playable = $derived(tile.kind === "song" || tile.kind === "video" || (!!tile.playlistId && !tile.browseId));
  const isCurrent = $derived(playable && !!tile.videoId && tile.videoId === player.playback?.videoId);

  /** Songs and videos get the song menu, playlists the playlist menu. */
  function menuItems(): MenuEntry[] | null {
    if (playable && tile.videoId) return songMenu({ videoId: tile.videoId, title: tile.title });
    if (tile.kind === "playlist" && tile.browseId?.startsWith("VL")) return playlistMenu({ browseId: tile.browseId, title: tile.title });
    return null;
  }
  function onContextMenu(e: MouseEvent) {
    const items = menuItems();
    if (items) menu.show(e, items);
  }
</script>

<button class="card {tile.kind}" class:current={isCurrent} onclick={() => openTile(tile)} oncontextmenu={onContextMenu} title={tile.title}>
  <span class="art">
    <Artwork src={tile.kind === "video" ? tile.thumbnail : sized(tile.thumbnail, 400)} kind={tile.kind} lazy />
    {#if playable}
      <span class="play" aria-hidden="true"><Play size={20} fill="currentColor" strokeWidth={0} /></span>
    {/if}
  </span>
  <span class="title truncate">{tile.title}</span>
  <span class="sub truncate">{tile.subtitle}</span>
</button>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    border-radius: var(--radius-lg);
    text-align: left;
    min-width: 0;
    transition: background 0.15s;
  }
  .card:hover {
    background: var(--surface-2);
  }
  .art {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    margin-bottom: 10px;
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--surface-3);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.4);
    transition: transform 0.2s var(--ease);
  }
  .video .art {
    aspect-ratio: 16 / 9;
  }
  .artist .art {
    border-radius: 50%;
  }
  .card:hover .art {
    transform: translateY(-3px);
  }
  /* Songs and videos play when clicked: say so on hover. */
  .play {
    position: absolute;
    right: 10px;
    bottom: 10px;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-ink);
    box-shadow: 0 8px 20px rgb(0 0 0 / 0.45);
    opacity: 0;
    transform: translateY(6px);
    transition:
      opacity 0.15s,
      transform 0.2s var(--ease);
  }
  .card:hover .play,
  .card:focus-visible .play {
    opacity: 1;
    transform: none;
  }
  .title {
    font-weight: 500;
  }
  .current .title {
    color: var(--accent);
  }
  .artist .title,
  .artist .sub {
    text-align: center;
  }
  .sub {
    font-size: 12.5px;
    color: var(--muted);
  }
</style>
