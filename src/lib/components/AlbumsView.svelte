<script lang="ts">
  import { arrowNav } from "$lib/a11y";
  import Artwork from "./Artwork.svelte";
  import { Disc3 } from "@lucide/svelte";
  import { library } from "$lib/stores/library.svelte";
  import { nav } from "$lib/stores/nav.svelte";
  import { sized } from "$lib/ytm/thumbs";

  const albums = library.albums;
  $effect(() => {
    albums.load();
  });
</script>

<div class="view">
  <header>
    <div class="eyebrow">Library</div>
    <h1>Albums</h1>
  </header>

  {#if albums.error}
    <div class="empty">
      <p>Couldn't load your albums: {albums.error}</p>
      <button class="btn-primary" onclick={() => albums.load()}>Try again</button>
    </div>
  {:else if albums.loading && !albums.items.length}
    <span class="eyebrow">Loading…</span>
  {:else if albums.loaded && !albums.items.length}
    <div class="empty">
      <span class="badge"><Disc3 size={28} /></span>
      <h2>No saved albums yet</h2>
      <p>Albums you save in YouTube Music show up here.</p>
    </div>
  {:else}
    <div class="grid" use:arrowNav={{ selector: ".card", orientation: "grid" }}>
      {#each albums.items as a (a.browseId)}
        <button class="card" onclick={() => nav.go({ kind: "list", browseId: a.browseId })}>
          <span class="art">
            <Artwork src={sized(a.thumbnail, 400)} fallback={a.thumbnail} kind="album" lazy />
          </span>
          <span class="title truncate">{a.title}</span>
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
    grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
    gap: 24px;
  }
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
    aspect-ratio: 1;
    margin-bottom: 10px;
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--surface-3);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.4);
    transition: transform 0.2s var(--ease);
  }
  .card:hover .art {
    transform: translateY(-3px);
  }
  .title {
    font-weight: 500;
  }
  .sub {
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
