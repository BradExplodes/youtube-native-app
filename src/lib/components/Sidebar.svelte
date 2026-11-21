<script lang="ts">
  // Collapsible: a slim icon rail, or the rail plus labels and your playlists.
  import { arrowNav } from "$lib/a11y";
  import Artwork from "./Artwork.svelte";
  import { Disc3, Heart, MicVocal, PanelLeftClose, PanelLeftOpen, Pin, Plus, Search } from "@lucide/svelte";
  import Equalizer from "./Equalizer.svelte";
  import { playlistMenu } from "$lib/menus";
  import { dialog } from "$lib/stores/dialog.svelte";
  import { library, sidebarPlaylists } from "$lib/stores/library.svelte";
  import { menu } from "$lib/stores/menu.svelte";
  import { nav, type Route } from "$lib/stores/nav.svelte";
  import { player } from "$lib/stores/player.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { BROWSE } from "$lib/ytm/api";

  const open = $derived(ui.sidebarOpen);
  // Pinned playlists first, then the rest (the same order "Add to playlist" uses).
  const playlists = $derived(sidebarPlaylists());
  const pinnedCount = $derived(playlists.filter((p) => ui.isPinned(p.browseId)).length);
  const newPlaylist = () => dialog.open({ kind: "playlist", title: "", description: "", privacy: "PRIVATE" });
  const playingFrom = (browseId: string) => player.context === browseId && !!player.playback;

  const main: { label: string; route: Route; icon: typeof Heart }[] = [
    { label: "Liked Songs", route: { kind: "list", browseId: BROWSE.likedSongs }, icon: Heart },
    { label: "Albums", route: { kind: "albums" }, icon: Disc3 },
    { label: "Artists", route: { kind: "artists" }, icon: MicVocal },
  ];
</script>

<nav class="sidebar" class:open aria-label="Library" use:arrowNav={{ selector: "button.item" }}>
  <div class="top">
    {#if open}
      <div class="brand">Your library</div>
    {/if}
    <button
      class="icon-btn toggle"
      aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
      title={open ? "Collapse" : "Expand"}
      onclick={() => ui.toggleSidebar()}
    >
      {#if open}<PanelLeftClose size={18} />{:else}<PanelLeftOpen size={18} />{/if}
    </button>
  </div>

  <div class="group">
    <button
      class="item"
      class:active={ui.searchOpen}
      title={open ? undefined : "Search (Ctrl+K)"}
      onclick={() => ui.openSearch()}
    >
      <span class="icon"><Search size={20} strokeWidth={2} /></span>
      {#if open}
        <span class="label truncate">Search</span>
        <span class="shortcut"><kbd>Ctrl</kbd><kbd>K</kbd></span>
      {/if}
    </button>
    {#each main as item (item.label)}
      {@const Icon = item.icon}
      <button
        class="item"
        class:active={nav.isAt(item.route)}
        title={open ? undefined : item.label}
        onclick={() => nav.go(item.route)}
      >
        <span class="icon"><Icon size={20} strokeWidth={2} /></span>
        {#if open}<span class="label truncate">{item.label}</span>{/if}
        {#if item.route.kind === "list" && playingFrom(item.route.browseId) && open}
          <Equalizer playing={player.playback?.playing} size={12} />
        {/if}
      </button>
    {/each}
  </div>

  <div class="divider"></div>
  {#if open}
    <div class="heading">
      <span class="eyebrow">Playlists</span>
      <button class="icon-btn add" aria-label="New playlist" title="New playlist" onclick={newPlaylist}>
        <Plus size={16} />
      </button>
    </div>
  {/if}

  <div class="playlists">
    {#if library.playlists.error}
      {#if open}
        <p class="note">
          Couldn't load playlists.
          <button class="link" onclick={() => library.playlists.load()}>Retry</button>
        </p>
      {/if}
    {:else if library.playlists.loading && !playlists.length && open}
      <p class="note">Loading…</p>
    {/if}
    {#each playlists as p, i (p.browseId)}
      {@const route = { kind: "list", browseId: p.browseId } as const}
      {@const isPinned = ui.isPinned(p.browseId)}
      <button
        class="item playlist"
        class:active={nav.isAt(route)}
        class:last-pinned={isPinned && i === pinnedCount - 1 && pinnedCount < playlists.length}
        onclick={() => nav.go(route)}
        oncontextmenu={(e) => menu.show(e, playlistMenu(p))}
        title={p.title}
      >
        <span class="thumb"><Artwork src={p.thumbnail} kind="playlist" lazy /></span>
        {#if open}
          <span class="meta">
            <span class="label truncate">{p.title}</span>
            <span class="sub truncate">
              {#if isPinned}<Pin size={11} class="pin" fill="currentColor" />{/if}{p.subtitle}
            </span>
          </span>
          {#if playingFrom(p.browseId)}<Equalizer playing={player.playback?.playing} size={12} />{/if}
        {/if}
      </button>
    {/each}
  </div>
</nav>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    width: var(--rail);
    min-height: 0;
    padding: 8px 12px 0;
    transition: width 0.22s var(--ease);
  }
  .sidebar.open {
    width: var(--sidebar);
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 40px;
    margin-bottom: 8px;
    padding-left: 2px;
  }
  .sidebar:not(.open) .top {
    justify-content: center;
    padding: 0;
  }
  .brand {
    padding-left: 10px;
    font-weight: 500;
    font-size: 15px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 44px;
    padding: 0 12px;
    border-radius: var(--radius);
    text-align: left;
    color: var(--muted);
    font-weight: 400;
    transition:
      background 0.15s,
      color 0.15s;
  }
  .sidebar:not(.open) .item {
    justify-content: center;
    padding: 0;
  }
  .item:hover {
    color: var(--text);
    background: var(--surface);
  }
  .item.active {
    color: var(--text);
    background: var(--surface-2);
  }
  .item.active .icon {
    color: var(--accent);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 24px;
    flex: none;
  }
  .label {
    flex: 1;
    min-width: 0;
  }
  .shortcut {
    display: flex;
    gap: 3px;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .item:hover .shortcut {
    opacity: 1;
  }
  .shortcut kbd {
    min-width: 0;
    padding: 0 5px;
    font-size: 10.5px;
    color: var(--muted);
  }
  .divider {
    height: 1px;
    margin: 12px 8px;
    background: var(--line);
  }
  .heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px 6px 12px;
  }
  .add {
    width: 28px;
    height: 28px;
  }
  .sub :global(.pin) {
    display: inline;
    margin-right: 5px;
    vertical-align: -1px;
    color: var(--accent);
  }
  /* A thin line between the pinned playlists and the rest. */
  .last-pinned {
    margin-bottom: 9px;
  }
  .last-pinned::after {
    content: "";
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: -5px;
    height: 1px;
    background: var(--line);
  }
  .playlists {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0 -6px;
    padding: 0 6px var(--player-clearance);
  }
  /* The slim rail has no room for a scrollbar (the wheel still scrolls). */
  .sidebar:not(.open) .playlists {
    scrollbar-width: none;
  }
  .sidebar:not(.open) .playlists::-webkit-scrollbar {
    display: none;
  }
  .playlist {
    min-height: 56px;
    padding: 0 8px;
  }
  .sidebar:not(.open) .playlist {
    padding: 0;
  }
  .thumb {
    position: relative;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-2);
    flex: none;
  }
  .playlist.active .thumb {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .meta .label {
    font-size: 13.5px;
  }
  .sub {
    font-size: 12px;
    font-weight: 400;
    color: var(--faint);
  }
  .note {
    margin: 4px 12px;
    font-size: 12px;
    color: var(--muted);
  }
  .link {
    color: var(--accent);
  }
</style>
