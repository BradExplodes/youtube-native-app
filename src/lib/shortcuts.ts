// App-wide keyboard shortcuts. The list below drives both the handler and the
// shortcuts sheet (Settings, and `?`), so they can't disagree.
import { cycleRegion, isTyping } from "$lib/a11y";
import {
  REPEAT_LABEL,
  cycleRepeat,
  next,
  nudgeVolume,
  previous,
  seekBy,
  toggleLikeCurrent,
  toggleMute,
  togglePlay,
  toggleShuffle,
} from "$lib/playback";
import { menu } from "$lib/stores/menu.svelte";
import { nav } from "$lib/stores/nav.svelte";
import { player } from "$lib/stores/player.svelte";
import { toasts } from "$lib/stores/toast.svelte";
import { ui } from "$lib/stores/ui.svelte";

export type ShortcutGroup = "Playback" | "Pages and panels" | "Moving around";

export interface Shortcut {
  /** Keys as shown, e.g. ["Ctrl", "→"]. */
  keys: string[];
  label: string;
  group: ShortcutGroup;
  /** Matches the key press. */
  match: (e: KeyboardEvent) => boolean;
  run: (e: KeyboardEvent) => void;
  /** Also works while typing in a text box. */
  whileTyping?: boolean;
}

const plain = (e: KeyboardEvent) => !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
const ctrl = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
const key = (e: KeyboardEvent) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);

export const SHORTCUTS: Shortcut[] = [
  // ---- playback
  {
    keys: ["Space"],
    label: "Play / pause",
    group: "Playback",
    // On a focused button Space presses it, as usual.
    match: (e) => plain(e) && e.key === " " && !(e.target as HTMLElement).closest?.("button, a, [role='menuitem']"),
    run: () => togglePlay(),
  },
  { keys: ["Ctrl", "→"], label: "Next song", group: "Playback", match: (e) => ctrl(e) && e.key === "ArrowRight", run: () => next() },
  {
    keys: ["Ctrl", "←"],
    label: "Previous song (or restart)",
    group: "Playback",
    match: (e) => ctrl(e) && e.key === "ArrowLeft",
    run: () => previous(),
  },
  {
    keys: ["Shift", "→"],
    label: "Forward 10 seconds",
    group: "Playback",
    match: (e) => e.shiftKey && !e.ctrlKey && !e.altKey && e.key === "ArrowRight",
    run: () => seekBy(10),
  },
  {
    keys: ["Shift", "←"],
    label: "Back 10 seconds",
    group: "Playback",
    match: (e) => e.shiftKey && !e.ctrlKey && !e.altKey && e.key === "ArrowLeft",
    run: () => seekBy(-10),
  },
  { keys: ["Ctrl", "↑"], label: "Volume up", group: "Playback", match: (e) => ctrl(e) && e.key === "ArrowUp", run: () => nudgeVolume(5) },
  { keys: ["Ctrl", "↓"], label: "Volume down", group: "Playback", match: (e) => ctrl(e) && e.key === "ArrowDown", run: () => nudgeVolume(-5) },
  { keys: ["M"], label: "Mute / unmute", group: "Playback", match: (e) => plain(e) && key(e) === "m", run: () => toggleMute() },
  {
    keys: ["L"],
    label: "Like / unlike the current song",
    group: "Playback",
    match: (e) => plain(e) && key(e) === "l",
    run: () => toggleLikeCurrent(),
  },
  {
    keys: ["S"],
    label: "Shuffle on / off",
    group: "Playback",
    match: (e) => plain(e) && key(e) === "s",
    run: () => {
      if (!player.playback) return;
      toggleShuffle();
      toasts.show(player.playback.shuffle ? "Shuffle on" : "Shuffle off");
    },
  },
  {
    keys: ["R"],
    label: "Repeat: off / playlist / this song",
    group: "Playback",
    match: (e) => plain(e) && key(e) === "r",
    run: () => {
      const mode = cycleRepeat();
      if (mode) toasts.show(REPEAT_LABEL[mode]);
    },
  },

  // ---- pages and panels
  {
    keys: ["Ctrl", "K"],
    label: "Search",
    group: "Pages and panels",
    whileTyping: true,
    match: (e) => ctrl(e) && key(e) === "k",
    run: () => ui.openSearch(),
  },
  {
    keys: ["Ctrl", "F"],
    label: "Find in this playlist",
    group: "Pages and panels",
    whileTyping: true,
    match: (e) => ctrl(e) && key(e) === "f",
    run: () => (nav.route.kind === "list" ? ui.filterFocus++ : ui.openSearch()),
  },
  { keys: ["Q"], label: "Show / hide the queue", group: "Pages and panels", match: (e) => plain(e) && key(e) === "q", run: () => ui.toggleQueue() },
  {
    keys: ["Ctrl", "L"],
    label: "Show / hide lyrics",
    group: "Pages and panels",
    match: (e) => ctrl(e) && key(e) === "l",
    run: () => ui.toggleLyrics(),
  },
  {
    keys: ["Ctrl", "B"],
    label: "Expand / collapse the sidebar",
    group: "Pages and panels",
    match: (e) => ctrl(e) && key(e) === "b",
    run: () => ui.toggleSidebar(),
  },
  {
    keys: ["Ctrl", ","],
    label: "Settings",
    group: "Pages and panels",
    whileTyping: true,
    match: (e) => ctrl(e) && e.key === ",",
    run: () => nav.go({ kind: "settings" }),
  },
  {
    keys: ["?"],
    label: "Keyboard shortcuts",
    group: "Pages and panels",
    match: (e) => !e.ctrlKey && !e.altKey && !e.metaKey && e.key === "?",
    run: () => (ui.shortcutsOpen = true),
  },

  // ---- moving around
  {
    keys: ["Ctrl", "Tab"],
    label: "Next tab",
    group: "Moving around",
    whileTyping: true,
    match: (e) => e.ctrlKey && !e.shiftKey && !e.altKey && e.key === "Tab",
    run: () => nav.cycle(1),
  },
  {
    keys: ["Ctrl", "Shift", "Tab"],
    label: "Previous tab",
    group: "Moving around",
    whileTyping: true,
    match: (e) => e.ctrlKey && e.shiftKey && !e.altKey && e.key === "Tab",
    run: () => nav.cycle(-1),
  },
  {
    keys: ["Ctrl", "W"],
    label: "Close this tab",
    group: "Moving around",
    whileTyping: true,
    match: (e) => ctrl(e) && key(e) === "w",
    run: () => nav.close(nav.activeId),
  },
  {
    keys: ["Alt", "←"],
    label: "Back to the previous tab",
    group: "Moving around",
    whileTyping: true,
    match: (e) => e.altKey && !e.ctrlKey && !e.shiftKey && e.key === "ArrowLeft",
    run: () => nav.back(),
  },
  {
    keys: ["F6"],
    label: "Next area (tabs, sidebar, page, panel, player)",
    group: "Moving around",
    whileTyping: true,
    match: (e) => !e.ctrlKey && !e.altKey && e.key === "F6",
    run: (e) => cycleRegion(e.shiftKey),
  },
];

/** Shown in the sheet, handled where they happen (lists, menus, popups). */
export const LOCAL_KEYS: { keys: string[]; label: string }[] = [
  { keys: ["↑", "↓"], label: "Move through songs, the sidebar and lists" },
  { keys: ["←", "→"], label: "Move between tabs, cards and shelves" },
  { keys: ["Home", "End"], label: "First / last item" },
  { keys: ["Enter"], label: "Play the song / open the item" },
  { keys: ["Shift", "F10"], label: "More actions for the item (like the right-click menu)" },
  { keys: ["Alt", "↑ / ↓"], label: "Move a song up or down in your playlist" },
  { keys: ["Delete"], label: "Close the focused tab" },
  { keys: ["Esc"], label: "Close a popup or menu" },
];

/** Browser keys that make no sense in an app (reloading would stop the UI, not the music). */
function isBrowserKey(e: KeyboardEvent) {
  const k = key(e);
  return e.key === "F5" || ((e.ctrlKey || e.metaKey) && (k === "r" || k === "p" || k === "g" || k === "u" || k === "j"));
}

/** The window's keydown handler. */
export function handleShortcut(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing) return;
  // Menus and popups handle their own keys first.
  if (menu.open) return;
  const typing = isTyping(e.target);
  const shortcut = SHORTCUTS.find((s) => s.match(e));
  if (shortcut && (!typing || shortcut.whileTyping)) {
    e.preventDefault();
    shortcut.run(e);
    return;
  }
  if (!import.meta.env.DEV && isBrowserKey(e)) e.preventDefault();
}
