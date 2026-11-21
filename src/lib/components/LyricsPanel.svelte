<script lang="ts">
  // Lyrics for the song playing now, in the panel on the right. Synced lyrics follow the
  // song (click a line to jump there); plain lyrics just scroll.
  import { X } from "@lucide/svelte";
  import { playerCmd } from "$lib/ipc";
  import { lyrics } from "$lib/stores/lyrics.svelte";
  import { player } from "$lib/stores/player.svelte";
  import { ui } from "$lib/stores/ui.svelte";

  const p = $derived(player.playback);
  // Playback updates every second; these only change with the song.
  const videoId = $derived(p?.videoId ?? null);
  const song = $derived.by(() => {
    if (!videoId || !p) return null;
    return { videoId, title: p.title, artist: p.artist, album: p.album, duration: Math.round(p.duration) };
  });
  const songKey = $derived(song ? JSON.stringify(song) : "");

  // Keyed on the text, so it runs once per song rather than on every playback update.
  $effect(() => {
    if (songKey) lyrics.load(JSON.parse(songKey));
  });

  const current = $derived(lyrics.videoId === p?.videoId ? lyrics.lyrics : null);
  const synced = $derived(!!current?.synced);

  // The song's position, a few times a second while it plays.
  let now = $state(performance.now());
  $effect(() => {
    if (!synced || !p?.playing) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") now = performance.now();
    }, 200);
    return () => clearInterval(id);
  });
  // A little early, so a line lights up as it's sung rather than just after.
  const position = $derived(player.positionNow(now) + 0.25);
  const active = $derived.by(() => {
    if (!synced || !current) return -1;
    let at = -1;
    for (let i = 0; i < current.lines.length; i++) {
      if ((current.lines[i].time ?? 0) <= position) at = i;
      else break;
    }
    return at;
  });

  // Keep the sung line in the middle, unless you've just scrolled to read ahead.
  let scroller = $state<HTMLDivElement>();
  let userScrolledAt = 0;
  $effect(() => {
    if (active < 0 || !scroller || performance.now() - userScrolledAt < 4000) return;
    const el = scroller.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (!el) return;
    scroller.scrollTo({ top: el.offsetTop - scroller.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" });
  });
  // A new song starts at the top.
  $effect(() => {
    void videoId;
    scroller?.scrollTo({ top: 0 });
    userScrolledAt = 0;
  });

  function seek(time: number | undefined) {
    if (time === undefined) return;
    userScrolledAt = 0;
    player.seeked(time);
    now = performance.now();
    playerCmd({ action: "seek", seconds: time });
  }
</script>

<aside class="lyrics" aria-label="Lyrics">
  <header>
    <div class="head-text">
      <h2>Lyrics</h2>
      {#if p}<span class="song truncate">{p.title}</span>{/if}
    </div>
    <button class="icon-btn" aria-label="Close lyrics" onclick={() => ui.toggleLyrics()}>
      <X size={18} />
    </button>
  </header>

  <div class="scroll" bind:this={scroller} onwheel={() => (userScrolledAt = performance.now())}>
    {#if !p}
      <p class="note">Play something to see its lyrics.</p>
    {:else if lyrics.loading || lyrics.videoId !== p.videoId}
      <p class="note">Looking for lyrics…</p>
    {:else if lyrics.error}
      <div class="note">
        <p>Couldn't load lyrics: {lyrics.error}</p>
      </div>
    {:else if !current}
      <p class="note">No lyrics found for this song.</p>
    {:else if !current.lines.length}
      <p class="note">This one's an instrumental.</p>
    {:else}
      <div class="lines" class:synced>
        {#each current.lines as line, i (i)}
          {#if synced}
            <button
              class="line"
              class:active={i === active}
              class:past={i < active}
              class:gap={!line.text}
              data-line={i}
              onclick={() => seek(line.time)}
            >
              {line.text || "♪"}
            </button>
          {:else}
            <p class="line" class:gap={!line.text}>{line.text}</p>
          {/if}
        {/each}
      </div>
      <p class="source">{current.source}</p>
    {/if}
  </div>
</aside>

<style>
  .lyrics {
    display: flex;
    flex-direction: column;
    min-height: 0;
    margin: 0 12px;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--surface);
    border: 1px solid var(--line);
    border-bottom: 0;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 16px 10px 8px 20px;
  }
  .head-text {
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 500;
    letter-spacing: -0.01em;
  }
  .song {
    display: block;
    color: var(--muted);
    font-size: 12.5px;
  }
  .scroll {
    /* Lines measure their offsetTop from here, for scrolling the sung line into the middle. */
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 20px var(--player-clearance);
    /* Fade the lines out at the top and bottom edges. */
    mask-image: linear-gradient(transparent, #000 24px, #000 calc(100% - 64px), transparent);
  }
  .note {
    margin: 10px 0;
    color: var(--muted);
    font-size: 13px;
  }
  .lines {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 0 40px;
  }
  .line {
    margin: 0;
    padding: 4px 0;
    color: var(--text);
    font-size: 16px;
    font-weight: 600;
    line-height: 1.4;
    text-align: left;
    user-select: text;
  }
  .line.gap {
    height: 12px;
    padding: 0;
  }
  .synced .line {
    padding: 6px 8px;
    margin: 0 -8px;
    border-radius: 8px;
    color: var(--faint);
    font-size: 19px;
    font-weight: 700;
    letter-spacing: -0.01em;
    transition:
      color 0.25s,
      transform 0.25s var(--ease);
    transform-origin: left center;
    user-select: none;
  }
  .synced .line.gap {
    height: auto;
    padding: 6px 8px;
  }
  .synced .line:hover {
    color: var(--muted);
    background: rgb(255 255 255 / 0.04);
  }
  .synced .line.past {
    color: color-mix(in srgb, var(--muted) 70%, transparent);
  }
  .synced .line.active {
    color: var(--text);
    transform: scale(1.03);
  }
  .source {
    margin: 0 0 12px;
    color: var(--faint);
    font-size: 11.5px;
  }
</style>
