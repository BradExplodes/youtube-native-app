<script lang="ts">
  import { playerCmd } from "$lib/ipc";
  import { player } from "$lib/stores/player.svelte";

  const p = $derived(player.playback);

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

  // ---- volume: changes as you drag, at most every 80 ms
  let dragVol = $state<number | null>(null);
  const shownVol = $derived(dragVol ?? (p?.muted ? 0 : (p?.volume ?? 100)));
  let volTimer: ReturnType<typeof setTimeout> | null = null;
  function onVolume(e: Event) {
    dragVol = Number((e.currentTarget as HTMLInputElement).value);
    if (volTimer) return;
    volTimer = setTimeout(() => {
      volTimer = null;
      if (dragVol !== null) playerCmd({ action: "volume", value: dragVol });
    }, 80);
  }
  function commitVolume(e: Event) {
    const value = Number((e.currentTarget as HTMLInputElement).value);
    playerCmd({ action: "volume", value });
    player.optimistic({ volume: value, muted: false });
    dragVol = null;
  }

  function toggle() {
    if (p) player.optimistic({ playing: !p.playing, position: livePos });
    playerCmd({ action: "toggle" });
  }
</script>

<footer class="bar">
  <div class="track">
    {#if p?.artwork}
      <img src={p.artwork} alt="" width="48" height="48" />
    {:else}
      <div class="art-placeholder"></div>
    {/if}
    <div class="meta">
      <div class="title">{p?.title ?? "Nothing playing"}</div>
      <div class="artist">{p?.artist ?? ""}</div>
    </div>
  </div>

  <div class="center">
    <div class="controls">
      <button aria-label="Previous" onclick={() => playerCmd({ action: "previous" })}>
        <svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zM9.5 12 18 6v12z" /></svg>
      </button>
      <button class="play" aria-label={p?.playing ? "Pause" : "Play"} onclick={toggle}>
        {#if p?.playing}
          <svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
        {:else}
          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
        {/if}
      </button>
      <button aria-label="Next" onclick={() => playerCmd({ action: "next" })}>
        <svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2zM6 18V6l8.5 6z" /></svg>
      </button>
    </div>
    <div class="progress">
      <span>{fmt(shownPos)}</span>
      <input
        type="range"
        min="0"
        max={p?.duration || 1}
        step="any"
        value={shownPos}
        disabled={!p}
        onpointerdown={startDrag}
        oninput={(e) => (dragPos = Number(e.currentTarget.value))}
        onpointerup={commitSeek}
        onchange={commitSeek}
        aria-label="Seek"
      />
      <span>{fmt(p?.duration ?? 0)}</span>
    </div>
  </div>

  <div class="right">
    <svg class="vol-icon" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" /></svg>
    <input
      type="range"
      min="0"
      max="100"
      value={shownVol}
      oninput={onVolume}
      onchange={commitVolume}
      aria-label="Volume"
    />
  </div>
</footer>

<style>
  .bar {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) minmax(280px, 2fr) minmax(140px, 1fr);
    align-items: center;
    gap: 16px;
    height: 76px;
    padding: 0 16px;
    background: var(--panel);
    border-top: 1px solid var(--line);
  }
  .track {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  img,
  .art-placeholder {
    width: 48px;
    height: 48px;
    border-radius: 6px;
    background: var(--panel-2);
    object-fit: cover;
    flex: none;
  }
  .meta {
    min-width: 0;
  }
  .title,
  .artist {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .artist {
    color: var(--muted);
    font-size: 12px;
    margin-top: 2px;
  }
  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 18px;
  }
  .controls button {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    color: var(--muted);
  }
  .controls button:hover {
    color: var(--text);
  }
  .controls .play {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--text);
    color: var(--bg);
  }
  .controls .play:hover {
    color: var(--bg);
    transform: scale(1.05);
  }
  svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }
  .progress {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    max-width: 560px;
    font-size: 11px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .progress input {
    flex: 1;
  }
  .right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    color: var(--muted);
  }
  .right input {
    width: 110px;
  }
  input[type="range"] {
    accent-color: var(--accent);
    height: 4px;
  }
</style>
