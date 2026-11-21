// Open pages as tabs, like a browser. Opening something that already has a tab
// switches to it; otherwise it opens in a new tab next to the current one.
import { devLog } from "$lib/ipc";
import { ui } from "$lib/stores/ui.svelte";
import { BROWSE } from "$lib/ytm/api";

export type Route =
  | { kind: "list"; browseId: string } // Liked Songs, a playlist, an album or a library artist
  | { kind: "albums" }
  | { kind: "artists" }
  | { kind: "artist"; browseId: string } // an artist's own page (UC…)
  | { kind: "settings" };

export interface Tab {
  id: number;
  route: Route;
}

export const sameRoute = (a: Route, b: Route) =>
  a.kind === b.kind && ("browseId" in a ? "browseId" in b && a.browseId === b.browseId : true);

const MAX_TABS = 8;
const LIKED: Route = { kind: "list", browseId: BROWSE.likedSongs };

class Nav {
  tabs = $state<Tab[]>([{ id: 1, route: LIKED }]);
  activeId = $state(1);
  private nextId = 2;
  /** Tab ids, most recently active last: for Back and for closing the active tab. */
  private recent: number[] = [1];

  get active(): Tab {
    return this.tabs.find((t) => t.id === this.activeId) ?? this.tabs[0];
  }

  get route(): Route {
    return this.active.route;
  }

  go(to: Route) {
    devLog(`go ${JSON.stringify(to)}`);
    // Opening a page from the search popup takes you there.
    ui.closeSearch();
    const existing = this.tabs.find((t) => sameRoute(t.route, to));
    if (existing) return this.activate(existing.id);

    const tab = { id: this.nextId++, route: to };
    const at = this.tabs.findIndex((t) => t.id === this.activeId);
    const tabs = [...this.tabs];
    tabs.splice(at + 1, 0, tab);
    // Too many tabs: drop the one used least recently (never the current one).
    while (tabs.length > MAX_TABS) {
      const victim = this.recent.find((id) => id !== this.activeId && tabs.some((t) => t.id === id));
      if (victim === undefined) break;
      tabs.splice(tabs.findIndex((t) => t.id === victim), 1);
      this.recent = this.recent.filter((id) => id !== victim);
    }
    this.tabs = tabs;
    this.activate(tab.id);
  }

  activate(id: number) {
    if (!this.tabs.some((t) => t.id === id)) return;
    this.activeId = id;
    this.recent = [...this.recent.filter((r) => r !== id), id];
  }

  close(id: number) {
    if (this.tabs.length === 1) {
      // Closing the last tab goes back to Liked Songs rather than leaving nothing.
      this.tabs = [{ id: this.nextId, route: LIKED }];
      this.recent = [this.nextId];
      this.activeId = this.nextId++;
      return;
    }
    this.tabs = this.tabs.filter((t) => t.id !== id);
    this.recent = this.recent.filter((r) => r !== id);
    if (this.activeId === id) this.activate(this.recent[this.recent.length - 1] ?? this.tabs[0].id);
  }

  /** Back to the previously used tab (mouse back button). */
  back() {
    const prev = this.recent[this.recent.length - 2];
    if (prev !== undefined) this.activate(prev);
  }

  /** Ctrl+Tab / Ctrl+Shift+Tab: the tab to the right / left, wrapping around. */
  cycle(step: 1 | -1) {
    const at = this.tabs.findIndex((t) => t.id === this.activeId);
    const to = this.tabs[(at + step + this.tabs.length) % this.tabs.length];
    if (to) this.activate(to.id);
  }

  isAt(to: Route) {
    return sameRoute(to, this.route);
  }
}

export const nav = new Nav();
