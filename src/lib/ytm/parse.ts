// Turn YouTube Music's raw browse responses into our own types.
//
// The response format is undocumented and changes over time; this follows the shapes
// seen in real responses (see __fixtures__) and the open-source ytmusicapi project
// (MIT licence, https://github.com/sigma67/ytmusicapi), whose parsers map out the
// same renderers. Everything is defensive: a missing field gives an empty value,
// never an exception.
import type { Raw } from "./api";
import type {
  ArtistBatch,
  ArtistRef,
  Card,
  CardBatch,
  LibraryArtist,
  Track,
  TrackBatch,
  TrackListPage,
} from "./types";

// ------------------------------------------------------------------ helpers

/** First value stored under `key` anywhere inside `obj` (depth-first). */
export function findKey(obj: Raw, key: string): Raw {
  if (!obj || typeof obj !== "object") return undefined;
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const hit = findKey(v, key);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const hit = findKey(v, key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

export const text = (t: Raw): string =>
  t?.runs ? t.runs.map((r: Raw) => r.text ?? "").join("") : (t?.simpleText ?? "");

/** The smallest thumbnail at least `size` px wide (or the biggest there is). */
export function pickThumbnail(thumbnails: Raw, size: number): string | undefined {
  if (!Array.isArray(thumbnails) || !thumbnails.length) return undefined;
  const sorted = [...thumbnails].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((t) => (t.width ?? 0) >= size) ?? sorted[sorted.length - 1]).url;
}

export const thumbnailsOf = (r: Raw): Raw =>
  r?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
  r?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
  r?.foregroundThumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
  r?.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails;

export const SEPARATOR = " • ";

export const flexRuns = (item: Raw, i: number): Raw[] =>
  item.flexColumns?.[i]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];

export const pageType = (run: Raw): string | undefined =>
  run?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig
    ?.pageType;

/** "A, B & C • 5 plays" -> [A, B, C]: everything before the first " • ". */
export function parseArtists(runs: Raw[]): ArtistRef[] {
  const out: ArtistRef[] = [];
  for (const run of runs) {
    const t: string = run.text ?? "";
    if (t === SEPARATOR) break;
    const id = run.navigationEndpoint?.browseEndpoint?.browseId;
    if (id) out.push({ name: t, id });
    else if (t.trim() && ![",", "&"].includes(t.trim())) out.push({ name: t.trim() });
  }
  return out;
}

// ------------------------------------------------------------------ tracks

/** One row of a track list (musicResponsiveListItemRenderer). Null if it can't be played. */
export function parseTrack(item: Raw, fallbackArtist?: string): Track | null {
  if (!item) return null;
  const titleRun = flexRuns(item, 0)[0];
  const videoId: string | undefined =
    item.playlistItemData?.videoId ??
    titleRun?.navigationEndpoint?.watchEndpoint?.videoId ??
    findKey(item.overlay, "videoId");
  if (!videoId || !titleRun) return null;

  let artists = parseArtists(flexRuns(item, 1));
  if (!artists.length && fallbackArtist) artists = [{ name: fallbackArtist }];

  let album: Track["album"];
  for (let i = 2; i < (item.flexColumns?.length ?? 0) && !album; i++) {
    const run = flexRuns(item, i).find((r) => pageType(r) === "MUSIC_PAGE_TYPE_ALBUM");
    if (run) album = { name: run.text, id: run.navigationEndpoint.browseEndpoint.browseId };
  }

  const badges = item.badges ?? [];
  return {
    ...rowExtras(item),
    videoId,
    title: titleRun.text ?? "",
    artists,
    album,
    duration: text(item.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text) || undefined,
    thumbnail: pickThumbnail(thumbnailsOf(item), 96),
    explicit: badges.some((b: Raw) => b.musicInlineBadgeRenderer?.icon?.iconType === "MUSIC_EXPLICIT_BADGE"),
    available: item.musicItemRendererDisplayPolicy !== "MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT",
  };
}

/** Like status and playlist row id, when the row carries them. */
export function rowExtras(item: Raw): Pick<Track, "liked" | "setVideoId"> {
  const status = findKey(item.menu, "likeStatus");
  const setVideoId = item.playlistItemData?.playlistSetVideoId;
  return {
    ...(status ? { liked: status === "LIKE" } : {}),
    ...(setVideoId ? { setVideoId } : {}),
  };
}

/** The continuation token at the end of a list's items, if there are more. */
export function tokenIn(items: Raw[] | undefined, legacy?: Raw): string | undefined {
  const last = items?.[items.length - 1];
  return (
    last?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ??
    legacy?.[0]?.nextContinuationData?.continuation ??
    undefined
  );
}

export function parseTracks(items: Raw[] | undefined, fallbackArtist?: string): Track[] {
  return (items ?? [])
    .map((i) => parseTrack(i?.musicResponsiveListItemRenderer, fallbackArtist))
    .filter((t): t is Track => !!t);
}

const HEADER_KEYS = [
  "musicResponsiveHeaderRenderer",
  "musicDetailHeaderRenderer",
  "musicVisualHeaderRenderer",
  "musicImmersiveHeaderRenderer",
  "musicHeaderRenderer",
];

/** Liked Songs, a playlist, an album or a library artist page. */
export function parseTrackListPage(raw: Raw): TrackListPage {
  let header: Raw;
  for (const k of HEADER_KEYS) if ((header = findKey(raw, k))) break;
  const shelf = findKey(raw, "musicPlaylistShelfRenderer") ?? findKey(raw, "musicShelfRenderer");
  const byline = text(header?.straplineTextOne);
  const tracks = parseTracks(shelf?.contents, byline || undefined);

  const canonical: string | undefined = raw?.microformat?.microformatDataRenderer?.urlCanonical;
  const fromUrl = canonical?.includes("list=") ? new URL(canonical).searchParams.get("list") : null;
  const fromRow = findKey(shelf?.contents?.[0], "watchEndpoint")?.playlistId;

  const editable = findKey(raw, "musicPlaylistEditHeaderRenderer");
  const privacy = editable?.privacy;
  return {
    title: text(header?.title),
    description: text(findKey(header?.description, "description") ?? header?.description),
    owned: !!editable,
    privacy: privacy === "PUBLIC" || privacy === "UNLISTED" || privacy === "PRIVATE" ? privacy : undefined,
    subtitle: text(header?.subtitle),
    secondSubtitle: text(header?.secondSubtitle),
    byline,
    thumbnail: pickThumbnail(thumbnailsOf(header), 300),
    playlistId: shelf?.playlistId ?? fromUrl ?? fromRow ?? undefined,
    tracks,
    continuation: tokenIn(shelf?.contents, shelf?.continuations),
  };
}

/** The items and next token from a continuation response, whichever format it uses. */
export function continuationParts(raw: Raw): { items: Raw[]; token?: string } {
  for (const action of raw?.onResponseReceivedActions ?? []) {
    const items = action?.appendContinuationItemsAction?.continuationItems;
    if (items) return { items, token: tokenIn(items) };
  }
  const contents = raw?.continuationContents;
  const part = contents && (Object.values(contents)[0] as Raw);
  if (part) {
    const items = part.contents ?? part.items ?? [];
    return { items, token: tokenIn(items, part.continuations) };
  }
  return { items: [] };
}

/** The next batch of a track list. */
export function parseTrackContinuation(raw: Raw, fallbackArtist?: string): TrackBatch {
  const { items, token } = continuationParts(raw);
  return { tracks: parseTracks(items, fallbackArtist), continuation: token };
}

// ------------------------------------------------------------------ library

function parseCard(r: Raw): Card | null {
  const browseId: string | undefined = r?.navigationEndpoint?.browseEndpoint?.browseId;
  if (!browseId) return null; // e.g. the "New playlist" button
  return {
    browseId,
    title: text(r.title),
    subtitle: text(r.subtitle),
    thumbnail: pickThumbnail(thumbnailsOf(r), 200),
    // Only your own playlists offer "Delete".
    owned: (r.menu?.menuRenderer?.items ?? []).some(
      (i: Raw) => Object.values(i ?? {}).some((v: Raw) => v?.icon?.iconType === "DELETE"),
    ),
  };
}

function parseCards(items: Raw[] | undefined, prefix: string): Card[] {
  return (items ?? [])
    .map((i) => parseCard(i?.musicTwoRowItemRenderer))
    .filter((c): c is Card => !!c && c.browseId.startsWith(prefix));
}

function parseGrid(raw: Raw, prefix: string): CardBatch {
  const grid = findKey(raw, "gridRenderer");
  return { items: parseCards(grid?.items, prefix), continuation: tokenIn(grid?.items, grid?.continuations) };
}

function parseGridContinuation(raw: Raw, prefix: string): CardBatch {
  const { items, token } = continuationParts(raw);
  return { items: parseCards(items, prefix), continuation: token };
}

/** Your playlists (Liked Music included), from FEmusic_liked_playlists. */
export const parseLibraryPlaylists = (raw: Raw) => parseGrid(raw, "VL");
export const parseLibraryPlaylistsContinuation = (raw: Raw) => parseGridContinuation(raw, "VL");
/** Your saved albums, from FEmusic_liked_albums. Empty when you have none. */
export const parseLibraryAlbums = (raw: Raw) => parseGrid(raw, "MPRE");
export const parseLibraryAlbumsContinuation = (raw: Raw) => parseGridContinuation(raw, "MPRE");

function parseArtistRows(items: Raw[] | undefined): LibraryArtist[] {
  return (items ?? [])
    .map((i): LibraryArtist | null => {
      const r = i?.musicResponsiveListItemRenderer;
      const browseId = r?.navigationEndpoint?.browseEndpoint?.browseId;
      if (!browseId) return null;
      return {
        browseId,
        name: text(r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text),
        subtitle: text(r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text),
        thumbnail: pickThumbnail(thumbnailsOf(r), 96),
      };
    })
    .filter((a): a is LibraryArtist => !!a);
}

/** Artists of the songs in your library, from FEmusic_library_corpus_track_artists. */
export function parseLibraryArtists(raw: Raw): ArtistBatch {
  const shelf = findKey(raw, "musicShelfRenderer");
  return { items: parseArtistRows(shelf?.contents), continuation: tokenIn(shelf?.contents, shelf?.continuations) };
}

export function parseLibraryArtistsContinuation(raw: Raw): ArtistBatch {
  const { items, token } = continuationParts(raw);
  return { items: parseArtistRows(items), continuation: token };
}
