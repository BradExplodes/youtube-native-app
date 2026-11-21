// Development only: run the UI in an ordinary browser (no app around it) for design
// work. Fakes the app's commands with the saved sample responses from your library
// (src/lib/ytm/__fixtures__/raw, gitignored) and a pretend player. Never in the real app.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { parseLibraryPlaylists, parseTrackListPage } from "$lib/ytm/parse";

const raw = import.meta.glob("$lib/ytm/__fixtures__/raw/*.json", { eager: true, import: "default" });
const fixture = (name: string): unknown =>
  Object.entries(raw).find(([path]) => path.endsWith(`/${name}.json`))?.[1];

const BY_BROWSE_ID: Record<string, string> = {
  VLLM: "liked_songs",
  FEmusic_liked_playlists: "library_playlists",
  FEmusic_liked_albums: "library_albums",
  FEmusic_library_corpus_track_artists: "library_artists",
};

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
  let settings = { discordPresence: true, audioOnly: true, verboseLogs: false };

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
          if (c.action === "queueJump") (index = c.index), (position = 0);
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
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
}
