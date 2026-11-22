<script lang="ts">
  import { Ellipsis, Pause, Play, Search, X } from "@lucide/svelte";
  import TrackList from "./TrackList.svelte";
  import { moveInPlaylist } from "$lib/actions";
  import { playerCmd } from "$lib/ipc";
  import { editPlaylistDetails, playlistMenu, songMenu } from "$lib/menus";
  import { library } from "$lib/stores/library.svelte";
  import { menu } from "$lib/stores/menu.svelte";
  import { nav, notFound } from "$lib/stores/nav.svelte";
  import { player } from "$lib/stores/player.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { BROWSE } from "$lib/ytm/api";
  import type { Track } from "$lib/ytm/types";

  let { browseId }: { browseId: string } = $props();

  const page = $derived(library.page(browseId));
  const info = $derived(page.info);
  const isAlbum = $derived(browseId.startsWith("MPRE"));
  const isLiked = $derived(browseId === BROWSE.likedSongs);
  // Playlists (not albums, Liked Songs or a library artist's songs) get a playlist menu.
  const isPlaylist = $derived(browseId.startsWith("VL") && !isLiked);
  const listMenu = () => playlistMenu({ browseId, title: info?.title ?? "" });
  // Long descriptions (album write-ups) show two lines until clicked.
  let descOpen = $state(false);
  // Is the music playing right now from this page?
  const isSource = $derived(player.context === browseId && !!player.playback);
  const sourcePlaying = $derived(isSource && !!player.playback?.playing);

  $effect(() => {
    page.load();
  });
  // A tab reopened from last time whose playlist is gone (deleted elsewhere) becomes Home.
  $effect(() => {
    const route = { kind: "list", browseId } as const;
    if (info && (info.title || page.tracks.length || browseId === BROWSE.likedSongs)) nav.loaded(route);
    else if (info || (page.error && notFound(page.error))) nav.missing(route);
  });

  // ---- find in this list: every word must appear in the title, artists or album,
  // ignoring case and accents. Loads the rest of a long list so nothing is missed.
  let filterText = $state("");
  let filterInput = $state<HTMLInputElement>();
  const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const haystacks = new WeakMap<Track, string>();
  const haystack = (t: Track) => {
    let h = haystacks.get(t);
    if (h === undefined) {
      h = fold([t.title, ...t.artists.map((a) => a.name), t.album?.name ?? ""].join(" "));
      haystacks.set(t, h);
    }
    return h;
  };
  const words = $derived(fold(filterText).split(/\s+/).filter(Boolean));
  /** Matching rows with their place in the full list, or null when not filtering. */
  const matches = $derived(
    words.length
      ? page.tracks.flatMap((t, i) => (words.every((w) => haystack(t).includes(w)) ? [{ t, i }] : []))
      : null,
  );
  const shownTracks = $derived(matches ? matches.map((m) => m.t) : page.tracks);
  $effect(() => {
    if (words.length) page.all();
  });
  $effect(() => {
    if (ui.filterFocus) filterInput?.focus();
  });

  // Your own playlists can be put in a new order by dragging, except while filtered
  // (the rows shown aren't next to each other) or if a row lacks its playlist row id.
  const canReorder = $derived(
    isPlaylist && !!info?.owned && !matches && page.tracks.length > 1 && page.tracks.every((t) => t.setVideoId),
  );

  function play(index: number) {
    const t = page.tracks[index];
    if (!t) return;
    player.context = browseId;
    // Playing inside the list's own playlist keeps the queue going through it.
    playerCmd({ action: "load", videoId: t.videoId, playlistId: info?.playlistId });
  }
  function heroPlay() {
    if (isSource) {
      // Already playing from here: the big button is play/pause.
      player.optimistic({ playing: !sourcePlaying });
      playerCmd({ action: "toggle" });
      return;
    }
    const first = page.tracks.findIndex((t) => t.available);
    if (first >= 0) play(first);
  }

  const initial = $derived((info?.title || "?").trim().charAt(0).toUpperCase());
</script>

{#if page.error && !info}
  <div class="state">
    <p>Couldn't load this page: {page.error}</p>
    <button class="btn-primary" onclick={() => page.load()}>Try again</button>
  </div>
{:else if !info}
  <div class="state"><span class="eyebrow">Loading…</span></div>
{:else}
  <TrackList
    tracks={shownTracks}
    showAlbum={!isAlbum}
    showArt={!isAlbum}
    play={(i) => play(matches ? matches[i].i : i)}
    openAlbum={(id) => nav.go({ kind: "list", browseId: id })}
    nearEnd={matches ? undefined : () => page.more()}
    scrollKey={browseId}
    reorder={canReorder ? (from, gap) => moveInPlaylist(browseId, from, gap) : undefined}
    dropAtEnd={!page.hasMore}
    menuFor={(t, i) =>
      songMenu(t, { play: () => play(matches ? matches[i].i : i), inPlaylist: info.owned ? browseId : undefined })}
  >
    {#snippet header()}
      <header class="hero" role="group" aria-label="Playlist" oncontextmenu={(e) => isPlaylist && menu.show(e, listMenu())}>
        {#if info.thumbnail}
          <img class="backdrop" src={info.thumbnail} alt="" aria-hidden="true" />
        {:else}
          <div class="backdrop glow"></div>
        {/if}
        <div class="shade"></div>

        <div class="content">
          <div class="cover" class:liked={isLiked && !info.thumbnail}>
            {#if info.thumbnail}
              <img src={info.thumbnail} alt="" width="232" height="232" />
            {:else}
              <span class="initial">{initial}</span>
            {/if}
          </div>
          <div class="text">
            <div class="eyebrow kind">{info.subtitle || (isLiked ? "Collection" : "Artist")}</div>
            <h1>{isLiked ? "Liked Songs" : info.title}</h1>
            <div class="facts">
              {#if info.byline}<span class="byline">{info.byline}</span>{/if}
              {#if info.secondSubtitle}<span class="muted">{info.secondSubtitle}</span>{/if}
            </div>
            {#if info.description}
              <button
                class="description"
                class:open={descOpen}
                title={descOpen ? "Show less" : "Show all"}
                onclick={() => (descOpen = !descOpen)}
              >
                {info.description}
              </button>
            {:else if info.owned}
              <button class="add-description" onclick={() => editPlaylistDetails({ browseId, title: info.title })}>
                Add a description
              </button>
            {/if}
          </div>

        <!-- Play and find: under the title when there's room, a full-width bar when not. -->
        <div class="actions">
          <button
            class="hero-play"
            aria-label={sourcePlaying ? "Pause" : "Play"}
            disabled={!page.tracks.length}
            onclick={heroPlay}
          >
            {#if sourcePlaying}
              <Pause size={24} fill="currentColor" strokeWidth={0} />
            {:else}
              <Play size={24} fill="currentColor" strokeWidth={0} />
            {/if}
          </button>
          {#if isPlaylist}
            <button
              class="icon-btn more"
              aria-label="More options for this playlist"
              title="More options"
              onclick={(e) => menu.showAt(e.currentTarget, listMenu())}
            >
              <Ellipsis size={22} />
            </button>
          {/if}
          {#if isSource}<span class="eyebrow live">Playing from here</span>{/if}
          <div class="find">
            {#if matches}
              <span class="filter-note">
                {matches.length} of {page.tracks.length}{page.hasMore ? "+" : ""}{page.hasMore ? " · loading…" : ""}
              </span>
            {/if}
            <label class="filter" class:active={!!filterText}>
              <Search size={16} />
              <input
                bind:this={filterInput}
                bind:value={filterText}
                onkeydown={(e) => e.key === "Escape" && (filterText = "")}
                placeholder={isAlbum ? "Find in album" : "Find in playlist"}
                spellcheck="false"
                autocomplete="off"
              />
              {#if filterText}
                <button class="clear" aria-label="Clear" onclick={() => ((filterText = ""), filterInput?.focus())}>
                  <X size={14} />
                </button>
              {/if}
            </label>
          </div>
        </div>
        </div>
      </header>
    {/snippet}
  </TrackList>
  {#if page.error}
    <p class="inline-error">Couldn't load more tracks: {page.error}</p>
  {/if}
{/if}

<style>
  .state {
    height: 100%;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 12px;
  }
  /* Sized by its own width (the space between sidebar and queue), not the window's. */
  .hero {
    position: relative;
    overflow: hidden;
    padding: 56px 40px 28px;
    container-type: inline-size;
  }
  /* The cover, blown up and blurred into a soft coloured backdrop. Static, so it's
     drawn once and then only moved by the compositor while scrolling. */
  .backdrop {
    position: absolute;
    inset: -80px;
    width: calc(100% + 160px);
    height: calc(100% + 160px);
    object-fit: cover;
    filter: blur(72px) saturate(1.6);
    opacity: 0.55;
    transform: translateZ(0);
  }
  .backdrop.glow {
    background:
      radial-gradient(60% 80% at 20% 30%, var(--accent-glow), transparent 70%),
      radial-gradient(50% 70% at 80% 10%, color-mix(in srgb, var(--accent-2) 25%, transparent), transparent 70%);
    filter: none;
    opacity: 1;
  }
  .shade {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgb(19 19 23 / 0.1) 0%, rgb(19 19 23 / 0.6) 60%, var(--surface) 100%);
  }
  .content {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas:
      "cover text"
      "cover actions";
    align-items: end;
    column-gap: clamp(20px, 4cqw, 32px);
  }
  .content > .cover {
    grid-area: cover;
  }
  .content > .text {
    grid-area: text;
  }
  .content > .actions {
    grid-area: actions;
  }
  /* Narrower: Play and find get the full width, under the cover. */
  @container (max-width: 760px) {
    .content {
      grid-template-areas:
        "cover text"
        "actions actions";
    }
    .content > .actions {
      margin-top: 26px;
    }
  }
  .cover {
    width: clamp(132px, 30cqw, 232px);
    height: clamp(132px, 30cqw, 232px);
    flex: none;
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--surface-3);
    box-shadow:
      0 24px 60px rgb(0 0 0 / 0.6),
      0 0 0 1px rgb(255 255 255 / 0.06);
    display: grid;
    place-items: center;
  }
  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .cover.liked,
  .cover:not(:has(img)) {
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
  }
  .initial {
    font-size: clamp(56px, 12cqw, 96px);
    font-weight: 600;
    color: rgb(0 0 0 / 0.35);
  }
  .text {
    flex: 1;
    min-width: 0;
    padding-bottom: 4px;
  }
  .kind {
    color: var(--text);
    opacity: 0.8;
  }
  h1 {
    margin: 8px 0 10px;
    font-size: clamp(30px, 7.5cqw, 72px);
    font-weight: var(--weight-display);
    /* Room for descenders (g, y, p): the two-line clamp below cuts off anything
       outside the line box, so it can't be tighter than this. */
    line-height: 1.12;
    padding-bottom: 0.06em;
    letter-spacing: -0.025em;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
    font-size: 13.5px;
  }
  .byline {
    font-weight: 500;
  }
  .description {
    display: -webkit-box;
    max-width: 720px;
    margin-top: 10px;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    color: rgb(255 255 255 / 0.72);
    font-size: 13.5px;
    line-height: 1.5;
    text-align: left;
    white-space: pre-line;
    cursor: pointer;
  }
  .description.open {
    -webkit-line-clamp: unset;
    line-clamp: unset;
  }
  .description:hover {
    color: var(--text);
  }
  .add-description {
    margin-top: 10px;
    color: rgb(255 255 255 / 0.55);
    font-size: 13px;
  }
  .add-description:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .muted {
    color: var(--muted);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 22px;
  }
  .find {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    flex: 1;
    min-width: 0;
  }
  .hero-play {
    flex: none; /* never squeezed by the filter box beside it */
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
  .more {
    flex: none;
    width: 42px;
    height: 42px;
  }
  /* Too narrow for cover and title side by side: title under the cover. */
  @container (max-width: 440px) {
    .content {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas:
        "cover"
        "text"
        "actions";
    }
    .content > .text {
      margin-top: 20px;
    }
  }
  .filter {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 1 260px;
    min-width: 150px;
    height: 38px;
    padding: 0 8px 0 14px;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.07);
    border: 1px solid var(--line-strong);
    color: var(--muted);
    backdrop-filter: blur(12px);
    transition:
      border-color 0.15s,
      background 0.15s;
  }
  .filter:focus-within,
  .filter.active {
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
    background: rgb(0 0 0 / 0.25);
    color: var(--text);
  }
  .filter input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 13.5px;
  }
  .filter input::placeholder {
    color: var(--faint);
  }
  .clear {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    color: var(--muted);
  }
  .clear:hover {
    background: var(--surface-3);
    color: var(--text);
  }
  .filter-note {
    flex: none;
    font-size: 12.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .inline-error {
    position: absolute;
    bottom: calc(var(--player-clearance) - 8px);
    left: 40px;
    color: var(--accent);
    font-size: 12px;
  }
</style>
