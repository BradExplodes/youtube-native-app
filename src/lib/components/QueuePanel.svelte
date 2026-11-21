<script lang="ts">
  import { arrowNav } from "$lib/a11y";
  import Artwork from "./Artwork.svelte";
  import { X } from "@lucide/svelte";
  import Equalizer from "./Equalizer.svelte";
  import { playerCmd, type QueueItem } from "$lib/ipc";
  import { songMenu } from "$lib/menus";
  import { menu } from "$lib/stores/menu.svelte";
  import { player } from "$lib/stores/player.svelte";
  import { ui } from "$lib/stores/ui.svelte";

  // Indexes are positions in YouTube Music's queue, which is what a jump needs.
  const indexed = $derived(player.queue.map((item, index) => ({ item, index })));
  const currentAt = $derived(indexed.findIndex((e) => e.item.current));
  const now = $derived(currentAt >= 0 ? indexed[currentAt] : null);
  const after = $derived(currentAt >= 0 ? indexed.slice(currentAt + 1) : indexed);
  const nextUp = $derived(after.filter((e) => !e.item.autoplay));
  const autoplay = $derived(after.filter((e) => e.item.autoplay));

  const jump = (index: number, item: QueueItem) => playerCmd({ action: "queueJump", index, videoId: item.videoId });
</script>

{#snippet row(entry: { item: QueueItem; index: number })}
  <button
    class="item"
    ondblclick={() => jump(entry.index, entry.item)}
    onkeydown={(e) => e.key === "Enter" && jump(entry.index, entry.item)}
    oncontextmenu={(e) => menu.show(e, songMenu(entry.item, { play: () => jump(entry.index, entry.item) }))}
    title="Double-click to play"
  >
    <span class="thumb"><Artwork src={entry.item.thumbnail} kind="song" /></span>
    <span class="meta">
      <span class="title truncate">{entry.item.title}</span>
      <span class="artist truncate">{entry.item.artist}</span>
    </span>
    <span class="dur">{entry.item.duration}</span>
  </button>
{/snippet}

<aside class="queue" aria-label="Queue" use:arrowNav={{ selector: "button.item" }}>
  <header>
    <h2>Queue</h2>
    <button class="icon-btn" aria-label="Close queue" onclick={() => ui.toggleQueue()}>
      <X size={18} />
    </button>
  </header>

  <div class="scroll">
    {#if !player.queue.length}
      <p class="empty">Nothing queued yet. Play something from your library.</p>
    {:else}
      {#if now}
        <div class="eyebrow section">Now playing</div>
        <div class="item now" role="group" oncontextmenu={(e) => menu.show(e, songMenu(now.item))}>
          <span class="thumb"><Artwork src={now.item.thumbnail} kind="song" /></span>
          <span class="meta">
            <span class="title truncate">{now.item.title}</span>
            <span class="artist truncate">{now.item.artist}</span>
          </span>
          <Equalizer playing={!!player.playback?.playing} size={14} />
        </div>
      {/if}
      {#if nextUp.length}
        <div class="eyebrow section">Next up</div>
        {#each nextUp as e (e.index)}{@render row(e)}{/each}
      {/if}
      {#if autoplay.length}
        <div class="eyebrow section">Autoplay</div>
        {#each autoplay as e (e.index)}{@render row(e)}{/each}
      {/if}
    {/if}
  </div>
</aside>

<style>
  .queue {
    display: flex;
    flex-direction: column;
    min-height: 0;
    margin: 0 12px 0 12px;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--surface);
    border: 1px solid var(--line);
    border-bottom: 0;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 10px 4px 20px;
  }
  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 500;
    letter-spacing: -0.01em;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 10px var(--player-clearance);
  }
  .section {
    margin: 18px 10px 8px;
  }
  .empty {
    margin: 10px;
    color: var(--muted);
    font-size: 13px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 7px 10px;
    border-radius: var(--radius);
    text-align: left;
    /* Off-screen rows skip layout and paint entirely. */
    content-visibility: auto;
    contain-intrinsic-size: auto 58px;
  }
  button.item:hover,
  button.item:focus-visible {
    background: rgb(255 255 255 / 0.05);
  }
  .item.now {
    padding: 10px;
    background: linear-gradient(90deg, var(--accent-soft), transparent);
  }
  .item.now .title {
    color: var(--accent);
  }
  .thumb {
    position: relative;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-3);
    flex: none;
  }
  .item.now .thumb {
    width: 56px;
    height: 56px;
    border-radius: 10px;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.4);
  }
  .meta {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .title {
    font-weight: 400;
  }
  .artist,
  .dur {
    font-size: 12px;
    color: var(--muted);
  }
  .dur {
    font-variant-numeric: tabular-nums;
  }
</style>
