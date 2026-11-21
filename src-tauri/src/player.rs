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
const SIGN_IN_URL: &str = "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F";
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
    /// YouTube Music's queue, mirrored: `{items: [...]}`.
    queue: Option<Value>,
}

/// Send an update to our UI, unless it's minimized: there's no point waking it, and
/// it catches up through `player_status` when restored.
fn emit_if_visible(app: &AppHandle, event: &str, data: Value) {
    let minimized = app
        .get_webview_window(MAIN_LABEL)
        .and_then(|w| w.is_minimized().ok())
        .unwrap_or(false);
    if !minimized {
        let _ = app.emit_to(MAIN_LABEL, event, data);
    }
}

/// Both windows run in ONE WebView2 browser: same data folder and same flags. Two
/// different folders or flag sets would start a second browser with its own GPU,
/// network and storage processes (about 180 MB more).
/// The folder keeps the Google sign-in ("player-profile" is its historical name).
pub fn webview_data_dir(app: &AppHandle) -> tauri::Result<std::path::PathBuf> {
    Ok(app.path().app_local_data_dir()?.join("player-profile"))
}

/// Tauri's defaults (the msWebOOUI… features) must be repeated when overriding.
/// HardwareMediaKeyHandling off: the page must not register its own media keys and
/// Windows media session; the app's own controls (media.rs) do that.
pub const BROWSER_ARGS: &str = "--autoplay-policy=no-user-gesture-required \
     --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,HardwareMediaKeyHandling";

/// Our UI. Declared in tauri.conf.json (with `create: false`) and built here so it
/// can share the player's WebView2 browser.
pub fn create_main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == MAIN_LABEL)
        .expect("main window missing from tauri.conf.json")
        .clone();
    WebviewWindowBuilder::from_config(app, &config)?
        .data_directory(webview_data_dir(app)?)
        .additional_browser_args(BROWSER_ARGS)
        .build()
}

pub fn create_player_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(
        app,
        PLAYER_LABEL,
        WebviewUrl::External(YTM_URL.parse().unwrap()),
    )
    .title("Sign in to YouTube Music")
    .inner_size(1000.0, 760.0)
    .visible(false)
    .data_directory(webview_data_dir(app)?)
    .additional_browser_args(BROWSER_ARGS)
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

/// Volume and the last song, kept across restarts in `playback.json` in the app's
/// data folder. (Not the page's own storage: that's written to disk lazily, so the
/// latest changes can be lost when the app is closed.)
#[derive(Default)]
pub struct Saved(Mutex<Option<Value>>);

fn saved_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|dir| dir.join("playback.json"))
}

fn saved_state(app: &AppHandle) -> Value {
    let saved = app.state::<Saved>();
    let mut guard = saved.0.lock().unwrap();
    guard
        .get_or_insert_with(|| {
            saved_file(app)
                .and_then(|f| std::fs::read_to_string(f).ok())
                .and_then(|text| serde_json::from_str::<Value>(&text).ok())
                .filter(Value::is_object)
                .unwrap_or_else(|| serde_json::json!({}))
        })
        .clone()
}

/// Merge what the bridge reports (`volume`, `last`) into the saved state and write it.
fn save_state(app: &AppHandle, patch: &Value) {
    let mut state = saved_state(app);
    let mut changed = false;
    if let Some(volume) = patch.get("volume").filter(|v| v.is_number()) {
        state["volume"] = volume.clone();
        changed = true;
    }
    if let Some(last) = patch.get("last").filter(|v| v.is_object()) {
        state["last"] = last.clone();
        changed = true;
    }
    if !changed {
        return;
    }
    *app.state::<Saved>().0.lock().unwrap() = Some(state.clone());
    if let Some(file) = saved_file(app) {
        let _ = std::fs::create_dir_all(file.parent().unwrap_or(&file));
        if let Err(e) = std::fs::write(&file, state.to_string()) {
            log::warn!("[saved] couldn't write {}: {e}", file.display());
        }
    }
}

pub fn player_window(app: &AppHandle) -> Result<WebviewWindow, String> {
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
) -> Result<Value, String> {
    if window.label() != PLAYER_LABEL {
        return Err("not allowed".into());
    }
    match kind.as_str() {
        // Restart memory: the bridge asks once when it starts, and reports changes.
        "loadSaved" => {
            let mut saved = saved_state(&app);
            saved["lightMode"] = Value::Bool(crate::settings::get(&app).audio_only);
            return Ok(saved);
        }
        "save" => save_state(&app, &data),
        "auth" => {
            let logged_in = data
                .get("loggedIn")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let visible = window.is_visible().unwrap_or(false);
            if logged_in && visible {
                // Signed in: the sign-in window has done its job.
                set_player_shown(&window, false);
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
            if log::log_enabled!(log::Level::Debug) {
                let key = |v: Option<&Value>| {
                    v.map(|v| (v.get("videoId").cloned(), v.get("quality").cloned()))
                };
                if key(previous.as_ref()) != key(Some(&data)) {
                    log::debug!(
                        "[player] now playing {} - {} ({})",
                        data["title"], data["artist"], data["quality"]
                    );
                }
            }
            crate::history::on_playback(&app, &data);
            #[cfg(target_os = "windows")]
            {
                crate::media::update(&app, &data);
                crate::thumbbar::update(&data);
                let presence = crate::settings::get(&app).discord_presence;
                crate::discord::update(if presence { &data } else { &Value::Null });
            }
            emit_if_visible(&app, "player://playback", data);
        }
        "queue" => {
            state.0.lock().unwrap().queue = Some(data.clone());
            emit_if_visible(&app, "player://queue", data);
        }
        "browse" => crate::library::resolve(&app.state::<crate::library::Pending>(), &data),
        // Diagnostics from the bridge (written to the log file in verbose mode).
        "log" => {
            let text: String = data.as_str().unwrap_or_default().chars().take(2000).collect();
            log::debug!("[bridge] {text}");
        }
        _ => {}
    }
    Ok(Value::Null)
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
        w.navigate(SIGN_IN_URL.parse().unwrap())
            .map_err(|e| e.to_string())?;
    }
    w.set_title("Sign in to YouTube Music")
        .map_err(|e| e.to_string())?;
    set_player_shown(&w, true);
    w.set_focus().map_err(|e| e.to_string())
}

/// Forward a control command from our UI to the bridge, e.g. {"action": "toggle"}.
#[tauri::command]
pub fn player_cmd(app: AppHandle, cmd: Value) -> Result<(), String> {
    send_command(&app, cmd)
}

/// Send a command to the bridge (from our UI or from Windows' media controls).
pub fn send_command(app: &AppHandle, cmd: Value) -> Result<(), String> {
    let action = cmd
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or_default();
    const ALLOWED: &[&str] = &[
        "play",
        "pause",
        "toggle",
        "next",
        "previous",
        "seek",
        "seekBy",
        "volume",
        "load",
        "queueJump",
        "rate",
        "repeat",
        "shuffle",
        "lightMode",
    ];
    if !ALLOWED.contains(&action) {
        return Err(format!("unknown action: {action}"));
    }
    if !matches!(action, "seek" | "volume") {
        log::debug!("[cmd] {cmd}");
    }
    // `cmd` is re-serialized by serde_json, so it is a plain JSON literal, never code.
    let js = format!("window.__ytmn && window.__ytmn.command({cmd});");
    player_window(app)?.eval(js).map_err(|e| e.to_string())
}

/// Show the player for sign-in, or hide it again. Hidden, WebView2 may run it lean.
pub fn set_player_shown(w: &WebviewWindow, shown: bool) {
    let _ = if shown { w.show() } else { w.hide() };
    #[cfg(target_os = "windows")]
    crate::webview::set_low_memory(w, !shown);
}
