mod player;

use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(player::PlayerState::default())
        .invoke_handler(tauri::generate_handler![
            player::player_event,
            player::player_status,
            player::player_show_login,
            player::player_cmd,
        ])
        .setup(|app| {
            player::create_player_window(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            // Closing our UI quits the whole app (the hidden player included).
            ("main", WindowEvent::CloseRequested { .. }) => window.app_handle().exit(0),
            // The player window must stay alive to keep playing: closing it during
            // sign-in just hides it again.
            (player::PLAYER_LABEL, WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
