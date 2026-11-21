//! App settings (the Settings page), kept in `settings.json` in the app's data folder.
//! Rust owns them because some take effect here: Discord presence, the player's
//! audio-only mode and how much goes into the log file.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// "Listening to …" on your Discord profile.
    pub discord_presence: bool,
    /// Prefer the audio ("Song") version of tracks and the lowest video quality, so the
    /// hidden player uses less data, CPU and memory.
    pub audio_only: bool,
    /// Write debug detail to the log file, for tracking down a problem.
    pub verbose_logs: bool,
    /// Look for a new version on GitHub when the app starts (the Settings page can
    /// always check by hand).
    pub check_for_updates: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            discord_presence: true,
            audio_only: true,
            verbose_logs: false,
            check_for_updates: true,
        }
    }
}

#[derive(Default)]
pub struct SettingsState(Mutex<Settings>);

fn file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|dir| dir.join("settings.json"))
}

/// Read the saved settings (defaults for anything missing) and apply them.
pub fn init(app: &AppHandle) {
    let settings = file(app)
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
        .unwrap_or_default();
    apply_log_level(&settings);
    app.manage(SettingsState(Mutex::new(settings)));
}

pub fn get(app: &AppHandle) -> Settings {
    app.state::<SettingsState>().0.lock().unwrap().clone()
}

fn apply_log_level(s: &Settings) {
    let level = if s.verbose_logs || cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };
    log::set_max_level(level);
}

#[tauri::command]
pub fn settings_get(state: State<'_, SettingsState>) -> Settings {
    state.0.lock().unwrap().clone()
}

/// Change some settings: `patch` holds only the fields to change. Returns them all.
#[tauri::command]
pub fn settings_set(app: AppHandle, state: State<'_, SettingsState>, patch: Value) -> Result<Settings, String> {
    let Some(patch) = patch.as_object() else {
        return Err("settings must be a JSON object".into());
    };
    let (before, after) = {
        let mut guard = state.0.lock().unwrap();
        let before = guard.clone();
        let mut merged = serde_json::to_value(&*guard).map_err(|e| e.to_string())?;
        for (k, v) in patch {
            // Only known fields, and only with the same type as before.
            match merged.get(k) {
                Some(old) if std::mem::discriminant(old) == std::mem::discriminant(v) => merged[k] = v.clone(),
                _ => return Err(format!("unknown or invalid setting: {k}")),
            }
        }
        let after: Settings = serde_json::from_value(merged).map_err(|e| e.to_string())?;
        *guard = after.clone();
        (before, after)
    };

    if let Some(f) = file(&app) {
        let _ = std::fs::create_dir_all(f.parent().unwrap_or(&f));
        let text = serde_json::to_string_pretty(&after).unwrap_or_default();
        if let Err(e) = std::fs::write(&f, text) {
            log::warn!("[settings] couldn't write {}: {e}", f.display());
        }
    }
    log::info!("[settings] changed: {}", Value::Object(patch.clone()));

    apply_log_level(&after);
    #[cfg(target_os = "windows")]
    if before.discord_presence && !after.discord_presence {
        crate::discord::update(&Value::Null); // clears it
    }
    if before.audio_only != after.audio_only {
        let _ = crate::player::send_command(&app, json!({ "action": "lightMode", "on": after.audio_only }));
    }
    Ok(after)
}

/// Facts for the Settings page's About section and for bug reports.
#[tauri::command]
pub fn app_info(app: AppHandle) -> Value {
    let path = |p: tauri::Result<std::path::PathBuf>| p.map(|p| p.display().to_string()).unwrap_or_default();
    json!({
        "name": app.package_info().name,
        "version": app.package_info().version.to_string(),
        "tauri": tauri::VERSION,
        "webview": tauri::webview_version().unwrap_or_default(),
        "os": format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        "logDir": path(app.path().app_log_dir()),
        "dataDir": path(app.path().app_local_data_dir()),
        "debug": cfg!(debug_assertions),
    })
}

/// Open the folder holding the log files in Explorer.
#[tauri::command]
pub fn open_log_folder(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// A message from our UI for the log file: errors, warnings, and (in verbose mode) detail.
#[tauri::command]
pub fn ui_log(level: String, message: String) {
    let message: String = message.chars().take(4000).collect();
    match level.as_str() {
        "error" => log::error!("[ui] {message}"),
        "warn" => log::warn!("[ui] {message}"),
        "info" => log::info!("[ui] {message}"),
        _ => log::debug!("[ui] {message}"),
    }
}
