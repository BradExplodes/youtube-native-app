import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fold, interleave, mainArtist, pickRelated, relatedArtists } from "./discover";
import { parseArtistPage } from "./ytm/search";
import type { Tile, Track } from "./ytm/types";

const artist = (id: string, title = id): Tile => ({ kind: "artist", title, subtitle: "", browseId: id });
const track = (videoId: string): Track => ({ videoId, title: videoId, artists: [], explicit: false, available: true });

describe("mainArtist", () => {
  it("takes the first name of a byline", () => {
    expect(mainArtist("Linkin Park")).toBe("Linkin Park");
    expect(mainArtist("Arash & Helena")).toBe("Arash");
    expect(mainArtist("A, B")).toBe("A");
    expect(mainArtist("Ava Max feat. Someone")).toBe("Ava Max");
    // Not inside words.
    expect(mainArtist("Daft Punk")).toBe("Daft Punk");
  });
});

describe("fold", () => {
  it("ignores case, accents and extra spaces", () => {
    expect(fold("  Beyoncé  Knowles ")).toBe("beyonce knowles");
  });
});

describe("relatedArtists", () => {
  it("finds the shelf made only of artists", () => {
    const page = {
      name: "X",
      subtitle: "",
      topSongs: [],
      shelves: [
        { title: "Albums", tiles: [{ kind: "album" as const, title: "A", subtitle: "", browseId: "MPRE1" }] },
        { title: "Fans might also like", tiles: [artist("UC1"), artist("UC2"), artist("UC3")] },
      ],
    };
    expect(relatedArtists(page).map((t) => t.browseId)).toEqual(["UC1", "UC2", "UC3"]);
    expect(relatedArtists({ ...page, shelves: page.shelves.slice(0, 1) })).toEqual([]);
  });
});

describe("pickRelated", () => {
  const seedA = { name: "Seed A", id: "UCa" };
  const seedB = { name: "Seed B", id: "UCb" };

  it("ranks artists several of yours point to first, and says which one it's like", () => {
    const picked = pickRelated(
      [
        { seed: seedA, related: [artist("UCx"), artist("UCy"), artist("UCz")] },
        { seed: seedB, related: [artist("UCw"), artist("UCz")] },
      ],
      new Set(),
    );
    expect(picked.map((r) => r.tile.browseId)).toEqual(["UCz", "UCw", "UCx", "UCy"]);
    // UCz is 2nd on B's list and 3rd on A's: most like B.
    expect(picked[0].because).toBe("Seed B");
  });

  it("leaves out artists you already listen to, by id or by name", () => {
    const picked = pickRelated(
      [{ seed: seedA, related: [artist("UCb", "Seed B"), artist("UCk", "Known Band"), artist("UCn", "New Band"), artist("UCa")] }],
      new Set(["UCb", fold("Known Band")]),
    );
    expect(picked.map((r) => r.tile.title)).toEqual(["New Band"]);
  });
});

describe("interleave", () => {
  it("takes from each list in turn, without repeats", () => {
    const out = interleave(
      [
        [track("a1"), track("a2"), track("a3"), track("a4")],
        [track("b1"), track("a1")],
        [track("c1"), track("c2")],
      ],
      3,
      50,
    );
    expect(out.map((t) => t.videoId)).toEqual(["a1", "b1", "c1", "a2", "c2", "a3"]);
    expect(interleave([[track("a"), track("b")], [track("c")]], 3, 2).map((t) => t.videoId)).toEqual(["a", "c"]);
  });
});

// A saved artist page (gitignored; see capture.ts), when there is one.
const fixture = path.join(import.meta.dirname, "ytm", "__fixtures__", "raw", "artist_page.json");
(fs.existsSync(fixture) ? it : it.skip)("finds Fans might also like on a real artist page", () => {
  const related = relatedArtists(parseArtistPage(JSON.parse(fs.readFileSync(fixture, "utf8"))));
  expect(related.length).toBeGreaterThanOrEqual(3);
  for (const t of related) expect(t.browseId).toMatch(/^UC/);
});
