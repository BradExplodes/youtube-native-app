// "Made for you": mixes this app puts together from your listening history (worked
// out on this computer, see src-tauri/src/mixes.rs), plus "Liked, rarely played",
// which matches your Liked Songs against it.
import { invoke } from "@tauri-apps/api/core";
import { discover } from "$lib/discover";
import { library } from "$lib/stores/library.svelte";
import { BROWSE } from "$lib/ytm/api";
import type { Tile, Track } from "$lib/ytm/types";

interface RawMixTrack {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  artwork: string;
}

interface RawMix {
  id: string;
  title: string;
  description: string;
  tracks: RawMixTrack[];
}

export interface Mix {
  id: string;
  title: string;
  description: string;
  tracks: Track[];
}

export const LIKED_RARELY = "liked-rarely";
export const NEW_TO_YOU = "new-to-you";
const DISCOVERY_CACHE = "ytmn.discovery";
/** Fewer songs than this and a mix isn't worth offering (same as the Rust side). */
const MIN_TRACKS = 15;
const MAX_TRACKS = 50;

const tzOffsetMinutes = () => -new Date().getTimezoneOffset();
const today = () => new Date().toDateString();
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The same order all day, a different one tomorrow. */
function shuffledForToday<T>(items: T[]): T[] {
  let seed = [...today()].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const clock = (s: number) => (s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : undefined);

function toTrack(t: RawMixTrack): Track {
  return {
    videoId: t.videoId,
    title: t.title || "Unknown song",
    artists: t.artist ? [{ name: t.artist }] : [],
    duration: clock(t.duration),
    // Songs heard before covers were recorded: the video's own thumbnail (the cover, letterboxed).
    thumbnail: t.artwork || `https://i.ytimg.com/vi/${t.videoId}/hqdefault.jpg`,
    explicit: false,
    available: true,
  };
}

/** Up to four covers for a mix's card, from its first songs. */
export const coversOf = (tracks: Track[]) =>
  tracks
    .map((t) => t.thumbnail)
    .filter((u): u is string => !!u)
    .slice(0, 4);

class Mixes {
  list = $state.raw<Mix[]>([]);
  loaded = $state(false);
  error = $state<string | null>(null);
  private day = "";
  private loading = false;

  /** Fetch the mixes (again, if the day has changed since: they're worked out per day). */
  async load() {
    if (this.loading || (this.loaded && this.day === today())) return;
    this.loading = true;
    try {
      const raw = await invoke<RawMix[]>("history_mixes", { tzOffsetMinutes: tzOffsetMinutes() });
      this.list = raw.map((m) => ({ id: m.id, title: m.title, description: m.description, tracks: m.tracks.map(toTrack) }));
      this.day = today();
      this.error = null;
      if (this.day !== this.likedDay) this.likedRarely = null;
    } catch (e) {
      this.error = message(e);
    } finally {
      this.loaded = true;
      this.loading = false;
    }
  }

  get(id: string): Mix | undefined {
    if (id === NEW_TO_YOU) return this.newToYou ?? undefined;
    return this.list.find((m) => m.id === id);
  }

  // ---- Discovery: artists like the ones you play most, and their songs you haven't
  // heard here ("New to you"). It takes a dozen or so page fetches, so it's worked out
  // once a day, in the background, and kept on this computer until tomorrow.

  /** Similar artists, for the "Artists you might like" shelf. */
  similarArtists = $state.raw<Tile[]>([]);
  newToYou = $state.raw<Mix | null>(null);
  discoveryLoading = $state(false);
  /** Worked out (or found to need more history) for today. */
  discoveryDone = $state(false);
  private discoveryDay = "";

  async loadDiscovery() {
    if (this.discoveryLoading || this.discoveryDay === today()) return;
    const cached = readDiscovery();
    if (cached) return this.setDiscovery(cached.artists, cached.tracks);
    this.discoveryLoading = true;
    try {
      const found = await discover();
      this.setDiscovery(found?.artists ?? [], found?.tracks ?? []);
      writeDiscovery(this.similarArtists, this.newToYou?.tracks ?? []);
    } catch {
      // Offline, or YouTube Music changed something: try again next time Home opens.
      this.discoveryDone = true;
    } finally {
      this.discoveryLoading = false;
    }
  }

  private setDiscovery(artists: Tile[], tracks: Track[]) {
    this.similarArtists = artists;
    this.newToYou =
      tracks.length >= MIN_TRACKS
        ? {
            id: NEW_TO_YOU,
            title: "New to you",
            description: "Top songs from artists like the ones you play most",
            tracks: tracks.slice(0, MAX_TRACKS),
          }
        : null;
    this.discoveryDay = today();
    this.discoveryDone = true;
  }

  // ---- Liked, rarely played: only worked out when you open it, since it needs all of
  // Liked Songs (which can be thousands of songs, fetched in batches).

  likedRarely = $state.raw<Mix | null>(null);
  likedLoading = $state(false);
  likedError = $state<string | null>(null);
  private likedDay = "";

  /** Offered once there's enough history for the other mixes to mean something. */
  get offerLikedRarely() {
    return this.list.length > 0;
  }

  async loadLikedRarely() {
    if (this.likedLoading || (this.likedRarely && this.likedDay === today())) return;
    this.likedLoading = true;
    this.likedError = null;
    try {
      const page = library.page(BROWSE.likedSongs);
      await page.load();
      await page.all();
      if (page.error) throw new Error(page.error);
      const liked = page.tracks.filter((t) => t.available);
      const counts = await invoke<number[]>("history_play_counts", { videoIds: liked.map((t) => t.videoId) });
      // A different handful each day, rather than always your most recent likes.
      const rarely = shuffledForToday(liked.filter((_, i) => (counts[i] ?? 0) <= 1));
      this.likedRarely = {
        id: LIKED_RARELY,
        title: "Liked, rarely played",
        description: "Songs you've liked but hardly ever play here",
        tracks: rarely.length >= MIN_TRACKS ? rarely.slice(0, MAX_TRACKS) : [],
      };
      this.likedDay = today();
    } catch (e) {
      this.likedError = message(e);
    } finally {
      this.likedLoading = false;
    }
  }
}

function readDiscovery(): { artists: Tile[]; tracks: Track[] } | null {
  try {
    const v = JSON.parse(localStorage.getItem(DISCOVERY_CACHE) ?? "null");
    if (!v || v.day !== today() || !Array.isArray(v.artists) || !Array.isArray(v.tracks)) return null;
    return { artists: v.artists, tracks: v.tracks };
  } catch {
    return null;
  }
}

function writeDiscovery(artists: Tile[], tracks: Track[]) {
  try {
    localStorage.setItem(DISCOVERY_CACHE, JSON.stringify({ day: today(), artists, tracks }));
  } catch {
    // Storage unavailable: it's worked out again next time.
  }
}

export const mixes = new Mixes();
