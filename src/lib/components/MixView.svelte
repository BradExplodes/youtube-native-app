<script lang="ts">
  // One of the app's own "Made for you" mixes: its songs, Play, and Save as a playlist
  // (only when you ask: nothing is saved to your account otherwise).
  import { untrack } from "svelte";
  import { ListPlus, Pause, Play, Sparkles } from "@lucide/svelte";
  import Mosaic from "./Mosaic.svelte";
  import SongRows from "./SongRows.svelte";
  import { playerCmd } from "$lib/ipc";
  import { dialog } from "$lib/stores/dialog.svelte";
  import { LIKED_RARELY, coversOf, mixes } from "$lib/stores/mixes.svelte";
  import { nav } from "$lib/stores/nav.svelte";
  import { player } from "$lib/stores/player.svelte";

  let { id }: { id: string } = $props();

  const isLiked = $derived(id === LIKED_RARELY);
  const mix = $derived(isLiked ? mixes.likedRarely : mixes.get(id));
  const loading = $derived(isLiked ? mixes.likedLoading || (!mixes.likedRarely && !mixes.likedError) : !mixes.loaded);
  const error = $derived(isLiked ? mixes.likedError : mixes.error);
  const tracks = $derived(mix?.tracks ?? []);

  $effect(() => {
    const liked = isLiked;
    untrack(() => {
      mixes.load();
      if (liked) mixes.loadLikedRarely();
    });
  });
  // A tab reopened from last time for a mix there isn't enough history for today becomes Home.
  $effect(() => {
    const route = { kind: "mix", id } as const;
    if (mix?.tracks.length) nav.loaded(route);
    else if (!loading && !error) nav.missing(route);
  });

  const context = $derived(`mix:${id}`);
  const isSource = $derived(player.context === context && !!player.playback);
  const sourcePlaying = $derived(isSource && !!player.playback?.playing);

  /** Play from song `index` on: it plays now and the rest of the mix is queued after it. */
  function play(index: number) {
    const ids = tracks.slice(index).map((t) => t.videoId);
    if (!ids.length) return;
    player.context = context;
    playerCmd({ action: "loadList", videoIds: ids });
  }
  function heroPlay() {
    if (isSource) {
      player.optimistic({ playing: !sourcePlaying });
      playerCmd({ action: "toggle" });
    } else play(0);
  }
  function save() {
    if (!mix) return;
    dialog.open({
      kind: "playlist",
      title: mix.title,
      description: mix.description,
      privacy: "PRIVATE",
      videoIds: tracks.map((t) => t.videoId),
    });
  }

  const minutes = $derived(
    Math.round(
      tracks.reduce((s, t) => s + (t.duration?.split(":").reduce((a, p) => a * 60 + Number(p), 0) ?? 0), 0) / 60,
    ),
  );
</script>

<div class="view">
  {#if error && !mix}
    <div class="state">
      <p>Couldn't put this mix together: {error}</p>
      <button class="btn-primary" onclick={() => (isLiked ? mixes.loadLikedRarely() : mixes.load())}>Try again</button>
    </div>
  {:else if loading && !mix}
    <div class="state">
      <span class="eyebrow">{isLiked ? "Going through your Liked Songs…" : "Loading…"}</span>
    </div>
  {:else if !tracks.length}
    <div class="state">
      <p>There isn't enough listening history for this mix yet.</p>
      <button class="btn-primary" onclick={() => nav.go({ kind: "home" })}>Back to Home</button>
    </div>
  {:else if mix}
    <header class="hero">
      <div class="cover"><Mosaic covers={coversOf(tracks)} /></div>
      <div class="meta">
        <div class="eyebrow kind"><Sparkles size={13} /> Made for you</div>
        <h1>{mix.title}</h1>
        <p class="description">{mix.description}</p>
        <div class="facts">{tracks.length} songs{minutes ? ` • about ${minutes} min` : ""}</div>
        <div class="actions">
          <button class="hero-play" aria-label={sourcePlaying ? "Pause" : "Play"} onclick={heroPlay}>
            {#if sourcePlaying}
              <Pause size={24} fill="currentColor" strokeWidth={0} />
            {:else}
              <Play size={24} fill="currentColor" strokeWidth={0} />
            {/if}
          </button>
          <button class="save" onclick={save} title="Save these songs as a new playlist in your library">
            <ListPlus size={18} /> Save as a playlist
          </button>
          {#if isSource}<span class="eyebrow live">Playing from here</span>{/if}
        </div>
      </div>
    </header>

    <div class="body">
      <SongRows {tracks} {play} numbered />
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
    padding: 0 40px;
    text-align: center;
  }
  .hero {
    display: flex;
    align-items: flex-end;
    gap: 28px;
    padding: 40px 40px 28px;
    background: linear-gradient(180deg, var(--accent-soft), transparent);
  }
  .cover {
    position: relative;
    flex: none;
    width: clamp(160px, 20vw, 232px);
    aspect-ratio: 1;
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--surface-3);
    box-shadow: 0 20px 50px rgb(0 0 0 / 0.5);
  }
  .meta {
    min-width: 0;
  }
  .kind {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--accent);
  }
  h1 {
    margin: 8px 0 6px;
    font-size: clamp(32px, 5vw, 64px);
    font-weight: var(--weight-display);
    line-height: 1.08;
    letter-spacing: -0.03em;
    overflow-wrap: anywhere;
  }
  .description {
    margin: 0 0 6px;
    color: var(--muted);
  }
  .facts {
    font-size: 13px;
    color: var(--muted);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 20px;
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
  .hero-play:hover {
    transform: scale(1.06);
    background: var(--accent-hover);
  }
  .save {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 16px;
    border-radius: 999px;
    border: 1px solid var(--line);
    color: var(--text);
    font-weight: 500;
    transition: background 0.15s;
  }
  .save:hover {
    background: var(--surface-2);
  }
  .live {
    color: var(--accent);
  }
  .body {
    padding: 0 40px;
  }
</style>
