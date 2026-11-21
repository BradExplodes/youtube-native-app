// What the right-click menu offers for a song or a playlist.
import {
  Disc3,
  Heart,
  HeartOff,
  Link,
  ListMinus,
  ListPlus,
  MicVocal,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  Shapes,
  Trash2,
} from "@lucide/svelte";
import {
  addToPlaylist,
  copyLink,
  deletePlaylist,
  playlistIdOf,
  playlistUrl,
  removeFromPlaylist,
  removeSongFromPlaylist,
  setLiked,
  songUrl,
} from "$lib/actions";
import { playerCmd } from "$lib/ipc";
import { canOpenArtist, openAlbum, openArtist, playSingle } from "$lib/open";
import { dialog } from "$lib/stores/dialog.svelte";
import { library, sidebarPlaylists } from "$lib/stores/library.svelte";
import { likes } from "$lib/stores/likes.svelte";
import { memberships } from "$lib/stores/membership.svelte";
import type { MenuEntry, MenuItem } from "$lib/stores/menu.svelte";
import { player } from "$lib/stores/player.svelte";
import { ui } from "$lib/stores/ui.svelte";
import { versions } from "$lib/stores/versions.svelte";
import type { ArtistRef } from "$lib/ytm/types";

export interface SongTarget {
  videoId: string;
  title: string;
  artists?: ArtistRef[];
  album?: { name: string; id: string };
  setVideoId?: string;
  /** Artist names as one string, when there are no artist links (the queue, the player). */
  artist?: string;
}

export interface SongMenuOptions {
  /** Play it in its list (otherwise it plays on its own, followed by a radio). */
  play?: () => void;
  /** The playlist (VL…) this row is in, when it's one of yours: offers "Remove from this playlist". */
  inPlaylist?: string;
}

/** "Add to playlist" submenu: a new playlist, then your own playlists, ticked where the
 *  song already is. Clicking one adds or removes the song, and the menu stays open. */
function addToPlaylistItems(song: SongTarget): MenuEntry[] {
  const m = memberships.of(song.videoId);
  const entries: MenuEntry[] = [
    {
      label: "New playlist…",
      icon: Plus,
      action: () =>
        dialog.open({ kind: "playlist", title: "", description: "", privacy: "PRIVATE", videoIds: [song.videoId] }),
    },
    null,
  ];
  if (m.options.length) {
    // In the sidebar's order (pinned first); any the sidebar doesn't list go last.
    const order = new Map(sidebarPlaylists().map((p, i) => [p.browseId, i]));
    const rank = (id: string) => order.get(id) ?? Infinity;
    const options = m.options.toSorted((a, b) => rank(a.browseId) - rank(b.browseId));
    for (const o of options) {
      entries.push({
        label: o.title,
        icon: Plus,
        checked: o.contains,
        keepOpen: true,
        action: () => (o.contains ? removeSongFromPlaylist(o.browseId, song, o.removeActions) : addToPlaylist(o.browseId, [song])),
      });
    }
  } else if (m.loading || !m.loaded && !m.error) {
    entries.push({ label: "Loading your playlists…", disabled: true });
  } else {
    // Couldn't ask which playlists hold it: still offer adding, without ticks.
    for (const p of sidebarPlaylists().filter((p) => p.owned)) {
      entries.push({ label: p.title, icon: Plus, keepOpen: true, action: () => addToPlaylist(p.browseId, [song]) });
    }
  }
  return entries;
}

export function songMenu(song: SongTarget, opts: SongMenuOptions = {}): MenuEntry[] {
  const liked = likes.get(song.videoId);
  const artist = song.artists?.find((a) => canOpenArtist(a.id));
  // Ask now which playlists hold it, so the ticks are ready when the submenu opens.
  memberships.load(song.videoId);
  const entries: MenuEntry[] = [
    { label: "Play", icon: Play, action: opts.play ?? (() => playSingle(song.videoId)) },
    null,
    liked
      ? { label: "Remove from Liked Songs", icon: HeartOff, action: () => setLiked(song, false) }
      : { label: "Add to Liked Songs", icon: Heart, action: () => setLiked(song, true) },
    { label: "Add to playlist", icon: ListPlus, items: () => addToPlaylistItems(song) },
  ];
  if (opts.inPlaylist && song.setVideoId) {
    const setVideoId = song.setVideoId;
    const browseId = opts.inPlaylist;
    entries.push({
      label: "Remove from this playlist",
      icon: ListMinus,
      danger: true,
      action: () => removeFromPlaylist(browseId, { ...song, setVideoId }),
    });
  }
  entries.push(null, {
    label: "Other versions",
    icon: Shapes,
    action: () =>
      versions.open({
        videoId: song.videoId,
        title: song.title,
        artist: song.artists?.[0]?.name ?? song.artist ?? "",
      }),
  });
  if (artist?.id) {
    const id = artist.id;
    entries.push({ label: "Go to artist", icon: MicVocal, action: () => openArtist(id) });
  }
  if (song.album) {
    const id = song.album.id;
    entries.push({ label: "Go to album", icon: Disc3, action: () => openAlbum(id) });
  }
  entries.push(null, { label: "Copy link", icon: Link, action: () => copyLink(songUrl(song.videoId)) });
  return entries;
}

export interface PlaylistTarget {
  /** VL… */
  browseId: string;
  title: string;
}

export function playlistMenu(p: PlaylistTarget): MenuEntry[] {
  const card = library.playlists.items.find((c) => c.browseId === p.browseId);
  const owned = card?.owned ?? library.openedPage(p.browseId)?.info?.owned ?? false;
  const pinned = ui.isPinned(p.browseId);
  const entries: MenuEntry[] = [
    {
      label: "Play",
      icon: Play,
      action: () => {
        player.context = p.browseId;
        playerCmd({ action: "load", playlistId: playlistIdOf(p.browseId) });
      },
    },
  ];
  // Only playlists in your library are listed in the sidebar, so only those can be pinned.
  if (card) {
    entries.push(
      pinned
        ? { label: "Unpin", icon: PinOff, action: () => ui.setPinned(p.browseId, false) }
        : { label: "Pin to top", icon: Pin, action: () => ui.setPinned(p.browseId, true) },
    );
  }
  if (owned) {
    entries.push(
      null,
      { label: "Edit details…", icon: Pencil, action: () => editPlaylistDetails(p) },
      {
        label: "Delete playlist…",
        icon: Trash2,
        danger: true,
        action: () =>
          dialog.open({
            kind: "confirm",
            title: `Delete ${p.title}?`,
            message: "It will be deleted from your YouTube Music account. This can't be undone.",
            confirm: "Delete",
            onconfirm: () => deletePlaylist(p.browseId),
          }),
      },
    );
  }
  entries.push(null, { label: "Copy link", icon: Link, action: () => copyLink(playlistUrl(p.browseId)) });
  return entries;
}

/** Open the edit popup with the playlist's current details (loading them if needed). */
export async function editPlaylistDetails(p: PlaylistTarget) {
  const page = library.page(p.browseId);
  await page.load();
  const info = page.info;
  dialog.open({
    kind: "playlist",
    browseId: p.browseId,
    title: info?.title || p.title,
    description: info?.description ?? "",
    privacy: info?.privacy ?? "PRIVATE",
  });
}
