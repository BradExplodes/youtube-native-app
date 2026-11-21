#[cfg(debug_assertions)]
mod devtest;
#[cfg(target_os = "windows")]
mod discord;
mod history;
mod library;
#[cfg(target_os = "windows")]
mod media;
mod player;
mod settings;
#[cfg(target_os = "windows")]
mod thumbbar;
#[cfg(target_os = "windows")]
mod webview;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Manager, WindowEvent};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use tauri_plugin_window_state::StateFlags;

/// Whether our UI was minimized at the last resize, to act only on changes.
static MAIN_MINIMIZED: AtomicBool = AtomicBool::new(false);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Log file: %LOCALAPPDATA%/com.ytmnative.desktop/logs/app.log (and the terminal
    // in development). Kept small: 1 MB per file, the last three files.
    let mut log = tauri_plugin_log::Builder::new()
        .clear_targets()
        .target(Target::new(TargetKind::LogDir { file_name: Some("app".into()) }))
        .max_file_size(1_000_000)
        .rotation_strategy(RotationStrategy::KeepSome(3))
        .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
        // The level is lowered at startup unless verbose logging is on (settings.rs).
        .level(log::LevelFilter::Debug)
        .level_for("tao", log::LevelFilter::Warn)
        .level_for("wry", log::LevelFilter::Warn)
        .level_for("tracing", log::LevelFilter::Warn);
    if cfg!(debug_assertions) {
        log = log.target(Target::new(TargetKind::Stderr));
    }

    tauri::Builder::default()
        .plugin(log.build())
        .plugin(
            // Size, position and maximized state of our UI, restored at the next start.
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .with_denylist(&[player::PLAYER_LABEL])
                .build(),
        )
        .manage(player::PlayerState::default())
        .manage(player::Saved::default())
        .manage(library::Pending::default())
        .invoke_handler(tauri::generate_handler![
            player::player_event,
            player::player_status,
            player::player_show_login,
            player::player_cmd,
            library::browse,
            library::ytm_call,
            library::dev_save_fixture,
            library::dev_log,
            settings::settings_get,
            settings::settings_set,
            settings::app_info,
            settings::open_log_folder,
            settings::ui_log,
            history::history_recent,
            history::history_stats,
        ])
        .setup(|app| {
            settings::init(app.handle());
            let info = app.package_info();
            log::info!(
                "{} {} starting (WebView2 {})",
                info.name,
                info.version,
                tauri::webview_version().unwrap_or_default()
            );
            // Created hidden: the saved size and position are applied first, and the
            // taskbar hook must be in place before its taskbar button appears.
            let main = player::create_main_window(app.handle())?;
            #[cfg(target_os = "windows")]
            thumbbar::init(app.handle(), &main);
            main.show()?;
            let _player = player::create_player_window(app.handle())?;
            // Nobody looks at the player (outside sign-in), so it can run lean.
            #[cfg(target_os = "windows")]
            webview::set_low_memory(&_player, true);
            #[cfg(target_os = "windows")]
            media::init(app.handle());
            #[cfg(target_os = "windows")]
            discord::init();
            #[cfg(debug_assertions)]
            devtest::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            // Closing our UI quits the whole app (the hidden player included).
            ("main", WindowEvent::CloseRequested { .. }) => window.app_handle().exit(0),
            // Minimized: let WebView2 trim our UI's memory until it's back on screen.
            ("main", WindowEvent::Resized(_)) => {
                let minimized = window.is_minimized().unwrap_or(false);
                if MAIN_MINIMIZED.swap(minimized, Ordering::Relaxed) != minimized {
                    #[cfg(target_os = "windows")]
                    if let Some(w) = window.app_handle().get_webview_window("main") {
                        webview::set_low_memory(&w, minimized);
                    }
                }
            }
            // The player window must stay alive to keep playing: closing it during
            // sign-in just hides it again.
            (player::PLAYER_LABEL, WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                if let Some(w) = window.app_handle().get_webview_window(player::PLAYER_LABEL) {
                    player::set_player_shown(&w, false);
                }
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Quitting mid-song: still record what was listened to.
            if let tauri::RunEvent::Exit = event {
                history::flush(app);
            }
        });
}
