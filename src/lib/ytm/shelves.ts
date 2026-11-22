// Pages made of shelves: Home, Explore, Moods & genres, a genre, the charts, new
// releases. Each shelf is a row of cards, a block of songs or a set of genre buttons.
//
// Same defensive style as parse.ts: a section or item we don't recognise (podcasts,
// the "rate these artists" taste builder…) is skipped, never an error.
import type { Raw } from "./api";
import { continuationParts, findKey, text, tokenIn } from "./parse";
import { parseRow, twoRowTile } from "./search";
import type { BrowseLink, Chip, NavButton, Shelf, ShelfBatch, ShelfPage } from "./types";

/** Home and Explore: the pages the Home view is built from. */
export const SHELF_PAGES = {
  home: "FEmusic_home",
  explore: "FEmusic_explore",
} as const;

/** Explore's own sections, always offered at the top of Explore on Home. */
export const EXPLORE_LINKS = [
  { title: "New releases", browseId: "FEmusic_new_releases" },
  { title: "Charts", browseId: "FEmusic_charts" },
  { title: "Moods & genres", browseId: "FEmusic_moods_and_genres" },
] as const;

function linkOf(endpoint: Raw): BrowseLink | undefined {
  const b = endpoint?.browseEndpoint;
  if (typeof b?.browseId !== "string" || !b.browseId) return undefined;
  return typeof b.params === "string" && b.params ? { browseId: b.browseId, params: b.params } : { browseId: b.browseId };
}

/** YouTube Music's colours are ARGB numbers (4294940672): keep the RGB part. */
function colorOf(argb: unknown): string | undefined {
  if (typeof argb !== "number" && typeof argb !== "string") return undefined;
  const n = Number(argb);
  if (!Number.isFinite(n)) return undefined;
  return `#${(n % 0x1000000).toString(16).padStart(6, "0")}`;
}

function navButton(r: Raw): NavButton | null {
  const link = linkOf(r?.clickCommand);
  const title = text(r?.buttonText);
  if (!link || !title) return null;
  return { title, color: colorOf(r.solid?.leftStripeColor), link };
}

/** A shelf's items, sorted into songs, cards and buttons. */
function shelfOf(head: Omit<Shelf, "tracks" | "tiles" | "buttons">, items: Raw[] | undefined): Shelf | null {
  const shelf: Shelf = { ...head, tracks: [], tiles: [], buttons: [] };
  for (const item of items ?? []) {
    if (item?.musicTwoRowItemRenderer) {
      const tile = twoRowTile(item.musicTwoRowItemRenderer);
      if (tile) shelf.tiles.push(tile);
    } else if (item?.musicResponsiveListItemRenderer) {
      const row = parseRow(item, false);
      if (row && "track" in row) shelf.tracks.push(row.track);
      else if (row) shelf.tiles.push(row.tile);
    } else if (item?.musicNavigationButtonRenderer) {
      const button = navButton(item.musicNavigationButtonRenderer);
      if (button) shelf.buttons.push(button);
    }
  }
  // A shelf shows one kind of thing. Mostly songs (Quick picks, Trending): show those.
  if (shelf.tracks.length && shelf.tracks.length >= shelf.tiles.length) shelf.tiles = [];
  else shelf.tracks = [];
  return shelf.tracks.length || shelf.tiles.length || shelf.buttons.length ? shelf : null;
}

/** One section of a page, if it's a kind of shelf we show. */
export function parseSection(s: Raw): Shelf | null {
  const carousel = s?.musicCarouselShelfRenderer ?? s?.musicImmersiveCarouselShelfRenderer;
  if (carousel) {
    const h = carousel.header?.musicCarouselShelfBasicHeaderRenderer;
    return shelfOf(
      {
        title: text(h?.title),
        strapline: text(h?.strapline) || undefined,
        more: linkOf(h?.moreContentButton?.buttonRenderer?.navigationEndpoint) ?? linkOf(h?.title?.runs?.[0]?.navigationEndpoint),
        grid: false,
      },
      carousel.contents,
    );
  }
  const grid = s?.gridRenderer;
  if (grid) {
    return shelfOf({ title: text(grid.header?.gridHeaderRenderer?.title), grid: true }, grid.items);
  }
  const list = s?.musicShelfRenderer;
  if (list) {
    return shelfOf(
      { title: text(list.title), more: linkOf(list.bottomEndpoint) ?? linkOf(list.title?.runs?.[0]?.navigationEndpoint), grid: false },
      list.contents,
    );
  }
  return null;
}

const parseSections = (sections: Raw[] | undefined): Shelf[] =>
  (sections ?? []).map(parseSection).filter((s): s is Shelf => !!s);

function parseChips(raw: Raw): Chip[] {
  const chips: Raw[] = findKey(raw, "chipCloudRenderer")?.chips ?? [];
  return chips
    .map((c): Chip | null => {
      const r = c?.chipCloudChipRenderer;
      const title = text(r?.text);
      if (!title) return null;
      return { title, params: linkOf(r.navigationEndpoint)?.params, selected: !!r.isSelected };
    })
    .filter((c): c is Chip => !!c);
}

/** The first batch of a page of shelves. */
export function parseShelfPage(raw: Raw): ShelfPage {
  const list = findKey(raw?.contents, "sectionListRenderer");
  const header = raw?.header;
  return {
    title: text(findKey(header, "title")),
    chips: parseChips(list?.header ?? header),
    shelves: parseSections(list?.contents),
    continuation: tokenIn(list?.contents, list?.continuations),
  };
}

/** More shelves (Home keeps going as you scroll). */
export function parseShelfContinuation(raw: Raw): ShelfBatch {
  const { items, token } = continuationParts(raw);
  return { shelves: parseSections(items), continuation: token };
}
