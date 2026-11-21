//! Windows media controls (System Media Transport Controls): keyboard media keys, and
//! the track shown in the volume flyout, lock screen and Xbox Game Bar media widget.
//!
//! The hidden YouTube Music window's own media handling is switched off (see
//! `player.rs`), so these are the only controls Windows sees, and they go through
//! the same commands as the app's buttons.

use std::{sync::Mutex, time::Duration};

use serde_json::{Value, json};
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
    SeekDirection,
};
use tauri::{AppHandle, Manager};

use crate::player::send_command;

/// What Windows was last told, so it's only updated when something changes.
#[derive(Default, PartialEq)]
struct Shown {
    video_id: Option<String>,
    playing: bool,
    position: u64,
    duration: u64,
}

pub struct Media {
    controls: Mutex<Option<MediaControls>>,
    shown: Mutex<Shown>,
}

pub fn init(app: &AppHandle) {
    let controls = create(app)
        .map_err(|e| log::warn!("[media] Windows media controls unavailable: {e}"))
        .ok();
    app.manage(Media {
        controls: Mutex::new(controls),
        shown: Mutex::default(),
    });
}

fn create(app: &AppHandle) -> Result<MediaControls, String> {
    let main = app.get_webview_window("main").ok_or("no main window")?;
    let hwnd = main.hwnd().map_err(|e| e.to_string())?;
    let config = PlatformConfig {
        dbus_name: "ytm_native",
        display_name: "YouTube Music Native",
        hwnd: Some(hwnd.0),
    };
    let mut controls = MediaControls::new(config).map_err(|e| format!("{e:?}"))?;
    let app = app.clone();
    controls
        .attach(move |event| {
            if let Some(cmd) = command_for(event) {
                let _ = send_command(&app, cmd);
            }
        })
        .map_err(|e| format!("{e:?}"))?;
    Ok(controls)
}

/// A media key or flyout button, as one of our player commands.
fn command_for(event: MediaControlEvent) -> Option<Value> {
    Some(match event {
        MediaControlEvent::Play => json!({ "action": "play" }),
        MediaControlEvent::Pause | MediaControlEvent::Stop => json!({ "action": "pause" }),
        MediaControlEvent::Toggle => json!({ "action": "toggle" }),
        MediaControlEvent::Next => json!({ "action": "next" }),
        MediaControlEvent::Previous => json!({ "action": "previous" }),
        MediaControlEvent::SetPosition(MediaPosition(at)) => {
            json!({ "action": "seek", "seconds": at.as_secs_f64() })
        }
        MediaControlEvent::Seek(SeekDirection::Forward) => {
            json!({ "action": "seekBy", "seconds": 10 })
        }
        MediaControlEvent::Seek(SeekDirection::Backward) => {
            json!({ "action": "seekBy", "seconds": -10 })
        }
        MediaControlEvent::SeekBy(dir, by) => {
            let s = by.as_secs_f64();
            json!({ "action": "seekBy", "seconds": if matches!(dir, SeekDirection::Forward) { s } else { -s } })
        }
        _ => return None,
    })
}

/// Bigger artwork for the flyout: YouTube Music's image URLs carry their size.
fn large_artwork(url: &str) -> String {
    match url.rfind('=') {
        Some(i) if url.contains("googleusercontent.com") || url.contains("ggpht.com") => {
            format!("{}=w544-h544-l90-rj", &url[..i])
        }
        _ => url.to_owned(),
    }
}

/// Called with every now-playing update from the player.
pub fn update(app: &AppHandle, p: &Value) {
    let Some(media) = app.try_state::<Media>() else {
        return;
    };
    let mut guard = media.controls.lock().unwrap();
    let Some(controls) = guard.as_mut() else {
        return;
    };

    let str_of = |k: &str| p.get(k).and_then(Value::as_str).unwrap_or_default();
    let video_id = p.get("videoId").and_then(Value::as_str).map(str::to_owned);
    let playing = p.get("playing").and_then(Value::as_bool).unwrap_or(false);
    let position = p.get("position").and_then(Value::as_f64).unwrap_or(0.0);
    let duration = p.get("duration").and_then(Value::as_f64).unwrap_or(0.0);

    let mut shown = media.shown.lock().unwrap();
    // Also when the duration settles: the first report of a new track can carry a
    // provisional one.
    if shown.video_id != video_id || shown.duration != duration as u64 {
        let cover = p.get("artwork").and_then(Value::as_str).map(large_artwork);
        let _ = controls.set_metadata(MediaMetadata {
            title: Some(str_of("title")),
            artist: Some(str_of("artist")).filter(|s| !s.is_empty()),
            album: Some(str_of("album")).filter(|s| !s.is_empty()),
            cover_url: cover.as_deref(),
            duration: (duration > 0.0).then(|| Duration::from_secs_f64(duration)),
        });
    }
    // Windows moves the timeline on by itself while playing, so only tell it about
    // play/pause changes, new tracks and jumps (seeks), not every second.
    let expected = if shown.playing {
        shown.position + 1
    } else {
        shown.position
    };
    let jumped = (position as i64 - expected as i64).abs() > 2;
    if shown.video_id != video_id || shown.playing != playing || jumped {
        let progress = Some(MediaPosition(Duration::from_secs_f64(position.max(0.0))));
        let _ = controls.set_playback(if playing {
            MediaPlayback::Playing { progress }
        } else {
            MediaPlayback::Paused { progress }
        });
    }
    *shown = Shown {
        video_id,
        playing,
        position: position as u64,
        duration: duration as u64,
    };
}
