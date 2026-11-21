import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseArtistPage, parseFilteredSearch, parseSearch, parseSearchContinuation } from "./search";

// ---------------------------------------------------------------- hand-made examples

const browseRun = (text: string, browseId: string, pageType: string) => ({
  text,
  navigationEndpoint: {
    browseEndpoint: { browseId, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } } },
  },
});
const watchRun = (text: string, videoId: string, musicVideoType: string) => ({
  text,
  navigationEndpoint: {
    watchEndpoint: { videoId, watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType } } },
  },
});
const flex = (...runs: object[]) => ({ musicResponsiveListItemFlexColumnRenderer: { text: { runs } } });
const SEP = { text: " • " };
const row = (r: object) => ({ musicResponsiveListItemRenderer: r });
const section = (item: object) => ({ itemSectionRenderer: { contents: [item] } });
const search = (...sections: object[]) => ({
  contents: { tabbedSearchResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: sections } } } }] } },
});

const ARTIST = browseRun("Band", "UC1", "MUSIC_PAGE_TYPE_ARTIST");

describe("parseSearch", () => {
  it("sorts a plain search by where each result leads, not by its label", () => {
    const raw = search(
      section(row({ flexColumns: [flex(watchRun("Hit", "aaaaaaaaaaa", "MUSIC_VIDEO_TYPE_ATV")), flex({ text: "Song" }, SEP, ARTIST, SEP, { text: "3:05" })] })),
      section(row({ flexColumns: [flex(watchRun("Clip", "bbbbbbbbbbb", "MUSIC_VIDEO_TYPE_OMV")), flex({ text: "Video" }, SEP, ARTIST)] })),
      section(row({
        navigationEndpoint: browseRun("", "MPREb_1", "MUSIC_PAGE_TYPE_ALBUM").navigationEndpoint,
        flexColumns: [flex({ text: "Record" }), flex({ text: "Album" }, SEP, ARTIST, SEP, { text: "2020" })],
      })),
      section(row({
        navigationEndpoint: ARTIST.navigationEndpoint,
        flexColumns: [flex({ text: "Band" }), flex({ text: "Artist" }, SEP, { text: "1m monthly audience" })],
      })),
      section(row({
        navigationEndpoint: browseRun("", "UCx", "MUSIC_PAGE_TYPE_USER_CHANNEL").navigationEndpoint,
        flexColumns: [flex({ text: "Someone" }), flex({ text: "Profile" })],
      })),
      section(row({ flexColumns: [flex(watchRun("Ep 1", "ccccccccccc", "MUSIC_VIDEO_TYPE_PODCAST_EPISODE")), flex({ text: "Episode" })] })),
    );
    const r = parseSearch(raw);
    expect(r.songs).toHaveLength(1);
    // The "Song • " label isn't an artist; the duration comes from the same column.
    expect(r.songs[0]).toMatchObject({ title: "Hit", artists: [{ name: "Band", id: "UC1" }], duration: "3:05" });
    expect(r.videos.map((v) => v.title)).toEqual(["Clip"]);
    expect(r.albums).toMatchObject([{ kind: "album", browseId: "MPREb_1", subtitle: "Album • Band • 2020" }]);
    expect(r.artists).toMatchObject([{ kind: "artist", browseId: "UC1", subtitle: "1m monthly audience" }]);
    // Profiles and podcast episodes are left out.
    expect(r.playlists).toEqual([]);
  });

  it("reads the top result card and its songs", () => {
    const raw = search({
      musicCardShelfRenderer: {
        title: { runs: [ARTIST] },
        subtitle: { runs: [{ text: "Artist • 1m monthly audience" }] },
        contents: [row({ flexColumns: [flex(watchRun("Hit", "aaaaaaaaaaa", "MUSIC_VIDEO_TYPE_ATV")), flex({ text: "Song" }, SEP, { text: "3:05" })] })],
      },
    });
    const { top } = parseSearch(raw);
    expect(top?.tile).toMatchObject({ kind: "artist", browseId: "UC1", title: "Band" });
    // No artist in the row: it's the card's artist.
    expect(top?.tracks).toMatchObject([{ title: "Hit", artists: [{ name: "Band" }], duration: "3:05" }]);
  });
});

// ---------------------------------------------------------------- real responses
// Captured with the dev build; skipped when not present (they're not committed).

const RAW = path.join(import.meta.dirname, "__fixtures__", "raw");
const load = (name: string) => {
  const file = path.join(RAW, `${name}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
};
const real = (name: string) => (load(name) ? it : it.skip);

describe("real responses", () => {
  real("search_linkin_park")("a plain search", () => {
    const r = parseSearch(load("search_linkin_park"));
    expect(r.top?.tile.kind).toBe("artist");
    expect(r.top?.tracks.length).toBeGreaterThan(0);
    expect(r.songs.length).toBeGreaterThan(0);
    expect(r.albums.every((a) => a.browseId?.startsWith("MPRE"))).toBe(true);
    expect(r.artists.every((a) => a.browseId?.startsWith("UC"))).toBe(true);
    expect(r.playlists.every((p) => p.browseId?.startsWith("VL"))).toBe(true);
    for (const t of [...r.songs, ...r.videos]) {
      expect(t.videoId).toMatch(/^[\w-]{11}$/);
      expect(t.artists.length).toBeGreaterThan(0);
      expect(["Song", "Video"]).not.toContain(t.artists[0].name);
    }
  });

  real("search_songs")("a songs-only search and its next batch", () => {
    const { first, next } = load("search_songs");
    const batch = parseFilteredSearch(first);
    expect(batch.tracks.length).toBeGreaterThan(10);
    expect(batch.continuation).toBeTruthy();
    expect(batch.tracks.every((t) => t.duration && t.artists.length)).toBe(true);
    expect(batch.tracks.some((t) => t.album)).toBe(true);
    expect(parseSearchContinuation(next).tracks.length).toBeGreaterThan(0);
  });

  real("artist_page")("an artist page", () => {
    const a = parseArtistPage(load("artist_page"));
    expect(a.name).not.toBe("");
    expect(a.subtitle).not.toBe("");
    expect(a.thumbnail).toBeTruthy();
    expect(a.topSongs.length).toBeGreaterThan(0);
    expect(a.allSongsId).toMatch(/^VL/);
    expect(a.shelves.length).toBeGreaterThan(2);
    expect(a.shelves.flatMap((s) => s.tiles).every((t) => t.title && (t.browseId || t.videoId))).toBe(true);
  });
});
