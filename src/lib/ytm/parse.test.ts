import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseLibraryAlbums,
  parseLibraryArtists,
  parseLibraryPlaylists,
  parseTrack,
  parseTrackContinuation,
  parseTrackListPage,
  pickThumbnail,
} from "./parse";

// ---------------------------------------------------------------- hand-made examples
// Trimmed copies of real response shapes, with made-up values.

const run = (text: string, browseId?: string, pageType?: string) => ({
  text,
  ...(browseId && {
    navigationEndpoint: {
      browseEndpoint: {
        browseId,
        browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } },
      },
    },
  }),
});
const flex = (...runs: object[]) => ({ musicResponsiveListItemFlexColumnRenderer: { text: runs.length ? { runs } : {} } });

const trackRow = {
  playlistItemData: { videoId: "vid1", playlistSetVideoId: "SET1" },
  flexColumns: [
    flex({ text: "Song One", navigationEndpoint: { watchEndpoint: { videoId: "vid1", playlistId: "PLx" } } }),
    flex(run("Artist A", "UCa", "MUSIC_PAGE_TYPE_ARTIST"), run(" & "), run("Artist B", "UCb", "MUSIC_PAGE_TYPE_ARTIST")),
    flex(run("Album X", "MPREb_x", "MUSIC_PAGE_TYPE_ALBUM")),
  ],
  fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: "3:07" }] } } }],
  thumbnail: {
    musicThumbnailRenderer: {
      thumbnail: { thumbnails: [{ url: "small", width: 60 }, { url: "big", width: 120 }] },
    },
  },
  badges: [{ musicInlineBadgeRenderer: { icon: { iconType: "MUSIC_EXPLICIT_BADGE" } } }],
};

describe("parseTrack", () => {
  it("reads title, artists, album, duration and badges", () => {
    expect(parseTrack(trackRow)).toEqual({
      videoId: "vid1",
      title: "Song One",
      artists: [
        { name: "Artist A", id: "UCa" },
        { name: "Artist B", id: "UCb" },
      ],
      album: { name: "Album X", id: "MPREb_x" },
      duration: "3:07",
      thumbnail: "big",
      explicit: true,
      available: true,
      setVideoId: "SET1",
    });
  });

  it("reads the like status from the row's menu", () => {
    const menu = (likeStatus: string) => ({
      menuRenderer: { topLevelButtons: [{ likeButtonRenderer: { likeStatus } }] },
    });
    expect(parseTrack({ ...trackRow, menu: menu("LIKE") })?.liked).toBe(true);
    expect(parseTrack({ ...trackRow, menu: menu("INDIFFERENT") })?.liked).toBe(false);
    expect(parseTrack(trackRow)?.liked).toBeUndefined();
  });

  it("stops artists at the ' • ' separator", () => {
    const row = { ...trackRow, flexColumns: [trackRow.flexColumns[0], flex(run("Uploader", "UCu"), run(" • "), run("5 plays"))] };
    expect(parseTrack(row)?.artists).toEqual([{ name: "Uploader", id: "UCu" }]);
  });

  it("uses the album artist when a row has none, and marks greyed-out rows", () => {
    const row = {
      ...trackRow,
      flexColumns: [trackRow.flexColumns[0], flex(), flex(run("2.4bn plays"))],
      musicItemRendererDisplayPolicy: "MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT",
    };
    const t = parseTrack(row, "Album Artist");
    expect(t?.artists).toEqual([{ name: "Album Artist" }]);
    expect(t?.album).toBeUndefined();
    expect(t?.available).toBe(false);
  });

  it("skips rows without a video", () => {
    expect(parseTrack({ flexColumns: [flex(run("Nothing"))] })).toBeNull();
    expect(parseTrack(undefined)).toBeNull();
  });
});

describe("parseTrackListPage", () => {
  it("reads the header, tracks, playlist and continuation", () => {
    const raw = {
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  sectionListRenderer: {
                    contents: [
                      {
                        musicResponsiveHeaderRenderer: {
                          title: { runs: [{ text: "My List" }] },
                          subtitle: { runs: [{ text: "Playlist" }, { text: " • " }, { text: "2020" }] },
                          secondSubtitle: { runs: [{ text: "2 songs" }] },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
          secondaryContents: {
            sectionListRenderer: {
              contents: [
                {
                  musicPlaylistShelfRenderer: {
                    playlistId: "PLx",
                    contents: [
                      { musicResponsiveListItemRenderer: trackRow },
                      { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: "NEXT" } } } },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    };
    const page = parseTrackListPage(raw);
    expect(page).toMatchObject({
      title: "My List",
      subtitle: "Playlist • 2020",
      secondSubtitle: "2 songs",
      playlistId: "PLx",
      continuation: "NEXT",
    });
    expect(page.tracks).toHaveLength(1);
  });

  it("returns an empty page for an unexpected response", () => {
    expect(parseTrackListPage({})).toMatchObject({ title: "", tracks: [], continuation: undefined });
  });
});

describe("parseTrackContinuation", () => {
  it("reads appended items and the next token", () => {
    const raw = {
      onResponseReceivedActions: [
        {
          appendContinuationItemsAction: {
            continuationItems: [
              { musicResponsiveListItemRenderer: trackRow },
              { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: "MORE" } } } },
            ],
          },
        },
      ],
    };
    const batch = parseTrackContinuation(raw);
    expect(batch.tracks.map((t) => t.videoId)).toEqual(["vid1"]);
    expect(batch.continuation).toBe("MORE");
  });

  it("reads the older continuationContents format", () => {
    const raw = {
      continuationContents: {
        musicPlaylistShelfContinuation: {
          contents: [{ musicResponsiveListItemRenderer: trackRow }],
          continuations: [{ nextContinuationData: { continuation: "OLD" } }],
        },
      },
    };
    expect(parseTrackContinuation(raw)).toMatchObject({ continuation: "OLD" });
  });
});

describe("library", () => {
  const card = (browseId: string | null, title: string) => ({
    musicTwoRowItemRenderer: {
      title: { runs: [{ text: title }] },
      subtitle: { runs: [{ text: "Someone" }] },
      navigationEndpoint: browseId ? { browseEndpoint: { browseId } } : { createPlaylistEndpoint: {} },
    },
  });

  it("lists playlists, skipping the New playlist button", () => {
    const raw = { gridRenderer: { items: [card(null, "New playlist"), card("VLLM", "Liked music"), card("VLPL1", "Mine")] } };
    expect(parseLibraryPlaylists(raw).items.map((c) => c.browseId)).toEqual(["VLLM", "VLPL1"]);
  });

  it("lists albums only from album cards", () => {
    const raw = { gridRenderer: { items: [card("MPREb_1", "Album"), card("VLPL1", "Not an album")] } };
    expect(parseLibraryAlbums(raw).items.map((c) => c.title)).toEqual(["Album"]);
  });

  it("lists library artists", () => {
    const raw = {
      musicShelfRenderer: {
        contents: [
          {
            musicResponsiveListItemRenderer: {
              navigationEndpoint: { browseEndpoint: { browseId: "MPLAUC1" } },
              flexColumns: [flex(run("Artist")), flex(run("3 songs"))],
            },
          },
        ],
      },
    };
    expect(parseLibraryArtists(raw).items).toEqual([
      { browseId: "MPLAUC1", name: "Artist", subtitle: "3 songs", thumbnail: undefined },
    ]);
  });
});

describe("pickThumbnail", () => {
  it("picks the smallest one big enough, else the biggest", () => {
    const t = [
      { url: "a", width: 60 },
      { url: "c", width: 544 },
      { url: "b", width: 226 },
    ];
    expect(pickThumbnail(t, 200)).toBe("b");
    expect(pickThumbnail(t, 1000)).toBe("c");
    expect(pickThumbnail([], 10)).toBeUndefined();
  });
});

// ---------------------------------------------------------------- real responses
// Saved from your own account during development (gitignored, so these only run
// on a machine that has them). They catch YouTube Music changing its format.

const RAW = path.join(import.meta.dirname, "__fixtures__", "raw");
const load = (name: string) => {
  const file = path.join(RAW, `${name}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
};
const real = (name: string) => (load(name) ? it : it.skip);

describe("real responses", () => {
  real("liked_songs")("Liked Songs", () => {
    const page = parseTrackListPage(load("liked_songs"));
    expect(page.title).not.toBe("");
    expect(page.playlistId).toBe("LM");
    expect(page.tracks.length).toBeGreaterThan(0);
    for (const t of page.tracks) {
      expect(t.videoId).toMatch(/^[\w-]{11}$/);
      expect(t.title).not.toBe("");
    }
    expect(page.tracks.some((t) => t.artists.length && t.album)).toBe(true);
  });

  real("liked_songs_continuation")("Liked Songs, next batch", () => {
    expect(parseTrackContinuation(load("liked_songs_continuation")).tracks.length).toBeGreaterThan(0);
  });

  real("playlist")("a playlist", () => {
    const page = parseTrackListPage(load("playlist"));
    expect(page.title).not.toBe("");
    expect(page.playlistId).toBeTruthy();
    expect(page.tracks.length).toBeGreaterThan(0);
  });

  real("album")("an album", () => {
    const page = parseTrackListPage(load("album"));
    expect(page.byline).not.toBe("");
    expect(page.playlistId).toMatch(/^OLAK5uy_/);
    expect(page.tracks.length).toBeGreaterThan(0);
    // Album rows have no artist column: they fall back to the album artist.
    expect(page.tracks.every((t) => t.artists[0]?.name === page.byline)).toBe(true);
  });

  real("library_artist")("a library artist", () => {
    const page = parseTrackListPage(load("library_artist"));
    expect(page.title).not.toBe("");
    expect(page.tracks.length).toBeGreaterThan(0);
  });

  real("library_playlists")("library playlists", () => {
    const { items } = parseLibraryPlaylists(load("library_playlists"));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((c) => c.browseId.startsWith("VL") && c.title)).toBe(true);
  });

  real("library_albums")("library albums (may be empty)", () => {
    expect(parseLibraryAlbums(load("library_albums")).items).toBeInstanceOf(Array);
  });

  real("library_artists")("library artists", () => {
    const { items } = parseLibraryArtists(load("library_artists"));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((a) => a.browseId.startsWith("MPLA") && a.name)).toBe(true);
  });
});
