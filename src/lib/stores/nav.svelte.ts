// Open pages as tabs, like a browser. Opening something that already has a tab
// switches to it; otherwise it opens in a new tab next to the current one.
// The open tabs are remembered on this computer, so the app reopens where you left off.
import { devLog } from "$lib/ipc";
import { ui } from "$lib/stores/ui.svelte";

export type Route =
  | { kind: "home" } // Home: YouTube Music's picks for you, plus Explore
  | { kind: "list"; browseId: string } // Liked Songs, a playlist, an album or a library artist
  | { kind: "browse"; browseId: string; params?: string } // a page of shelves: a genre, the charts, new releases…
  | { kind: "albums" }
  | { kind: "artists" }
  | { kind: "artist"; browseId: string } // an artist's own page (UC…)
  | { kind: "settings" };

export interface Tab {
  id: number;
  route: Route;
}

export const sameRoute = (a: Route, b: Route) =>
  a.kind === b.kind &&
  ("browseId" in a ? "browseId" in b && a.browseId === b.browseId : true) &&
  ("params" in a ? a.params : undefined) === ("params" in b ? b.params : undefined);

/** Whether a page failed because it doesn't exist (rather than, say, being offline). */
export const notFound = (error: string) => /answered 40[04]\b/.test(error);

const MAX_TABS = 8;
const HOME: Route = { kind: "home" };
const STORAGE_KEY = "ytmn.tabs";

/** A route read back from storage, or null if it isn't one we know (e.g. from a newer version). */
function validRoute(r: unknown): Route | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const id = typeof o.browseId === "string" && o.browseId ? o.browseId : null;
  switch (o.kind) {
    case "home":
    case "albums":
    case "artists":
    case "settings":
      return { kind: o.kind };
    case "list":
    case "artist":
      return id ? { kind: o.kind, browseId: id } : null;
    case "browse":
      if (!id) return null;
      return typeof o.params === "string" && o.params ? { kind: "browse", browseId: id, params: o.params } : { kind: "browse", browseId: id };
    default:
      return null;
  }
}

/** The tabs open when the app was last closed, and which one was showing. */
function readSaved(): { routes: Route[]; active: number } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!saved || !Array.isArray(saved.tabs)) return null;
    const routes: Route[] = [];
    let active = 0;
    saved.tabs.forEach((r: unknown, i: number) => {
      const route = validRoute(r);
      if (!route || routes.some((x) => sameRoute(x, route))) return;
      if (i === saved.active) active = routes.length;
      routes.push(route);
    });
    return routes.length ? { routes: routes.slice(0, MAX_TABS), active: Math.min(active, MAX_TABS - 1) } : null;
  } catch {
    return null;
  }
}

class Nav {
  tabs = $state<Tab[]>([]);
  activeId = $state(1);
  private nextId = 1;
  /** Tab ids, most recently active last: for Back and for closing the active tab. */
  private recent: number[] = [];
  /** Tabs brought back from last time whose page hasn't loaded yet. If one turns out
   *  not to exist any more (a playlist deleted elsewhere), it quietly becomes Home. */
  private restored = new Set<number>();

  constructor() {
    const saved = readSaved();
    const routes = saved?.routes ?? [HOME];
    this.tabs = routes.map((route) => ({ id: this.nextId++, route }));
    if (saved) for (const t of this.tabs) this.restored.add(t.id);
    const active = this.tabs[saved?.active ?? 0] ?? this.tabs[0];
    this.activeId = active.id;
    this.recent = [...this.tabs.filter((t) => t !== active).map((t) => t.id), active.id];
  }

  /** Remember the open tabs for next time. */
  private save() {
    try {
      const active = this.tabs.findIndex((t) => t.id === this.activeId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs: this.tabs.map((t) => t.route), active }));
    } catch {
      // Storage unavailable: the tabs just aren't remembered.
    }
  }

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

  /** A page finished loading: it exists, so its tab is no longer in doubt. */
  loaded(route: Route) {
    for (const t of this.tabs) if (sameRoute(t.route, route)) this.restored.delete(t.id);
  }

  /** A page couldn't be found. If its tab was brought back from last time, turn it into
   *  Home (or close it, if Home is already open) instead of showing an error. */
  missing(route: Route) {
    const tab = this.tabs.find((t) => sameRoute(t.route, route) && this.restored.has(t.id));
    if (!tab) return;
    this.restored.delete(tab.id);
    devLog(`restored tab ${JSON.stringify(route)} no longer exists`);
    if (this.tabs.some((t) => t.route.kind === "home")) return this.close(tab.id);
    this.tabs = this.tabs.map((t) => (t.id === tab.id ? { id: t.id, route: HOME } : t));
    this.save();
  }

  activate(id: number) {
    if (!this.tabs.some((t) => t.id === id)) return;
    this.activeId = id;
    this.recent = [...this.recent.filter((r) => r !== id), id];
    this.save();
  }

  close(id: number) {
    if (this.tabs.length === 1) {
      // Closing the last tab goes back to Home rather than leaving nothing.
      this.tabs = [{ id: this.nextId, route: HOME }];
      this.recent = [this.nextId];
      this.activeId = this.nextId++;
      this.save();
      return;
    }
    this.tabs = this.tabs.filter((t) => t.id !== id);
    this.recent = this.recent.filter((r) => r !== id);
    this.restored.delete(id);
    if (this.activeId === id) this.activate(this.recent[this.recent.length - 1] ?? this.tabs[0].id);
    else this.save();
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
