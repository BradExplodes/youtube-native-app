<script lang="ts">
  // Search YouTube Music in a popup: everything at once ("All"), or one kind with more as
  // you scroll. Opening a result's page closes it; playing a song leaves it open.
  import { Search, X } from "@lucide/svelte";
  import Artwork from "./Artwork.svelte";
  import Modal from "./Modal.svelte";
  import SongRows from "./SongRows.svelte";
  import TileCard from "./TileCard.svelte";
  import TrackList from "./TrackList.svelte";
  import { playlistMenu, songMenu } from "$lib/menus";
  import { menu } from "$lib/stores/menu.svelte";
  import { openAlbum, openTile, playSingle } from "$lib/open";
  import { search } from "$lib/stores/search.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import type { SearchFilter, Tile, Track } from "$lib/ytm/types";

  const FILTERS: { id: "all" | SearchFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "songs", label: "Songs" },
    { id: "videos", label: "Videos" },
    { id: "albums", label: "Albums" },
    { id: "artists", label: "Artists" },
    { id: "playlists", label: "Playlists" },
  ];

  let input = $state<HTMLInputElement>();

  // Search as you type, once typing pauses.
  $effect(() => {
    const text = search.input;
    const timer = setTimeout(() => search.run(text), 350);
    return () => clearTimeout(timer);
  });

  // Focus the box when the popup opens, and on Ctrl+K (see +page.svelte).
  $effect(() => {
    void ui.searchFocus;
    input?.focus();
    input?.select();
  });

  const r = $derived(search.results);
  const filter = $derived(search.filter);
  const only = $derived(filter !== "all" && search.query ? search.only(filter) : null);
  $effect(() => {
    only?.load();
  });

  const videoTile = (t: Track): Tile => ({
    kind: "video",
    title: t.title,
    subtitle: t.artists.map((a) => a.name).join(", "),
    thumbnail: `https://i.ytimg.com/vi/${t.videoId}/mqdefault.jpg`,
    videoId: t.videoId,
  });

  const playFrom = (tracks: Track[]) => (i: number) => {
    const t = tracks[i];
    if (t) playSingle(t.videoId);
  };

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter") search.run();
  }

  // Tiles (albums, artists, playlists) load more as you near the bottom.
  function onScroll(e: Event) {
    const el = e.currentTarget as HTMLElement;
    if (only && el.scrollTop + el.clientHeight > el.scrollHeight - 600) only.more();
  }
</script>

{#snippet section(title: string, more: SearchFilter | null)}
  <div class="section-head">
    <h2>{title}</h2>
    {#if more}<button class="show-all" onclick={() => (search.filter = more)}>Show all</button>{/if}
  </div>
{/snippet}

<Modal label="Search" width={1040} height={780} onclose={() => ui.closeSearch()}>
  <header class="head">
    <div class="bar">
      <label class="box">
        <Search size={20} />
        <input
          bind:this={input}
          bind:value={search.input}
          onkeydown={onKey}
          placeholder="Songs, artists, albums, playlists…"
          spellcheck="false"
          autocomplete="off"
        />
        {#if search.input}
          <button class="clear" aria-label="Clear" onclick={() => ((search.input = ""), input?.focus())}>
            <X size={16} />
          </button>
        {/if}
      </label>
      <button class="modal-pill" onclick={() => ui.closeSearch()}>Close</button>
    </div>
    {#if search.query}
      <div class="chips" role="tablist">
        {#each FILTERS as f (f.id)}
          <button role="tab" class="chip" class:on={filter === f.id} aria-selected={filter === f.id} onclick={() => (search.filter = f.id)}>
            {f.label}
          </button>
        {/each}
      </div>
    {/if}
  </header>

  <div class="body">
    {#if only && (filter === "songs" || filter === "videos")}
      <!-- Long lists of songs or videos: the virtualized track list, more as you scroll. -->
      <TrackList
        tracks={only.tracks}
        showAlbum={filter === "songs"}
        play={playFrom(only.tracks)}
        openAlbum={openAlbum}
        nearEnd={() => only.more()}
        scrollKey="search:{search.query}:{filter}"
        menuFor={(t, i) => songMenu(t, { play: () => playFrom(only.tracks)(i) })}
      >
        {#snippet header()}
          {#if only.error}<p class="note">Couldn't search: {only.error}</p>{/if}
          {#if only.loaded && !only.tracks.length}<p class="note">No {filter} found.</p>{/if}
          <div class="list-gap"></div>
        {/snippet}
      </TrackList>
    {:else}
      <div class="scroll" onscroll={onScroll}>
        {#if !search.query}
          <div class="intro">
            <span class="badge"><Search size={26} /></span>
            <h2>Search YouTube Music</h2>
            <p>Songs, artists, albums and playlists, as you type.</p>
            <div class="hints">
              <span><kbd>Enter</kbd> search now</span>
              <span><kbd>Esc</kbd> close</span>
              <span><kbd>Ctrl</kbd> <kbd>K</kbd> open from anywhere</span>
            </div>
          </div>
        {:else if only}
          {#if only.error}
            <p class="note">Couldn't search: {only.error}</p>
          {:else if only.loading && !only.tiles.length}
            <p class="note">Searching…</p>
          {:else if only.loaded && !only.tiles.length}
            <p class="note">No {filter} found.</p>
          {/if}
          <div class="grid">
            {#each only.tiles as t, i (t.browseId ?? t.videoId ?? i)}<TileCard tile={t} />{/each}
          </div>
        {:else if search.error && !r}
          <div class="note">
            <p>Couldn't search: {search.error}</p>
            <button class="btn-primary" onclick={() => ((search.query = ""), search.run())}>Try again</button>
          </div>
        {:else if search.loading && !r}
          <p class="note">Searching…</p>
        {:else if r}
          <div class="results" class:stale={search.loading}>
            {#if r.top}
              {@const top = r.top}
              <section class="top-row">
                <div>
                  {@render section("Top result", null)}
                  <button
                    class="top {top.tile.kind}"
                    onclick={() => openTile(top.tile)}
                    oncontextmenu={(e) => {
                      const t = top.tile;
                      if (t.videoId) menu.show(e, songMenu({ videoId: t.videoId, title: t.title }));
                      else if (t.kind === "playlist" && t.browseId?.startsWith("VL"))
                        menu.show(e, playlistMenu({ browseId: t.browseId, title: t.title }));
                    }}
                  >
                    <span class="top-art"><Artwork src={top.tile.thumbnail} kind={top.tile.kind} /></span>
                    <span class="top-title">{top.tile.title}</span>
                    <span class="top-sub truncate">{top.tile.subtitle}</span>
                  </button>
                </div>
                {#if top.tracks.length || r.songs.length}
                  {@const songs = top.tracks.length ? top.tracks : r.songs.slice(0, 4)}
                  <div class="top-songs">
                    {@render section("Songs", "songs")}
                    <SongRows tracks={songs} play={playFrom(songs)} />
                  </div>
                {/if}
              </section>
            {/if}

            {#if r.songs.length && (r.top?.tracks.length || !r.top)}
              <section>
                {@render section(r.top ? "More songs" : "Songs", "songs")}
                <SongRows tracks={r.songs.slice(0, 5)} play={playFrom(r.songs)} />
              </section>
            {/if}

            {#if r.artists.length}
              <section>
                {@render section("Artists", "artists")}
                <div class="grid">{#each r.artists as t (t.browseId)}<TileCard tile={t} />{/each}</div>
              </section>
            {/if}
            {#if r.albums.length}
              <section>
                {@render section("Albums", "albums")}
                <div class="grid">{#each r.albums as t (t.browseId)}<TileCard tile={t} />{/each}</div>
              </section>
            {/if}
            {#if r.playlists.length}
              <section>
                {@render section("Playlists", "playlists")}
                <div class="grid">{#each r.playlists as t (t.browseId)}<TileCard tile={t} />{/each}</div>
              </section>
            {/if}
            {#if r.videos.length}
              <section>
                {@render section("Videos", "videos")}
                <div class="grid videos">{#each r.videos as t (t.videoId)}<TileCard tile={videoTile(t)} />{/each}</div>
              </section>
            {/if}
            {#if !r.top && !r.songs.length && !r.artists.length && !r.albums.length && !r.playlists.length && !r.videos.length}
              <p class="note">Nothing found for “{search.query}”.</p>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</Modal>

<style>
  .head {
    flex: none;
    padding: 18px 18px 14px 22px;
    border-bottom: 1px solid var(--line);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .box {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
    height: 48px;
    padding: 0 8px 0 16px;
    border-radius: 14px;
    background: rgb(255 255 255 / 0.04);
    border: 1px solid var(--line-strong);
    color: var(--muted);
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }
  .box:focus-within {
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
    box-shadow: 0 0 0 4px var(--accent-soft);
    color: var(--text);
  }
  .box input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 16px;
    font-weight: 500;
  }
  .box input::placeholder {
    color: var(--faint);
    font-weight: 400;
  }
  .clear {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    color: var(--muted);
  }
  .clear:hover {
    background: var(--surface-3);
    color: var(--text);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 14px;
  }
  .chip {
    height: 30px;
    padding: 0 14px;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.04);
    border: 1px solid var(--line-strong);
    color: var(--muted);
    font-size: 12.5px;
    font-weight: 500;
    transition:
      background 0.15s,
      color 0.15s;
  }
  .chip:hover {
    background: var(--surface-3);
    color: var(--text);
  }
  .chip.on {
    background: var(--text);
    border-color: var(--text);
    color: var(--bg);
  }
  .body {
    flex: 1;
    min-height: 0;
  }
  .scroll {
    height: 100%;
    overflow-y: auto;
    padding-bottom: 24px;
  }
  .list-gap {
    height: 12px;
  }
  .intro {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 6px;
    min-height: 100%;
    padding: 40px 24px 64px;
    text-align: center;
    color: var(--muted);
  }
  .intro h2 {
    margin: 12px 0 0;
    font-size: 20px;
  }
  .intro p {
    margin: 0;
  }
  .hints {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px 20px;
    margin-top: 22px;
    font-size: 12.5px;
    color: var(--faint);
  }
  .badge {
    display: grid;
    place-items: center;
    width: 60px;
    height: 60px;
    border-radius: 18px;
    color: var(--accent);
    background: var(--accent-soft);
    border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
  }
  .note {
    margin: 24px 28px;
    color: var(--muted);
  }
  .results {
    padding: 22px 28px 0;
    transition: opacity 0.15s;
  }
  /* A newer search is on its way. */
  .results.stale {
    opacity: 0.6;
  }
  section {
    margin-bottom: 32px;
  }
  .section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: var(--weight-display);
    letter-spacing: -0.01em;
  }
  .show-all {
    color: var(--muted);
    font-size: 12.5px;
    font-weight: 500;
  }
  .show-all:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .top-row {
    display: grid;
    grid-template-columns: minmax(240px, 2fr) minmax(0, 3fr);
    gap: 24px;
  }
  .top {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    width: 100%;
    padding: 20px;
    border-radius: 16px;
    background: rgb(255 255 255 / 0.03);
    border: 1px solid var(--line-strong);
    text-align: left;
    transition: background 0.15s;
  }
  .top:hover {
    background: rgb(255 255 255 / 0.06);
  }
  .top-art {
    position: relative;
    width: 96px;
    height: 96px;
    margin-bottom: 12px;
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--surface-3);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.45);
  }
  .top.artist .top-art {
    border-radius: 50%;
  }
  .top-title {
    max-width: 100%;
    font-size: 24px;
    font-weight: var(--weight-display);
    letter-spacing: -0.02em;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }
  .top-sub {
    max-width: 100%;
    color: var(--muted);
    font-size: 13px;
  }
  .top-songs {
    min-width: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(156px, 1fr));
    gap: 8px;
    margin: 0 -12px;
  }
  .scroll > .grid {
    margin: 16px 16px 0;
  }
  .grid.videos {
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  }
  @media (max-width: 900px) {
    .top-row {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
