// Lyrics for the song playing now. Time-synced lyrics come from LRCLIB (lrclib.net, a
// free, open lyrics database: it's sent the song's title, artist, album and length).
// When it has none, YouTube Music's own lyrics are shown, as plain text.
import { browseRaw, ytmCall, type Raw } from "$lib/ytm/api";
import { findKey, text } from "$lib/ytm/parse";

export interface Line {
  /** Seconds into the song (synced lyrics only). */
  time?: number;
  text: string;
}

export interface Lyrics {
  lines: Line[];
  synced: boolean;
  /** e.g. "LRCLIB" or "Source: Musixmatch". */
  source: string;
}

export interface SongInfo {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
}

const LRCLIB = "https://lrclib.net/api";
// LRCLIB asks apps to say who they are; browsers can't set User-Agent, so it takes this header.
const CLIENT = { "Lrclib-Client": "YouTube Music Native v0.1.0" };

/** "[01:23.45] words" lines -> timed lines. Lines without a time are dropped. */
export function parseLrc(lrc: string): Line[] {
  const out: Line[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const words = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const s of stamps) out.push({ time: Number(s[1]) * 60 + Number(s[2]), text: words });
  }
  return out.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
}

const plainLines = (s: string): Line[] => s.split(/\r?\n/).map((text) => ({ text: text.trim() }));

/** "Artist A, Artist B & C" -> "Artist A": LRCLIB matches the main artist best. */
const mainArtist = (artist: string) => artist.split(/,| & | feat\.? | ft\.? /i)[0].trim();

interface LrclibRecord {
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

async function lrclib(song: SongInfo): Promise<LrclibRecord | null> {
  const artist = mainArtist(song.artist);
  const exact = new URLSearchParams({ track_name: song.title, artist_name: artist });
  if (song.album) exact.set("album_name", song.album);
  if (song.duration) exact.set("duration", String(Math.round(song.duration)));
  const res = await fetch(`${LRCLIB}/get?${exact}`, { headers: CLIENT });
  if (res.ok) return res.json();
  if (res.status !== 404) throw new Error(`LRCLIB answered ${res.status}`);

  // No exact match (album or length differ): search, and take the closest length.
  const q = new URLSearchParams({ track_name: song.title, artist_name: artist });
  const found = await fetch(`${LRCLIB}/search?${q}`, { headers: CLIENT });
  if (!found.ok) return null;
  const list = ((await found.json()) as LrclibRecord[]).filter((r) => r.syncedLyrics || r.plainLyrics);
  const off = (r: LrclibRecord) => (song.duration && r.duration ? Math.abs(r.duration - song.duration) : 0);
  const close = list.filter((r) => off(r) <= 4).sort((a, b) => off(a) - off(b) || +!!b.syncedLyrics - +!!a.syncedLyrics);
  if (close[0]) return close[0];
  // Only a different-length version (a remix, a sped-up edit…): its words still help,
  // but its timings wouldn't match, so offer it as plain lyrics only.
  const other = list.find((r) => r.plainLyrics);
  return other ? { ...other, syncedLyrics: null } : null;
}

/** YouTube Music's own lyrics: the "Lyrics" tab of the song's watch page. */
async function youtubeMusic(videoId: string): Promise<Lyrics | null> {
  const next: Raw = await ytmCall("next", { videoId });
  const tabs: Raw[] = findKey(next, "tabs") ?? [];
  const browseId: string | undefined = tabs
    .map((t) => t?.tabRenderer?.endpoint?.browseEndpoint)
    .find(
      (b) =>
        b?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ===
          "MUSIC_PAGE_TYPE_TRACK_LYRICS" || b?.browseId?.startsWith("MPLY"),
    )?.browseId;
  if (!browseId) return null;
  const page: Raw = await browseRaw({ browseId });
  const shelf = findKey(page, "musicDescriptionShelfRenderer");
  const body = text(shelf?.description);
  if (!body.trim()) return null;
  return { lines: plainLines(body), synced: false, source: text(shelf?.footer) || "YouTube Music" };
}

async function find(song: SongInfo): Promise<Lyrics | null> {
  let fromLrclib: LrclibRecord | null = null;
  try {
    fromLrclib = await lrclib(song);
  } catch {
    // LRCLIB unreachable: YouTube Music may still have them.
  }
  if (fromLrclib?.syncedLyrics) {
    const lines = parseLrc(fromLrclib.syncedLyrics);
    if (lines.length) return { lines, synced: true, source: "LRCLIB" };
  }
  if (fromLrclib?.instrumental) return { lines: [], synced: false, source: "LRCLIB" };
  const ytm = await youtubeMusic(song.videoId).catch(() => null);
  if (ytm) return ytm;
  if (fromLrclib?.plainLyrics) return { lines: plainLines(fromLrclib.plainLyrics), synced: false, source: "LRCLIB" };
  return null;
}

class LyricsStore {
  /** Which song `lyrics` belongs to. */
  videoId = $state<string | null>(null);
  lyrics = $state.raw<Lyrics | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  private cache = new Map<string, Lyrics | null>();

  async load(song: SongInfo) {
    if (song.videoId === this.videoId && (this.loading || this.lyrics || !this.error)) return;
    this.videoId = song.videoId;
    this.error = null;
    if (this.cache.has(song.videoId)) {
      this.lyrics = this.cache.get(song.videoId) ?? null;
      this.loading = false;
      return;
    }
    this.lyrics = null;
    this.loading = true;
    try {
      const found = await find(song);
      this.cache.set(song.videoId, found);
      if (this.videoId === song.videoId) this.lyrics = found;
    } catch (e) {
      if (this.videoId === song.videoId) this.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (this.videoId === song.videoId) this.loading = false;
    }
  }
}

export const lyrics = new LyricsStore();
