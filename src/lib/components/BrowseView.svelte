<script lang="ts">
  // A page of shelves opened from Home: New releases, Charts, Moods & genres, one
  // genre's playlists, or a shelf's "See all".
  import { tick, untrack } from "svelte";
  import Shelves from "./Shelves.svelte";
  import { library } from "$lib/stores/library.svelte";
  import { nav, notFound, type Route } from "$lib/stores/nav.svelte";
  import { EXPLORE_LINKS } from "$lib/ytm/shelves";

  let { browseId, params }: { browseId: string; params?: string } = $props();

  const page = $derived(library.shelfPage(params ? { browseId, params } : { browseId }));
  const route = $derived<Route>(params ? { kind: "browse", browseId, params } : { kind: "browse", browseId });
  const title = $derived(page.title || EXPLORE_LINKS.find((l) => l.browseId === browseId)?.title || "");

  $effect(() => {
    const p = page;
    untrack(() => p.load());
  });
  // A tab reopened from last time for a page that's gone becomes Home.
  $effect(() => {
    if (page.loaded && page.shelves.length) nav.loaded(route);
    else if (page.loaded || (page.error && notFound(page.error))) nav.missing(route);
  });

  let scroller = $state<HTMLDivElement>();
  function nearEnd() {
    const el = scroller;
    if (el && el.scrollTop + el.clientHeight > el.scrollHeight - 900 && page.hasMore && !page.error) page.more();
  }
  $effect(() => {
    void page.shelves;
    void page.loading;
    tick().then(nearEnd);
  });
</script>

<div class="view" bind:this={scroller} onscroll={nearEnd}>
  {#if page.error && !page.shelves.length}
    <div class="state">
      <p>Couldn't load this page: {page.error}</p>
      <button class="btn-primary" onclick={() => page.load()}>Try again</button>
    </div>
  {:else if !page.loaded && !page.shelves.length}
    <div class="state"><span class="eyebrow">Loading…</span></div>
  {:else}
    <div class="body">
      {#if title}<h1>{title}</h1>{/if}
      {#if !page.shelves.length}<p class="empty">Nothing here right now.</p>{/if}
      <Shelves shelves={page.shelves} />
      {#if page.error}
        <p class="inline-error">
          Couldn't load more: {page.error}
          <button class="link" onclick={() => page.more()}>Retry</button>
        </p>
      {:else if page.hasMore}
        <div class="more"><span class="eyebrow">Loading…</span></div>
      {/if}
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
  .body {
    padding: 36px 40px 0;
  }
  h1 {
    margin: 0 0 28px;
    font-size: clamp(32px, 4vw, 48px);
    font-weight: var(--weight-display);
    letter-spacing: -0.03em;
    line-height: 1.1;
  }
  .empty {
    color: var(--muted);
  }
  .more {
    display: grid;
    place-items: center;
    padding: 12px 0 36px;
  }
  .inline-error {
    color: var(--muted);
    margin: 0 0 36px;
  }
  .link {
    color: var(--text);
    text-decoration: underline;
  }
</style>
