//! Development only (not compiled into release builds): a tiny local test hook so the
//! app can be exercised from a script. It listens on 127.0.0.1 (this computer only).
//! Each line received is `main <js>` or `player <js>`, evaluated in that window, or
//! `window minimize` / `window restore` for our UI.
//! Scripts report results through `dev_log` / the bridge's log, i.e. the dev terminal.

use std::{
    io::{BufRead, BufReader},
    net::TcpListener,
};

use tauri::{AppHandle, Manager};

pub const PORT: u16 = 47811;

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let Ok(listener) = TcpListener::bind(("127.0.0.1", PORT)) else {
            log::info!("[devtest] port {PORT} busy; test hook disabled");
            return;
        };
        log::info!("[devtest] listening on 127.0.0.1:{PORT}");
        for stream in listener.incoming().flatten() {
            for line in BufReader::new(stream).lines().map_while(Result::ok) {
                // `window minimize` / `window restore`: our UI, for testing minimized behaviour.
                if let Some(action) = line.strip_prefix("window ") {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = match action.trim() {
                            "minimize" => w.minimize(),
                            "restore" => w.unminimize(),
                            _ => Ok(()),
                        };
                    }
                    continue;
                }
                let Some((target, js)) = line.split_once(' ') else {
                    continue;
                };
                let label = match target {
                    "main" => "main",
                    "player" => crate::player::PLAYER_LABEL,
                    _ => continue,
                };
                if let Some(w) = app.get_webview_window(label) {
                    let _ = w.eval(js);
                }
            }
        }
    });
}
