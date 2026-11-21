//! The hidden player window (the real music.youtube.com) and the commands that
//! connect it to our UI.
//!
//! Flow: `scripts/player-bridge.js` runs inside music.youtube.com and reports
//! state through `player_event`; we keep the latest copy and forward it to the
//! `main` window. `main` controls playback through `player_cmd`, which calls
//! back into the bridge.

use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use tauri::{
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    utils::config::BackgroundThrottlingPolicy, webview::PageLoadEvent,
};

pub const PLAYER_LABEL: &str = "player";
const MAIN_LABEL: &str = "main";
const YTM_URL: &str = "https://music.youtube.com/";
const SIGN_IN_URL: &str =
    "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F";
const BRIDGE_JS: &str = include_str!("../scripts/player-bridge.js");

/// Latest known player state, so `main` can catch up after starting or being restored.
#[derive(Default)]
pub struct PlayerState(Mutex<Snapshot>);

#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// None until the page has loaded far enough to tell.
    logged_in: Option<bool>,
    /// Now-playing info as reported by the bridge.
    playback: Option<Value>,
}

pub fn create_player_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    // Its own WebView2 profile: keeps the Google sign-in, and lets this window use
    // different browser flags from our UI.
    let profile = app.path().app_local_data_dir()?.join("player-profile");

    WebviewWindowBuilder::new(app, PLAYER_LABEL, WebviewUrl::External(YTM_URL.parse().unwrap()))
        .title("Sign in to YouTube Music")
        .inner_size(1000.0, 760.0)
        .visible(false)
        .data_directory(profile)
        // Tauri's defaults (the msWebOOUI… features) must be repeated when overriding.
        .additional_browser_args(
            "--autoplay-policy=no-user-gesture-required \
             --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
        )
        // A hidden window must never be throttled, or audio would stutter.
        .background_throttling(BackgroundThrottlingPolicy::Disabled)
        .initialization_script(BRIDGE_JS)
        .on_page_load(|w, payload| {
            // Anything other than YouTube Music itself (the cookie-consent page shown in
            // the UK/EU, or Google sign-in) needs the user, so treat it as "not signed in".
            // The bridge script only runs on music.youtube.com and can't report it.
            if matches!(payload.event(), PageLoadEvent::Finished)
                && payload.url().host_str() != Some("music.youtube.com")
                && !w.is_visible().unwrap_or(false)
            {
                let app = w.app_handle();
                set_logged_in(app, false);
            }
        })
        .build()
}

fn player_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(PLAYER_LABEL)
        .ok_or_else(|| "player window is missing".into())
}

/// Called by the bridge inside music.youtube.com (the only command it may call).
#[tauri::command]
pub fn player_event(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, PlayerState>,
    kind: String,
    data: Value,
) -> Result<(), String> {
    if window.label() != PLAYER_LABEL {
        return Err("not allowed".into());
    }
    match kind.as_str() {
        "auth" => {
            let logged_in = data.get("loggedIn").and_then(Value::as_bool).unwrap_or(false);
            let visible = window.is_visible().unwrap_or(false);
            if logged_in && visible {
                // Signed in: the sign-in window has done its job.
                let _ = window.hide();
                let _ = window.set_title("YouTube Music player");
            } else if !logged_in && visible {
                // Back on YouTube Music but signed out (e.g. just after the cookie
                // choice): carry straight on to Google sign-in.
                let _ = window.navigate(SIGN_IN_URL.parse().unwrap());
            }
            set_logged_in(&app, logged_in);
        }
        "playback" => {
            let previous = state.0.lock().unwrap().playback.replace(data.clone());
            if cfg!(debug_assertions) {
                let key = |v: Option<&Value>| {
                    v.map(|v| (v.get("videoId").cloned(), v.get("quality").cloned()))
                };
                if key(previous.as_ref()) != key(Some(&data)) {
                    eprintln!(
                        "[player] now playing {} - {} ({})",
                        data["title"], data["artist"], data["quality"]
                    );
                }
            }
            // Don't wake a minimized UI; it catches up via `player_status` when restored.
            let minimized = app
                .get_webview_window(MAIN_LABEL)
                .and_then(|w| w.is_minimized().ok())
                .unwrap_or(false);
            if !minimized {
                let _ = app.emit_to(MAIN_LABEL, "player://playback", data);
            }
        }
        _ => {}
    }
    Ok(())
}

fn set_logged_in(app: &AppHandle, logged_in: bool) {
    let state = app.state::<PlayerState>();
    let changed = {
        let mut s = state.0.lock().unwrap();
        let changed = s.logged_in != Some(logged_in);
        s.logged_in = Some(logged_in);
        changed
    };
    if changed {
        let _ = app.emit_to(MAIN_LABEL, "player://auth", logged_in);
    }
}

#[tauri::command]
pub fn player_status(state: State<'_, PlayerState>) -> Snapshot {
    state.0.lock().unwrap().clone()
}

/// Show the player window so the user can sign in. If it's parked on another page
/// (cookie consent, a half-finished sign-in) show that as it is; otherwise go to sign-in.
#[tauri::command]
pub fn player_show_login(app: AppHandle) -> Result<(), String> {
    let w = player_window(&app)?;
    let on_ytm = w.url().ok().and_then(|u| u.host_str().map(str::to_owned))
        == Some("music.youtube.com".to_owned());
    if on_ytm {
        w.navigate(SIGN_IN_URL.parse().unwrap()).map_err(|e| e.to_string())?;
    }
    w.set_title("Sign in to YouTube Music").map_err(|e| e.to_string())?;
    w.show().map_err(|e| e.to_string())?;
    w.set_focus().map_err(|e| e.to_string())
}

/// Forward a control command from our UI to the bridge, e.g. {"action": "toggle"}.
#[tauri::command]
pub fn player_cmd(app: AppHandle, cmd: Value) -> Result<(), String> {
    let action = cmd.get("action").and_then(Value::as_str).unwrap_or_default();
    const ALLOWED: &[&str] = &["play", "pause", "toggle", "next", "previous", "seek", "volume", "load"];
    if !ALLOWED.contains(&action) {
        return Err(format!("unknown action: {action}"));
    }
    // `cmd` is re-serialized by serde_json, so it is a plain JSON literal, never code.
    let js = format!("window.__ytmn && window.__ytmn.command({cmd});");
    player_window(&app)?.eval(js).map_err(|e| e.to_string())
}
