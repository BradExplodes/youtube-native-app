// Raw access to YouTube Music's browse pages and search, fetched by the hidden player window.
import { invoke } from "@tauri-apps/api/core";

export type BrowseRequest =
  | { browseId: string; params?: string }
  | { query: string; params?: string }
  | { continuation: string; search?: boolean };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Raw = any;

export const browseRaw = (request: BrowseRequest) => invoke<Raw>("browse", { request });

/** Actions on your account (liking, editing playlists) and the lyrics lookup.
 *  Only these endpoints are allowed (see src-tauri/src/library.rs). */
export type Action =
  | "next"
  | "like/like"
  | "like/removelike"
  | "browse/edit_playlist"
  | "playlist/create"
  | "playlist/delete"
  | "playlist/get_add_to_playlist";

export const ytmCall = (endpoint: Action, body: Record<string, unknown>) =>
  invoke<Raw>("ytm_call", { endpoint, body });

export const BROWSE = {
  likedSongs: "VLLM",
  playlists: "FEmusic_liked_playlists",
  albums: "FEmusic_liked_albums",
  artists: "FEmusic_library_corpus_track_artists",
} as const;
