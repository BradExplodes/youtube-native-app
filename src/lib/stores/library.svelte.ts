// Your library (playlists, albums, artists) and the track-list pages you open.
// Everything is fetched on demand and kept for the session.
import { BROWSE, browseRaw } from "$lib/ytm/api";
import {
  parseLibraryAlbums,
  parseLibraryAlbumsContinuation,
  parseLibraryArtists,
  parseLibraryArtistsContinuation,
  parseLibraryPlaylists,
  parseLibraryPlaylistsContinuation,
  parseTrackContinuation,
  parseTrackListPage,
} from "$lib/ytm/parse";
import { parseArtistPage } from "$lib/ytm/search";
import { EXPLORE_LINKS, parseShelfContinuation, parseShelfPage } from "$lib/ytm/shelves";
import { likes } from "$lib/stores/likes.svelte";
import { ui } from "$lib/stores/ui.svelte";
import type { ArtistPage, BrowseLink, Card, Chip, LibraryArtist, Shelf, Track, TrackListPage } from "$lib/ytm/types";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Page titles by browse id, filled in as pages load: for tab titles. (Tabs can't
 *  read the page stores directly: the store would be created inside the tab's own
 *  update, and Svelte doesn't track state created that way.) */
export const titles = $state<Record<string, string>>({});

/** A list that loads its first batch, then follows continuation tokens to the end. */
class Collection<T> {
  items = $state.raw<T[]>([]);
  loading = $state(false);
  loaded = $state(false);
  error = $state<string | null>(null);

  constructor(
    private browseId: string,
    private first: (raw: unknown) => { items: T[]; continuation?: string },
    private next: (raw: unknown) => { items: T[]; continuation?: string },
  ) {}

  async load() {
    if (this.loading || this.loaded) return;
    this.loading = true;
    this.error = null;
    try {
      let batch = this.first(await browseRaw({ browseId: this.browseId }));
      this.items = batch.items;
      // Libraries are small (a few pages at most), so just fetch the rest.
      for (let i = 0; batch.continuation && i < 50; i++) {
        batch = this.next(await browseRaw({ continuation: batch.continuation }));
        this.items = [...this.items, ...batch.items];
      }
      this.loaded = true;
    } catch (e) {
      this.error = message(e);
    } finally {
      this.loading = false;
    }
  }

  /** Fetch it all again (after you change it), keeping the old list on screen meanwhile. */
  async reload() {
    if (this.loading) return;
    this.loaded = false;
    await this.load();
  }
}

/** One open track list. Tracks after the first batch load as you scroll. */
export class TrackPage {
  info = $state.raw<TrackListPage | null>(null);
  tracks = $state.raw<Track[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);
  private continuation = $state<string | undefined>(undefined);

  constructor(readonly browseId: string) {}

  get hasMore() {
    return !!this.continuation;
  }

  private get isLiked() {
    return this.browseId === BROWSE.likedSongs;
  }

  async load() {
    if (this.loading || this.info) return;
    await this.fetchFirst();
  }

  /** Load the first batch again (after you change the list), keeping the old one on
   *  screen meanwhile. Batches further down load again as you scroll. */
  async refresh() {
    if (!this.info) return; // never opened: it loads fresh when it is
    await this.fetchFirst();
  }

  private async fetchFirst() {
    if (this.loading) return;
    this.loading = true;
    this.error = null;
    try {
      const page = parseTrackListPage(await browseRaw({ browseId: this.browseId }));
      this.info = page;
      if (page.title) titles[this.browseId] = page.title;
      this.tracks = page.tracks;
      likes.note(page.tracks, this.isLiked);
      this.continuation = page.continuation;
    } catch (e) {
      this.error = message(e);
    } finally {
      this.loading = false;
    }
  }

  /** Take songs out of the list straight away (after removing them from the playlist). */
  remove(match: (t: Track) => boolean) {
    this.tracks = this.tracks.filter((t) => !match(t));
  }

  /** Move a row into the gap before row `gap` straight away (after dragging it there). */
  move(from: number, gap: number) {
    const next = [...this.tracks];
    const [row] = next.splice(from, 1);
    if (!row) return;
    next.splice(gap > from ? gap - 1 : gap, 0, row);
    this.tracks = next;
  }

  /** Show new details straight away (after editing the playlist). */
  patch(info: Partial<TrackListPage>) {
    if (this.info) this.info = { ...this.info, ...info };
    if (info.title) titles[this.browseId] = info.title;
  }

  /** Load every remaining batch (for filtering the whole list). */
  async all() {
    while (this.continuation && !this.error) {
      const before = this.continuation;
      await this.more();
      if (this.continuation === before) break; // still loading elsewhere, or stuck
    }
  }

  /** Fetch the next batch (called when scrolling near the end). */
  async more() {
    if (this.loading || !this.continuation) return;
    this.loading = true;
    try {
      const batch = parseTrackContinuation(await browseRaw({ continuation: this.continuation }), this.info?.byline);
      this.tracks = [...this.tracks, ...batch.tracks];
      likes.note(batch.tracks, this.isLiked);
      this.continuation = batch.continuation;
    } catch (e) {
      this.error = message(e);
    } finally {
      this.loading = false;
    }
  }
}

/** An artist's own page (UC…). */
export class ArtistPageStore {
  info = $state.raw<ArtistPage | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);

  constructor(readonly browseId: string) {}

  async load() {
    if (this.loading || this.info) return;
    this.loading = true;
    this.error = null;
    try {
      this.info = parseArtistPage(await browseRaw({ browseId: this.browseId }));
      if (this.info.name) titles[this.browseId] = this.info.name;
    } catch (e) {
      this.error = message(e);
    } finally {
      this.loading = false;
    }
  }
}

/** The key a page of shelves is kept (and titled) under: its browse id, plus params if any. */
export const shelfKey = (link: BrowseLink) => (link.params ? `${link.browseId}|${link.params}` : link.browseId);

/** A page of shelves: Home (per mood chip), Explore, a genre, the charts…
 *  More shelves load as you scroll. */
export class ShelfPageStore {
  title = $state("");
  chips = $state.raw<Chip[]>([]);
  shelves = $state.raw<Shelf[]>([]);
  loading = $state(false);
  loaded = $state(false);
  error = $state<string | null>(null);
  private continuation = $state<string | undefined>(undefined);
  private loadedAt = 0;

  constructor(readonly link: BrowseLink) {}

  get hasMore() {
    return !!this.continuation;
  }

  async load() {
    if (this.loading || this.loaded) return;
    await this.fetchFirst();
  }

  /** Fetch it again if it's older than `maxAgeMs` (keeping the old shelves on screen meanwhile). */
  async refreshIfOlder(maxAgeMs: number) {
    if (this.loaded && !this.loading && Date.now() - this.loadedAt > maxAgeMs) await this.fetchFirst();
  }

  private async fetchFirst() {
    this.loading = true;
    this.error = null;
    try {
      const page = parseShelfPage(await browseRaw(this.link));
      this.title = page.title;
      // Some pages (the charts) have no heading of their own: name their tab anyway.
      titles[shelfKey(this.link)] =
        page.title || EXPLORE_LINKS.find((l) => l.browseId === this.link.browseId)?.title || "Explore";
      this.chips = page.chips;
      this.shelves = page.shelves;
      this.continuation = page.continuation;
      this.loaded = true;
      this.loadedAt = Date.now();
    } catch (e) {
      this.error = message(e);
    } finally {
      this.loading = false;
    }
  }

  /** Fetch the next shelves (called when scrolling near the end). */
  async more() {
    if (this.loading || !this.continuation) return;
    this.loading = true;
    this.error = null;
    try {
      const batch = parseShelfContinuation(await browseRaw({ continuation: this.continuation }));
      this.shelves = [...this.shelves, ...batch.shelves];
      // A token that leads nowhere new would otherwise be asked for forever.
      this.continuation = batch.shelves.length ? batch.continuation : undefined;
    } catch (e) {
      this.error = message(e);
    } finally {
      this.loading = false;
    }
  }
}

class Library {
  playlists = new Collection<Card>(BROWSE.playlists, parseLibraryPlaylists, parseLibraryPlaylistsContinuation);
  albums = new Collection<Card>(BROWSE.albums, parseLibraryAlbums, parseLibraryAlbumsContinuation);
  artists = new Collection<LibraryArtist>(BROWSE.artists, parseLibraryArtists, parseLibraryArtistsContinuation);
  private pages = new Map<string, TrackPage>();
  private artistPages = new Map<string, ArtistPageStore>();
  private shelfPages = new Map<string, ShelfPageStore>();
  /** The mood chip picked on Home ("Energize", "Relax"…), as its params. Kept for the session. */
  homeChip = $state<string | undefined>(undefined);

  shelfPage(link: BrowseLink): ShelfPageStore {
    const key = shelfKey(link);
    let p = this.shelfPages.get(key);
    if (!p) this.shelfPages.set(key, (p = new ShelfPageStore(link)));
    return p;
  }

  artist(browseId: string): ArtistPageStore {
    let p = this.artistPages.get(browseId);
    if (!p) this.artistPages.set(browseId, (p = new ArtistPageStore(browseId)));
    return p;
  }

  page(browseId: string): TrackPage {
    let p = this.pages.get(browseId);
    if (!p) this.pages.set(browseId, (p = new TrackPage(browseId)));
    return p;
  }

  /** A page only if it has been opened (so changes don't fetch pages nobody looks at). */
  openedPage(browseId: string): TrackPage | undefined {
    return this.pages.get(browseId);
  }

  /** Drop a page that no longer exists (a deleted playlist). */
  forget(browseId: string) {
    this.pages.delete(browseId);
  }
}

export const library = new Library();

/** Your playlists as the sidebar lists them: pinned first (most recently pinned on top),
 *  then the rest in YouTube Music's order. Liked Songs isn't among them. */
export function sidebarPlaylists(): Card[] {
  const all = library.playlists.items.filter((p) => p.browseId !== BROWSE.likedSongs);
  const pinned = ui.pinned
    .toReversed()
    .map((id) => all.find((p) => p.browseId === id))
    .filter((p): p is Card => !!p);
  return [...pinned, ...all.filter((p) => !ui.isPinned(p.browseId))];
}
