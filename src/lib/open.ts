// Opening and playing things found in search and on artist pages.
import { playerCmd } from "$lib/ipc";
import { nav } from "$lib/stores/nav.svelte";
import { player } from "$lib/stores/player.svelte";
import type { Tile } from "$lib/ytm/types";

/** Play one song or video on its own; YouTube Music follows it with a radio of similar music. */
export function playSingle(videoId: string) {
  player.context = null;
  playerCmd({ action: "load", videoId });
}

/** An artist link: their own page (UC…) or your library's songs by them (MPLA…). */
export function openArtist(id: string) {
  if (id.startsWith("UC")) nav.go({ kind: "artist", browseId: id });
  else if (id.startsWith("MPLA")) nav.go({ kind: "list", browseId: id });
}

export const canOpenArtist = (id?: string) => !!id && (id.startsWith("UC") || id.startsWith("MPLA"));

export function openAlbum(id: string) {
  nav.go({ kind: "list", browseId: id });
}

/** A card or row: open its page, or play it if it's a song or video. */
export function openTile(t: Tile) {
  if (t.kind === "artist" && t.browseId) openArtist(t.browseId);
  else if ((t.kind === "album" || t.kind === "playlist") && t.browseId) nav.go({ kind: "list", browseId: t.browseId });
  else if (t.videoId) playSingle(t.videoId);
}
