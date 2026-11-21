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
        ]),
    ))
    .expect("failed to run tauri-build");
}
