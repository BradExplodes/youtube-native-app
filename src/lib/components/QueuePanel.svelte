<script lang="ts">
  import { arrowNav } from "$lib/a11y";
  import Artwork from "./Artwork.svelte";
  import { GripVertical, ListStart, X } from "@lucide/svelte";
  import { tick } from "svelte";
  import Equalizer from "./Equalizer.svelte";
  import { playerCmd, type QueueItem } from "$lib/ipc";
  import { songMenu } from "$lib/menus";
  import { menu } from "$lib/stores/menu.svelte";
  import { player } from "$lib/stores/player.svelte";
  import { ui } from "$lib/stores/ui.svelte";

  type Entry = { item: QueueItem; index: number };

  // Indexes are positions in YouTube Music's queue, which is what a jump needs.
  const indexed = $derived(player.queue.map((item, index) => ({ item, index })));
  // Which one is playing. The queue's own marker can lag behind the player (its update
  // comes separately), so when the player is on a track that's in the queue, believe
  // the player: the copy nearest the marker, if the track is in there twice.
  const currentAt = $derived.by(() => {
    const marked = indexed.findIndex((e) => e.item.current);
    const id = player.playback?.videoId;
    if (!id || indexed[marked]?.item.videoId === id) return marked;
    let best = -1;
    for (const e of indexed) {
      if (e.item.videoId !== id) continue;
      if (best < 0 || Math.abs(e.index - marked) < Math.abs(best - marked)) best = e.index;
    }
    return best >= 0 ? best : marked;
  });
  const now = $derived(currentAt >= 0 ? indexed[currentAt] : null);
  const after = $derived(currentAt >= 0 ? indexed.slice(currentAt + 1) : indexed);
  const nextUp = $derived(after.filter((e) => !e.item.autoplay));
  const autoplay = $derived(after.filter((e) => e.item.autoplay));

  const jump = (index: number, item: QueueItem) => playerCmd({ action: "queueJump", index, videoId: item.videoId });

  // ---------------------------------------------------------------- reordering
  // "Next up" rows can be dragged to a new place, or moved with Alt+Up/Down. (Autoplay
  // is YouTube Music's own suggestions, kept apart: it can't be reordered.)
  let scroller = $state<HTMLDivElement>();
  /** Positions within `nextUp`; `dy` is how far the row has been dragged. */
  let drag = $state<{ from: number; to: number; dy: number; height: number } | null>(null);
  let press: { pos: number; pointerId: number; startY: number; startScroll: number; el: HTMLElement } | null = null;
  let lastY = 0;
  let scrollFrame = 0;

  function moveTo(fromPos: number, toPos: number) {
    const a = nextUp[fromPos];
    const b = nextUp[toPos];
    if (a && b && a !== b) player.moveInQueue(a.index, b.index);
  }

  function onPointerDown(e: PointerEvent, pos: number) {
    if (e.button !== 0 || !scroller) return;
    press = { pos, pointerId: e.pointerId, startY: e.clientY, startScroll: scroller.scrollTop, el: e.currentTarget as HTMLElement };
  }

  function updateDrag() {
    if (!press || !drag || !scroller) return;
    const dy = lastY - press.startY + (scroller.scrollTop - press.startScroll);
    const to = Math.max(0, Math.min(nextUp.length - 1, drag.from + Math.round(dy / drag.height)));
    drag = { ...drag, dy, to };
  }

  function onPointerMove(e: PointerEvent) {
    if (!press || e.pointerId !== press.pointerId) return;
    // Released somewhere we didn't hear about: not a drag.
    if (!(e.buttons & 1)) return endDrag(false);
    lastY = e.clientY;
    if (!drag) {
      if (Math.abs(e.clientY - press.startY) < 5) return;
      try {
        press.el.setPointerCapture(e.pointerId); // keep getting moves outside the row
      } catch {}
      drag = { from: press.pos, to: press.pos, dy: 0, height: press.el.offsetHeight || 58 };
      scrollFrame = requestAnimationFrame(autoScroll);
    }
    updateDrag();
  }

  // Near the top or bottom edge, scroll the list so a row can go anywhere in it.
  function autoScroll() {
    if (!drag || !scroller) return;
    const r = scroller.getBoundingClientRect();
    const bottom = r.bottom - (parseFloat(getComputedStyle(scroller).paddingBottom) || 0);
    const edge = 48;
    let step = 0;
    if (lastY < r.top + edge) step = -Math.ceil((r.top + edge - lastY) / 4);
    else if (lastY > bottom - edge) step = Math.ceil((lastY - (bottom - edge)) / 4);
    if (step) {
      scroller.scrollTop += Math.max(-24, Math.min(24, step));
      updateDrag();
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  function endDrag(commit: boolean) {
    cancelAnimationFrame(scrollFrame);
    if (drag && commit && drag.to !== drag.from) moveTo(drag.from, drag.to);
    drag = null;
    press = null;
  }

  // While dragging: the row follows the pointer, and the rows it passes make room.
  function shift(pos: number): number {
    if (!drag) return 0;
    const { from, to, dy, height } = drag;
    if (pos === from) return dy;
    if (from < to && pos > from && pos <= to) return -height;
    if (from > to && pos >= to && pos < from) return height;
    return 0;
  }

  async function onRowKey(e: KeyboardEvent, entry: Entry, pos: number | null) {
    if (e.key === "Enter") return jump(entry.index, entry.item);
    if (drag && e.key === "Escape") return endDrag(false);
    if (pos === null || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const to = pos + (e.key === "ArrowUp" ? -1 : 1);
    if (to < 0 || to >= nextUp.length) return;
    moveTo(pos, to);
    // Keep the focus on the row that moved.
    await tick();
    scroller?.querySelectorAll<HTMLElement>("button.item.movable")[to]?.focus();
  }

  function rowMenu(e: MouseEvent, entry: Entry, pos: number | null) {
    const entries = songMenu(entry.item, { play: () => jump(entry.index, entry.item) });
    if (pos !== null && pos > 0) {
      entries.splice(1, 0, { label: "Play next", icon: ListStart, action: () => moveTo(pos, 0) });
    }
    menu.show(e, entries);
  }
</script>

{#snippet row(entry: Entry, pos: number | null)}
  {@const offset = pos === null ? 0 : shift(pos)}
  <button
    class="item"
    class:movable={pos !== null}
    class:dragged={drag !== null && pos === drag.from}
    style:transform={offset ? `translateY(${offset}px)` : null}
    ondblclick={() => jump(entry.index, entry.item)}
    onkeydown={(e) => onRowKey(e, entry, pos)}
    oncontextmenu={(e) => rowMenu(e, entry, pos)}
    onpointerdown={pos === null ? undefined : (e) => onPointerDown(e, pos)}
    onpointermove={pos === null ? undefined : onPointerMove}
    onpointerup={pos === null ? undefined : () => endDrag(true)}
    onpointercancel={pos === null ? undefined : () => endDrag(false)}
    title={pos === null ? "Double-click to play" : "Double-click to play, drag to reorder (or Alt+Up/Down)"}
  >
    {#if pos !== null}<span class="grip" aria-hidden="true"><GripVertical size={14} /></span>{/if}
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

  <div class="scroll" class:dragging={drag !== null} bind:this={scroller}>
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
        {#each nextUp as e, pos (e.index)}{@render row(e, pos)}{/each}
      {/if}
      {#if autoplay.length}
        <div class="eyebrow section">Autoplay</div>
        {#each autoplay as e (e.index)}{@render row(e, null)}{/each}
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
  /* The grip sits in the row's left padding, shown on hover. */
  button.item.movable {
    position: relative;
  }
  .grip {
    position: absolute;
    left: -4px;
    display: flex;
    color: var(--muted);
    opacity: 0;
    transition: opacity 120ms;
  }
  button.item.movable:hover .grip,
  button.item.movable:focus-visible .grip {
    opacity: 1;
  }
  .scroll.dragging {
    user-select: none;
    cursor: grabbing;
  }
  /* Rows make room smoothly; every row is laid out while dragging so none skips a frame. */
  .scroll.dragging .item {
    content-visibility: visible;
    transition: transform 140ms ease;
  }
  .scroll.dragging button.item.dragged {
    z-index: 2;
    transition: none;
    background: var(--surface-3);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
  }
  .scroll.dragging button.item:not(.dragged):hover {
    background: none;
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
