// What our UI works with, independent of YouTube Music's raw response format.

export interface ArtistRef {
  name: string;
  /** Channel id (UC…) when YouTube Music links it. */
  id?: string;
}

export interface Track {
  videoId: string;
  title: string;
  artists: ArtistRef[];
  album?: { name: string; id: string };
  /** As shown, e.g. "3:07". */
  duration?: string;
  thumbnail?: string;
  explicit: boolean;
  /** False for tracks YouTube Music greys out (removed, region-blocked…). */
  available: boolean;
  /** In Liked Songs, when YouTube Music says (unknown otherwise). */
  liked?: boolean;
  /** This row's own id within a playlist: needed to remove it from that playlist. */
  setVideoId?: string;
}

/** A page that is mostly a track list: Liked Songs, a playlist, an album, a library artist. */
export interface TrackListPage {
  title: string;
  /** e.g. "Album • 2012" or "Playlist • Private • 2020". */
  subtitle: string;
  /** e.g. "13 songs • 52 minutes". */
  secondSubtitle: string;
  /** Album artist (shown above album titles). */
  byline: string;
  thumbnail?: string;
  /** The playlist to play the tracks in, so the queue continues through the list. */
  playlistId?: string;
  description: string;
  /** One of your own playlists: you can edit it and remove songs from it. */
  owned: boolean;
  privacy?: Privacy;
  tracks: Track[];
  /** Token for the next batch of tracks, if there are more. */
  continuation?: string;
}

export interface TrackBatch {
  tracks: Track[];
  continuation?: string;
}

/** A playlist or album card in the library. */
export interface Card {
  /** Browse id to open it: VL… (playlist) or MPREb_… (album). */
  browseId: string;
  title: string;
  subtitle: string;
  thumbnail?: string;
  /** One of your own playlists (you can edit and delete it). */
  owned: boolean;
}

export type Privacy = "PUBLIC" | "UNLISTED" | "PRIVATE";

export interface CardBatch {
  items: Card[];
  continuation?: string;
}

export interface LibraryArtist {
  /** MPLA… : your library's songs by this artist. */
  browseId: string;
  name: string;
  /** e.g. "12 songs". */
  subtitle: string;
  thumbnail?: string;
}

export interface ArtistBatch {
  items: LibraryArtist[];
  continuation?: string;
}

/** Something to open or play, shown as a card or row in search and on artist pages. */
export interface Tile {
  kind: "album" | "playlist" | "artist" | "song" | "video";
  title: string;
  /** e.g. "Album • Linkin Park • 2020" or "181m monthly audience". */
  subtitle: string;
  thumbnail?: string;
  /** To open it: MPRE… (album), VL… (playlist) or UC… (artist). */
  browseId?: string;
  /** To play it (songs and videos). */
  videoId?: string;
}

/** Everything a plain search finds, by kind. */
export interface SearchResults {
  /** The best match, with a few of its songs when it's an artist or album. */
  top?: { tile: Tile; tracks: Track[] };
  songs: Track[];
  videos: Track[];
  albums: Tile[];
  artists: Tile[];
  playlists: Tile[];
}

export type SearchFilter = "songs" | "videos" | "albums" | "artists" | "playlists";

/** One batch of a search narrowed to one kind (songs and videos come as tracks). */
export interface SearchBatch {
  tracks: Track[];
  tiles: Tile[];
  continuation?: string;
}

export interface ArtistPage {
  name: string;
  /** e.g. "181m monthly audience". */
  subtitle: string;
  /** A wide banner image. */
  thumbnail?: string;
  topSongs: Track[];
  /** The full "Top songs" playlist page (VL…), also what Play plays. */
  allSongsId?: string;
  shelves: { title: string; tiles: Tile[] }[];
}
