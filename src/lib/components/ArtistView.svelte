<script lang="ts">
  // An artist's page: banner, top songs and their albums, singles, videos and more.
  import { arrowNav } from "$lib/a11y";
  import { Pause, Play } from "@lucide/svelte";
  import SongRows from "./SongRows.svelte";
  import TileCard from "./TileCard.svelte";
  import { playerCmd } from "$lib/ipc";
  import { library } from "$lib/stores/library.svelte";
  import { nav, notFound } from "$lib/stores/nav.svelte";
  import { player } from "$lib/stores/player.svelte";

  let { browseId }: { browseId: string } = $props();

  const page = $derived(library.artist(browseId));
  const info = $derived(page.info);
  $effect(() => {
    page.load();
  });
  // A tab reopened from last time for an artist page that's gone becomes Home.
  $effect(() => {
    const route = { kind: "artist", browseId } as const;
    if (info?.name) nav.loaded(route);
    else if (info || (page.error && notFound(page.error))) nav.missing(route);
  });

  // Top songs play inside their own playlist, so the queue carries on through them.
  const playlistId = $derived(info?.allSongsId?.replace(/^VL/, ""));
  const isSource = $derived(player.context === browseId && !!player.playback);
  const sourcePlaying = $derived(isSource && !!player.playback?.playing);

  function play(index: number) {
    const t = info?.topSongs[index];
    if (!t) return;
    player.context = browseId;
    playerCmd({ action: "load", videoId: t.videoId, playlistId });
  }
  function heroPlay() {
    if (isSource) {
      player.optimistic({ playing: !sourcePlaying });
      playerCmd({ action: "toggle" });
      return;
    }
    if (playlistId) {
      player.context = browseId;
      playerCmd({ action: "load", playlistId });
    } else play(0);
  }
</script>

<div class="view">
  {#if page.error && !info}
    <div class="state">
      <p>Couldn't load this artist: {page.error}</p>
      <button class="btn-primary" onclick={() => page.load()}>Try again</button>
    </div>
  {:else if !info}
    <div class="state"><span class="eyebrow">Loading…</span></div>
  {:else}
    <header class="hero">
      {#if info.thumbnail}<img class="banner" src={info.thumbnail} alt="" />{/if}
      <div class="shade"></div>
      <div class="content">
        <div class="eyebrow kind">Artist</div>
        <h1>{info.name}</h1>
        {#if info.subtitle}<div class="facts">{info.subtitle}</div>{/if}
        <div class="actions">
          <button
            class="hero-play"
            aria-label={sourcePlaying ? "Pause" : "Play"}
            disabled={!info.topSongs.length && !playlistId}
            onclick={heroPlay}
          >
            {#if sourcePlaying}
              <Pause size={24} fill="currentColor" strokeWidth={0} />
            {:else}
              <Play size={24} fill="currentColor" strokeWidth={0} />
            {/if}
          </button>
          {#if isSource}<span class="eyebrow live">Playing from here</span>{/if}
        </div>
      </div>
    </header>

    <div class="body">
      {#if info.topSongs.length}
        <section>
          <div class="section-head">
            <h2>Top songs</h2>
            {#if info.allSongsId}
              <button class="show-all" onclick={() => nav.go({ kind: "list", browseId: info.allSongsId! })}>See all</button>
            {/if}
          </div>
          <SongRows tracks={info.topSongs} {play} numbered />
        </section>
      {/if}

      {#each info.shelves as shelf (shelf.title)}
        <section>
          <div class="section-head"><h2>{shelf.title}</h2></div>
          <div class="carousel" use:arrowNav={{ selector: ".card", orientation: "horizontal" }}>
            {#each shelf.tiles as t, i (t.browseId ?? t.videoId ?? i)}
              <div class="slot" class:wide={t.kind === "video"}><TileCard tile={t} /></div>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .view {
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    padding-bottom: var(--player-clearance);
  }
  .state {
    height: 100%;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 12px;
  }
  .hero {
    position: relative;
    display: flex;
    align-items: flex-end;
    min-height: clamp(280px, 38vh, 400px);
    padding: 40px;
    overflow: hidden;
  }
  .banner {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center 25%;
  }
  .shade {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(180deg, rgb(19 19 23 / 0.05) 0%, rgb(19 19 23 / 0.55) 55%, var(--surface) 100%),
      linear-gradient(90deg, rgb(19 19 23 / 0.5) 0%, transparent 60%);
  }
  .content {
    position: relative;
    min-width: 0;
  }
  .kind {
    color: var(--text);
    opacity: 0.85;
  }
  h1 {
    margin: 8px 0 8px;
    font-size: clamp(40px, 6vw, 84px);
    font-weight: var(--weight-display);
    line-height: 1.08;
    padding-bottom: 0.06em;
    letter-spacing: -0.03em;
    overflow-wrap: anywhere;
    text-shadow: 0 4px 30px rgb(0 0 0 / 0.4);
  }
  .facts {
    font-size: 14px;
    color: var(--text);
    opacity: 0.85;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 22px;
  }
  .hero-play {
    flex: none;
    width: 56px;
    height: 56px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-ink);
    box-shadow: 0 10px 30px var(--accent-glow);
    transition:
      transform 0.15s var(--ease),
      background 0.15s;
  }
  .hero-play:hover:not(:disabled) {
    transform: scale(1.06);
    background: var(--accent-hover);
  }
  .hero-play:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .live {
    color: var(--accent);
  }
  .body {
    padding: 8px 40px 0;
  }
  section {
    margin-bottom: 36px;
  }
  .section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  h2 {
    margin: 0;
    font-size: 22px;
    font-weight: var(--weight-display);
    letter-spacing: -0.01em;
  }
  .show-all {
    color: var(--muted);
    font-size: 13px;
    font-weight: 500;
  }
  .show-all:hover {
    color: var(--text);
    text-decoration: underline;
  }
  /* One row of cards that scrolls sideways (wheel + Shift, trackpad, or the scrollbar). */
  .carousel {
    display: flex;
    gap: 4px;
    margin: 0 -12px;
    padding-bottom: 6px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
  }
  .slot {
    flex: 0 0 184px;
    min-width: 0;
  }
  .slot.wide {
    flex-basis: 264px;
  }
  .slot > :global(.card) {
    width: 100%;
  }
</style>
