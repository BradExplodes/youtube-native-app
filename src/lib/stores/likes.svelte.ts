// Which songs are in your Liked Songs, as far as we know: learned from the lists we load
// (YouTube Music marks each row) and from your own likes in this session.
import { SvelteMap } from "svelte/reactivity";
import type { Track } from "$lib/ytm/types";

class Likes {
  private known = new SvelteMap<string, boolean>();

  /** Remember what loaded rows say. `all` marks every row liked (the Liked Songs list). */
  note(tracks: Track[], all = false) {
    for (const t of tracks) {
      const liked = all ? true : t.liked;
      if (liked !== undefined) this.known.set(t.videoId, liked);
    }
  }

  /** Liked, not liked, or undefined when we haven't seen this song's status. */
  get(videoId: string | null | undefined): boolean | undefined {
    return videoId ? this.known.get(videoId) : undefined;
  }

  set(videoId: string, liked: boolean | undefined) {
    if (liked === undefined) this.known.delete(videoId);
    else this.known.set(videoId, liked);
  }
}

export const likes = new Likes();
