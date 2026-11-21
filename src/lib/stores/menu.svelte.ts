// The right-click menu: one at a time, opened at the pointer.
import type { Component } from "svelte";

export interface MenuItem {
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon?: Component<any>;
  action?: () => void;
  /** Shown in red: deletes or removes something. */
  danger?: boolean;
  disabled?: boolean;
  /** Opens a submenu to the side instead of acting. A function makes it a live list,
   *  redrawn as what it reads changes (e.g. ticks appearing once they've loaded). */
  items?: MenuEntry[] | (() => MenuEntry[]);
  /** Ticked (e.g. a playlist the song is already in). */
  checked?: boolean;
  /** Clicking it leaves the menu open (to tick several playlists in a row). */
  keepOpen?: boolean;
}

export const entriesOf = (items: MenuItem["items"]): MenuEntry[] =>
  typeof items === "function" ? items() : (items ?? []);

/** `null` draws a divider. */
export type MenuEntry = MenuItem | null;

class Menu {
  open = $state.raw<{ x: number; y: number; items: MenuEntry[] } | null>(null);

  /** Open at the pointer, in place of the browser's own menu. */
  show(e: MouseEvent, items: MenuEntry[]) {
    e.preventDefault();
    e.stopPropagation();
    // From the keyboard (the Menu key, Shift+F10) there's no pointer: open by the element.
    if (e.clientX === 0 && e.clientY === 0 && e.currentTarget instanceof HTMLElement) {
      const r = e.currentTarget.getBoundingClientRect();
      this.open = { x: r.left + Math.min(48, r.width / 2), y: r.top + r.height / 2, items };
      return;
    }
    this.open = { x: e.clientX, y: e.clientY, items };
  }

  /** Open under a button (a "more" button). */
  showAt(el: HTMLElement, items: MenuEntry[]) {
    const r = el.getBoundingClientRect();
    this.open = { x: r.left, y: r.bottom + 6, items };
  }

  close() {
    this.open = null;
  }
}

export const menu = new Menu();
