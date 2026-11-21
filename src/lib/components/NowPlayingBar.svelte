<script lang="ts">
  import Artwork from "./Artwork.svelte";
  import {
    Heart,
    ListMusic,
    Pause,
    Play,
    Repeat,
    Repeat1,
    Shuffle,
    SkipBack,
    SkipForward,
    TextQuote,
    Volume1,
    Volume2,
    VolumeX,
  } from "@lucide/svelte";
  import { playerCmd, type RepeatMode } from "$lib/ipc";
  import {
    REPEAT_LABEL,
    cycleRepeat,
    next,
    previous,
    seekBy,
    setVolume,
    toggleMute as muteToggle,
    togglePlay,
    toggleShuffle,
    toSlider,
    toVolume,
  } from "$lib/playback";
  import { player } from "$lib/stores/player.svelte";
  import { ui } from "$lib/stores/ui.svelte";
  import { setLiked } from "$lib/actions";
  import { songMenu } from "$lib/menus";
  import { likes } from "$lib/stores/likes.svelte";
  import { menu } from "$lib/stores/menu.svelte";

  const p = $derived(player.playback);
  const liked = $derived(likes.get(p?.videoId));
  const song = $derived(p?.videoId ? { videoId: p.videoId, title: p.title, artist: p.artist } : null);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // ---- progress: move smoothly between the player's once-a-second updates
  let now = $state(performance.now());
  $effect(() => {
    // Only tick while something is playing and the window is on screen.
    if (!p?.playing) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") now = performance.now();
    }, 250);
    return () => clearInterval(id);
  });

  // While the user holds the seek bar, `dragPos` freezes it so the ticking clock never
  // moves the thumb out from under them; the seek is sent once, on release.
  let dragPos = $state<number | null>(null);
  const livePos = $derived(player.positionNow(now));
  const shownPos = $derived(dragPos ?? livePos);
  const duration = $derived(p?.duration || 0);
  const posPct = $derived(duration ? Math.min(100, (shownPos / duration) * 100) : 0);

  function startDrag(e: PointerEvent) {
    dragPos = livePos;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function commitSeek(e: Event) {
    if (dragPos === null) return; // already sent (pointerup and change both fire)
    const seconds = Number((e.currentTarget as HTMLInputElement).value);
    dragPos = null;
    player.seeked(seconds);
    now = performance.now();
    playerCmd({ action: "seek", seconds });
  }

  /** Arrow keys on the focused seek bar: 5 s steps, Page Up/Down 30 s, Home/End. */
  function seekKey(e: KeyboardEvent) {
    const steps: Record<string, number> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -30, PageUp: 30 };
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key in steps) seekBy(steps[e.key]);
    else if (e.key === "Home") seekBy(-Infinity);
    else if (e.key === "End") seekBy(duration - livePos - 1);
    else return;
    e.preventDefault();
    now = performance.now();
  }

  // ---- volume: changes as you drag, at most every 80 ms
  let dragVol = $state<number | null>(null);
  const shownVol = $derived(dragVol ?? (p?.muted ? 0 : (p?.volume ?? 100)));
  const sliderPos = $derived(toSlider(shownVol));
  let volTimer: ReturnType<typeof setTimeout> | null = null;
  const sliderVolume = (e: Event) => Math.round(toVolume(Number((e.currentTarget as HTMLInputElement).value)));
  function onVolume(e: Event) {
    dragVol = sliderVolume(e);
    if (volTimer) return;
    volTimer = setTimeout(() => {
      volTimer = null;
      if (dragVol !== null) playerCmd({ action: "volume", value: dragVol });
    }, 80);
  }
  function commitVolume(e: Event) {
    setVolume(sliderVolume(e));
    dragVol = null;
  }

  // ---- repeat, speed
  const repeat = $derived<RepeatMode>(p?.repeat ?? "NONE");

  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const rate = $derived(p?.rate ?? 1);
  let speedOpen = $state(false);
  function setRate(value: number) {
    speedOpen = false;
    player.optimistic({ rate: value });
    playerCmd({ action: "rate", value });
  }
  const fmtRate = (r: number) => `${r}×`;

  // Screen readers hear about a new song (once it has a title), not every progress tick.
  const announcement = $derived(p?.videoId && p.title ? `Now playing: ${p.title}${p.artist ? `, by ${p.artist}` : ""}` : "");
</script>

<footer class="player" aria-label="Player">
  <div class="sr-only" aria-live="polite">{announcement}</div>
  <div class="track" role="group" oncontextmenu={(e) => song && menu.show(e, songMenu(song))}>
    <div class="art">
      <Artwork src={p?.artwork} kind="song" />
    </div>
    <div class="meta">
      <div class="title truncate">{p?.title ?? "Nothing playing"}</div>
      <div class="artist truncate">{p?.artist ?? "Pick something from your library"}</div>
    </div>
    {#if song}
      <button
        class="icon-btn like"
        class:on={liked}
        aria-label={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
        aria-pressed={!!liked}
        title={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
        onclick={() => setLiked(song, !liked)}
      >
        <Heart size={18} fill={liked ? "currentColor" : "none"} />
      </button>
    {/if}
  </div>

  <div class="center">
    <div class="controls">
      <button
        class="icon-btn toggle-btn"
        class:on={p?.shuffle}
        aria-label="Shuffle"
        aria-pressed={!!p?.shuffle}
        title={p?.shuffle ? "Shuffle: on" : "Shuffle: off"}
        disabled={!p}
        onclick={toggleShuffle}
      >
        <Shuffle size={17} />
      </button>
      <button class="icon-btn" aria-label="Previous" title="Previous (Ctrl+Left)" onclick={previous}>
        <SkipBack size={18} fill="currentColor" />
      </button>
      <button class="play" aria-label={p?.playing ? "Pause" : "Play"} disabled={!p} onclick={togglePlay}>
        {#if p?.playing}
          <Pause size={20} fill="currentColor" strokeWidth={0} />
        {:else}
          <Play size={20} fill="currentColor" strokeWidth={0} />
        {/if}
      </button>
      <button class="icon-btn" aria-label="Next" title="Next (Ctrl+Right)" onclick={next}>
        <SkipForward size={18} fill="currentColor" />
      </button>
      <button
        class="icon-btn toggle-btn"
        class:on={repeat !== "NONE"}
        aria-label={REPEAT_LABEL[repeat]}
        title={REPEAT_LABEL[repeat]}
        disabled={!p}
        onclick={cycleRepeat}
      >
        {#if repeat === "ONE"}<Repeat1 size={17} />{:else}<Repeat size={17} />{/if}
      </button>
    </div>
    <div class="progress">
      <span class="time">{fmt(shownPos)}</span>
      <input
        class="slider"
        type="range"
        min="0"
        max={duration || 1}
        step="any"
        value={shownPos}
        style:--pct="{posPct}%"
        disabled={!p}
        onpointerdown={startDrag}
        oninput={(e) => (dragPos = Number(e.currentTarget.value))}
        onpointerup={commitSeek}
        onchange={commitSeek}
        onkeydown={seekKey}
        aria-label="Seek"
        aria-valuetext="{fmt(shownPos)} of {fmt(duration)}"
      />
      <span class="time">{fmt(duration)}</span>
    </div>
  </div>

  <div class="right">
    <div class="speed">
      <button
        class="icon-btn speed-btn"
        class:on={rate !== 1}
        aria-label="Playback speed"
        aria-haspopup="menu"
        aria-expanded={speedOpen}
        title="Playback speed"
        disabled={!p}
        onclick={() => (speedOpen = !speedOpen)}
      >
        {fmtRate(rate)}
      </button>
      {#if speedOpen}
        <!-- Clicking anywhere else closes it. -->
        <button class="scrim" aria-label="Close" tabindex="-1" onclick={() => (speedOpen = false)}></button>
        <div class="speed-menu" role="menu">
          <div class="eyebrow">Speed</div>
          {#each RATES as r (r)}
            <button role="menuitemradio" aria-checked={r === rate} class:current={r === rate} onclick={() => setRate(r)}>
              {fmtRate(r)}{#if r === 1}<span class="normal">Normal</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <button
      class="icon-btn"
      class:on={ui.lyricsOpen}
      aria-label="Lyrics"
      aria-pressed={ui.lyricsOpen}
      title="Lyrics (Ctrl+L)"
      onclick={() => ui.toggleLyrics()}
    >
      <TextQuote size={19} />
    </button>
    <button
      class="icon-btn queue-btn"
      class:on={ui.queueOpen}
      aria-label="Queue"
      aria-pressed={ui.queueOpen}
      title="Queue (Q)"
      onclick={() => ui.toggleQueue()}
    >
      <ListMusic size={19} />
    </button>
    <button class="icon-btn" aria-label={shownVol > 0 ? "Mute" : "Unmute"} onclick={() => muteToggle(shownVol)}>
      {#if shownVol === 0}<VolumeX size={19} />{:else if sliderPos < 50}<Volume1 size={19} />{:else}<Volume2
          size={19}
        />{/if}
    </button>
    <input
      class="slider volume"
      type="range"
      min="0"
      max="100"
      step="any"
      value={sliderPos}
      style:--pct="{sliderPos}%"
      oninput={onVolume}
      onchange={commitVolume}
      aria-label="Volume"
      aria-valuetext="{Math.round(shownVol)}%"
    />
  </div>
</footer>

<style>
  /* Floats over the bottom of the window, frosted. */
  .player {
    position: absolute;
    left: var(--player-gap);
    right: var(--player-gap);
    bottom: var(--player-gap);
    z-index: 20;
    display: grid;
    grid-template-columns: minmax(200px, 1fr) minmax(320px, 1.6fr) minmax(200px, 1fr);
    align-items: center;
    gap: 20px;
    height: var(--player);
    padding: 0 16px 0 12px;
    border-radius: var(--radius-lg);
    background: rgb(22 22 28 / 0.78);
    border: 1px solid var(--line-strong);
    box-shadow:
      0 20px 50px rgb(0 0 0 / 0.55),
      inset 0 1px 0 rgb(255 255 255 / 0.04);
    backdrop-filter: blur(28px) saturate(160%);
  }
  .track {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }
  .art {
    position: relative;
    width: 56px;
    height: 56px;
    flex: none;
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--surface-3);
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.45);
  }
  .meta {
    min-width: 0;
  }
  .like {
    flex: none;
    width: 32px;
    height: 32px;
  }
  .title {
    font-weight: 500;
    font-size: 14.5px;
  }
  .artist {
    margin-top: 2px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .play {
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--text);
    color: var(--bg);
    transition: transform 0.15s var(--ease);
  }
  .play:hover:not(:disabled) {
    transform: scale(1.07);
  }
  .play:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .progress {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    max-width: 560px;
  }
  .progress input {
    flex: 1;
  }
  .time {
    width: 38px;
    font-size: 11px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  .right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
  }
  .volume {
    width: 110px;
    margin-left: 4px;
  }
  /* Shuffle / repeat when on: accent colour plus a small dot, as most players do. */
  .toggle-btn {
    position: relative;
  }
  .toggle-btn.on::after {
    content: "";
    position: absolute;
    bottom: 3px;
    left: 50%;
    width: 4px;
    height: 4px;
    margin-left: -2px;
    border-radius: 50%;
    background: var(--accent);
  }
  .icon-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .speed {
    position: relative;
  }
  .speed-btn {
    width: auto;
    min-width: 40px;
    padding: 0 8px;
    font-size: 12.5px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 1;
    cursor: default;
  }
  .speed-menu {
    position: absolute;
    bottom: calc(100% + 14px);
    left: 50%;
    z-index: 2;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    min-width: 132px;
    padding: 8px;
    border-radius: var(--radius);
    background: var(--surface-2);
    border: 1px solid var(--line-strong);
    box-shadow: 0 16px 40px rgb(0 0 0 / 0.5);
  }
  .speed-menu .eyebrow {
    padding: 4px 10px 6px;
  }
  .speed-menu button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    height: 34px;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .speed-menu button:hover {
    background: var(--surface-3);
    color: var(--text);
  }
  .speed-menu button.current {
    color: var(--accent);
  }
  .normal {
    font-size: 11.5px;
    color: var(--faint);
  }
</style>
