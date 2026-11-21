// The Settings page's state. Most settings live in the app itself (they take effect in
// Rust: Discord, the player, logging); display-only ones stay in this window's storage.
import {
  appInfo,
  logError,
  setVerboseLogging,
  settingsGet,
  settingsSet,
  type AppInfo,
  type AppSettings,
} from "$lib/ipc";
import { toasts } from "$lib/stores/toast.svelte";

const REDUCE_MOTION_KEY = "ytmn.reduceMotion";

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}

class Settings {
  /** Null until loaded from the app. */
  app = $state<AppSettings | null>(null);
  info = $state<AppInfo | null>(null);
  /** Turn off animations, on top of Windows' own "Animation effects" setting. */
  reduceMotion = $state(readFlag(REDUCE_MOTION_KEY));

  constructor() {
    this.applyMotion();
  }

  async load() {
    try {
      const [app, info] = await Promise.all([settingsGet(), appInfo()]);
      this.app = app;
      this.info = info;
      setVerboseLogging(app.verboseLogs);
    } catch (e) {
      logError(`couldn't load settings: ${e}`);
    }
  }

  async set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    const before = this.app;
    if (before) this.app = { ...before, [key]: value };
    try {
      this.app = await settingsSet({ [key]: value } as Partial<AppSettings>);
      setVerboseLogging(this.app.verboseLogs);
    } catch (e) {
      this.app = before;
      toasts.error(`Couldn't change that setting: ${e}`);
    }
  }

  setReduceMotion(on: boolean) {
    this.reduceMotion = on;
    writeFlag(REDUCE_MOTION_KEY, on);
    this.applyMotion();
  }

  private applyMotion() {
    if (typeof document !== "undefined") document.documentElement.classList.toggle("reduce-motion", this.reduceMotion);
  }
}

export const settings = new Settings();
