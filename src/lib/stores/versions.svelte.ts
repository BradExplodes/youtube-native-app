// Other versions of a song: live performances and covers YouTube Music links to the song
// itself ("Other performances" on its Related page), plus sped-up, slowed, nightcore,
// remixed and covered uploads found by searching for it.
import { browseRaw, ytmCall, type Raw } from "$lib/ytm/api";
import { findKey, parseArtists, parseTrack, pickThumbnail, text, thumbnailsOf } from "$lib/ytm/parse";
import { SEARCH_FILTERS, parseFilteredSearch } from "$lib/ytm/search";
import type { Track } from "$lib/ytm/types";

export interface VersionsOf {
  videoId: string;
  title: string;
  artist: string;
}

/** Kinds of version, picked out of titles, for the filter chips. */
export const KINDS: { id: string; label: string; test: RegExp }[] = [
  { id: "sped", label: "Sped up", test: /sped[\s-]*up|speed[\s-]*up/i },
  { id: "slowed", label: "Slowed", test: /slowed|reverb/i },
  { id: "nightcore", label: "Nightcore", test: /nightcore/i },
  { id: "remix", label: "Remix", test: /remix|\bmix\b|bootleg|edit\)/i },
  { id: "live", label: "Live", test: /\blive\b|concert|session/i },
  { id: "acoustic", label: "Acoustic", test: /acoustic|unplugged|piano/i },
  { id: "cover", label: "Cover", test: /cover/i },
  { id: "instrumental", label: "Instrumental", test: /instrumental|karaoke/i },
];

export const kindsOf = (t: Track) => KINDS.filter((k) => k.test.test(t.title)).map((k) => k.id);

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** "Numb (Official Video) [Remastered] feat. X" -> "Numb": the part every version shares. */
export function baseTitle(title: string): string {
  let t = title.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  t = t.replace(/\s(feat\.?|ft\.?|featuring)\s.*$/i, " ");
  // "Artist - Title" uploads: keep the title.
  if (t.includes(" - ")) t = t.split(" - ").slice(1).join(" - ");
  return t.replace(/\s+/g, " ").trim() || title;
}

/** A video card on the Related page (musicTwoRowItemRenderer) as a track. */
function cardTrack(r: Raw): Track | null {
  const videoId: string | undefined = findKey(r?.navigationEndpoint, "videoId");
  if (!videoId) return null;
  return {
    videoId,
    title: text(r.title),
    artists: parseArtists(r.subtitle?.runs ?? []),
    thumbnail: pickThumbnail(thumbnailsOf(r), 226),
    explicit: false,
    available: true,
  };
}

/** YouTube Music's own "Other performances" (or "Other versions") shelf, if the song has one. */
async function performances(videoId: string): Promise<Track[]> {
  const next: Raw = await ytmCall("next", { videoId });
  const tabs: Raw[] = findKey(next, "tabs") ?? [];
  const related: string | undefined = tabs
    .map((t) => t?.tabRenderer?.endpoint?.browseEndpoint)
    .find(
      (b) =>
        b?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ===
          "MUSIC_PAGE_TYPE_TRACK_RELATED" || b?.browseId?.startsWith("MPTR"),
    )?.browseId;
  if (!related) return [];
  const page: Raw = await browseRaw({ browseId: related });
  const shelves: Raw[] = [];
  const walk = (o: Raw) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (o.musicCarouselShelfRenderer) shelves.push(o.musicCarouselShelfRenderer);
    else Object.values(o).forEach(walk);
  };
  walk(page);
  const shelf = shelves.find((s) => /other (performances|versions)/i.test(text(findKey(s.header, "title"))));
  return (shelf?.contents ?? [])
    .map((c: Raw) =>
      c.musicResponsiveListItemRenderer ? parseTrack(c.musicResponsiveListItemRenderer) : cardTrack(c.musicTwoRowItemRenderer),
    )
    .filter((t: Track | null): t is Track => !!t && t.videoId !== videoId);
}

/** Songs and videos whose titles contain the song's title, by any artist. */
async function uploads(song: VersionsOf): Promise<Track[]> {
  const base = baseTitle(song.title);
  const query = [base, song.artist].filter(Boolean).join(" ");
  const [songs, videos] = await Promise.all(
    (["songs", "videos"] as const).map((f) =>
      browseRaw({ query, params: SEARCH_FILTERS[f] })
        .then((raw) => parseFilteredSearch(raw).tracks)
        .catch(() => [] as Track[]),
    ),
  );
  const want = fold(base);
  const sameSong = (t: Track) =>
    fold(t.title) === fold(song.title) && fold(t.artists.map((a) => a.name).join(" ")).includes(fold(song.artist));
  return [...songs, ...videos].filter(
    (t) => t.videoId !== song.videoId && fold(t.title).includes(want) && !sameSong(t),
  );
}

class Versions {
  /** The song whose versions are open (null: the popup is closed). */
  song = $state.raw<VersionsOf | null>(null);
  performances = $state.raw<Track[]>([]);
  uploads = $state.raw<Track[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);

  async open(song: VersionsOf) {
    this.song = song;
    this.performances = [];
    this.uploads = [];
    this.error = null;
    this.loading = true;
    const [p, u] = await Promise.allSettled([performances(song.videoId), uploads(song)]);
    if (this.song !== song) return; // another song's versions were opened meanwhile
    this.performances = p.status === "fulfilled" ? p.value : [];
    const seen = new Set(this.performances.map((t) => t.videoId));
    this.uploads = u.status === "fulfilled" ? u.value.filter((t) => !seen.has(t.videoId) && seen.add(t.videoId)) : [];
    if (p.status === "rejected" && u.status === "rejected") this.error = String(u.reason?.message ?? u.reason);
    this.loading = false;
  }

  close() {
    this.song = null;
  }
}

export const versions = new Versions();
