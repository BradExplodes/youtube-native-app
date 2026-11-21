// Searching YouTube Music. One search at a time (the search popup); narrowing it to one
// kind (songs, albums…) loads that list separately, with more as you scroll.
import { browseRaw } from "$lib/ytm/api";
import { SEARCH_FILTERS, parseFilteredSearch, parseSearch, parseSearchContinuation } from "$lib/ytm/search";
import { likes } from "$lib/stores/likes.svelte";
import type { SearchFilter, SearchResults, Tile, Track } from "$lib/ytm/types";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One kind of result, loaded in batches. */
export class FilteredResults {
  tracks = $state.raw<Track[]>([]);
  tiles = $state.raw<Tile[]>([]);
  loading = $state(false);
  loaded = $state(false);
  error = $state<string | null>(null);
  private continuation: string | undefined;

  constructor(
    readonly query: string,
    readonly filter: SearchFilter,
  ) {}

  get hasMore() {
    return !!this.continuation;
  }

  async load() {
    if (this.loading || this.loaded) return;
    this.loading = true;
    this.error = null;
    try {
      const batch = parseFilteredSearch(await browseRaw({ query: this.query, params: SEARCH_FILTERS[this.filter] }));
      this.tracks = batch.tracks;
      likes.note(batch.tracks);
      this.tiles = batch.tiles;
      this.continuation = batch.continuation;
      this.loaded = true;
    } catch (e) {
      this.error = message(e);
    } finally {
      this.loading = false;
    }
  }

  async more() {
    if (this.loading || !this.continuation) return;
    this.loading = true;
    try {
      const batch = parseSearchContinuation(await browseRaw({ continuation: this.continuation, search: true }));
      this.tracks = [...this.tracks, ...batch.tracks];
      likes.note(batch.tracks);
      this.tiles = [...this.tiles, ...batch.tiles];
      this.continuation = batch.continuation;
    } catch (e) {
      this.error = message(e);
    } finally {
      this.loading = false;
    }
  }
}

class Search {
  /** What's typed in the box. */
  input = $state("");
  /** What the results are for. */
  query = $state("");
  filter = $state<"all" | SearchFilter>("all");
  results = $state.raw<SearchResults | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  private filtered = new Map<SearchFilter, FilteredResults>();
  /** Bumped by each new search, so a slow older answer can't replace a newer one. */
  private generation = 0;

  async run(query = this.input) {
    query = query.trim();
    if (!query || query === this.query) return;
    const generation = ++this.generation;
    this.query = query;
    this.filtered.clear();
    this.loading = true;
    this.error = null;
    try {
      const results = parseSearch(await browseRaw({ query }));
      if (generation === this.generation) this.results = results;
      likes.note([...results.songs, ...(results.top?.tracks ?? [])]);
    } catch (e) {
      if (generation === this.generation) this.error = message(e);
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  /** Results narrowed to one kind, for the current query (created on first use). */
  only(filter: SearchFilter): FilteredResults {
    let f = this.filtered.get(filter);
    if (!f || f.query !== this.query) this.filtered.set(filter, (f = new FilteredResults(this.query, filter)));
    return f;
  }
}

export const search = new Search();
