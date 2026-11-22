import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSection, parseShelfContinuation, parseShelfPage } from "./shelves";

// ---------------------------------------------------------------- hand-made examples
// Trimmed copies of real response shapes, with made-up values.

const browse = (browseId: string, pageType?: string, params?: string) => ({
  browseEndpoint: {
    browseId,
    ...(params && { params }),
    ...(pageType && { browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } } }),
  },
});
const runs = (text: string, navigationEndpoint?: object) => ({ runs: [{ text, ...(navigationEndpoint && { navigationEndpoint }) }] });
const thumb = (url: string) => ({
  musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url, width: 226, height: 226 }] } },
});

const playlistCard = {
  musicTwoRowItemRenderer: {
    title: runs("Discover Mix"),
    subtitle: runs("Artist A, Artist B and more"),
    thumbnailRenderer: thumb("mix.jpg"),
    navigationEndpoint: browse("VLRDTMAK5uy_discover", "MUSIC_PAGE_TYPE_PLAYLIST"),
  },
};
const playOnlyMix = {
  musicTwoRowItemRenderer: {
    title: runs("My Supermix"),
    subtitle: runs("Artist C, Artist D"),
    thumbnailRenderer: thumb("supermix.jpg"),
    navigationEndpoint: { watchPlaylistEndpoint: { playlistId: "RTMsupermix", params: "wAEB" } },
  },
};
const albumCard = {
  musicTwoRowItemRenderer: {
    title: runs("Album X"),
    subtitle: runs("Album • Artist A"),
    thumbnailRenderer: thumb("album.jpg"),
    navigationEndpoint: browse("MPREb_x", "MUSIC_PAGE_TYPE_ALBUM"),
  },
};
const podcastCard = {
  musicTwoRowItemRenderer: {
    title: runs("A podcast"),
    navigationEndpoint: browse("MPSPPLx", "MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE"),
  },
};
const flex = (...r: object[]) => ({ musicResponsiveListItemFlexColumnRenderer: { text: { runs: r } } });
const songRow = (videoId: string, title: string) => ({
  musicResponsiveListItemRenderer: {
    flexColumns: [
      flex({ text: title, navigationEndpoint: { watchEndpoint: { videoId, watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: "MUSIC_VIDEO_TYPE_ATV" } } } } }),
      flex({ text: "Artist A", navigationEndpoint: browse("UCa", "MUSIC_PAGE_TYPE_ARTIST") }, { text: " • " }, { text: "Album X", navigationEndpoint: browse("MPREb_x", "MUSIC_PAGE_TYPE_ALBUM") }),
    ],
    thumbnail: thumb(`${videoId}.jpg`),
  },
});
const genreButton = (title: string, params: string, color?: number) => ({
  musicNavigationButtonRenderer: {
    buttonText: runs(title),
    ...(color !== undefined && { solid: { leftStripeColor: color } }),
    clickCommand: browse("FEmusic_moods_and_genres_category", undefined, params),
  },
});
const carousel = (title: string, contents: object[], extra: object = {}) => ({
  musicCarouselShelfRenderer: {
    header: { musicCarouselShelfBasicHeaderRenderer: { title: runs(title), ...extra } },
    contents,
  },
});

const home = {
  contents: {
    singleColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                header: {
                  chipCloudRenderer: {
                    chips: [
                      { chipCloudChipRenderer: { text: runs("Energize"), navigationEndpoint: browse("FEmusic_home", undefined, "ggMPOg1uX1") } },
                      { chipCloudChipRenderer: { text: runs("Relax"), navigationEndpoint: browse("FEmusic_home", undefined, "ggMPOg1uX2"), isSelected: true } },
                    ],
                  },
                },
                contents: [
                  carousel("Quick picks", [songRow("aaaaaaaaaaa", "Song One"), songRow("bbbbbbbbbbb", "Song Two")], {
                    strapline: runs("Start radio from a song"),
                  }),
                  carousel("Mixed for you", [playlistCard, playOnlyMix, podcastCard], {
                    moreContentButton: { buttonRenderer: { text: runs("More"), navigationEndpoint: browse("FEmusic_mixed_for_you") } },
                  }),
                  carousel("More from Artist A", [albumCard], { title: runs("More from Artist A", browse("UCa", "MUSIC_PAGE_TYPE_ARTIST")) }),
                  { musicTastebuilderShelfRenderer: { primaryText: runs("Tell us what you like") } },
                  carousel("Only podcasts", [podcastCard]),
                ],
                continuations: [{ nextContinuationData: { continuation: "HOME2" } }],
              },
            },
          },
        },
      ],
    },
  },
};

describe("parseShelfPage", () => {
  const page = parseShelfPage(home);

  it("reads the mood chips", () => {
    expect(page.chips).toEqual([
      { title: "Energize", params: "ggMPOg1uX1", selected: false },
      { title: "Relax", params: "ggMPOg1uX2", selected: true },
    ]);
  });

  it("keeps the shelves it can show, in order, and skips the rest", () => {
    expect(page.shelves.map((s) => s.title)).toEqual(["Quick picks", "Mixed for you", "More from Artist A"]);
    expect(page.continuation).toBe("HOME2");
  });

  it("shows songs as songs", () => {
    const quick = page.shelves[0];
    expect(quick.strapline).toBe("Start radio from a song");
    expect(quick.tiles).toEqual([]);
    expect(quick.tracks.map((t) => [t.videoId, t.title, t.artists[0]?.name, t.album?.id])).toEqual([
      ["aaaaaaaaaaa", "Song One", "Artist A", "MPREb_x"],
      ["bbbbbbbbbbb", "Song Two", "Artist A", "MPREb_x"],
    ]);
  });

  it("opens mixes with a page, plays mixes without one, and drops podcasts", () => {
    const mixes = page.shelves[1];
    expect(mixes.more).toEqual({ browseId: "FEmusic_mixed_for_you" });
    expect(mixes.tiles).toEqual([
      { kind: "playlist", title: "Discover Mix", subtitle: "Artist A, Artist B and more", browseId: "VLRDTMAK5uy_discover", thumbnail: "mix.jpg" },
      { kind: "playlist", title: "My Supermix", subtitle: "Artist C, Artist D", playlistId: "RTMsupermix", thumbnail: "supermix.jpg" },
    ]);
  });

  it("uses a linked title as the shelf's See all", () => {
    expect(page.shelves[2].more).toEqual({ browseId: "UCa" });
  });
});

describe("parseSection", () => {
  it("reads genre buttons with their colour", () => {
    const shelf = parseSection({
      gridRenderer: {
        header: { gridHeaderRenderer: { title: runs("Genres") } },
        items: [genreButton("Rock", "ggMProck", 4294940672), genreButton("Jazz", "ggMPjazz")],
      },
    });
    expect(shelf).toEqual({
      title: "Genres",
      grid: true,
      tracks: [],
      tiles: [],
      buttons: [
        { title: "Rock", color: "#ff9800", link: { browseId: "FEmusic_moods_and_genres_category", params: "ggMProck" } },
        { title: "Jazz", color: undefined, link: { browseId: "FEmusic_moods_and_genres_category", params: "ggMPjazz" } },
      ],
    });
  });

  it("reads a plain list of songs (the charts)", () => {
    const shelf = parseSection({
      musicShelfRenderer: { title: runs("Top songs"), contents: [songRow("ccccccccccc", "Song Three")], bottomEndpoint: browse("VLPLcharts") },
    });
    expect(shelf?.tracks.map((t) => t.title)).toEqual(["Song Three"]);
    expect(shelf?.more).toEqual({ browseId: "VLPLcharts" });
  });

  it("gives null for sections it doesn't know", () => {
    expect(parseSection({ itemSectionRenderer: {} })).toBeNull();
    expect(parseSection(undefined)).toBeNull();
  });
});

describe("parseShelfContinuation", () => {
  it("reads the next shelves and token", () => {
    const batch = parseShelfContinuation({
      continuationContents: {
        sectionListContinuation: {
          contents: [carousel("Listen again", [albumCard])],
          continuations: [{ nextContinuationData: { continuation: "HOME3" } }],
        },
      },
    });
    expect(batch.shelves.map((s) => s.title)).toEqual(["Listen again"]);
    expect(batch.continuation).toBe("HOME3");
  });
});

// ---------------------------------------------------------------- real responses
// Saved from your own account during development (gitignored; see capture.ts).

const RAW = path.join(import.meta.dirname, "__fixtures__", "raw");
const load = (name: string) => {
  const file = path.join(RAW, `${name}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
};
const real = (name: string) => (load(name) ? it : it.skip);

describe("real responses", () => {
  real("home")("Home", () => {
    const page = parseShelfPage(load("home"));
    expect(page.shelves.length).toBeGreaterThan(0);
    expect(page.chips.length).toBeGreaterThan(0);
    for (const s of page.shelves) expect(s.tracks.length + s.tiles.length + s.buttons.length).toBeGreaterThan(0);
    expect(page.shelves.some((s) => s.tracks.length)).toBe(true);
  });

  real("home_continuation")("Home, more shelves", () => {
    expect(parseShelfContinuation(load("home_continuation")).shelves.length).toBeGreaterThan(0);
  });

  real("explore")("Explore", () => {
    const page = parseShelfPage(load("explore"));
    expect(page.shelves.some((s) => s.tiles.length)).toBe(true);
  });

  real("moods_and_genres")("Moods & genres", () => {
    const page = parseShelfPage(load("moods_and_genres"));
    expect(page.shelves.some((s) => s.buttons.length)).toBe(true);
  });

  real("genre")("a genre", () => {
    const page = parseShelfPage(load("genre"));
    expect(page.shelves.some((s) => s.tiles.length)).toBe(true);
  });

  real("charts")("the charts", () => {
    expect(parseShelfPage(load("charts")).shelves.length).toBeGreaterThan(0);
  });
});
