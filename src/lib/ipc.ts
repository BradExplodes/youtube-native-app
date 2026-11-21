// Typed wrappers around the Rust commands in src-tauri/src/player.rs.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface Playback {
  videoId: string | null;
  title: string;
  artist: string;
  album: string;
  artwork: string | null;
  playing: boolean;
  position: number; // seconds
  duration: number; // seconds
  volume: number; // 0-100
  muted: boolean;
  quality: string | null; // decoded video size, or "audio only"
  rate: number; // playback speed, 1 = normal
  repeat: RepeatMode;
  shuffle: boolean;
}

export type RepeatMode = "NONE" | "ALL" | "ONE";

export interface QueueItem {
  videoId: string;
  title: string;
  artist: string;
  duration: string;
  thumbnail: string | null;
  /** The track playing now. */
  current: boolean;
  /** Added by YouTube Music's autoplay rather than by you. */
  autoplay: boolean;
}

export interface Snapshot {
  loggedIn: boolean | null;
  playback: Playback | null;
  queue: { items: QueueItem[] } | null;
}

export type PlayerCommand =
  | { action: "play" | "pause" | "toggle" | "next" | "previous" }
  | { action: "seek"; seconds: number }
  | { action: "volume"; value: number }
  | { action: "rate"; value: number }
  | { action: "repeat"; mode: RepeatMode }
  | { action: "shuffle"; on: boolean }
  | { action: "load"; videoId?: string; playlistId?: string }
  | { action: "queueJump"; index: number; videoId: string };

export const playerStatus = () => invoke<Snapshot>("player_status");
export const showLogin = () => invoke<void>("player_show_login");
/** Detail for the log: the terminal running `pnpm tauri dev`, and the log file when
 *  verbose logging is on in Settings. */
let verbose = false;
export const setVerboseLogging = (on: boolean) => (verbose = on);
export function devLog(message: string) {
  if (import.meta.env.DEV || verbose) invoke("dev_log", { message }).catch(() => {});
}

/** Errors and warnings always go to the log file (and the dev terminal). */
export function logError(message: string) {
  invoke("ui_log", { level: "error", message }).catch(() => {});
}
export function logWarn(message: string) {
  invoke("ui_log", { level: "warn", message }).catch(() => {});
}

// ------------------------------------------------------------------ settings

/** Settings kept by the app itself (src-tauri/src/settings.rs). */
export interface AppSettings {
  discordPresence: boolean;
  audioOnly: boolean;
  verboseLogs: boolean;
}

export interface AppInfo {
  name: string;
  version: string;
  tauri: string;
  webview: string;
  os: string;
  logDir: string;
  dataDir: string;
  debug: boolean;
}

export const settingsGet = () => invoke<AppSettings>("settings_get");
export const settingsSet = (patch: Partial<AppSettings>) => invoke<AppSettings>("settings_set", { patch });
export const appInfo = () => invoke<AppInfo>("app_info");
export const openLogFolder = () => invoke<void>("open_log_folder");

export const playerCmd = (cmd: PlayerCommand) =>
  invoke<void>("player_cmd", { cmd }).catch((e) => {
    devLog(`player_cmd ${cmd.action} failed: ${e}`);
    throw e;
  });

export const onAuth = (fn: (loggedIn: boolean) => void): Promise<UnlistenFn> =>
  listen<boolean>("player://auth", (e) => fn(e.payload));

export const onPlayback = (fn: (p: Playback) => void): Promise<UnlistenFn> =>
  listen<Playback>("player://playback", (e) => fn(e.payload));

export const onQueue = (fn: (items: QueueItem[]) => void): Promise<UnlistenFn> =>
  listen<{ items: QueueItem[] }>("player://queue", (e) => fn(e.payload.items ?? []));
