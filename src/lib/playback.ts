// Player controls shared by the player bar and the keyboard shortcuts. Each shows its
// result straight away (optimistically) and then asks the player.
import { setLiked } from "$lib/actions";
import { playerCmd, type RepeatMode } from "$lib/ipc";
import { likes } from "$lib/stores/likes.svelte";
import { player } from "$lib/stores/player.svelte";

// ---- volume
// YouTube's volume gets loud fast, so the slider is stretched at the quiet end: its
// first half covers 0-20%, its second half 20-100%. YouTube takes whole numbers only.
const KNEE_SLIDER = 50;
export const KNEE_VOLUME = 20;
export const toVolume = (slider: number) =>
  slider <= KNEE_SLIDER
    ? (slider * KNEE_VOLUME) / KNEE_SLIDER
    : KNEE_VOLUME + ((slider - KNEE_SLIDER) * (100 - KNEE_VOLUME)) / (100 - KNEE_SLIDER);
export const toSlider = (volume: number) =>
  volume <= KNEE_VOLUME
    ? (volume * KNEE_SLIDER) / KNEE_VOLUME
    : KNEE_SLIDER + ((volume - KNEE_VOLUME) * (100 - KNEE_SLIDER)) / (100 - KNEE_VOLUME);

/** The volume you hear now (0 when muted). */
export const currentVolume = () => {
  const p = player.playback;
  return p?.muted ? 0 : (p?.volume ?? 100);
};

export function setVolume(value: number) {
  value = Math.max(0, Math.min(100, Math.round(value)));
  playerCmd({ action: "volume", value });
  player.optimistic({ volume: value, muted: false });
}

/** Louder or quieter by `step` on the slider's scale, so steps feel even. */
export function nudgeVolume(step: number) {
  const slider = Math.max(0, Math.min(100, toSlider(currentVolume()) + step));
  setVolume(toVolume(slider));
}

// Muting remembers the old volume, and unmuting brings it back.
let beforeMute = KNEE_VOLUME;
export function toggleMute(shown = currentVolume()) {
  if (shown > 0) {
    beforeMute = shown;
    setVolume(0);
  } else setVolume(beforeMute || KNEE_VOLUME);
}

// ---- transport
export function togglePlay() {
  const p = player.playback;
  if (!p) return;
  player.optimistic({ playing: !p.playing, position: player.positionNow() });
  playerCmd({ action: "toggle" });
}

export const next = () => playerCmd({ action: "next" });
export const previous = () => playerCmd({ action: "previous" });

export function seekBy(seconds: number) {
  const p = player.playback;
  if (!p) return;
  const target = Math.max(0, Math.min(p.duration || Infinity, player.positionNow() + seconds));
  player.seeked(target);
  playerCmd({ action: "seek", seconds: target });
}

// ---- modes
export function toggleShuffle() {
  const p = player.playback;
  if (!p) return;
  const on = !p.shuffle;
  player.optimistic({ shuffle: on });
  playerCmd({ action: "shuffle", on });
}

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { NONE: "ALL", ALL: "ONE", ONE: "NONE" };
export const REPEAT_LABEL: Record<RepeatMode, string> = {
  NONE: "Repeat: off",
  ALL: "Repeat: playlist",
  ONE: "Repeat: this song",
};
export function cycleRepeat() {
  const p = player.playback;
  if (!p) return;
  const mode = NEXT_REPEAT[p.repeat ?? "NONE"];
  player.optimistic({ repeat: mode });
  playerCmd({ action: "repeat", mode });
  return mode;
}

/** Like or unlike what's playing. Returns whether it's liked now (undefined: nothing playing). */
export function toggleLikeCurrent() {
  const p = player.playback;
  if (!p?.videoId) return undefined;
  const liked = !likes.get(p.videoId);
  setLiked({ videoId: p.videoId, title: p.title }, liked);
  return liked;
}
