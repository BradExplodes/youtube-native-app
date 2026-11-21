// Popups that ask for something: a playlist's details, or "are you sure?".
import type { Privacy } from "$lib/ytm/types";

export type Dialog =
  | {
      kind: "playlist";
      /** Editing this playlist (browse id VL…), or creating a new one. */
      browseId?: string;
      title: string;
      description: string;
      privacy: Privacy;
      /** Songs to put in a new playlist. */
      videoIds?: string[];
    }
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirm: string;
      /** Show the confirm button in red (default), for something that can't be undone. */
      danger?: boolean;
      onconfirm: () => Promise<unknown> | void;
    };

class Dialogs {
  current = $state.raw<Dialog | null>(null);

  open(d: Dialog) {
    this.current = d;
  }

  close() {
    this.current = null;
  }
}

export const dialog = new Dialogs();
