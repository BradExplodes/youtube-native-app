<script lang="ts">
  import { onMount } from "svelte";
  import LoginPrompt from "$lib/components/LoginPrompt.svelte";
  import NowPlayingBar from "$lib/components/NowPlayingBar.svelte";
  import { playerCmd } from "$lib/ipc";
  import { player } from "$lib/stores/player.svelte";

  onMount(() => {
    const markHidden = () =>
      document.documentElement.classList.toggle("hidden", document.visibilityState !== "visible");
    document.addEventListener("visibilitychange", markHidden);
    const stop = player.start();
    return () => {
      document.removeEventListener("visibilitychange", markHidden);
      stop.then((fn) => fn());
    };
  });
</script>

<div class="app">
  <nav class="sidebar">
    <div class="brand">YouTube Music Native</div>
    <p class="soon">Your library arrives in milestone 3.</p>
  </nav>

  <main class="content">
    {#if player.loggedIn === null}
      <p class="muted">Connecting to YouTube Music…</p>
    {:else if player.loggedIn}
      <h1>Ready</h1>
      <p class="muted">Signed in. Test that hidden background playback works:</p>
      <button class="primary" onclick={() => playerCmd({ action: "load", playlistId: "LM" })}>
        Play my Liked Songs
      </button>
    {/if}
  </main>

  <NowPlayingBar />
</div>

{#if player.loggedIn === false}
  <LoginPrompt />
{/if}

<style>
  .app {
    display: grid;
    grid-template-columns: 240px 1fr;
    grid-template-rows: 1fr auto;
    height: 100vh;
  }
  .app > :global(footer) {
    grid-column: 1 / -1;
  }
  .sidebar {
    background: var(--panel);
    border-right: 1px solid var(--line);
    padding: 20px 16px;
  }
  .brand {
    font-weight: 700;
    letter-spacing: 0.2px;
  }
  .soon,
  .muted {
    color: var(--muted);
  }
  .soon {
    font-size: 12px;
  }
  .content {
    padding: 32px;
    overflow: auto;
  }
  h1 {
    margin: 0 0 8px;
    font-size: 28px;
  }
  .primary {
    margin-top: 12px;
    padding: 10px 24px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 600;
  }
</style>
