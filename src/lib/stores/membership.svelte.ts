// Which of your playlists already hold a song: YouTube Music's own "Save to playlist"
// list, which ticks the playlists the song is in. Asked again each time a song's menu
// opens, so it's never stale for long.
import { SvelteMap } from "svelte/reactivity";
import { ytmCall, type Raw } from "$lib/ytm/api";
import { text } from "$lib/ytm/parse";

export interface PlaylistOption {
  /** VL… browse id. */
  browseId: string;
  title: string;
  /** The song is in this playlist. */
  contains: boolean;
  /** YouTube Music's own "remove this song" actions for this playlist, when it gives them. */
  removeActions?: Record<string, unknown>[];
}

export interface Membership {
  options: PlaylistOption[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

/** Every value stored under `key` anywhere inside `obj`. */
function findAll(obj: Raw, key: string, out: Raw[] = []): Raw[] {
  if (!obj || typeof obj !== "object") return out;
  if (Array.isArray(obj)) {
    for (const v of obj) findAll(v, key, out);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === key) out.push(v);
    else findAll(v, key, out);
  }
  return out;
}

/** The "Save to playlist" answer -> your playlists, ticked where the song already is. */
export function parseAddToPlaylist(raw: Raw): PlaylistOption[] {
  return findAll(raw, "playlistAddToOptionRenderer")
    .map((r): PlaylistOption | null => {
      const id: string | undefined = r?.playlistId;
      if (!id) return null;
      const actions = r.removeFromPlaylistServiceEndpoint?.playlistEditEndpoint?.actions;
      return {
        browseId: id.startsWith("VL") ? id : `VL${id}`,
        title: text(r.title),
        contains: r.containsSelectedVideos === "ALL",
        ...(Array.isArray(actions) && actions.length ? { removeActions: actions } : {}),
      };
    })
    .filter((o): o is PlaylistOption => !!o);
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

class Memberships {
  private byVideo = new SvelteMap<string, Membership>();

  /** What we know for this song (empty until `load` has been called). */
  of(videoId: string): Membership {
    return this.byVideo.get(videoId) ?? { options: [], loading: false, loaded: false, error: null };
  }

  /** Ask YouTube Music again; the last answer stays on show meanwhile. */
  async load(videoId: string) {
    const before = this.of(videoId);
    this.byVideo.set(videoId, { ...before, loading: true, error: null });
    try {
      const raw = await ytmCall("playlist/get_add_to_playlist", { videoIds: [videoId] });
      this.byVideo.set(videoId, { options: parseAddToPlaylist(raw), loading: false, loaded: true, error: null });
    } catch (e) {
      this.byVideo.set(videoId, { ...this.of(videoId), loading: false, error: message(e) });
    }
  }

  /** Show a change straight away (after adding or removing the song). */
  mark(videoId: string, browseId: string, contains: boolean) {
    const m = this.byVideo.get(videoId);
    if (!m) return;
    this.byVideo.set(videoId, {
      ...m,
      options: m.options.map((o) => (o.browseId === browseId ? { ...o, contains } : o)),
    });
  }
}

export const memberships = new Memberships();
