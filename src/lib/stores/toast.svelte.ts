// Short messages at the bottom of the window: "Added to Road trip", "Couldn't like this song"…

export interface Toast {
  id: number;
  text: string;
  error: boolean;
}

class Toasts {
  items = $state<Toast[]>([]);
  private nextId = 1;

  show(text: string, error = false) {
    const id = this.nextId++;
    // At most three at once: the oldest makes way.
    this.items = [...this.items.slice(-2), { id, text, error }];
    setTimeout(() => this.dismiss(id), error ? 5000 : 3000);
  }

  error(text: string) {
    this.show(text, true);
  }

  dismiss(id: number) {
    this.items = this.items.filter((t) => t.id !== id);
  }
}

export const toasts = new Toasts();
