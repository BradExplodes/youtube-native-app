// Shared player state for the UI, kept in sync with the hidden player window.
import { onAuth, onPlayback, onQueue, playerStatus, type Playback, type QueueItem } from "$lib/ipc";

const CONTEXT_KEY = "ytmn:context";
function readContext(): string | null {
  try {
    return localStorage.getItem(CONTEXT_KEY);
  } catch {
    return null;
  }
}

class PlayerStore {
  loggedIn = $state<boolean | null>(null);
  playback = $state.raw<Playback | null>(null);
  queue = $state.raw<QueueItem[]>([]);
  /** The page (browse id) playback was started from, to mark its tab and list.
   *  Remembered across restarts, like the last song itself. */
  #context = $state<string | null>(readContext());
  get context() {
    return this.#context;
  }
  set context(browseId: string | null) {
    this.#context = browseId;
    try {
      if (browseId) localStorage.setItem(CONTEXT_KEY, browseId);
      else localStorage.removeItem(CONTEXT_KEY);
    } catch {}
  }
  /** When `playback` arrived (performance.now()), to move the progress bar smoothly between updates. */
  receivedAt = $state(0);

  /** Set right after a seek, so updates sent before the seek landed can't snap the bar back. */
  private seekGuard: { target: number; at: number; until: number } | null = null;

  /** Where playback is now, moving on from the last update while playing. */
  positionNow(at = performance.now()) {
    const p = this.playback;
    if (!p) return 0;
    const pos = p.position + (p.playing ? (at - this.receivedAt) / 1000 : 0);
    return p.duration ? Math.min(pos, p.duration) : pos;
  }

  private set(next: Playback | null) {
    const now = performance.now();
    const prev = this.playback;
    if (next && prev && next.videoId === prev.videoId) {
      const guard = this.seekGuard;
      if (guard && now < guard.until && Math.abs(next.position - guard.target) > 2) {
        // A stale update from before the seek: keep showing the seek target.
        next = { ...next, position: guard.target + (next.playing ? (now - guard.at) / 1000 : 0) };
      } else {
        if (guard && Math.abs(next.position - guard.target) <= 2) this.seekGuard = null;
        // Small backwards corrections (timing jitter) would make the clock tick 1:13 -> 1:12.
        const expected = this.positionNow(now);
        if (next.playing && prev.playing && expected > next.position && expected - next.position < 1) {
          next = { ...next, position: expected };
        }
      }
    } else {
      this.seekGuard = null;
    }
    this.playback = next;
    this.receivedAt = now;
  }

  /** Called when the user seeks: show the new position immediately and hold it. */
  seeked(seconds: number) {
    const now = performance.now();
    this.seekGuard = { target: seconds, at: now, until: now + 2500 };
    if (this.playback) {
      this.playback = { ...this.playback, position: seconds };
      this.receivedAt = performance.now();
    }
  }

  async refresh() {
    const s = await playerStatus();
    this.loggedIn = s.loggedIn;
    this.set(s.playback);
    this.queue = s.queue?.items ?? [];
  }

  /** Subscribe to the player and catch up whenever the window becomes visible again. */
  async start() {
    const unlisten = await Promise.all([
      onAuth((v) => (this.loggedIn = v)),
      onPlayback((p) => this.set(p)),
      onQueue((items) => (this.queue = items)),
    ]);
    await this.refresh();
    // Rust skips progress events while we're minimized, so re-sync on restore.
    const onVisible = () => {
      if (document.visibilityState === "visible") this.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unlisten.forEach((u) => u());
      document.removeEventListener("visibilitychange", onVisible);
    };
  }

  /** Show a change straight away, before the player confirms it. */
  optimistic(patch: Partial<Playback>) {
    if (this.playback) this.set({ ...this.playback, ...patch });
  }
}

export const player = new PlayerStore();
