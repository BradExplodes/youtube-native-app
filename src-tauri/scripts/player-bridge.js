// Injected into the hidden player window. Runs on every page it loads, including
// Google's sign-in pages, so it only does anything on music.youtube.com itself.
(() => {
  if (location.hostname !== "music.youtube.com" || window.top !== window) return;
  if (window.__ytmn) return;

  // Keep the hidden window cheap: prefer the audio ("Song") version of tracks and
  // cap any video that does play at the lowest quality.
  const LIGHT_MODE = true;

  const send = (kind, data) => {
    const ipc = window.__TAURI_INTERNALS__;
    if (ipc) ipc.invoke("player_event", { kind, data }).catch(() => {});
  };

  const player = () => document.getElementById("movie_player");
  const video = () => document.querySelector("video");

  // ---------------------------------------------------------------- sign-in state
  const authTimer = setInterval(() => {
    const cfg = window.ytcfg;
    const loggedIn = cfg && typeof cfg.get === "function" ? cfg.get("LOGGED_IN") : undefined;
    if (loggedIn === undefined) return;
    clearInterval(authTimer);
    send("auth", { loggedIn: !!loggedIn });
  }, 500);

  // ---------------------------------------------------------------- light mode
  let lightenedFor = null;
  let qualityTries = 0;
  function lighten(videoId) {
    if (!LIGHT_MODE || !videoId) return;
    if (lightenedFor !== videoId) {
      lightenedFor = videoId;
      qualityTries = 0;
      const toggle = document.querySelector("ytmusic-av-toggle");
      if (toggle && toggle.hasAttribute("is-video-playback-mode-selected") &&
          toggle.getAttribute("is-video-playback-mode-selected") !== "false") {
        toggle.querySelector(".song-button")?.click();
      }
    }
    // YouTube resets the quality for each video and ignores the request until its
    // player is ready, so keep asking (a few times per track) until it sticks.
    // With Premium the hidden window usually streams audio only (no video frames at
    // all, videoWidth 0), and then there is nothing to cap.
    const p = player();
    const v = video();
    if (!v || v.videoWidth === 0) return;
    if (!p?.setPlaybackQualityRange || p.getPlaybackQuality?.() === "tiny" || qualityTries >= 20) return;
    qualityTries++;
    try {
      p.setPlaybackQualityRange("tiny", "tiny");
    } catch {}
  }

  // ---------------------------------------------------------------- now playing
  const pickArtwork = (artwork) => {
    if (!artwork || !artwork.length) return null;
    const big = artwork.find((a) => parseInt(a.sizes, 10) >= 120);
    return (big || artwork[artwork.length - 1]).src;
  };

  let lastJson = "";
  let lastSentAt = 0;
  function report(force) {
    const v = video();
    const p = player();
    const meta = navigator.mediaSession && navigator.mediaSession.metadata;
    if (!v || !meta || !meta.title) return;
    const videoId = p?.getVideoData?.().video_id || null;
    lighten(videoId);
    const state = {
      videoId,
      title: meta.title,
      artist: meta.artist || "",
      album: meta.album || "",
      artwork: pickArtwork(meta.artwork),
      playing: !v.paused && !v.ended,
      // Tenths of a second: whole seconds threw away up to 1 s, which made the
      // UI's clock tick backwards (1:13 -> 1:12) when the next update arrived.
      position: Math.round((v.currentTime || 0) * 10) / 10,
      duration: Math.floor(v.duration || 0) || Math.floor(p?.getDuration?.() || 0),
      volume: p?.getVolume ? p.getVolume() : Math.round(v.volume * 100),
      muted: p?.isMuted ? p.isMuted() : v.muted,
      // What the hidden window is really decoding, e.g. "tiny 256x144" (for checking light mode).
      quality: v.videoWidth ? `${v.videoWidth}x${v.videoHeight}` : "audio only",
    };
    const json = JSON.stringify(state);
    if (json === lastJson) return;
    // Position ticks go out at most once a second; real changes go out at once.
    const now = Date.now();
    if (!force && now - lastSentAt < 1000) return;
    lastJson = json;
    lastSentAt = now;
    send("playback", state);
  }

  // Media events don't bubble, but they can be caught at the document while capturing,
  // which keeps working when YouTube Music swaps the <video> element.
  const immediate = ["play", "pause", "ended", "loadedmetadata", "durationchange", "volumechange", "seeked"];
  for (const ev of immediate) document.addEventListener(ev, () => report(true), true);
  document.addEventListener("timeupdate", () => report(false), true);
  // Safety net for metadata that changes without a media event.
  setInterval(() => report(false), 3000);

  // ---------------------------------------------------------------- controls
  function load({ videoId, playlistId }) {
    const watchEndpoint = {};
    if (videoId) watchEndpoint.videoId = String(videoId);
    if (playlistId) watchEndpoint.playlistId = String(playlistId);
    const app = document.querySelector("ytmusic-app");
    const target = videoId ? `v=${videoId}` : `list=${playlistId}`;
    if (app) {
      // YouTube Music's own in-app navigation: no page reload.
      app.dispatchEvent(new CustomEvent("yt-navigate", {
        bubbles: true,
        composed: true,
        detail: { endpoint: { watchEndpoint } },
      }));
    }
    // Fallback: if the app didn't move within 4 s, do a full page load.
    setTimeout(() => {
      if (!location.href.includes(target)) {
        const url = new URL("/watch", location.origin);
        if (videoId) url.searchParams.set("v", String(videoId));
        if (playlistId) url.searchParams.set("list", String(playlistId));
        location.assign(url.toString());
      }
    }, app ? 4000 : 0);
  }

  const commands = {
    play: () => player()?.playVideo?.(),
    pause: () => player()?.pauseVideo?.(),
    toggle: () => {
      const v = video();
      if (v && v.paused) player()?.playVideo?.();
      else player()?.pauseVideo?.();
    },
    next: () => player()?.nextVideo?.(),
    previous: () => player()?.previousVideo?.(),
    seek: ({ seconds }) => player()?.seekTo?.(Math.max(0, Number(seconds) || 0), true),
    volume: ({ value }) => {
      const p = player();
      if (!p) return;
      if (p.isMuted?.()) p.unMute?.();
      p.setVolume?.(Math.max(0, Math.min(100, Number(value) || 0)));
    },
    load,
  };

  window.__ytmn = {
    command(cmd) {
      const fn = cmd && commands[cmd.action];
      if (fn) fn(cmd);
    },
  };
})();
