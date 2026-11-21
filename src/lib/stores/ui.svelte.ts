// Small UI preferences, remembered on this computer.

function read(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function write(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeList(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}

class Ui {
  queueOpen = $state(read("ytmn.queueOpen", false));
  lyricsOpen = $state(read("ytmn.lyricsOpen", false));
  /** Pinned playlists (browse ids), in the order they were pinned. Kept on this computer only. */
  pinned = $state<string[]>(readList("ytmn.pinned"));
  sidebarOpen = $state(read("ytmn.sidebarOpen", true));
  /** Bumped to ask the open search box / playlist filter to take the keyboard focus. */
  searchFocus = $state(0);
  filterFocus = $state(0);
  /** The search popup. */
  searchOpen = $state(false);
  /** The keyboard shortcuts sheet. */
  shortcutsOpen = $state(false);

  openSearch() {
    this.searchOpen = true;
    this.searchFocus++;
  }

  closeSearch() {
    this.searchOpen = false;
  }

  isPinned(browseId: string) {
    return this.pinned.includes(browseId);
  }

  setPinned(browseId: string, on: boolean) {
    this.pinned = on ? [...this.pinned.filter((id) => id !== browseId), browseId] : this.pinned.filter((id) => id !== browseId);
    writeList("ytmn.pinned", this.pinned);
  }

  // The queue and the lyrics share the panel on the right: one at a time.
  toggleLyrics() {
    this.lyricsOpen = !this.lyricsOpen;
    write("ytmn.lyricsOpen", this.lyricsOpen);
    if (this.lyricsOpen && this.queueOpen) {
      this.queueOpen = false;
      write("ytmn.queueOpen", false);
    }
  }

  toggleQueue() {
    this.queueOpen = !this.queueOpen;
    write("ytmn.queueOpen", this.queueOpen);
    if (this.queueOpen && this.lyricsOpen) {
      this.lyricsOpen = false;
      write("ytmn.lyricsOpen", false);
    }
  }

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
    write("ytmn.sidebarOpen", this.sidebarOpen);
  }
}

export const ui = new Ui();
