<script lang="ts">
  import { arrowNav } from "$lib/a11y";
  import Artwork from "./Artwork.svelte";
  import { MicVocal } from "@lucide/svelte";
  import { library } from "$lib/stores/library.svelte";
  import { nav } from "$lib/stores/nav.svelte";
  import { sized } from "$lib/ytm/thumbs";

  const artists = library.artists;
  $effect(() => {
    artists.load();
  });
</script>

<div class="view">
  <header>
    <div class="eyebrow">Library</div>
    <h1>Artists</h1>
  </header>

  {#if artists.error}
    <div class="empty">
      <p>Couldn't load your artists: {artists.error}</p>
      <button class="btn-primary" onclick={() => artists.load()}>Try again</button>
    </div>
  {:else if artists.loading && !artists.items.length}
    <span class="eyebrow">Loading…</span>
  {:else if artists.loaded && !artists.items.length}
    <div class="empty">
      <span class="badge"><MicVocal size={28} /></span>
      <h2>No artists yet</h2>
      <p>Artists of the songs in your library show up here.</p>
    </div>
  {:else}
    <div class="grid" use:arrowNav={{ selector: ".card", orientation: "grid" }}>
      {#each artists.items as a (a.browseId)}
        <button class="card" onclick={() => nav.go({ kind: "list", browseId: a.browseId })}>
          <span class="avatar">
            <Artwork src={sized(a.thumbnail, 320)} fallback={a.thumbnail} kind="artist" lazy />
          </span>
          <span class="name truncate">{a.name}</span>
          <span class="sub truncate">{a.subtitle}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .view {
    height: 100%;
    overflow-y: auto;
    padding: 48px 40px var(--player-clearance);
  }
  header {
    margin-bottom: 28px;
  }
  h1 {
    margin: 8px 0 0;
    font-size: 44px;
    font-weight: var(--weight-display);
    letter-spacing: -0.02em;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 20px;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 16px 12px;
    border-radius: var(--radius-lg);
    min-width: 0;
    text-align: center;
    transition: background 0.15s;
  }
  .card:hover {
    background: var(--surface-2);
  }
  .avatar {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    margin-bottom: 12px;
    border-radius: 50%;
    overflow: hidden;
    display: grid;
    place-items: center;
    background: linear-gradient(135deg, var(--surface-3), var(--surface-2));
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.4);
    transition: transform 0.2s var(--ease);
  }
  .card:hover .avatar {
    transform: translateY(-3px);
  }
  .name {
    max-width: 100%;
    font-weight: 500;
  }
  .sub {
    max-width: 100%;
    font-size: 12.5px;
    color: var(--muted);
  }
  .empty {
    display: grid;
    justify-items: start;
    gap: 6px;
    max-width: 420px;
    color: var(--muted);
  }
  .empty h2 {
    margin: 10px 0 0;
    color: var(--text);
    font-size: 20px;
  }
  .empty p {
    margin: 0 0 8px;
  }
  .badge {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    border-radius: 20px;
    color: var(--accent);
    background: var(--accent-soft);
  }
</style>
