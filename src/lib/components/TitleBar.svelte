<script lang="ts">
  // The window's title bar: open pages as tabs, plus minimize / maximize / close.
  // Empty space drags the window; double-clicking it maximizes, like a normal title bar.
  import { arrowNav } from "$lib/a11y";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { onMount } from "svelte";
  import { Copy, Disc3, Heart, Library, ListMusic, MicVocal, Minus, Settings, Square, X } from "@lucide/svelte";
  import Equalizer from "./Equalizer.svelte";
  import { library, titles } from "$lib/stores/library.svelte";
  import { nav, type Route, type Tab } from "$lib/stores/nav.svelte";
  import { player } from "$lib/stores/player.svelte";
  import { BROWSE } from "$lib/ytm/api";

  const win = getCurrentWindow();
  let maximized = $state(false);

  onMount(() => {
    win.isMaximized().then((m) => (maximized = !!m));
    const off = win.onResized(async () => (maximized = !!(await win.isMaximized())));
    return () => {
      off.then((fn) => fn());
    };
  });

  function kindOf(route: Route): { label: string; icon: typeof Heart } {
    if (route.kind === "settings") return { label: "App", icon: Settings };
    if (route.kind === "albums") return { label: "Library", icon: Disc3 };
    if (route.kind === "artists") return { label: "Library", icon: Library };
    if (route.kind === "artist") return { label: "Artist", icon: MicVocal };
    const id = route.browseId;
    if (id === BROWSE.likedSongs) return { label: "Collection", icon: Heart };
    if (id.startsWith("MPRE")) return { label: "Album", icon: Disc3 };
    if (id.startsWith("MPLA")) return { label: "Artist", icon: MicVocal };
    return { label: "Playlist", icon: ListMusic };
  }

  function titleOf(route: Route): string {
    if (route.kind === "settings") return "Settings";
    if (route.kind === "albums") return "Albums";
    if (route.kind === "artists") return "Artists";
    if (route.kind === "artist") return titles[route.browseId] ?? "Loading…";
    if (route.browseId === BROWSE.likedSongs) return "Liked Songs";
    const loaded = titles[route.browseId];
    if (loaded) return loaded;
    return (
      library.playlists.items.find((p) => p.browseId === route.browseId)?.title ??
      library.artists.items.find((a) => a.browseId === route.browseId)?.name ??
      "Loading…"
    );
  }

  const isPlayingFrom = (tab: Tab) =>
    "browseId" in tab.route && tab.route.browseId === player.context && !!player.playback;

  function onTabMouseDown(e: MouseEvent, tab: Tab) {
    // Middle-click closes a tab, as in a browser.
    if (e.button === 1) {
      e.preventDefault();
      nav.close(tab.id);
    }
  }
</script>

<header class="titlebar" data-tauri-drag-region>
  <div class="brand" data-tauri-drag-region>
    <img class="mark" src="/logo.png" alt="" width="32" height="32" draggable="false" />
  </div>

  <div class="tabs" data-tauri-drag-region role="tablist" aria-label="Open pages" use:arrowNav={{ selector: ".tab-main", orientation: "horizontal" }}>
    {#each nav.tabs as tab (tab.id)}
      {@const active = tab.id === nav.activeId}
      {@const kind = kindOf(tab.route)}
      {@const Icon = kind.icon}
      {@const live = isPlayingFrom(tab)}
      <div class="tab" class:active role="presentation" onmousedown={(e) => onTabMouseDown(e, tab)}>
        <button
          class="tab-main"
          role="tab"
          aria-selected={active}
          tabindex={active ? 0 : -1}
          title="{titleOf(tab.route)} (Delete closes the tab)"
          onclick={() => nav.activate(tab.id)}
          onkeydown={(e) => e.key === "Delete" && (e.preventDefault(), nav.close(tab.id))}
        >
          <span class="icon"><Icon size={22} strokeWidth={1.6} /></span>
          <span class="text">
            <span class="kind">{kind.label}</span>
            <span class="title truncate">{titleOf(tab.route)}</span>
          </span>
        </button>
        <span class="end">
          {#if live}<span class="live"><Equalizer playing={player.playback?.playing} size={18} /></span>{/if}
          <button class="close" aria-label="Close tab" tabindex="-1" onclick={() => nav.close(tab.id)}>
            <X size={15} strokeWidth={2.25} />
          </button>
        </span>
      </div>
    {/each}
  </div>

  <div class="app-actions">
    <button
      class="icon-btn"
      class:on={nav.route.kind === "settings"}
      aria-label="Settings"
      title="Settings (Ctrl+,)"
      onclick={() => nav.go({ kind: "settings" })}
    >
      <Settings size={19} />
    </button>
  </div>

  <div class="window-controls">
    <button aria-label="Minimize" onclick={() => win.minimize()}><Minus size={16} /></button>
    <button aria-label={maximized ? "Restore" : "Maximize"} onclick={() => win.toggleMaximize()}>
      {#if maximized}<Copy size={13} />{:else}<Square size={13} />{/if}
    </button>
    <button class="quit" aria-label="Close" onclick={() => win.close()}><X size={17} /></button>
  </div>
</header>

<style>
  .titlebar {
    display: flex;
    align-items: stretch;
    height: var(--titlebar);
    background: var(--bg);
  }
  /* Lines up with the sidebar's icon rail below it. */
  .brand {
    width: var(--rail);
    flex: none;
    display: grid;
    place-items: center;
  }
  .mark {
    width: 32px;
    height: 32px;
    pointer-events: none; /* let the window drag from here */
    filter: drop-shadow(0 0 10px var(--accent-glow));
  }
  .tabs {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding-right: 16px;
    overflow: hidden;
  }
  .tab {
    position: relative;
    flex: 0 1 270px;
    min-width: 150px;
    height: 54px;
    display: flex;
    align-items: center;
    border-radius: 14px;
    background: var(--surface-2);
    border: 1px solid var(--line-strong);
    color: var(--muted);
    transition:
      background 0.15s,
      border-color 0.15s,
      color 0.15s;
  }
  .tab:hover {
    background: var(--surface-3);
    color: var(--text);
  }
  .tab.active {
    background: color-mix(in srgb, var(--accent) 13%, var(--surface-2));
    border-color: color-mix(in srgb, var(--accent) 28%, transparent);
    color: var(--text);
  }
  /* The thick accent bar along the bottom of the current tab. */
  .tab.active::after {
    content: "";
    position: absolute;
    left: 14px;
    right: 14px;
    bottom: -1px;
    height: 4px;
    border-radius: 4px;
    background: var(--accent);
    box-shadow: 0 0 14px var(--accent-glow);
  }
  .tab-main {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 0 6px 0 16px;
    text-align: left;
  }
  .icon {
    display: grid;
    place-items: center;
    flex: none;
    color: var(--muted);
  }
  .tab.active .icon {
    color: var(--text);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    line-height: 1.15;
  }
  .kind {
    font-size: 10.5px;
    font-weight: 400;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .tab.active .kind {
    color: var(--muted);
  }
  .title {
    font-size: 14px;
    font-weight: 400;
    color: var(--text);
  }
  .tab:not(.active) .title {
    color: var(--muted);
  }
  .tab:not(.active):hover .title {
    color: var(--text);
  }
  /* Right edge: sound bars while playing from this tab, the close button on hover. */
  .end {
    position: relative;
    flex: none;
    width: 32px;
    height: 32px;
    margin-right: 10px;
    display: grid;
    place-items: center;
  }
  .live {
    display: grid;
    place-items: center;
  }
  .close {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    border-radius: 8px;
    color: var(--faint);
    opacity: 0;
    transition: opacity 0.12s;
  }
  .tab:hover .close,
  .close:focus-visible {
    opacity: 1;
    background: var(--surface-3);
  }
  .tab.active:hover .close {
    background: color-mix(in srgb, var(--accent) 18%, var(--surface-2));
  }
  .tab:hover .live {
    visibility: hidden;
  }
  .close:hover {
    color: var(--text);
  }
  .app-actions {
    display: flex;
    align-items: center;
    padding-right: 8px;
  }
  .window-controls {
    display: flex;
    align-self: flex-start;
    height: 36px;
  }
  .window-controls button {
    width: 46px;
    display: grid;
    place-items: center;
    color: var(--muted);
  }
  .window-controls button:hover {
    color: var(--text);
    background: rgb(255 255 255 / 0.08);
  }
  .window-controls .quit:hover {
    background: #c42b1c;
    color: #fff;
  }
</style>
