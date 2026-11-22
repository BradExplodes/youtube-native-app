// Development only: save real responses from the signed-in account as test
// fixtures (to a gitignored folder), so the parsers are written against real data.
import { invoke } from "@tauri-apps/api/core";
import { BROWSE, browseRaw, type Raw } from "./api";
import { EXPLORE_LINKS, SHELF_PAGES } from "./shelves";

const save = (name: string, data: Raw) => invoke("dev_save_fixture", { name, data });

/** First value found anywhere in `obj` for which `pick` returns something. */
function findDeep<T>(obj: Raw, pick: (key: string, value: Raw) => T | undefined): T | undefined {
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const [k, v] of Object.entries(cur)) {
      const hit = pick(k, v);
      if (hit !== undefined) return hit;
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return undefined;
}

const browseIdLike = (prefix: string, exclude: string[] = []) => (k: string, v: Raw) =>
  k === "browseId" && typeof v === "string" && v.startsWith(prefix) && !exclude.includes(v) ? v : undefined;

const continuationToken = (k: string, v: Raw) =>
  (k === "continuationCommand" || k === "nextContinuationData") && v && typeof v === "object"
    ? ((v.token ?? v.continuation) as string | undefined)
    : undefined;

let done = false;

export async function captureFixtures() {
  if (done || !import.meta.env.DEV) return;
  done = true;
  const log: string[] = [];
  const step = async (name: string, fn: () => Promise<Raw>) => {
    try {
      const data = await fn();
      await save(name, data);
      log.push(`ok ${name}`);
      return data;
    } catch (e) {
      log.push(`FAILED ${name}: ${e}`);
      return null;
    }
  };

  const liked = await step("liked_songs", () => browseRaw({ browseId: BROWSE.likedSongs }));
  const token = liked && findDeep(liked, continuationToken);
  if (token) await step("liked_songs_continuation", () => browseRaw({ continuation: token }));

  const playlists = await step("library_playlists", () => browseRaw({ browseId: BROWSE.playlists }));
  const albums = await step("library_albums", () => browseRaw({ browseId: BROWSE.albums }));
  const artists = await step("library_artists", () => browseRaw({ browseId: BROWSE.artists }));

  const playlistId = playlists && findDeep(playlists, browseIdLike("VL", ["VLLM", "VLSE"]));
  if (playlistId) await step("playlist", () => browseRaw({ browseId: playlistId }));
  const albumId = (albums && findDeep(albums, browseIdLike("MPREb_"))) || findDeep(liked, browseIdLike("MPREb_"));
  if (albumId) await step("album", () => browseRaw({ browseId: albumId }));
  const libraryArtistId = artists && findDeep(artists, browseIdLike("MPLA"));
  if (libraryArtistId) await step("library_artist", () => browseRaw({ browseId: libraryArtistId }));
  const artistId = findDeep(liked, browseIdLike("UC"));
  if (artistId) await step("artist", () => browseRaw({ browseId: artistId }));

  // Home and Explore.
  const home = await step("home", () => browseRaw({ browseId: SHELF_PAGES.home }));
  const homeToken = home && findDeep(home, continuationToken);
  if (homeToken) await step("home_continuation", () => browseRaw({ continuation: homeToken }));
  await step("explore", () => browseRaw({ browseId: SHELF_PAGES.explore }));
  const [, charts, moodsId] = EXPLORE_LINKS.map((l) => l.browseId);
  await step("charts", () => browseRaw({ browseId: charts }));
  const moods = await step("moods_and_genres", () => browseRaw({ browseId: moodsId }));
  const genreParams =
    moods &&
    findDeep(moods, (k, v) =>
      k === "browseEndpoint" && v?.browseId === "FEmusic_moods_and_genres_category" && typeof v.params === "string" ? (v.params as string) : undefined,
    );
  if (genreParams) await step("genre", () => browseRaw({ browseId: "FEmusic_moods_and_genres_category", params: genreParams }));

  await save("_capture_log", { log });
}
