// Opening and playing things found in search and on artist pages.
import { playerCmd } from "$lib/ipc";
import { nav } from "$lib/stores/nav.svelte";
import { player } from "$lib/stores/player.svelte";
import type { BrowseLink, Tile } from "$lib/ytm/types";

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

/** Play a mix that has no page of its own (My Supermix and other radios). */
export function playMix(playlistId: string) {
  player.context = null;
  playerCmd({ action: "load", playlistId });
}

/** A card or row: open its page, or play it if it's a song, video or play-only mix. */
export function openTile(t: Tile) {
  if (t.kind === "artist" && t.browseId) openArtist(t.browseId);
  else if ((t.kind === "album" || t.kind === "playlist") && t.browseId) nav.go({ kind: "list", browseId: t.browseId });
  else if (t.videoId) playSingle(t.videoId);
  else if (t.playlistId) playMix(t.playlistId);
}

/** A shelf's "More", a genre button or a chart: the page it leads to, whichever kind it is. */
export function openLink(link: BrowseLink) {
  const id = link.browseId;
  if (!link.params && (id.startsWith("UC") || id.startsWith("MPLA"))) openArtist(id);
  else if (!link.params && (id.startsWith("VL") || id.startsWith("MPRE"))) nav.go({ kind: "list", browseId: id });
  else if (id === "FEmusic_home") nav.go({ kind: "home" });
  else nav.go({ kind: "browse", browseId: id, ...(link.params ? { params: link.params } : {}) });
}
