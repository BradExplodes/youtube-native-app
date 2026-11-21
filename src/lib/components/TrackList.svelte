<script lang="ts" module>
  // Scroll positions per list, so switching tabs comes back to the same place.
  const scrollMemory = new Map<string, number>();
</script>

<script lang="ts">
  // A virtualized track table: only the rows on screen (plus a few) exist in the page,
  // so a 1,500-track playlist costs the same as a 15-track one.
  import Artwork from "./Artwork.svelte";
  import { tick as nextTick, type Snippet } from "svelte";
  import { Clock3, GripVertical, Heart, Play } from "@lucide/svelte";
  import ArtistLinks from "./ArtistLinks.svelte";
  import Equalizer from "./Equalizer.svelte";
  import { setLiked } from "$lib/actions";
  import { likes } from "$lib/stores/likes.svelte";
  import { menu, type MenuEntry } from "$lib/stores/menu.svelte";
  import { player } from "$lib/stores/player.svelte";
  import type { Track } from "$lib/ytm/types";

  interface Props {
    tracks: Track[];
    /** Show the album column (off for album pages). */
    showAlbum?: boolean;
    /** Show thumbnails (off for album pages, where they're all the same cover). */
    showArt?: boolean;
    play: (index: number) => void;
    openAlbum?: (id: string) => void;
    /** Called when the end of the list is near, to load more. */
    nearEnd?: () => void;
    /** Remembers the scroll position under this key. */
    scrollKey?: string;
    /** Rendered above the table, scrolling with it. */
    header?: Snippet;
    /** The right-click menu for a row. */
    menuFor?: (track: Track, index: number) => MenuEntry[];
    /** Lets you drag rows (or Alt+Up/Down) into a new order: move row `from` into the gap
     *  before row `gap` (`gap` = the length: to the end). */
    reorder?: (from: number, gap: number) => void;
    /** Whether a row can be dropped after the last one (not while more are still to load). */
    dropAtEnd?: boolean;
  }
  let {
    tracks,
    showAlbum = true,
    showArt = true,
    play,
    openAlbum,
    nearEnd,
    scrollKey,
    header,
    menuFor,
    reorder,
    dropAtEnd = true,
  }: Props = $props();

  const ROW = 60;
  const OVERSCAN = 8;

  let scroller: HTMLDivElement;
  let headerHeight = $state(0);
  let scrollTop = $state(0);
  let viewport = $state(600);

  const listTop = $derived(scrollTop - headerHeight);
  const first = $derived(Math.max(0, Math.floor(listTop / ROW) - OVERSCAN));
  const last = $derived(Math.min(tracks.length, Math.ceil((listTop + viewport) / ROW) + OVERSCAN));
  const visible = $derived(tracks.slice(first, last));
  const current = $derived(player.playback?.videoId);
  const playing = $derived(!!player.playback?.playing);

  $effect(() => {
    if (nearEnd && last >= tracks.length - 20) nearEnd();
  });

  // Restore the remembered position once the rows exist, and remember it on the way out.
  $effect(() => {
    if (!scrollKey) return;
    const saved = scrollMemory.get(scrollKey);
    if (saved) requestAnimationFrame(() => (scroller.scrollTop = saved));
    return () => scrollMemory.set(scrollKey, scroller?.scrollTop ?? 0);
  });

  // ---- drag to reorder. Pointer events rather than HTML drag and drop: the rows come
  // and go as you scroll (and the list scrolls itself near the edges while you drag),
  // and the app window takes HTML drags for dropped files.
  const THRESHOLD = 5; // px the pointer moves before a press becomes a drag
  const EDGE = 56; // px from the top/bottom of the list where dragging scrolls it

  let rowsEl: HTMLDivElement;
  /** The row being dragged, the gap it would drop into, and where the pointer is. */
  let drag = $state<{ from: number; gap: number; y: number } | null>(null);
  /** Rows jump to their new places on drop, rather than sliding from the old ones. */
  let settling = $state(false);
  let press: { from: number; x: number; y: number; id: number } | null = null;
  let pointerY = 0;
  let frame = 0;

  /** Where a dragged row would go: the nearest gap between rows. */
  function gapAt(clientY: number) {
    const top = rowsEl.getBoundingClientRect().top;
    const max = dropAtEnd ? tracks.length : tracks.length - 1;
    return Math.max(0, Math.min(max, Math.round((clientY - top) / ROW)));
  }

  function onPointerDown(e: PointerEvent, index: number) {
    if (!reorder || e.button !== 0 || (e.target as Element).closest("button, a, input")) return;
    press = { from: index, x: e.clientX, y: e.clientY, id: e.pointerId };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("keydown", onDragKey, true);
  }

  function onPointerMove(e: PointerEvent) {
    if (!press || e.pointerId !== press.id) return;
    pointerY = e.clientY;
    if (!drag) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < THRESHOLD) return;
      menu.close();
      drag = { from: press.from, gap: press.from, y: 0 };
      frame = requestAnimationFrame(tick);
    }
    update();
  }

  function update() {
    if (!drag) return;
    const top = rowsEl.getBoundingClientRect().top;
    drag.y = Math.max(0, Math.min((tracks.length - 1) * ROW, pointerY - top - ROW / 2));
    drag.gap = gapAt(pointerY);
  }

  /** Scroll while the pointer is near the top or bottom edge, faster the closer it is. */
  function tick() {
    if (!drag) return;
    const box = scroller.getBoundingClientRect();
    const clearance = parseFloat(getComputedStyle(scroller).getPropertyValue("--player-clearance")) || 0;
    const top = box.top + 40 + EDGE; // under the sticky column header
    const bottom = box.bottom - Math.min(clearance, box.height / 3) - EDGE;
    let speed = 0;
    if (pointerY < top) speed = -Math.min(1, (top - pointerY) / EDGE);
    else if (pointerY > bottom) speed = Math.min(1, (pointerY - bottom) / EDGE);
    if (speed) {
      scroller.scrollTop += speed * 18;
      update();
    }
    frame = requestAnimationFrame(tick);
  }

  function onPointerUp(e: PointerEvent) {
    if (press && e.pointerId !== press.id) return;
    const done = drag;
    endDrag();
    if (done && done.gap !== done.from && done.gap !== done.from + 1) {
      settling = true;
      reorder?.(done.from, done.gap);
      requestAnimationFrame(() => requestAnimationFrame(() => (settling = false)));
    }
  }

  function onDragKey(e: KeyboardEvent) {
    if (e.key !== "Escape" || !drag) return;
    e.preventDefault();
    e.stopPropagation();
    endDrag();
  }

  function endDrag() {
    press = null;
    drag = null;
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", endDrag);
    window.removeEventListener("keydown", onDragKey, true);
  }
  $effect(() => endDrag); // on the way out

  /** How far a row slides to open the gap the dragged row would drop into. */
  function shift(index: number) {
    if (!drag || index === drag.from) return 0;
    if (drag.from < index && index < drag.gap) return -ROW;
    if (drag.gap <= index && index < drag.from) return ROW;
    return 0;
  }

  /** Alt+Up / Alt+Down moves the focused row, keeping it focused. */
  function moveByKey(e: KeyboardEvent, index: number) {
    if (!reorder || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return false;
    e.preventDefault();
    const to = e.key === "ArrowUp" ? index - 1 : index + 1;
    const gap = e.key === "ArrowUp" ? index - 1 : index + 2;
    if (to < 0 || gap > (dropAtEnd ? tracks.length : tracks.length - 1)) return true;
    settling = true;
    reorder(index, gap);
    requestAnimationFrame(() => {
      settling = false;
      const row = rowsEl.querySelector<HTMLElement>(`[data-index="${to}"]`);
      row?.focus();
      // Keep it in view.
      const box = scroller.getBoundingClientRect();
      const r = row?.getBoundingClientRect();
      if (r && (r.top < box.top + 40 || r.bottom > box.bottom - 80)) row!.scrollIntoView({ block: "center" });
    });
    return true;
  }

  const dragged = $derived(drag ? tracks[drag.from] : undefined);

  // ---- keyboard: one row is in the Tab order (the last one focused); the arrow keys,
  // Page Up/Down and Home/End move between rows, scrolling rows into existence as needed.
  let focusIndex = $state(0);
  const firstOnScreen = $derived(Math.max(0, Math.min(tracks.length - 1, Math.floor(Math.max(0, listTop) / ROW))));
  const tabStop = $derived(focusIndex >= first && focusIndex < last ? focusIndex : firstOnScreen);

  function clearance() {
    return parseFloat(getComputedStyle(scroller).getPropertyValue("--player-clearance")) || 0;
  }

  async function focusRow(index: number) {
    index = Math.max(0, Math.min(tracks.length - 1, index));
    focusIndex = index;
    // Bring the row on screen (under the sticky column header, above the floating player).
    const rowTop = rowsEl.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop + index * ROW;
    const viewTop = scroller.scrollTop + 40;
    const viewBottom = scroller.scrollTop + scroller.clientHeight - Math.min(clearance(), scroller.clientHeight / 3);
    if (rowTop < viewTop) scroller.scrollTop = rowTop - 40;
    else if (rowTop + ROW > viewBottom) scroller.scrollTop += rowTop + ROW - viewBottom;
    scrollTop = scroller.scrollTop;
    await nextTick();
    rowsEl.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus({ preventScroll: true });
  }

  function rowKey(e: KeyboardEvent, index: number, t: Track) {
    if (moveByKey(e, index)) return;
    if (e.target !== e.currentTarget) return; // a button inside the row has the focus
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const page = Math.max(1, Math.floor(scroller.clientHeight / ROW) - 2);
    const to: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      PageDown: index + page,
      PageUp: index - page,
      Home: 0,
      End: tracks.length - 1,
    };
    if (e.key in to && !e.shiftKey) {
      e.preventDefault();
      focusRow(to[e.key]);
    } else if (e.key === "Enter" && t.available) {
      e.preventDefault();
      play(index);
    }
  }

  const rowLabel = (t: Track) =>
    [t.title, t.artists.map((a) => a.name).join(", "), t.album?.name, t.duration, t.available ? "" : "unavailable"]
      .filter(Boolean)
      .join(", ");
</script>

<div
  class="scroller"
  bind:this={scroller}
  bind:clientHeight={viewport}
  onscroll={() => (scrollTop = scroller.scrollTop)}
>
  <div bind:offsetHeight={headerHeight}>{@render header?.()}</div>

  <div class="cols head" class:no-album={!showAlbum}>
    <span class="num">#</span>
    <span class="eyebrow">Title</span>
    {#if showAlbum}<span class="eyebrow">Album</span>{/if}
    <span></span>
    <span class="dur"><Clock3 size={14} /></span>
  </div>

  <div
    class="rows"
    class:reorderable={!!reorder}
    class:dragging={!!drag}
    class:settling
    bind:this={rowsEl}
    role="table"
    aria-label="Tracks"
    aria-rowcount={tracks.length}
    style:height="{tracks.length * ROW}px"
  >
    {#each visible as t, i (first + i)}
      {@const index = first + i}
      {@const isCurrent = t.videoId === current}
      {@const liked = likes.get(t.videoId)}
      <div
        class="cols row"
        class:no-album={!showAlbum}
        class:current={isCurrent}
        class:unavailable={!t.available}
        class:lifted={drag?.from === index}
        style:top="{index * ROW}px"
        style:transform={drag ? `translateY(${shift(index)}px)` : undefined}
        data-index={index}
        role="row"
        tabindex={index === tabStop ? 0 : -1}
        data-tabstop={index === tabStop ? "" : undefined}
        aria-rowindex={index + 1}
        aria-label={rowLabel(t)}
        aria-current={isCurrent ? "true" : undefined}
        aria-roledescription={reorder ? "Reorderable track. Alt+Up or Alt+Down to move." : undefined}
        onfocus={() => (focusIndex = index)}
        ondblclick={() => t.available && play(index)}
        onpointerdown={(e) => onPointerDown(e, index)}
        onkeydown={(e) => rowKey(e, index, t)}
        oncontextmenu={(e) => menuFor && menu.show(e, menuFor(t, index))}
      >
        <span class="num">
          {#if isCurrent}
            <span class="n"><Equalizer {playing} size={14} /></span>
          {:else}
            <span class="n">{index + 1 + shift(index) / ROW}</span>
          {/if}
          <button
            class="play"
            tabindex="-1"
            aria-label="Play {t.title}"
            disabled={!t.available}
            onclick={() => play(index)}
            ondblclick={(e) => e.stopPropagation()}
          >
            <Play size={16} fill="currentColor" strokeWidth={0} />
          </button>
        </span>
        <span class="title-cell">
          {#if showArt}
            <span class="thumb"><Artwork src={t.thumbnail} kind="song" /></span>
          {/if}
          <span class="meta">
            <span class="title truncate">{t.title}</span>
            <span class="artist truncate">
              {#if t.explicit}<span class="explicit" title="Explicit">E</span>{/if}
              <ArtistLinks artists={t.artists} tabbable={false} />
            </span>
          </span>
        </span>
        {#if showAlbum}
          <span class="album truncate">
            {#if t.album && openAlbum}
              <button class="link" tabindex="-1" onclick={() => openAlbum(t.album!.id)}>{t.album.name}</button>
            {/if}
          </span>
        {/if}
        <span class="like-cell">
          <button
            class="like"
            tabindex="-1"
            class:on={liked}
            aria-label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
            title={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
            onclick={() => setLiked(t, !liked)}
            ondblclick={(e) => e.stopPropagation()}
          >
            <Heart size={16} fill={liked ? "currentColor" : "none"} />
          </button>
        </span>
        <span class="dur">{t.duration ?? ""}</span>
      </div>
    {/each}

    {#if drag && dragged}
      <!-- Where it will land: the slot the other rows open for it. -->
      <div class="drop-slot" style:top="{(drag.gap > drag.from ? drag.gap - 1 : drag.gap) * ROW}px"></div>
      <div class="cols row ghost" class:no-album={!showAlbum} style:top="{drag.y}px" aria-hidden="true">
        <span class="num"><GripVertical size={16} /></span>
        <span class="title-cell">
          {#if showArt}
            <span class="thumb"><Artwork src={dragged.thumbnail} kind="song" /></span>
          {/if}
          <span class="meta">
            <span class="title truncate">{dragged.title}</span>
            <span class="artist truncate">{dragged.artists.map((a) => a.name).join(", ")}</span>
          </span>
        </span>
        {#if showAlbum}<span class="album truncate">{dragged.album?.name ?? ""}</span>{/if}
        <span></span>
        <span class="dur">{dragged.duration ?? ""}</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .scroller {
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    contain: strict;
  }
  .cols {
    display: grid;
    grid-template-columns: 40px minmax(0, 5fr) minmax(0, 3fr) 32px 56px;
    align-items: center;
    gap: 16px;
    padding: 0 16px;
  }
  .cols.no-album {
    grid-template-columns: 40px minmax(0, 1fr) 32px 56px;
  }
  .head {
    position: sticky;
    top: 0;
    z-index: 2;
    height: 40px;
    margin: 0 24px;
    color: var(--faint);
    background: var(--surface);
    border-bottom: 1px solid var(--line);
    font-size: 12px;
  }
  .head .num {
    font-weight: 500;
  }
  .rows {
    position: relative;
    margin: 10px 24px var(--player-clearance);
  }
  .row {
    position: absolute;
    left: 0;
    right: 0;
    height: 56px;
    border-radius: var(--radius);
    color: var(--muted);
    transition: background 0.12s;
  }
  .row:hover,
  .row:focus-visible {
    background: rgb(255 255 255 / 0.05);
    outline: none;
  }
  .row.current {
    background: linear-gradient(90deg, var(--accent-soft), color-mix(in srgb, var(--accent) 3%, transparent) 70%, transparent);
  }
  .row.current .title {
    color: var(--accent);
  }
  .row.unavailable {
    opacity: 0.35;
  }

  /* ---- drag to reorder */
  .reorderable .row {
    cursor: grab;
  }
  .dragging,
  .dragging .row {
    cursor: grabbing;
  }
  /* Rows slide aside to open a gap where the dragged one would land. */
  .dragging .row {
    transition:
      transform 0.16s var(--ease),
      background 0.12s;
  }
  .dragging .row:hover {
    background: none;
  }
  .settling .row {
    transition: none;
  }
  /* The row being dragged leaves an empty slot behind; the ghost stands in for it. */
  .row.lifted {
    visibility: hidden;
  }
  .ghost {
    z-index: 1; /* under the sticky column header */
    pointer-events: none;
    background: var(--surface-3);
    color: var(--muted);
    box-shadow:
      0 12px 32px rgb(0 0 0 / 0.5),
      0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
    transform: scale(1.015);
  }
  .ghost .num {
    color: var(--text);
  }
  .drop-slot {
    position: absolute;
    left: 0;
    right: 0;
    height: 56px;
    border-radius: var(--radius);
    border: 1.5px dashed color-mix(in srgb, var(--accent) 70%, transparent);
    background: var(--accent-soft);
    pointer-events: none;
    transition: top 0.16s var(--ease);
  }
  .num {
    position: relative;
    display: grid;
    place-items: center end;
    height: 100%;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .n {
    display: grid;
    place-items: center;
  }
  .play {
    position: absolute;
    inset: 0;
    display: none;
    place-items: center end;
    color: var(--text);
  }
  .row:hover .play:not(:disabled),
  .row:focus-visible .play:not(:disabled) {
    display: grid;
  }
  .row:hover .n,
  .row:focus-visible .n {
    visibility: hidden;
  }
  .title-cell {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }
  .thumb {
    position: relative;
    width: 42px;
    height: 42px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-3);
    flex: none;
  }
  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .title {
    color: var(--text);
    font-weight: 400;
  }
  .artist {
    font-size: 12.5px;
    margin-top: 2px;
  }
  .explicit {
    display: inline-grid;
    place-items: center;
    width: 14px;
    height: 14px;
    margin-right: 4px;
    border-radius: 3px;
    font-size: 9px;
    font-weight: 600;
    background: rgb(255 255 255 / 0.18);
    color: var(--text);
    vertical-align: 1px;
  }
  .album {
    font-size: 13px;
  }
  .link {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    color: inherit;
  }
  .link:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .like-cell {
    display: flex;
    justify-content: center;
  }
  /* Liked songs always show a filled heart; others show an outline on hover. */
  .like {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    color: var(--muted);
    opacity: 0;
    transition:
      opacity 0.12s,
      color 0.12s;
  }
  .row:hover .like,
  .row:focus-within .like,
  .like.on {
    opacity: 1;
  }
  .like:hover {
    color: var(--text);
  }
  .like.on {
    color: var(--accent);
  }
  .dur {
    display: flex;
    justify-content: flex-end;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
</style>
