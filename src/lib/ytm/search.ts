// Search results and artist pages, from YouTube Music's raw responses.
//
// Results are classified by where they lead (an album, playlist or artist page, or
// a song or video to play), never by their localised labels ("Song", "Album"…).
// Same defensive style as parse.ts: missing fields give empty values, not errors.
import type { Raw } from "./api";
import {
  rowExtras,
  SEPARATOR,
  continuationParts,
  findKey,
  flexRuns,
  pageType,
  parseArtists,
  parseTracks,
  pickThumbnail,
  text,
  thumbnailsOf,
} from "./parse";
import type { ArtistPage, SearchBatch, SearchFilter, SearchResults, Tile, Track } from "./types";

/** Search params that narrow results to one kind, as YouTube Music's own filter chips send. */
export const SEARCH_FILTERS: Record<SearchFilter, string> = {
  songs: "EgWKAQIIAWoQEAUQCRADEAQQChAVEBAQEQ%3D%3D",
  videos: "EgWKAQIQAWoQEAUQCRADEAQQChAVEBAQEQ%3D%3D",
  albums: "EgWKAQIYAWoQEAUQCRADEAQQChAVEBAQEQ%3D%3D",
  artists: "EgWKAQIgAWoQEAUQCRADEAQQChAVEBAQEQ%3D%3D",
  playlists: "EgeKAQQoAEABahAQBRAJEAMQBBAKEBUQEBAR",
};

const DURATION = /^\d+(:\d\d)+$/;

const KIND_BY_PAGE: Record<string, Tile["kind"]> = {
  MUSIC_PAGE_TYPE_ALBUM: "album",
  MUSIC_PAGE_TYPE_PLAYLIST: "playlist",
  MUSIC_PAGE_TYPE_ARTIST: "artist",
};

/** Song (the audio track) or video, from the watch endpoint's music video type.
 *  Null for podcast episodes, which we don't show. */
function watchKind(item: Raw): "song" | "video" | null {
  const type: string | undefined = findKey(item, "musicVideoType");
  if (type === "MUSIC_VIDEO_TYPE_PODCAST_EPISODE") return null;
  return type === "MUSIC_VIDEO_TYPE_ATV" ? "song" : "video";
}

const videoIdOf = (r: Raw): string | undefined =>
  r.playlistItemData?.videoId ??
  flexRuns(r, 0)[0]?.navigationEndpoint?.watchEndpoint?.videoId ??
  findKey(r.overlay, "videoId");

/** The second column's runs. In a plain search it starts with the kind ("Song • "),
 *  which isn't part of the artist list. */
function detailRuns(r: Raw, typed: boolean): Raw[] {
  const runs = flexRuns(r, 1);
  if (typed && runs.length >= 2 && !runs[0].navigationEndpoint && runs[1].text === SEPARATOR) return runs.slice(2);
  if (typed && runs.length === 1 && !runs[0].navigationEndpoint) return [];
  return runs;
}

function rowTrack(r: Raw, typed: boolean, fallbackArtist?: string): Track | null {
  const titleRun = flexRuns(r, 0)[0];
  const videoId = videoIdOf(r);
  if (!titleRun || !videoId) return null;
  const runs = detailRuns(r, typed);
  let artists = parseArtists(runs.filter((run) => !DURATION.test(run.text ?? "")));
  if (!artists.length && fallbackArtist) artists = [{ name: fallbackArtist }];
  const albumRun = runs.find((run) => pageType(run) === "MUSIC_PAGE_TYPE_ALBUM");
  const duration =
    [...runs].reverse().find((run) => DURATION.test(run.text ?? ""))?.text ??
    (text(r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text) || undefined);
  const badges = r.badges ?? [];
  return {
    ...rowExtras(r),
    videoId,
    title: titleRun.text ?? "",
    artists,
    album: albumRun ? { name: albumRun.text, id: albumRun.navigationEndpoint.browseEndpoint.browseId } : undefined,
    duration,
    thumbnail: pickThumbnail(thumbnailsOf(r), 96),
    explicit: badges.some((b: Raw) => b.musicInlineBadgeRenderer?.icon?.iconType === "MUSIC_EXPLICIT_BADGE"),
    available: r.musicItemRendererDisplayPolicy !== "MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT",
  };
}

/** An album, playlist or artist row. Null for anything else (profiles, podcasts…). */
function rowTile(r: Raw, typed: boolean): Tile | null {
  const browse = r.navigationEndpoint?.browseEndpoint;
  const kind = KIND_BY_PAGE[pageType({ navigationEndpoint: r.navigationEndpoint }) ?? ""];
  if (!browse?.browseId || !kind) return null;
  const runs = kind === "artist" ? detailRuns(r, typed) : flexRuns(r, 1);
  return {
    kind,
    title: text(r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text),
    subtitle: runs.map((run) => run.text ?? "").join(""),
    thumbnail: pickThumbnail(thumbnailsOf(r), kind === "artist" ? 226 : 200),
    browseId: browse.browseId,
  };
}

type Row = { track: Track; kind: "song" | "video" } | { tile: Tile };

function parseRow(item: Raw, typed: boolean, fallbackArtist?: string): Row | null {
  const r = item?.musicResponsiveListItemRenderer;
  if (!r) return null;
  if (videoIdOf(r) && !r.navigationEndpoint?.browseEndpoint) {
    const kind = watchKind(r);
    const track = kind && rowTrack(r, typed, fallbackArtist);
    return track && kind ? { track, kind } : null;
  }
  const tile = rowTile(r, typed);
  return tile ? { tile } : null;
}

/** The rows of a plain search: `itemSectionRenderer`s of one item each (current
 *  layout) or titled `musicShelfRenderer`s (older layout). */
function searchRows(raw: Raw): Raw[] {
  const sections: Raw[] = findKey(raw, "sectionListRenderer")?.contents ?? [];
  return sections.flatMap((s: Raw) => s.itemSectionRenderer?.contents ?? s.musicShelfRenderer?.contents ?? []);
}

function topResult(raw: Raw): SearchResults["top"] {
  const card = findKey(raw, "musicCardShelfRenderer");
  if (!card) return undefined;
  const endpoint = card.title?.runs?.[0]?.navigationEndpoint ?? card.onTap;
  const browse = endpoint?.browseEndpoint;
  const watch = endpoint?.watchEndpoint;
  let tile: Tile | null = null;
  const base = {
    title: text(card.title),
    subtitle: text(card.subtitle),
    thumbnail: pickThumbnail(thumbnailsOf(card), 226),
  };
  const kind = KIND_BY_PAGE[pageType({ navigationEndpoint: endpoint }) ?? ""];
  if (browse?.browseId && kind) tile = { ...base, kind, browseId: browse.browseId };
  else if (watch?.videoId) {
    const wk = watchKind({ watch });
    if (wk) tile = { ...base, kind: wk, videoId: watch.videoId };
  }
  if (!tile) return undefined;
  const fallback = tile.kind === "artist" ? tile.title : undefined;
  const tracks = (card.contents ?? [])
    .map((c: Raw) => parseRow(c, true, fallback))
    .flatMap((row: Row | null) => (row && "track" in row ? [row.track] : []));
  return { tile, tracks };
}

/** A plain search: the top result plus everything else grouped by kind. */
export function parseSearch(raw: Raw): SearchResults {
  const out: SearchResults = { top: topResult(raw), songs: [], videos: [], albums: [], artists: [], playlists: [] };
  for (const item of searchRows(raw)) {
    const row = parseRow(item, true);
    if (!row) continue;
    if ("track" in row) (row.kind === "song" ? out.songs : out.videos).push(row.track);
    else if (row.tile.kind === "album") out.albums.push(row.tile);
    else if (row.tile.kind === "artist") out.artists.push(row.tile);
    else if (row.tile.kind === "playlist") out.playlists.push(row.tile);
  }
  return out;
}

function batchOf(items: Raw[], token?: string): SearchBatch {
  const out: SearchBatch = { tracks: [], tiles: [], continuation: token };
  for (const item of items) {
    const row = parseRow(item, false);
    if (!row) continue;
    if ("track" in row) out.tracks.push(row.track);
    else out.tiles.push(row.tile);
  }
  return out;
}

/** The first batch of a search narrowed to one kind (with `SEARCH_FILTERS`). */
export function parseFilteredSearch(raw: Raw): SearchBatch {
  const shelf = findKey(raw, "musicShelfRenderer");
  const items: Raw[] = shelf?.contents ?? [];
  const last = items[items.length - 1];
  const token =
    last?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ??
    shelf?.continuations?.[0]?.nextContinuationData?.continuation;
  return batchOf(items, token);
}

/** The next batch of a narrowed search. */
export function parseSearchContinuation(raw: Raw): SearchBatch {
  const { items, token } = continuationParts(raw);
  return batchOf(items, token);
}

// ------------------------------------------------------------------ artist pages

/** A card in a carousel (musicTwoRowItemRenderer). */
function twoRowTile(r: Raw): Tile | null {
  if (!r) return null;
  const base = { title: text(r.title), subtitle: text(r.subtitle) };
  const browse = r.navigationEndpoint?.browseEndpoint;
  const kind = KIND_BY_PAGE[pageType({ navigationEndpoint: r.navigationEndpoint }) ?? ""];
  if (browse?.browseId && kind) {
    return { ...base, kind, browseId: browse.browseId, thumbnail: pickThumbnail(thumbnailsOf(r), 226) };
  }
  const videoId = r.navigationEndpoint?.watchEndpoint?.videoId;
  const wk = videoId && watchKind(r.navigationEndpoint);
  if (videoId && wk) return { ...base, kind: wk, videoId, thumbnail: pickThumbnail(thumbnailsOf(r), 320) };
  return null;
}

/** An artist's page (UC…): header, top songs and their carousels. */
export function parseArtistPage(raw: Raw): ArtistPage {
  const header = findKey(raw, "musicImmersiveHeaderRenderer") ?? findKey(raw, "musicVisualHeaderRenderer");
  const name = text(header?.title);
  const sections: Raw[] = findKey(raw, "sectionListRenderer")?.contents ?? [];
  const page: ArtistPage = {
    name,
    subtitle:
      text(header?.monthlyListenerCount) ||
      text(findKey(header?.subscriptionButton, "longSubscriberCountText")) ||
      "",
    thumbnail: pickThumbnail(thumbnailsOf(header), 1440),
    topSongs: [],
    shelves: [],
  };
  for (const s of sections) {
    if (s.musicShelfRenderer && !page.topSongs.length) {
      const shelf = s.musicShelfRenderer;
      page.topSongs = parseTracks(shelf.contents, name);
      page.allSongsId =
        shelf.bottomEndpoint?.browseEndpoint?.browseId ?? shelf.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
    } else if (s.musicCarouselShelfRenderer) {
      const c = s.musicCarouselShelfRenderer;
      const tiles = (c.contents ?? [])
        .map((i: Raw) => twoRowTile(i.musicTwoRowItemRenderer))
        .filter((t: Tile | null): t is Tile => !!t);
      if (tiles.length) page.shelves.push({ title: text(c.header?.musicCarouselShelfBasicHeaderRenderer?.title), tiles });
    }
  }
  return page;
}
