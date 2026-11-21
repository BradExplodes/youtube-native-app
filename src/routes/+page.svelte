<script lang="ts">
  import { onMount } from "svelte";
  import AlbumsView from "$lib/components/AlbumsView.svelte";
  import ArtistView from "$lib/components/ArtistView.svelte";
  import ArtistsView from "$lib/components/ArtistsView.svelte";
  import ContextMenu from "$lib/components/ContextMenu.svelte";
  import Dialogs from "$lib/components/Dialogs.svelte";
  import LoginPrompt from "$lib/components/LoginPrompt.svelte";
  import LyricsPanel from "$lib/components/LyricsPanel.svelte";
  import NowPlayingBar from "$lib/components/NowPlayingBar.svelte";
  import QueuePanel from "$lib/components/QueuePanel.svelte";
  import SearchModal from "$lib/components/SearchModal.svelte";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import Toasts from "$lib/components/Toasts.svelte";
  import VersionsModal from "$lib/components/VersionsModal.svelte";
  import TrackListView from "$lib/components/TrackListView.svelte";
  import ShortcutsSheet from "$lib/components/ShortcutsSheet.svelte";
  import SettingsView from "$lib/components/SettingsView.svelte";
  import { devLog, logError } from "$lib/ipc";
  import { handleShortcut } from "$lib/shortcuts";
  import { settings } from "$lib/stores/settings.svelte";
  import { library } from "$lib/stores/library.svelte";
  import { nav } from "$lib/stores/nav.svelte";
  import { player } from "$lib/stores/player.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { updates } from "$lib/stores/updates.svelte";
  import { captureFixtures } from "$lib/ytm/capture";

  onMount(() => {
    const markHidden = () =>
      document.documentElement.classList.toggle("hidden", document.visibilityState !== "visible");
    markHidden();
    document.addEventListener("visibilitychange", markHidden);
    // Mouse back button goes to the previous tab, like a browser.
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) nav.back();
    };
    window.addEventListener("mouseup", onMouse);
    // Keyboard shortcuts (see $lib/shortcuts.ts). Bubbling phase: lists, menus and
    // popups handle their own keys first.
    window.addEventListener("keydown", handleShortcut);
    settings.load().then(() => updates.atStartup());
    // Our own right-click menus replace the browser's (Back, Reload, Inspect…), except in
    // text boxes, where cut/copy/paste is useful. Shift+right-click keeps it in development.
    const onContextMenu = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea")) return;
      if (import.meta.env.DEV && e.shiftKey) return;
      e.preventDefault();
    };
    window.addEventListener("contextmenu", onContextMenu);
    // UI errors go to the log file; in development also a heartbeat (so a frozen UI shows).
    const onError = (e: ErrorEvent) => logError(`${e.message} at ${e.filename}:${e.lineno}`);
    const onRejection = (e: PromiseRejectionEvent) => logError(`unhandled rejection: ${e.reason}`);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    let beats = 0;
    const heartbeat = import.meta.env.DEV ? setInterval(() => devLog(`alive ${++beats * 10}s`), 10_000) : 0;
    const stop = player.start();
    return () => {
      document.removeEventListener("visibilitychange", markHidden);
      window.removeEventListener("mouseup", onMouse);
      window.removeEventListener("keydown", handleShortcut);
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      clearInterval(heartbeat);
      stop.then((fn) => fn());
    };
  });

  $effect(() => {
    if (!player.loggedIn) return;
    library.playlists.load();
    // Development only, opt-in: refresh the saved sample responses used by the parser tests.
    if (import.meta.env.VITE_CAPTURE_FIXTURES === "1") captureFixtures();
  });

  const showPanel = $derived((ui.queueOpen || ui.lyricsOpen) && !!player.loggedIn);
</script>

<div class="shell" class:with-queue={showPanel}>
  <TitleBar />
  <Sidebar />

  <main class="stage">
    {#if player.loggedIn === null}
      <div class="connecting">
        <span class="eyebrow">Connecting to YouTube Music…</span>
      </div>
    {:else if player.loggedIn}
      {#key nav.activeId}
        {#if nav.route.kind === "list"}
          <TrackListView browseId={nav.route.browseId} />
        {:else if nav.route.kind === "artist"}
          <ArtistView browseId={nav.route.browseId} />
        {:else if nav.route.kind === "albums"}
          <AlbumsView />
        {:else if nav.route.kind === "settings"}
          <SettingsView />
        {:else}
          <ArtistsView />
        {/if}
      {/key}
    {/if}
  </main>

  {#if showPanel}
    {#if ui.lyricsOpen}<LyricsPanel />{:else}<QueuePanel />{/if}
  {/if}

  <NowPlayingBar />
</div>

{#if ui.searchOpen && player.loggedIn}
  <SearchModal />
{/if}

<VersionsModal />
<ShortcutsSheet />
<Dialogs />
<ContextMenu />
<Toasts />

{#if player.loggedIn === false}
  <LoginPrompt />
{/if}

<style>
  .shell {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: var(--titlebar) minmax(0, 1fr);
    height: 100vh;
    background: var(--bg);
  }
  .shell.with-queue {
    grid-template-columns: auto minmax(0, 1fr) clamp(280px, 26vw, 360px);
  }
  .shell > :global(.titlebar) {
    grid-column: 1 / -1;
  }
  .stage {
    position: relative;
    min-height: 0;
    overflow: hidden;
    margin: 0 12px 0 0;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--surface);
    border: 1px solid var(--line);
    border-bottom: 0;
  }
  .with-queue .stage {
    margin-right: 0;
  }
  .connecting {
    height: 100%;
    display: grid;
    place-items: center;
  }
</style>
