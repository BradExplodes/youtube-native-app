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
}

export interface Snapshot {
  loggedIn: boolean | null;
  playback: Playback | null;
}

export type PlayerCommand =
  | { action: "play" | "pause" | "toggle" | "next" | "previous" }
  | { action: "seek"; seconds: number }
  | { action: "volume"; value: number }
  | { action: "load"; videoId?: string; playlistId?: string };

export const playerStatus = () => invoke<Snapshot>("player_status");
export const showLogin = () => invoke<void>("player_show_login");
export const playerCmd = (cmd: PlayerCommand) => invoke<void>("player_cmd", { cmd });

export const onAuth = (fn: (loggedIn: boolean) => void): Promise<UnlistenFn> =>
  listen<boolean>("player://auth", (e) => fn(e.payload));

export const onPlayback = (fn: (p: Playback) => void): Promise<UnlistenFn> =>
  listen<Playback>("player://playback", (e) => fn(e.payload));
