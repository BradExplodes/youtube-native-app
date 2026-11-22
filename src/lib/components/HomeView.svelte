<script lang="ts">
  // Home: YouTube Music's picks for you (Quick picks, your mixes, Listen again…),
  // narrowed by a mood chip if you pick one, then Explore (new releases, charts,
  // moods & genres) once your own shelves run out.
  import { tick, untrack } from "svelte";
  import { Compass } from "@lucide/svelte";
  import Shelves from "./Shelves.svelte";
  import { openLink } from "$lib/open";
  import { library } from "$lib/stores/library.svelte";
  import { LIKED_RARELY, NEW_TO_YOU, coversOf, mixes } from "$lib/stores/mixes.svelte";
  import { EXPLORE_LINKS, SHELF_PAGES } from "$lib/ytm/shelves";
  import type { Chip, Shelf, Tile } from "$lib/ytm/types";

  /** Coming back to Home after this long fetches fresh picks. */
  const STALE_MS = 30 * 60_000;

  const unfiltered = library.shelfPage({ browseId: SHELF_PAGES.home });
  const home = $derived(
    library.homeChip ? library.shelfPage({ browseId: SHELF_PAGES.home, params: library.homeChip }) : unfiltered,
  );
  const explore = library.shelfPage({ browseId: SHELF_PAGES.explore });

  // A chip's page lists the chips again (with it selected); until it loads, keep showing the old ones.
  const chips = $derived(home.chips.length ? home.chips : unfiltered.chips);
  const exploreIds = new Set<string>(EXPLORE_LINKS.map((l) => l.browseId));
  // Explore's own New releases / Charts / Moods buttons duplicate the links above it.
  const exploreShelves = $derived(
    explore.shelves.filter((s: Shelf) => !(s.buttons.length && s.buttons.every((b) => exploreIds.has(b.link.browseId)))),
  );
  const exploreReady = $derived(home.loaded && !home.hasMore);

  // "Made for you": the app's own mixes from your listening history, after YouTube
  // Music's first shelf (Quick picks). Not with a mood chip picked: they aren't moods.
  const madeForYou = $derived.by((): Shelf | null => {
    if (library.homeChip || (!mixes.list.length && !mixes.newToYou)) return null;
    const all = mixes.newToYou ? [mixes.newToYou, ...mixes.list] : mixes.list;
    const tiles: Tile[] = all.map((m) => ({
      kind: "playlist",
      title: m.title,
      subtitle: m.description,
      mixId: m.id,
      covers: coversOf(m.tracks),
    }));
    if (mixes.offerLikedRarely) {
      const liked = mixes.likedRarely?.tracks ?? [];
      tiles.push({
        kind: "playlist",
        title: "Liked, rarely played",
        subtitle: "Songs you've liked but hardly ever play here",
        mixId: LIKED_RARELY,
        covers: coversOf(liked),
      });
    }
    return { title: "Made for you", strapline: "From your listening on this computer", tiles, tracks: [], buttons: [], grid: false };
  });
  // Artists like the ones you play most (from their "Fans might also like").
  const similar = $derived.by((): Shelf | null => {
    if (library.homeChip || mixes.similarArtists.length < 4) return null;
    return {
      title: "Artists you might like",
      strapline: "Fans of your favourites also listen to",
      tiles: mixes.similarArtists,
      tracks: [],
      buttons: [],
      grid: false,
    };
  });
  const homeShelves = $derived([
    ...home.shelves.slice(0, 1),
    ...(madeForYou ? [madeForYou] : []),
    ...(similar ? [similar] : []),
    ...home.shelves.slice(1),
  ]);
  $effect(() => {
    untrack(() => mixes.load());
  });
  // Discovery fetches a dozen or so pages: start it once YouTube Music's own Home is in.
  $effect(() => {
    if (home.loaded) untrack(() => mixes.loadDiscovery());
  });

  $effect(() => {
    const page = home;
    untrack(() => {
      page.load();
      page.refreshIfOlder(STALE_MS);
    });
  });
  $effect(() => {
    if (!exploreReady) return;
    untrack(() => {
      explore.load();
      explore.refreshIfOlder(STALE_MS);
    });
  });

  // More shelves load as you scroll towards the end (and until the page is full).
  let scroller = $state<HTMLDivElement>();
  function nearEnd() {
    const el = scroller;
    if (el && el.scrollTop + el.clientHeight > el.scrollHeight - 900 && home.hasMore && !home.error) home.more();
  }
  $effect(() => {
    void home.shelves;
    void home.loading;
    tick().then(nearEnd);
  });

  function pick(chip: Chip) {
    library.homeChip = chip.selected || chip.params === library.homeChip ? undefined : chip.params;
    scroller?.scrollTo({ top: 0 });
  }
</script>

<div class="view" bind:this={scroller} onscroll={nearEnd}>
  {#if chips.length}
    <div class="chips" role="toolbar" aria-label="Moods">
      {#each chips as c (c.title)}
        {@const on = library.homeChip ? c.params === library.homeChip : c.selected}
        <button class="chip" class:on aria-pressed={on} onclick={() => pick(c)}>{c.title}</button>
      {/each}
    </div>
  {/if}

  <div class="body">
    {#if home.error && !home.shelves.length}
      <div class="state">
        <p>Couldn't load Home: {home.error}</p>
        <button class="btn-primary" onclick={() => home.load()}>Try again</button>
      </div>
    {:else if !home.loaded && !home.shelves.length}
      <div class="state"><span class="eyebrow">Loading…</span></div>
    {:else}
      {#if !home.shelves.length}
        <p class="empty">YouTube Music has no picks for you here yet. Play some music and check back.</p>
      {/if}
      <Shelves shelves={homeShelves} />
      {#if home.error}
        <p class="inline-error">
          Couldn't load more: {home.error}
          <button class="link" onclick={() => home.more()}>Retry</button>
        </p>
      {:else if home.hasMore}
        <div class="more"><span class="eyebrow">Loading…</span></div>
      {/if}

      {#if exploreReady}
        <section class="explore" aria-labelledby="explore-heading">
          <header class="explore-head">
            <h1 id="explore-heading"><Compass size={26} strokeWidth={2.2} /> Explore</h1>
            <div class="links">
              {#each EXPLORE_LINKS as l (l.browseId)}
                <button class="pill" onclick={() => openLink({ browseId: l.browseId })}>{l.title}</button>
              {/each}
            </div>
          </header>
          {#if explore.error && !explore.shelves.length}
            <p class="inline-error">
              Couldn't load Explore: {explore.error}
              <button class="link" onclick={() => explore.load()}>Retry</button>
            </p>
          {:else if !explore.loaded && !explore.shelves.length}
            <div class="more"><span class="eyebrow">Loading…</span></div>
          {/if}
          <Shelves shelves={exploreShelves} />
        </section>
      {/if}
    {/if}
  </div>
</div>

<style>
  .view {
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    padding-bottom: var(--player-clearance);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 28px 40px 4px;
  }
  .chip {
    height: 32px;
    padding: 0 14px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text);
    font-size: 13px;
    font-weight: 500;
    transition:
      background 0.15s,
      color 0.15s;
  }
  .chip:hover {
    background: var(--surface-3);
  }
  .chip.on {
    background: var(--text);
    color: var(--surface);
  }
  .body {
    padding: 24px 40px 0;
  }
  .state {
    min-height: 50vh;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 12px;
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
  .explore {
    margin-top: 12px;
    padding-top: 32px;
    border-top: 1px solid var(--line);
  }
  .explore-head {
    margin-bottom: 28px;
  }
  h1 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 16px;
    font-size: 32px;
    font-weight: var(--weight-display);
    letter-spacing: -0.02em;
  }
  h1 :global(svg) {
    color: var(--accent);
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .pill {
    height: 40px;
    padding: 0 18px;
    border-radius: var(--radius);
    background: var(--surface-2);
    font-weight: 500;
    transition: background 0.15s;
  }
  .pill:hover {
    background: var(--surface-3);
  }
</style>
