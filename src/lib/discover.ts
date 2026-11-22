// Discovery: artists similar to the ones you play most (from their "Fans might also
// like" shelves on YouTube Music), and their top songs you've never played here.
//
// Your most-played artists come from the local listening history. Plays recorded
// since artist links were kept carry the artist's channel id; older ones only have a
// name, which is looked up with an artist search (and remembered on this computer).
import { invoke } from "@tauri-apps/api/core";
import { browseRaw } from "$lib/ytm/api";
import { SEARCH_FILTERS, parseArtistPage, parseFilteredSearch } from "$lib/ytm/search";
import type { ArtistPage, Tile, Track } from "$lib/ytm/types";

/** An artist you play a lot (from history_stats). */
interface ArtistStat {
  artist: string;
  artistId: string;
  plays: number;
}

export interface Seed {
  name: string;
  id: string;
}

export interface Related {
  tile: Tile;
  /** The artist of yours it's most like. */
  because: string;
  score: number;
}

export interface Discovery {
  artists: Tile[];
  tracks: Track[];
}

/** How many of your top artists to start from, and how many similar ones to use. */
const SEEDS = 5;
const RELATED_FOR_SONGS = 10;
const RELATED_SHOWN = 12;
const SONGS_PER_ARTIST = 3;
const MAX_TRACKS = 50;

export const fold = (s: string) =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** "A & B", "A, B", "A feat. B" -> "A": the main artist of a byline. */
export const mainArtist = (byline: string) => byline.split(/\s*(?:,|&|\bfeat\.?\s|\bft\.?\s)\s*/i)[0].trim();

/** The "Fans might also like" shelf: the one made only of artists. */
export function relatedArtists(page: ArtistPage): Tile[] {
  const shelf = page.shelves.find((s) => s.tiles.length >= 3 && s.tiles.every((t) => t.kind === "artist" && t.browseId));
  return shelf?.tiles ?? [];
}

/**
 * Similar artists, best first. An artist several of yours point to, or near the top of
 * their lists, comes first. Artists you already listen to (`known`: folded names and
 * channel ids) are left out: the point is something new.
 */
export function pickRelated(pages: { seed: Seed; related: Tile[] }[], known: Set<string>): Related[] {
  const byId = new Map<string, Related & { best: number }>();
  for (const { seed, related } of pages) {
    related.forEach((tile, i) => {
      const id = tile.browseId!;
      if (id === seed.id || known.has(id) || known.has(fold(tile.title))) return;
      const points = Math.max(1, 10 - i);
      const r = byId.get(id) ?? { tile, because: seed.name, score: 0, best: 0 };
      r.score += points;
      if (points > r.best) {
        r.best = points;
        r.because = seed.name;
      }
      byId.set(id, r);
    });
  }
  return [...byId.values()]
    .sort((a, b) => b.score - a.score || a.tile.title.localeCompare(b.tile.title))
    .map(({ tile, because, score }) => ({ tile, because, score }));
}

/** A few songs from each list in turn (A1 B1 C1 A2 B2…), so no artist comes in a row. */
export function interleave(lists: Track[][], perList: number, max: number): Track[] {
  const out: Track[] = [];
  const seen = new Set<string>();
  for (let round = 0; round < perList; round++) {
    for (const list of lists) {
      const t = list[round];
      if (t && !seen.has(t.videoId)) {
        seen.add(t.videoId);
        out.push(t);
      }
    }
  }
  return out.slice(0, max);
}

/** Run `fn` over `items`, a few at a time. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---------------------------------------------------------------- artist ids by name

const ID_CACHE = "ytmn.artistIds";

function cachedIds(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(ID_CACHE) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function rememberId(name: string, id: string) {
  try {
    localStorage.setItem(ID_CACHE, JSON.stringify({ ...cachedIds(), [fold(name)]: id }));
  } catch {
    // Storage unavailable: it's looked up again next time.
  }
}

/** An artist's channel id from their name: an artist search, taking an exact name match only. */
async function lookUpArtist(name: string): Promise<string | null> {
  const key = fold(name);
  const cached = cachedIds()[key];
  if (cached) return cached;
  const results = parseFilteredSearch(await browseRaw({ query: name, params: SEARCH_FILTERS.artists }));
  const wanted = new Set([key, fold(mainArtist(name))]);
  const hit = results.tiles.find((t) => t.kind === "artist" && t.browseId?.startsWith("UC") && wanted.has(fold(t.title)));
  if (hit?.browseId) rememberId(name, hit.browseId);
  return hit?.browseId ?? null;
}

// ---------------------------------------------------------------- putting it together

const DAY = 86_400;

/** Similar artists and their songs that are new to you, or null if there isn't enough history yet. */
export async function discover(): Promise<Discovery | null> {
  const tzOffsetMinutes = -new Date().getTimezoneOffset();
  const now = Math.floor(Date.now() / 1000);
  const [recent, allTime] = await Promise.all([
    invoke<{ topArtists: ArtistStat[] }>("history_stats", { since: now - 90 * DAY, tzOffsetMinutes, limit: 10 }),
    invoke<{ topArtists: ArtistStat[] }>("history_stats", { tzOffsetMinutes, limit: 1000 }),
  ]);
  const top = recent.topArtists.filter((a) => a.plays >= 3).slice(0, SEEDS);
  if (top.length < 2) return null;

  const known = new Set<string>();
  for (const a of allTime.topArtists) {
    known.add(fold(a.artist));
    known.add(fold(mainArtist(a.artist)));
    if (a.artistId) known.add(a.artistId);
  }

  const seeds = (
    await mapLimit(top, 3, async (a): Promise<Seed | null> => {
      const id = a.artistId || (await lookUpArtist(a.artist).catch(() => null));
      return id ? { name: mainArtist(a.artist) || a.artist, id } : null;
    })
  ).filter((s): s is Seed => !!s);
  for (const s of seeds) known.add(s.id);

  const pages = await mapLimit(seeds, 3, async (seed) => {
    try {
      return { seed, related: relatedArtists(parseArtistPage(await browseRaw({ browseId: seed.id }))) };
    } catch {
      return { seed, related: [] };
    }
  });
  const related = pickRelated(pages, known);
  if (!related.length) return null;

  // Their top songs, without ones you've played here or already like.
  const songLists = await mapLimit(related.slice(0, RELATED_FOR_SONGS), 3, async (r) => {
    try {
      const page = parseArtistPage(await browseRaw({ browseId: r.tile.browseId! }));
      return page.topSongs.filter((t) => t.available && !t.liked);
    } catch {
      return [];
    }
  });
  const all = songLists.flat();
  const counts = all.length ? await invoke<number[]>("history_play_counts", { videoIds: all.map((t) => t.videoId) }) : [];
  const unheard = new Set(all.filter((_, i) => !counts[i]).map((t) => t.videoId));
  const tracks = interleave(
    songLists.map((list) => list.filter((t) => unheard.has(t.videoId))),
    SONGS_PER_ARTIST,
    MAX_TRACKS,
  );

  return {
    artists: related.slice(0, RELATED_SHOWN).map((r) => ({ ...r.tile, subtitle: `Similar to ${r.because}` })),
    tracks,
  };
}
