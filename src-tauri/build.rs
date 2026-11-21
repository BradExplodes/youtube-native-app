fn main() {
    // Declaring the app's commands here makes each one need an explicit permission,
    // so a window only gets the commands its capability file lists. The remote
    // music.youtube.com page can then call `player_event` and nothing else.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "player_event",
            "player_status",
            "player_show_login",
            "player_cmd",
            "browse",
            "ytm_call",
            "dev_save_fixture",
            "dev_log",
            "settings_get",
            "settings_set",
            "app_info",
            "open_log_folder",
            "ui_log",
            "history_recent",
            "history_stats",
        ]),
    ))
    .expect("failed to run tauri-build");
}
