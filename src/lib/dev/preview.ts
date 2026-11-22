// Development only: run the UI in an ordinary browser (no app around it) for design
// work. Fakes the app's commands with the saved sample responses from your library
// (src/lib/ytm/__fixtures__/raw, gitignored) and a pretend player. Never in the real app.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { findKey, parseLibraryPlaylists, parseTrackListPage } from "$lib/ytm/parse";

const raw = import.meta.glob("$lib/ytm/__fixtures__/raw/*.json", { eager: true, import: "default" });
const fixture = (name: string): unknown =>
  Object.entries(raw).find(([path]) => path.endsWith(`/${name}.json`))?.[1];

const BY_BROWSE_ID: Record<string, string> = {
  VLLM: "liked_songs",
  FEmusic_liked_playlists: "library_playlists",
  FEmusic_liked_albums: "library_albums",
  FEmusic_library_corpus_track_artists: "library_artists",
};

// Home and Explore: the saved responses if there are any (capture.ts), otherwise
// pretend pages put together from your library's saved responses.
const SHELF_FIXTURES: Record<string, string> = {
  FEmusic_home: "home",
  FEmusic_explore: "explore",
  FEmusic_charts: "charts",
  FEmusic_moods_and_genres: "moods_and_genres",
  FEmusic_moods_and_genres_category: "genre",
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const runs = (text: string) => ({ runs: [{ text }] });
const endpoint = (browseId: string, params?: string) => ({ browseEndpoint: { browseId, ...(params && { params }) } });
const carousel = (title: string, contents: any[], strapline?: string) => ({
  musicCarouselShelfRenderer: {
    header: { musicCarouselShelfBasicHeaderRenderer: { title: runs(title), ...(strapline && { strapline: runs(strapline) }) } },
    contents,
  },
});
const grid = (title: string, items: any[]) => ({ gridRenderer: { header: { gridHeaderRenderer: { title: runs(title) } }, items } });
const GENRES: [string, number][] = [
  ["Chill", 0xff4caf50], ["Commute", 0xff2196f3], ["Energize", 0xffff9800], ["Feel good", 0xffffeb3b],
  ["Focus", 0xff9c27b0], ["Party", 0xffe91e63], ["Romance", 0xfff44336], ["Sleep", 0xff3f51b5],
  ["Workout", 0xffff5722], ["Rock", 0xff795548], ["Hip-hop", 0xff607d8b], ["Jazz", 0xff00bcd4],
];
const genreButtons = () =>
  GENRES.map(([title, color], i) => ({
    musicNavigationButtonRenderer: {
      buttonText: runs(title),
      solid: { leftStripeColor: color },
      clickCommand: endpoint("FEmusic_moods_and_genres_category", `preview-genre-${i}`),
    },
  }));
const page = (sections: any[], extra: any = {}) => ({
  ...extra,
  contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { ...extra.list, contents: sections } } } }] } },
});

function sampleShelfPage(browseId: string, params?: string): unknown {
  const songs: any[] = (findKey(fixture("liked_songs"), "musicPlaylistShelfRenderer")?.contents ?? []).filter(
    (i: any) => i.musicResponsiveListItemRenderer,
  );
  const cards: any[] = (findKey(fixture("library_playlists"), "gridRenderer")?.items ?? []).filter(
    (i: any) => i.musicTwoRowItemRenderer?.navigationEndpoint?.browseEndpoint?.browseId?.startsWith("VL"),
  );
  const artistShelves: any[] = (findKey(fixture("artist_page"), "sectionListRenderer")?.contents ?? []).filter(
    (s: any) => s.musicCarouselShelfRenderer,
  );
  if (browseId === "FEmusic_home") {
    const chips = ["Energize", "Relax", "Workout", "Focus", "Commute"].map((t, i) => ({
      chipCloudChipRenderer: {
        text: runs(t),
        navigationEndpoint: endpoint("FEmusic_home", `preview-chip-${i}`),
        ...(params === `preview-chip-${i}` && { isSelected: true }),
      },
    }));
    const shelves = params
      ? [carousel("Quick picks", songs.slice(8, 24)), carousel("Mixes for this mood", cards.slice(4, 12))]
      : [
          carousel("Quick picks", songs.slice(0, 20), "Start radio from a song"),
          carousel("Mixed for you", cards.slice(0, 8)),
          ...artistShelves.slice(0, 3),
          carousel("Listen again", [...cards.slice(8, 14)], "Your library"),
        ];
    return page(shelves, { list: { header: { chipCloudRenderer: { chips } } } });
  }
  if (browseId === "FEmusic_explore") {
    return page([
      ...artistShelves.slice(0, 1),
      carousel("Moods & genres", genreButtons()),
      carousel("Trending", songs.slice(20, 40)),
    ]);
  }
  if (browseId === "FEmusic_moods_and_genres") return page([grid("Moods & moments", genreButtons().slice(0, 9)), grid("Genres", genreButtons().slice(9))]);
  const title = browseId === "FEmusic_moods_and_genres_category" ? GENRES[Number(params?.split("-").pop())]?.[0] ?? "Genre" : "";
  return page([carousel("Featured playlists", cards.slice(0, 10)), grid("Community playlists", cards.slice(10, 30)), ...artistShelves.slice(0, 2)], {
    ...(title && { header: { musicHeaderRenderer: { title: runs(title) } } }),
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function install() {
  mockWindows("main");

  const liked = parseTrackListPage(fixture("liked_songs"));
  const tracks = liked.tracks.length ? liked.tracks : [];
  let index = 0;
  let playing = true;
  let position = 42;
  let volume = 70;
  let rate = 1;
  let repeat = "NONE";
  let shuffle = false;

  // "4:48" -> 288, so the pretend player reports each song's real length.
  const seconds = (d?: string) => (d ? d.split(":").reduce((s, part) => s * 60 + Number(part), 0) : 200) || 200;
  const playback = () => {
    const t = tracks[index];
    if (!t) return null;
    return {
      videoId: t.videoId,
      title: t.title,
      artist: t.artists.map((a) => a.name).join(", "),
      album: t.album?.name ?? "",
      artwork: t.thumbnail ?? null,
      playing,
      position,
      duration: seconds(t.duration),
      volume,
      muted: false,
      quality: "audio only",
      rate,
      repeat,
      shuffle,
    };
  };
  const queue = () => ({
    items: tracks.slice(0, 40).map((t, i) => ({
      videoId: t.videoId,
      title: t.title,
      artist: t.artists.map((a) => a.name).join(", "),
      duration: t.duration ?? "",
      thumbnail: t.thumbnail ?? null,
      current: i === index,
      autoplay: i > 30,
    })),
  });
  const push = () => {
    emit("player://playback", playback());
    emit("player://queue", queue());
  };
  setInterval(() => {
    if (playing) {
      position = (position + 1) % seconds(tracks[index]?.duration);
      emit("player://playback", playback());
    }
  }, 1000);

  // Which songs the pretend playlists hold ("playlistId|videoId"), for the "Add to playlist" ticks.
  const inPlaylist = new Set<string>();
  let settings = { discordPresence: true, audioOnly: true, verboseLogs: false, checkForUpdates: true };

  mockIPC(
    (cmd, args) => {
      const a = (args ?? {}) as Record<string, any>;
      switch (cmd) {
        case "player_status":
          return { loggedIn: true, playback: playback(), queue: queue() };
        case "browse": {
          const req = a.request ?? {};
          const songs = fixture("search_songs") as { first?: unknown; next?: unknown } | undefined;
          if (req.continuation) return (req.search && songs?.next) || {};
          if (req.query) return (req.params ? songs?.first : fixture("search_linkin_park")) ?? {};
          if (req.browseId?.startsWith("UC")) return fixture("artist_page") ?? {};
          if (req.browseId in SHELF_FIXTURES || req.browseId === "FEmusic_new_releases") {
            const saved = !req.params || req.browseId !== "FEmusic_home" ? fixture(SHELF_FIXTURES[req.browseId]) : undefined;
            return saved ?? sampleShelfPage(req.browseId, req.params);
          }
          const name = BY_BROWSE_ID[req.browseId];
          // Any other page: the saved playlist / album / library artist sample.
          const fallback = req.browseId?.startsWith("MPRE")
            ? "album"
            : req.browseId?.startsWith("MPLA")
              ? "library_artist"
              : "playlist";
          return fixture(name ?? fallback) ?? {};
        }
        case "player_cmd": {
          const c = a.cmd ?? {};
          if (c.action === "toggle") playing = !playing;
          if (c.action === "next") (index = (index + 1) % tracks.length), (position = 0);
          if (c.action === "previous") (index = Math.max(0, index - 1)), (position = 0);
          if (c.action === "seek") position = c.seconds;
          if (c.action === "seekBy") position = Math.max(0, position + c.seconds);
          if (c.action === "volume") volume = c.value;
          if (c.action === "rate") rate = c.value;
          if (c.action === "repeat") repeat = c.mode;
          if (c.action === "shuffle") shuffle = c.on;
          if (c.action === "load") {
            const at = tracks.findIndex((t) => t.videoId === c.videoId);
            index = at >= 0 ? at : 0;
            position = 0;
            playing = true;
          }
          if (c.action === "loadList") {
            const at = tracks.findIndex((t) => t.videoId === c.videoIds?.[0]);
            index = at >= 0 ? at : 0;
            position = 0;
            playing = true;
          }
          if (c.action === "queueJump") (index = c.index), (position = 0);
          if (c.action === "queueMove" && c.from > index && c.to > index && tracks[c.from]?.videoId === c.videoId) {
            tracks.splice(c.to, 0, ...tracks.splice(c.from, 1));
          }
          setTimeout(push, 50);
          return null;
        }
        case "ytm_call": {
          // Pretend every change works (nothing is sent anywhere).
          console.info("[preview] ytm_call", a.endpoint, a.body);
          if (a.endpoint === "playlist/create") return { playlistId: `PLpreview${Date.now()}` };
          if (a.endpoint === "playlist/get_add_to_playlist") {
            const videoId = a.body?.videoIds?.[0];
            const own = parseLibraryPlaylists(fixture("library_playlists")).items.filter((p) => p.owned);
            return {
              contents: [
                {
                  addToPlaylistRenderer: {
                    playlists: own.map((p) => ({
                      playlistAddToOptionRenderer: {
                        playlistId: p.browseId.slice(2),
                        title: { simpleText: p.title },
                        containsSelectedVideos: inPlaylist.has(`${p.browseId.slice(2)}|${videoId}`) ? "ALL" : "NONE",
                      },
                    })),
                  },
                },
              ],
            };
          }
          if (a.endpoint === "browse/edit_playlist") {
            const results = [];
            for (const act of a.body?.actions ?? []) {
              const key = `${a.body.playlistId}|${act.addedVideoId ?? act.removedVideoId}`;
              if (act.action === "ACTION_ADD_VIDEO") {
                inPlaylist.add(key);
                results.push({ playlistEditVideoAddedResultData: { videoId: act.addedVideoId, setVideoId: `SET${Date.now()}` } });
              }
              if (act.action?.startsWith("ACTION_REMOVE_VIDEO")) inPlaylist.delete(key);
            }
            return { status: "STATUS_SUCCEEDED", playlistEditResults: results };
          }
          if (a.endpoint === "next") return {}; // no YouTube Music lyrics in the preview
          return { status: "STATUS_SUCCEEDED" };
        }
        case "history_mixes": {
          // Pretend mixes from Liked Songs (there's no listening history in the preview).
          const raw = (from: number, n: number) =>
            tracks.slice(from, from + n).map((t) => ({
              videoId: t.videoId,
              title: t.title,
              artist: t.artists.map((x) => x.name).join(", "),
              album: t.album?.name ?? "",
              duration: seconds(t.duration),
              artwork: t.thumbnail ?? "",
            }));
          return [
            { id: "on-repeat", title: "On repeat", description: "What you've played most in the last 30 days", tracks: raw(0, 25) },
            { id: "forgotten-favourites", title: "Forgotten favourites", description: "Songs you used to play a lot and haven't heard in a while", tracks: raw(30, 20) },
            { id: "never-skipped", title: "Never skipped", description: "Songs you always listen to all the way through", tracks: raw(60, 40) },
            { id: "late-night", title: "Late night", description: "What you play after 10 pm", tracks: raw(100, 18) },
          ].filter((m) => m.tracks.length >= 15);
        }
        case "history_play_counts":
          // Every third song "played" a few times, the rest barely.
          return (a.videoIds ?? []).map((_: string, i: number) => (i % 3 === 0 ? 4 : i % 2));
        case "settings_get":
          return settings;
        case "settings_set":
          settings = { ...settings, ...a.patch };
          return settings;
        case "app_info":
          return {
            name: "youtube-music-native",
            version: "0.1.0 (preview)",
            tauri: "-",
            webview: "-",
            os: "browser preview",
            logDir: "(none in the preview)",
            dataDir: "(none in the preview)",
            debug: true,
          };
        case "plugin:updater|check":
          // A pretend newer release, so the Settings page's update section can be seen.
          return { rid: 1, currentVersion: "0.1.0", version: "0.2.0", date: null, body: "", rawJson: {} };
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
}
