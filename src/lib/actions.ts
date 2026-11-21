// Changes to your YouTube Music account: liking songs and editing your playlists.
// Each one shows its result straight away, tells you how it went, and puts things back
// if YouTube Music says no.
import { library } from "$lib/stores/library.svelte";
import { likes } from "$lib/stores/likes.svelte";
import { nav } from "$lib/stores/nav.svelte";
import { toasts } from "$lib/stores/toast.svelte";
import { ui } from "$lib/stores/ui.svelte";
import { memberships } from "$lib/stores/membership.svelte";
import { BROWSE, browseRaw, ytmCall, type Raw } from "$lib/ytm/api";
import { parseTrackListPage } from "$lib/ytm/parse";
import type { Privacy } from "$lib/ytm/types";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** VL… browse id -> playlist id, and back. */
export const playlistIdOf = (browseId: string) => (browseId.startsWith("VL") ? browseId.slice(2) : browseId);
export const browseIdOf = (playlistId: string) => (playlistId.startsWith("VL") ? playlistId : `VL${playlistId}`);

/** A song as far as these actions need it. */
export interface SongRef {
  videoId: string;
  title: string;
}

/** YouTube Music answers some failures with 200 and a status instead. */
function check(res: Raw) {
  const status: string | undefined = res?.status;
  if (status && status !== "STATUS_SUCCEEDED") throw new Error(status.replace(/^STATUS_/, "").toLowerCase());
  return res;
}

// ------------------------------------------------------------------ likes

export async function setLiked(song: SongRef, liked: boolean) {
  const before = likes.get(song.videoId);
  likes.set(song.videoId, liked);
  const page = library.openedPage(BROWSE.likedSongs);
  if (!liked) page?.remove((t) => t.videoId === song.videoId);
  try {
    await ytmCall(liked ? "like/like" : "like/removelike", { target: { videoId: song.videoId } });
    toasts.show(liked ? "Added to Liked Songs" : "Removed from Liked Songs");
    // A new like goes to the top of Liked Songs: fetch it again to show it there.
    if (liked) page?.refresh();
  } catch (e) {
    likes.set(song.videoId, before);
    if (!liked) page?.refresh();
    toasts.error(`Couldn't ${liked ? "like" : "unlike"} "${song.title}": ${message(e)}`);
  }
}

// ------------------------------------------------------------------ playlists

const playlistTitle = (browseId: string) =>
  library.playlists.items.find((p) => p.browseId === browseId)?.title ??
  library.openedPage(browseId)?.info?.title ??
  "the playlist";

async function editPlaylist(browseId: string, actions: Record<string, unknown>[]) {
  return check(await ytmCall("browse/edit_playlist", { playlistId: playlistIdOf(browseId), actions }));
}

/** Add songs to a playlist, at the top (YouTube Music adds at the end, so they're moved up). */
export async function addToPlaylist(browseId: string, songs: SongRef[]) {
  if (!songs.length) return;
  const title = playlistTitle(browseId);
  for (const s of songs) memberships.mark(s.videoId, browseId, true);
  try {
    const res = await editPlaylist(
      browseId,
      // Songs already in the playlist are skipped rather than added twice.
      songs.map((s) => ({ action: "ACTION_ADD_VIDEO", addedVideoId: s.videoId, dedupeOption: "DEDUPE_OPTION_SKIP" })),
    );
    await moveToTop(browseId, addedRows(res));
    toasts.show(songs.length === 1 ? `Added to ${title}` : `Added ${songs.length} songs to ${title}`);
    library.openedPage(browseId)?.refresh();
    library.playlists.reload(); // track counts
  } catch (e) {
    for (const s of songs) memberships.mark(s.videoId, browseId, false);
    toasts.error(`Couldn't add to ${title}: ${message(e)}`);
  }
}

/** The playlist row ids (setVideoId) YouTube Music gave the songs it just added. */
function addedRows(res: Raw): string[] {
  const out: string[] = [];
  for (const r of res?.playlistEditResults ?? []) {
    const id = r?.playlistEditVideoAddedResultData?.setVideoId;
    if (id) out.push(id);
  }
  return out;
}

/** Move just-added rows above what was the first song, keeping their order. Best effort:
 *  if it fails the songs are still in the playlist, just at the end. */
async function moveToTop(browseId: string, rows: string[]) {
  if (!rows.length) return;
  try {
    const page = parseTrackListPage(await browseRaw({ browseId }));
    const first = page.tracks.find((t) => t.setVideoId && !rows.includes(t.setVideoId))?.setVideoId;
    // Already at the top (a playlist sorted newest first), or it was empty.
    if (!first || page.tracks[0]?.setVideoId === rows[0]) return;
    await editPlaylist(
      browseId,
      rows.map((setVideoId) => ({ action: "ACTION_MOVE_VIDEO_BEFORE", setVideoId, movedSetVideoIdSuccessor: first })),
    );
  } catch {
    // Left at the end.
  }
}

/** Remove a song from a playlist without knowing its row (from the "Add to playlist" ticks). */
export async function removeSongFromPlaylist(browseId: string, song: SongRef, actions?: Record<string, unknown>[]) {
  const title = playlistTitle(browseId);
  memberships.mark(song.videoId, browseId, false);
  const page = library.openedPage(browseId);
  page?.remove((t) => t.videoId === song.videoId);
  try {
    await editPlaylist(browseId, actions ?? [{ action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID", removedVideoId: song.videoId }]);
    toasts.show(`Removed from ${title}`);
    library.playlists.reload();
  } catch (e) {
    memberships.mark(song.videoId, browseId, true);
    page?.refresh();
    toasts.error(`Couldn't remove "${song.title}" from ${title}: ${message(e)}`);
  }
}

/** Remove one row from a playlist. Needs the row's own id (`setVideoId`). */
export async function removeFromPlaylist(browseId: string, song: SongRef & { setVideoId: string }) {
  const title = playlistTitle(browseId);
  const page = library.openedPage(browseId);
  page?.remove((t) => t.setVideoId === song.setVideoId);
  memberships.mark(song.videoId, browseId, false);
  try {
    await editPlaylist(browseId, [
      { action: "ACTION_REMOVE_VIDEO", setVideoId: song.setVideoId, removedVideoId: song.videoId },
    ]);
    toasts.show(`Removed from ${title}`);
    library.playlists.reload();
  } catch (e) {
    page?.refresh();
    toasts.error(`Couldn't remove "${song.title}" from ${title}: ${message(e)}`);
  }
}

/** Moves waiting to be saved, per playlist: each is sent after the one before it, so
 *  YouTube Music applies them in the order you made them. */
const moveQueues = new Map<string, Promise<void>>();

/** Move one row of a playlist into the gap before row `gap` (`gap` = the length: to the
 *  end). It moves on screen straight away. YouTube Music then saves it as "move before
 *  this row", or "move to the end" when nothing follows it. */
export function moveInPlaylist(browseId: string, from: number, gap: number) {
  const page = library.openedPage(browseId);
  if (!page || gap === from || gap === from + 1) return;
  const moved = page.tracks[from];
  const successor = page.tracks[gap]; // undefined: to the end
  // Every row needs its own id. Also refuse to move past rows that haven't loaded yet:
  // with no row after it, "the end" would be the end of the loaded rows, not the playlist.
  if (!moved?.setVideoId || (successor ? !successor.setVideoId : page.hasMore)) return;
  page.move(from, gap);

  const action: Record<string, unknown> = { action: "ACTION_MOVE_VIDEO_BEFORE", setVideoId: moved.setVideoId };
  if (successor) action.movedSetVideoIdSuccessor = successor.setVideoId;
  const saved = (moveQueues.get(browseId) ?? Promise.resolve()).then(async () => {
    try {
      await editPlaylist(browseId, [action]);
    } catch (e) {
      // Show the order YouTube Music actually has.
      page.refresh();
      toasts.error(`Couldn't move "${moved.title}" in ${playlistTitle(browseId)}: ${message(e)}`);
    }
  });
  moveQueues.set(browseId, saved);
}

export interface PlaylistDetails {
  title: string;
  description: string;
  privacy: Privacy;
}

/** Make a new playlist, optionally with songs in it. Returns its browse id. */
export async function createPlaylist(details: PlaylistDetails, songs: SongRef[] = []): Promise<string | null> {
  try {
    const res = await ytmCall("playlist/create", {
      title: details.title,
      description: details.description,
      privacyStatus: details.privacy,
      ...(songs.length ? { videoIds: songs.map((s) => s.videoId) } : {}),
    });
    const id: string | undefined = res?.playlistId;
    if (!id) throw new Error("no playlist came back");
    toasts.show(songs.length ? `Created ${details.title} with ${songs.length === 1 ? "the song" : `${songs.length} songs`}` : `Created ${details.title}`);
    library.playlists.reload();
    return browseIdOf(id);
  } catch (e) {
    toasts.error(`Couldn't create the playlist: ${message(e)}`);
    return null;
  }
}

/** Change a playlist's title, description and privacy (only what's different is sent). */
export async function updatePlaylist(browseId: string, next: PlaylistDetails, before: Partial<PlaylistDetails>) {
  const actions: Record<string, unknown>[] = [];
  if (next.title !== before.title) actions.push({ action: "ACTION_SET_PLAYLIST_NAME", playlistName: next.title });
  if (next.description !== before.description)
    actions.push({ action: "ACTION_SET_PLAYLIST_DESCRIPTION", playlistDescription: next.description });
  if (next.privacy !== before.privacy) actions.push({ action: "ACTION_SET_PLAYLIST_PRIVACY", playlistPrivacy: next.privacy });
  if (!actions.length) return true;
  try {
    await editPlaylist(browseId, actions);
    library.openedPage(browseId)?.patch({ title: next.title, description: next.description, privacy: next.privacy });
    library.playlists.items = library.playlists.items.map((p) =>
      p.browseId === browseId ? { ...p, title: next.title } : p,
    );
    toasts.show("Playlist updated");
    return true;
  } catch (e) {
    toasts.error(`Couldn't update the playlist: ${message(e)}`);
    return false;
  }
}

export async function deletePlaylist(browseId: string) {
  const title = playlistTitle(browseId);
  try {
    check(await ytmCall("playlist/delete", { playlistId: playlistIdOf(browseId) }));
    library.playlists.items = library.playlists.items.filter((p) => p.browseId !== browseId);
    ui.setPinned(browseId, false);
    for (const tab of nav.tabs) if ("browseId" in tab.route && tab.route.browseId === browseId) nav.close(tab.id);
    library.forget(browseId);
    toasts.show(`Deleted ${title}`);
  } catch (e) {
    toasts.error(`Couldn't delete ${title}: ${message(e)}`);
  }
}

// ------------------------------------------------------------------ links

export async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toasts.show("Link copied");
  } catch {
    toasts.error("Couldn't copy the link");
  }
}

export const songUrl = (videoId: string) => `https://music.youtube.com/watch?v=${videoId}`;
export const playlistUrl = (browseId: string) => `https://music.youtube.com/playlist?list=${playlistIdOf(browseId)}`;
