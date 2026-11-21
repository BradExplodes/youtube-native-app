// Keyboard navigation helpers.
import type { Action } from "svelte/action";

export interface ArrowNavOptions {
  /** The items to move between (within the element the action is on). */
  selector: string;
  /** "vertical": Up/Down. "horizontal": Left/Right. "grid": all four, by position on screen. */
  orientation?: "vertical" | "horizontal" | "grid";
}

const usable = (el: HTMLElement) =>
  !(el as HTMLButtonElement).disabled && el.offsetParent !== null && !el.closest("[inert]");

/** The item in `direction` from `from` in a grid laid out on screen: the nearest one in
 *  the next row (Up/Down) or the next/previous one in reading order (Left/Right). */
function gridTarget(items: HTMLElement[], from: HTMLElement, key: string): HTMLElement | undefined {
  const at = items.indexOf(from);
  if (key === "ArrowRight") return items[at + 1];
  if (key === "ArrowLeft") return items[at - 1];
  const r = from.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const down = key === "ArrowDown";
  const candidates = items.filter((el) => {
    const b = el.getBoundingClientRect();
    return down ? b.top >= r.bottom - 1 : b.bottom <= r.top + 1;
  });
  if (!candidates.length) return undefined;
  // The closest row first, then the closest column within it.
  const rowY = (el: HTMLElement) => el.getBoundingClientRect().top;
  const nearestRow = down ? Math.min(...candidates.map(rowY)) : Math.max(...candidates.map(rowY));
  const row = candidates.filter((el) => Math.abs(rowY(el) - nearestRow) < 4);
  return row.reduce((best, el) => {
    const d = (e: HTMLElement) => Math.abs(e.getBoundingClientRect().left + e.getBoundingClientRect().width / 2 - cx);
    return d(el) < d(best) ? el : best;
  });
}

/**
 * Arrow keys move the focus between items, Home/End go to the first/last one. Only
 * acts when the focus is on one of the items (or inside one), and never in text boxes.
 */
export const arrowNav: Action<HTMLElement, ArrowNavOptions> = (node, initial) => {
  let opts = initial;
  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable]")) return;
    const items = [...node.querySelectorAll<HTMLElement>(opts.selector)].filter(usable);
    const from = items.find((el) => el === target || el.contains(target));
    if (!from) return;
    const o = opts.orientation ?? "vertical";
    const prevKey = o === "horizontal" ? "ArrowLeft" : "ArrowUp";
    const nextKey = o === "horizontal" ? "ArrowRight" : "ArrowDown";
    let to: HTMLElement | undefined;
    if (e.key === "Home") to = items[0];
    else if (e.key === "End") to = items[items.length - 1];
    else if (o === "grid" && e.key.startsWith("Arrow")) to = gridTarget(items, from, e.key);
    else if (e.key === nextKey) to = items[items.indexOf(from) + 1];
    else if (e.key === prevKey) to = items[items.indexOf(from) - 1];
    else return;
    e.preventDefault();
    if (to) {
      to.focus({ preventScroll: true });
      to.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
  node.addEventListener("keydown", onKey);
  return {
    update(next) {
      opts = next;
    },
    destroy() {
      node.removeEventListener("keydown", onKey);
    },
  };
};

/** Whether a key press belongs to a text box (typing), where shortcuts must stay out. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.closest) return false;
  if (el.closest("textarea, select, [contenteditable=''], [contenteditable='true']")) return true;
  const input = el.closest("input");
  return !!input && !["range", "checkbox", "radio", "button", "submit"].includes(input.type);
}

/** Main areas of the window, in the order F6 visits them. */
const REGIONS = [".titlebar .tabs", "nav.sidebar", "main.stage", "aside", "footer.player"];

/** F6 / Shift+F6: move the focus to the next / previous area of the window. */
export function cycleRegion(back: boolean) {
  const regions = REGIONS.map((s) => document.querySelector<HTMLElement>(s)).filter(
    (el): el is HTMLElement => !!el && el.offsetParent !== null,
  );
  if (!regions.length) return;
  const current = regions.findIndex((r) => r.contains(document.activeElement));
  const next = regions[(current + (back ? -1 : 1) + regions.length) % regions.length];
  // Prefer what the area itself marks as its entry point (a list's current row).
  const entry =
    next.querySelector<HTMLElement>("[aria-selected='true'], [data-tabstop], [tabindex='0']") ??
    next.querySelector<HTMLElement>("button:not(:disabled), a[href], input, [tabindex]:not([tabindex='-1'])");
  entry?.focus();
}
