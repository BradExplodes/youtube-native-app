import { describe, expect, it } from "vitest";
import { parseAddToPlaylist } from "$lib/stores/membership.svelte";
import { baseTitle } from "$lib/stores/versions.svelte";

describe("parseAddToPlaylist", () => {
  it("lists your playlists, ticked where the song already is", () => {
    const option = (playlistId: string, title: string, contains: string, extra = {}) => ({
      playlistAddToOptionRenderer: { playlistId, title: { simpleText: title }, containsSelectedVideos: contains, ...extra },
    });
    const remove = {
      removeFromPlaylistServiceEndpoint: {
        playlistEditEndpoint: { actions: [{ action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID", removedVideoId: "v1" }] },
      },
    };
    const raw = {
      contents: [{ addToPlaylistRenderer: { playlists: [option("PL1", "Road trip", "ALL", remove), option("PL2", "Gym", "NONE")] } }],
    };
    expect(parseAddToPlaylist(raw)).toEqual([
      {
        browseId: "VLPL1",
        title: "Road trip",
        contains: true,
        removeActions: [{ action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID", removedVideoId: "v1" }],
      },
      { browseId: "VLPL2", title: "Gym", contains: false },
    ]);
  });

  it("gives nothing for an unexpected answer", () => {
    expect(parseAddToPlaylist({})).toEqual([]);
  });
});

describe("baseTitle", () => {
  it("drops brackets, features and the 'Artist - ' prefix", () => {
    expect(baseTitle("Numb (Official Music Video) [4K Upgrade]")).toBe("Numb");
    expect(baseTitle("Linkin Park - Numb (Sped Up)")).toBe("Numb");
    expect(baseTitle("Temptation feat. Rebecca")).toBe("Temptation");
    expect(baseTitle("(Intro)")).toBe("(Intro)");
  });
});
