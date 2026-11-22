// Injected into the hidden player window. Runs on every page it loads, including
// Google's sign-in pages, so it only does anything on music.youtube.com itself.
(() => {
  if (location.hostname !== "music.youtube.com" || window.top !== window) return;
  if (window.__ytmn) return;

  // YouTube Music asks "Leave site?" when the page is reloaded while music plays. In
  // this hidden window nobody can answer, and the dialog blocks the page, so swallow
  // the event before YouTube's own handler sees it. (This script runs before the
  // page's scripts, so our listener is first in line.)
  window.addEventListener(
    "beforeunload",
    (e) => {
      e.stopImmediatePropagation();
    },
    true,
  );

  // Keep the hidden window cheap: prefer the audio ("Song") version of tracks and
  // cap any video that does play at the lowest quality. On unless turned off in
  // Settings ("Audio only"); the saved choice arrives with `loadSaved`.
  let lightMode = true;

  const send = (kind, data) => {
    const ipc = window.__TAURI_INTERNALS__;
    if (ipc) ipc.invoke("player_event", { kind, data }).catch(() => {});
  };

  const player = () => document.getElementById("movie_player");
  // The player's own element first: there can be more than one <video> on the page.
  const video = () => player()?.querySelector("video") || document.querySelector("video");
  // Position within the current track. Not `video.currentTime`: with gapless playback
  // YouTube Music appends the next track to the same stream, so the element's clock
  // keeps counting from the first track.
  const trackTime = () => {
    const t = player()?.getCurrentTime?.();
    return Number.isFinite(t) ? t : video()?.currentTime || 0;
  };

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
    if (!lightMode || !videoId) return;
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

  // The song's real length in seconds. Not `getDuration()` or `video.duration`: once
  // the next song starts buffering into the same stream (gapless playback) those grow
  // with the buffer, e.g. a 3:38 song shows 0:30, then 0:50… and a 3:22 song shows
  // 3:38, so seeking near "the end" lands past the real end.
  const parseClock = (text) =>
    (text || "").split(":").reduce((total, part) => total * 60 + (parseInt(part, 10) || 0), 0);
  function trackLength(p, videoId, queueData) {
    const details = p.getPlayerResponse?.()?.videoDetails;
    if (details && details.videoId === videoId && +details.lengthSeconds > 0) return +details.lengthSeconds;
    const fromQueue = queueData && parseClock(runsText(queueData.lengthText) || queueData.lengthText?.simpleText);
    if (fromQueue > 0) return fromQueue;
    return Math.floor(p.getDuration?.() || 0);
  }

  let lastJson = "";
  let lastSentAt = 0;
  let lastVideoId = null;
  function report(force) {
    const v = video();
    const p = player();
    const meta = (navigator.mediaSession && navigator.mediaSession.metadata) || {};
    if (!v || !p?.getVideoData?.().video_id) return;
    const vd = p?.getVideoData?.() || {};
    const videoId = vd.video_id || null;
    lighten(videoId);
    if (videoId !== lastVideoId) {
      lastVideoId = videoId;
      scheduleQueue(); // the "now playing" marker moved
      applySettings(); // YouTube may reset volume and speed for a new track
    }
    // Which track is this? The player knows straight away; the media-session info
    // (`meta`) lags behind after an in-app switch, so it's only used when it agrees.
    // The matching queue item has the nicest artist names and artwork.
    const qd = queueDataById.get(videoId) || null;
    const metaFits = meta.title === vd.title || (qd && meta.title === runsText(qd.title));
    const qThumbs = (qd && qd.thumbnail && qd.thumbnail.thumbnails) || [];
    const state = {
      videoId,
      title: (qd && runsText(qd.title)) || vd.title || meta.title,
      artist: (qd && runsText(qd.shortBylineText)) || (metaFits && meta.artist) || vd.author || "",
      album: metaFits ? meta.album || "" : "",
      artwork:
        (metaFits && pickArtwork(meta.artwork)) ||
        (qThumbs.length ? qThumbs[qThumbs.length - 1].url : null) ||
        (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null),
      playing: !v.paused && !v.ended,
      // Tenths of a second: whole seconds threw away up to 1 s, which made the
      // UI's clock tick backwards (1:13 -> 1:12) when the next update arrived.
      position: Math.round(trackTime() * 10) / 10,
      duration: trackLength(p, videoId, qd),
      volume: p?.getVolume ? p.getVolume() : Math.round(v.volume * 100),
      muted: p?.isMuted ? p.isMuted() : v.muted,
      // What the hidden window is really decoding, e.g. "tiny 256x144" (for checking light mode).
      quality: v.videoWidth ? `${v.videoWidth}x${v.videoHeight}` : "audio only",
      // The <video> element's own speed: the player object's answer can lag behind it.
      rate: v.playbackRate,
      repeat: repeatMode(),
      shuffle: shuffleOn,
    };
    if (videoId) remember(videoId, state.position, !state.playing);
    const json = JSON.stringify(state);
    if (json === lastJson) return;
    // Position ticks go out at most once a second; real changes go out at once.
    const now = Date.now();
    if (!force && now - lastSentAt < 1000) return;
    lastJson = json;
    lastSentAt = now;
    send("playback", state);
  }

  // ---------------------------------------------------------------- queue
  // YouTube Music's own queue stays the source of truth (autoplay and radio keep
  // working); we mirror it. Each item element carries its data on `.data`.
  const MAX_QUEUE = 500;
  const runsText = (t) => (t && t.runs ? t.runs.map((r) => r.text).join("") : "");
  // One entry per track. Many tracks come as a pair inside a wrapper: the song
  // ("primary") and its music video ("counterpart"). We use the song, and count the
  // pair once; the entry is current if either version is the one playing.
  function queueEntries() {
    const out = [];
    // Which entry is current? YouTube's own "selected" marker doesn't always follow
    // our navigation, so match the video actually playing (either version of a pair)
    // and only fall back to the marker.
    const playing = player()?.getVideoData?.().video_id;
    const lists = document.querySelectorAll("ytmusic-player-queue #contents, ytmusic-player-queue #automix-contents");
    for (const list of lists) {
      for (const child of list.children) {
        const tag = child.tagName;
        let el = null;
        if (tag === "YTMUSIC-PLAYER-QUEUE-ITEM") el = child;
        else if (tag === "YTMUSIC-PLAYLIST-PANEL-VIDEO-WRAPPER-RENDERER")
          el = child.querySelector("#primary-renderer ytmusic-player-queue-item") ||
            child.querySelector("ytmusic-player-queue-item");
        if (!el || !el.data) continue;
        const versions = tag === "YTMUSIC-PLAYER-QUEUE-ITEM" ? [child] : [...child.querySelectorAll("ytmusic-player-queue-item")];
        out.push({
          el,
          plays: !!playing && versions.some((v) => v.data && v.data.videoId === playing),
          marked: versions.some((v) => v.hasAttribute("selected")),
          autoplay: list.id === "automix-contents",
        });
      }
    }
    // The same track can be in the queue twice: prefer the marked copy among matches.
    let at = out.findIndex((e) => e.plays && e.marked);
    if (at < 0) at = out.findIndex((e) => e.plays);
    if (at < 0) at = out.findIndex((e) => e.marked);
    return out.map((e, i) => ({ el: e.el, current: i === at, autoplay: e.autoplay }));
  }
  const queueElements = () => queueEntries().map((e) => e.el);

  // Queue data by video id (both versions of a pair, mapped to the song's data), so
  // the now-playing info uses the same names and artwork as the queue panel.
  let queueDataById = new Map();
  function indexQueue() {
    const map = new Map();
    for (const item of document.querySelectorAll("ytmusic-player-queue ytmusic-player-queue-item")) {
      const wrapper = item.closest("ytmusic-playlist-panel-video-wrapper-renderer");
      const primary = wrapper && wrapper.querySelector("#primary-renderer ytmusic-player-queue-item");
      const data = (primary && primary.data) || item.data;
      if (item.data && item.data.videoId && data) map.set(item.data.videoId, data);
    }
    queueDataById = map;
  }

  function navigateTo(el) {
    const endpoint = el && el.data && el.data.navigationEndpoint;
    if (!endpoint) return false;
    el.dispatchEvent(new CustomEvent("yt-navigate", { bubbles: true, composed: true, detail: { endpoint } }));
    return true;
  }

  // Next / previous step through YouTube Music's own queue (the player's
  // nextVideo() doesn't know about it).
  function step(delta) {
    const entries = queueEntries();
    const at = entries.findIndex((e) => e.current);
    const target = at >= 0 ? entries[at + delta] : null;
    return !!target && navigateTo(target.el);
  }

  function readQueue() {
    return queueEntries().slice(0, MAX_QUEUE).map(({ el, current, autoplay }) => {
      const d = el.data || {};
      const thumbs = (d.thumbnail && d.thumbnail.thumbnails) || [];
      const thumb = thumbs.find((t) => t.width >= 96) || thumbs[thumbs.length - 1];
      return {
        videoId: d.videoId || "",
        title: runsText(d.title),
        artist: runsText(d.shortBylineText),
        duration: runsText(d.lengthText),
        thumbnail: thumb ? thumb.url : null,
        current,
        // Tracks YouTube Music added itself ("autoplay"), after your own.
        autoplay,
      };
    });
  }

  let lastQueue = "";
  let queueTimer = null;
  function scheduleQueue() {
    clearTimeout(queueTimer);
    queueTimer = setTimeout(() => {
      indexQueue();
      const items = readQueue();
      const json = JSON.stringify(items);
      if (json === lastQueue) return;
      lastQueue = json;
      send("queue", { items });
    }, 300);
  }

  // Watch the queue element for changes; it appears only once something has played.
  let observed = null;
  const observer = new MutationObserver(scheduleQueue);
  setInterval(() => {
    const q = document.querySelector("ytmusic-player-queue");
    if (q && q !== observed) {
      observer.disconnect();
      observer.observe(q, { childList: true, subtree: true, attributes: true, attributeFilter: ["selected"] });
      observed = q;
      scheduleQueue();
    }
  }, 2000);

  function queueJump({ index, videoId }) {
    const els = queueElements();
    let el = els[index];
    // The queue may have changed since our UI saw it: fall back to finding the track.
    if (!el || (videoId && el.data?.videoId !== videoId)) el = els.find((e) => e.data?.videoId === videoId);
    if (!navigateTo(el)) send("log", `queueJump: ${videoId} not in the queue`);
  }

  // Media events don't bubble, but they can be caught at the document while capturing,
  // which keeps working when YouTube Music swaps the <video> element.
  const immediate = ["play", "pause", "ended", "loadedmetadata", "durationchange", "volumechange", "seeked", "ratechange"];
  for (const ev of immediate) document.addEventListener(ev, () => report(true), true);
  document.addEventListener("timeupdate", () => report(false), true);
  // Safety net for metadata that changes without a media event.
  setInterval(() => report(false), 3000);

  // ---------------------------------------------------------------- remembered state
  // Volume and the last song survive restarts. The app keeps them in a file (see
  // player.rs): we ask for them once at startup and report changes.
  let saved = {};
  let savedLoaded = false;
  const stored = () => saved;
  const store = (patch) => {
    saved = { ...saved, ...patch };
    send("save", patch);
  };

  // What we want, re-applied on every track change: YouTube resets some of it.
  let wantVolume = null;
  let wantRate = 1;
  (async () => {
    try {
      const s = await window.__TAURI_INTERNALS__?.invoke("player_event", { kind: "loadSaved", data: null });
      if (s && typeof s === "object") saved = s;
    } catch {}
    if (typeof saved.lightMode === "boolean") lightMode = saved.lightMode;
    if (typeof saved.volume === "number" && wantVolume === null) wantVolume = saved.volume;
    savedLoaded = true;
  })();
  function applySettings() {
    const p = player();
    if (!p) return;
    if (wantVolume !== null && p.getVolume?.() !== wantVolume) {
      p.unMute?.();
      p.setVolume?.(wantVolume);
    }
    enforceRate();
  }

  // The speed you picked, on what's actually playing. YouTube Music resets the <video>
  // element to its own setting (normal) when a track loads and again shortly after,
  // while its player object can go on reporting our speed, so the element is the truth.
  // Every <video> on the page, not just the first: YouTube can hold more than one
  // (e.g. lining up the next track), and the one we checked wasn't always the one playing.
  const rateOff = (v) => Math.abs(v.playbackRate - wantRate) > 0.001;
  function enforceRate() {
    const off = [...document.querySelectorAll("video")].filter(rateOff);
    if (!off.length) return;
    player()?.setPlaybackRate?.(wantRate);
    for (const v of off) if (rateOff(v)) v.playbackRate = wantRate;
  }

  // The playlist the current music was started from (as loaded, before any shuffle).
  let contextPlaylist = null;

  // Start the next track paused: used to restore the last song at startup, and when
  // un-shuffling while paused. Muted until paused so not a sound gets out.
  let holdPaused = false;
  let holdMuted = false;
  document.addEventListener("play", (e) => {
    if (!holdPaused) return;
    holdMuted = e.target.muted;
    e.target.muted = true;
  }, true);
  document.addEventListener("playing", () => {
    if (holdPaused) player()?.pauseVideo?.();
    applySettings(); // YouTube resets the speed once a new track really starts
  }, true);
  // A new track: put the speed back before a note plays at the wrong one.
  for (const ev of ["loadstart", "loadedmetadata", "canplay"]) document.addEventListener(ev, enforceRate, true);
  // YouTube Music also puts its own speed (normal) back a moment after a track starts,
  // and again when it lines up the next track near the end (gapless playback). Undo it
  // at once, but only a few times in quick succession so we can never get into a tight
  // fight with it. This used to be a budget per track, which could run out mid-song and
  // leave the rest of it at normal speed.
  let quickFixes = [];
  document.addEventListener("ratechange", (e) => {
    const v = e.target;
    if (!(v instanceof HTMLMediaElement) || !rateOff(v)) return;
    const now = Date.now();
    quickFixes = quickFixes.filter((t) => now - t < 5000);
    if (quickFixes.length >= 8) return;
    quickFixes.push(now);
    setTimeout(enforceRate, 0);
  }, true);
  // The steady check, so a reset never sticks for more than a second whatever caused it.
  // Tied to playback (timeupdate fires a few times a second while playing), not a timer,
  // which the hidden window may throttle.
  let rateCheckedAt = 0;
  document.addEventListener("timeupdate", () => {
    const now = Date.now();
    if (now - rateCheckedAt < 1000) return;
    rateCheckedAt = now;
    enforceRate();
  }, true);
  document.addEventListener("pause", (e) => {
    if (!holdPaused) return;
    holdPaused = false;
    e.target.muted = holdMuted;
  }, true);
  // Anything you do yourself (play, load, skip…) cancels the hold.
  function releaseHold() {
    if (!holdPaused) return;
    holdPaused = false;
    const v = video();
    if (v) v.muted = holdMuted;
  }
  function startPaused() {
    holdPaused = true;
    holdMuted = video()?.muted || false;
    // Never leave it stuck muted if the track doesn't start.
    setTimeout(releaseHold, 15000);
  }

  // Saved on each new track and pause, and every 5 s while playing.
  let remembered = "";
  let rememberedAt = 0;
  function remember(videoId, position, now) {
    // Not before the startup restore is settled (YouTube Music first cues its own
    // last song at 0:00, which mustn't overwrite ours), nor mid-restore.
    if (!restoreSettled || holdPaused) return;
    const last = { videoId, playlistId: contextPlaylist, position: Math.floor(position) };
    const key = JSON.stringify(last);
    const t = Date.now();
    if (key === remembered) return;
    if (!now && remembered.includes(`"${videoId}"`) && t - rememberedAt < 5000) return;
    remembered = key;
    rememberedAt = t;
    store({ last });
  }

  // At startup, once YouTube Music is ready: our volume, and the last song, paused
  // where it was.
  let restoreTries = 0;
  let restoreSettled = false;
  const restoreTimer = setInterval(() => {
    if (++restoreTries > 240) {
      restoreSettled = true;
      return clearInterval(restoreTimer); // 2 minutes
    }
    if (!savedLoaded) return;
    const p = player();
    if (!p?.getVideoData || !document.querySelector("ytmusic-app") || !window.ytcfg?.get?.("LOGGED_IN")) return;
    clearInterval(restoreTimer);
    restoreSettled = true;
    applySettings();
    const last = stored().last;
    if (!last?.videoId) return;
    const loaded = p.getVideoData().video_id;
    // Something already started (e.g. YouTube Music resumed it after a reload): leave
    // it, just keep knowing which playlist it came from. Merely cued (YouTube Music
    // puts its own last song up at 0:00, unstarted): replace it with ours.
    const state = p.getPlayerState?.();
    if (loaded && state !== -1 && state !== 5) {
      if (loaded === last.videoId) contextPlaylist = last.playlistId || null;
      return;
    }
    contextPlaylist = last.playlistId || null;
    startPaused();
    load({ videoId: last.videoId, playlistId: last.playlistId, startTimeSeconds: last.position || 0 });
  }, 500);

  // ---------------------------------------------------------------- controls
  let lastLoad = { key: "", at: 0 };
  function load({ videoId, playlistId, startTimeSeconds }, onDone) {
    // The same request twice in quick succession (e.g. a double-click) is one request.
    const key = `${videoId}|${playlistId}|${startTimeSeconds}`;
    if (key === lastLoad.key && Date.now() - lastLoad.at < 1500) return;
    lastLoad = { key, at: Date.now() };
    const watchEndpoint = {};
    if (videoId) watchEndpoint.videoId = String(videoId);
    if (playlistId) watchEndpoint.playlistId = String(playlistId);
    if (startTimeSeconds > 0) watchEndpoint.startTimeSeconds = Math.floor(startTimeSeconds);
    const app = document.querySelector("ytmusic-app");
    const startedWith = player()?.getVideoData?.().video_id;
    if (app) {
      // YouTube Music's own in-app navigation: no page reload.
      app.dispatchEvent(new CustomEvent("yt-navigate", {
        bubbles: true,
        composed: true,
        detail: { endpoint: { watchEndpoint } },
      }));
    }
    // Did it work? Ask the player what it's playing: the address bar is no guide, as
    // YouTube Music often plays a track without changing the URL.
    const worked = () => {
      const now = player()?.getVideoData?.().video_id;
      return videoId ? now === String(videoId) : !!now && now !== startedWith;
    };
    // Only if nothing has changed after 6 s, fall back to a full page load.
    let waited = 0;
    const check = setInterval(() => {
      waited += 250;
      if (worked()) {
        clearInterval(check);
        if (onDone) onDone();
        return;
      }
      if (waited < (app ? 6000 : 0)) return;
      clearInterval(check);
      send("log", `load didn't take after ${waited} ms; reloading the page`);
      const url = new URL("/watch", location.origin);
      if (videoId) url.searchParams.set("v", String(videoId));
      if (playlistId) url.searchParams.set("list", String(playlistId));
      if (startTimeSeconds > 0) url.searchParams.set("t", `${Math.floor(startTimeSeconds)}s`);
      location.assign(url.toString());
    }, 250);
  }

  // ---- repeat: YouTube Music's own (NONE, ALL or ONE), set through its button.
  const playerBar = () => document.querySelector("ytmusic-player-bar");
  const repeatMode = () => playerBar()?.getAttribute("repeat-mode") || "NONE";

  // ---- shuffle: YouTube Music's own toggle. On shuffles what's left of the queue;
  // off puts it back in the original order, carrying on with the same song. Loading
  // something new clears it, so we re-apply what you chose.
  let shuffleOn = false;
  const shuffleButton = () => playerBar()?.querySelector(".shuffle");
  // Its icon is the only outward sign: MUSIC_SHUFFLE when off, shuffle_filled when on.
  const youtubeShuffled = () => /filled/i.test(shuffleButton()?.querySelector("yt-icon")?.icon || "");
  let syncTimer = null;
  function syncShuffle() {
    // Wait for YouTube Music to fill the queue of what was just loaded, or the click
    // would act on the old one.
    clearInterval(syncTimer);
    let tries = 0;
    syncTimer = setInterval(() => {
      const entries = queueEntries();
      if (++tries < 40 && !(entries.length > 1 && entries.some((e) => e.current))) return;
      clearInterval(syncTimer);
      if (youtubeShuffled() !== shuffleOn) shuffleButton()?.click();
    }, 125);
  }

  const commands = {
    play: () => player()?.playVideo?.(),
    pause: () => player()?.pauseVideo?.(),
    toggle: () => {
      const v = video();
      if (v && v.paused) player()?.playVideo?.();
      else player()?.pauseVideo?.();
    },
    next: () => {
      if (step(1)) return;
      // At the end of the queue with "repeat all": back to the top.
      const first = repeatMode() === "ALL" && queueEntries()[0];
      if (first && navigateTo(first.el)) return;
      player()?.nextVideo?.();
    },
    previous: () => {
      // Like most players: past the first 3 s, "previous" restarts the track.
      if (trackTime() > 3) return player()?.seekTo?.(0, true);
      if (!step(-1)) player()?.seekTo?.(0, true);
    },
    seek: ({ seconds }) => player()?.seekTo?.(Math.max(0, Number(seconds) || 0), true),
    seekBy: ({ seconds }) => {
      if (video()) player()?.seekTo?.(Math.max(0, trackTime() + (Number(seconds) || 0)), true);
    },
    volume: ({ value }) => {
      const p = player();
      if (!p) return;
      wantVolume = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
      store({ volume: wantVolume });
      if (p.isMuted?.()) p.unMute?.();
      p.setVolume?.(wantVolume);
    },
    rate: ({ value }) => {
      const rate = Number(value);
      wantRate = Number.isFinite(rate) ? Math.max(0.25, Math.min(2, rate)) : 1;
      quickFixes = [];
      enforceRate();
    },
    repeat: ({ mode }) => {
      const button = playerBar()?.querySelector(".repeat");
      if (!button || !["NONE", "ALL", "ONE"].includes(mode)) return;
      // The button cycles NONE -> ALL -> ONE.
      for (let i = 0; i < 3 && repeatMode() !== mode; i++) button.click();
      setTimeout(() => report(true), 50);
    },
    shuffle: ({ on }) => {
      shuffleOn = !!on;
      syncShuffle();
      report(true);
    },
    // Something new from our UI: it becomes the context, shuffled if shuffle is on.
    load: (req) => {
      contextPlaylist = req.playlistId || null;
      load(req, () => {
        if (shuffleOn) syncShuffle();
      });
    },
    queueJump,
    lightMode: ({ on }) => {
      lightMode = !!on;
      lightenedFor = null;
      if (lightMode) lighten(player()?.getVideoData?.().video_id);
      else {
        try {
          player()?.setPlaybackQualityRange?.("auto", "auto");
        } catch {}
      }
    },
  };

  // ---------------------------------------------------------------- library data
  // Same requests YouTube Music itself makes (browse and search), signed with the
  // page's own session.
  async function sapisidHash() {
    const cookies = Object.fromEntries(document.cookie.split("; ").map((c) => {
      const i = c.indexOf("=");
      return [c.slice(0, i), c.slice(i + 1)];
    }));
    const sapisid = cookies.SAPISID || cookies["__Secure-3PAPISID"];
    if (!sapisid) return null;
    const ts = Math.floor(Date.now() / 1000);
    const digest = await crypto.subtle.digest("SHA-1",
      new TextEncoder().encode(`${ts} ${sapisid} ${location.origin}`));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `SAPISIDHASH ${ts}_${hex}`;
  }

  function innertubeHeaders(cfg) {
    return {
      "content-type": "application/json",
      "x-goog-authuser": String(cfg.get("SESSION_INDEX") ?? 0),
      "x-origin": location.origin,
      "x-youtube-client-name": String(cfg.get("INNERTUBE_CONTEXT_CLIENT_NAME") ?? 67),
      "x-youtube-client-version": String(cfg.get("INNERTUBE_CLIENT_VERSION") ?? ""),
    };
  }

  // An action (like a song, edit a playlist…). Rust only lets allowed endpoints through.
  async function call(id, endpoint, req) {
    try {
      const cfg = window.ytcfg;
      if (!cfg || !cfg.get) throw new Error("YouTube Music hasn't finished loading");
      const url = new URL(`/youtubei/v1/${endpoint}`, location.origin);
      url.searchParams.set("prettyPrint", "false");
      const body = { ...req, context: cfg.get("INNERTUBE_CONTEXT") };
      const headers = innertubeHeaders(cfg);
      const auth = await sapisidHash();
      if (auth) headers.authorization = auth;
      const res = await fetch(url, { method: "POST", credentials: "include", headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`YouTube Music answered ${res.status}`);
      send("browse", { id, body: await res.json() });
    } catch (e) {
      send("browse", { id, error: String((e && e.message) || e) });
    }
  }

  async function browse(id, req) {
    try {
      const cfg = window.ytcfg;
      if (!cfg || !cfg.get) throw new Error("YouTube Music hasn't finished loading");
      const isSearch = !!req.query || !!req.search;
      const url = new URL(isSearch ? "/youtubei/v1/search" : "/youtubei/v1/browse", location.origin);
      url.searchParams.set("prettyPrint", "false");
      const body = { context: cfg.get("INNERTUBE_CONTEXT") };
      if (req.query) {
        body.query = req.query;
        if (req.params) body.params = req.params;
      } else if (req.continuation) {
        // Older list pages want the token in the URL, newer ones in the body.
        url.searchParams.set("ctoken", req.continuation);
        url.searchParams.set("continuation", req.continuation);
        url.searchParams.set("type", "next");
        body.continuation = req.continuation;
      } else {
        body.browseId = req.browseId;
        if (req.params) body.params = req.params;
      }
      const headers = innertubeHeaders(cfg);
      const auth = await sapisidHash();
      if (auth) headers.authorization = auth;
      const res = await fetch(url, { method: "POST", credentials: "include", headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`YouTube Music answered ${res.status}`);
      send("browse", { id, body: await res.json() });
    } catch (e) {
      send("browse", { id, error: String((e && e.message) || e) });
    }
  }

  window.__ytmn = {
    command(cmd) {
      const fn = cmd && commands[cmd.action];
      if (cmd && !["seek", "seekBy", "volume", "rate", "repeat", "shuffle"].includes(cmd.action)) releaseHold();
      if (cmd && cmd.action === "load") send("log", `load ${JSON.stringify(cmd)}`);
      try {
        if (fn) fn(cmd);
      } catch (e) {
        send("log", `${cmd.action} threw: ${(e && e.stack) || e}`);
      }
    },
    browse,
    call,
  };
})();
