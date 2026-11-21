//! Discord Rich Presence: "Listening to …" on your Discord profile while music plays,
//! like Spotify's. Talks to the Discord app on this computer through its local pipe
//! (nothing goes over the internet from us). Does nothing when Discord isn't running,
//! and picks it up again when it starts.
//!
//! Discord's protocol: frames of `[opcode u32 LE][length u32 LE][JSON]` on
//! `\\.\pipe\discord-ipc-N`. Opcode 0 is the handshake, 1 a command, 3/4 ping/pong.

use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    sync::{
        Mutex, OnceLock,
        mpsc::{self, Receiver, RecvTimeoutError, Sender},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde_json::{Value, json};

/// The Discord application whose name shows as "Listening to <name>".
const CLIENT_ID: &str = "1573763494103228457";
/// Discord allows about five presence updates per 20 seconds.
const MIN_GAP: Duration = Duration::from_secs(2);
/// How often to look for Discord when it isn't running.
const RETRY: Duration = Duration::from_secs(15);
/// The position may drift this far from what Discord shows before we correct it (a seek).
const DRIFT_MS: i64 = 3000;

/// `Some(activity)` to show, `None` to clear.
type Update = Option<Value>;

static SENDER: OnceLock<Mutex<Sender<Update>>> = OnceLock::new();
/// What we last asked for, to skip the once-a-second playback updates that change nothing.
static LAST: Mutex<Option<(String, i64)>> = Mutex::new(None);

/// Start the background thread that keeps Discord up to date.
pub fn init() {
    let (tx, rx) = mpsc::channel();
    if SENDER.set(Mutex::new(tx)).is_ok() {
        std::thread::Builder::new()
            .name("discord-presence".into())
            .spawn(move || run(rx))
            .ok();
    }
}

/// Called with every playback update from the player (see player.rs).
pub fn update(p: &Value) {
    let activity = activity(p);
    // Same song, state and speed, and the clock still where Discord thinks it is: nothing to say.
    let key = activity.as_ref().map(|a| {
        let mut a = a.clone();
        let start = a["timestamps"]["start"].as_i64().unwrap_or(0);
        a["timestamps"] = Value::Null;
        (a.to_string(), start)
    });
    {
        let mut last = LAST.lock().unwrap();
        let unchanged = match (&*last, &key) {
            (None, None) => true,
            (Some((a, s1)), Some((b, s2))) => a == b && (s1 - s2).abs() < DRIFT_MS,
            _ => false,
        };
        if unchanged {
            return;
        }
        *last = key;
    }
    if let Some(tx) = SENDER.get() {
        let _ = tx.lock().unwrap().send(activity);
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Discord wants 2-128 characters for its text fields.
fn field(s: &str) -> String {
    let s: String = s.trim().chars().take(128).collect();
    if s.chars().count() < 2 { format!("{s:<2}") } else { s }
}

/// The presence for a playback update, or None when nothing is playing (paused clears
/// it, as Spotify does).
fn activity(p: &Value) -> Option<Value> {
    let video_id = p["videoId"].as_str().filter(|v| !v.is_empty())?;
    if !p["playing"].as_bool().unwrap_or(false) {
        return None;
    }
    let title = p["title"].as_str().unwrap_or_default();
    let artist = p["artist"].as_str().unwrap_or_default();
    let album = p["album"].as_str().unwrap_or_default();
    let rate = p["rate"].as_f64().filter(|r| *r > 0.0).unwrap_or(1.0);
    let position = p["position"].as_f64().unwrap_or(0.0);
    let duration = p["duration"].as_f64().unwrap_or(0.0);

    // Discord counts in real time, so a faster speed means a shorter song.
    let start = now_ms() - (position / rate * 1000.0) as i64;
    let mut timestamps = json!({ "start": start });
    if duration > 0.0 {
        timestamps["end"] = json!(start + (duration / rate * 1000.0) as i64);
    }

    // Cover art by URL (Discord fetches it). Its limit is 256 characters.
    let artwork = p["artwork"]
        .as_str()
        .filter(|u| u.starts_with("https://") && u.len() <= 256)
        .map(str::to_owned)
        .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"));

    let url = format!("https://music.youtube.com/watch?v={video_id}");
    Some(json!({
        "type": 2,                // "Listening to …"
        "status_display_type": 1, // the member list shows the artist, like Spotify
        "details": field(if title.is_empty() { "Unknown song" } else { title }),
        "state": field(if artist.is_empty() { "YouTube Music" } else { artist }),
        "timestamps": timestamps,
        "assets": {
            "large_image": artwork,
            "large_text": field(if album.is_empty() { title } else { album }),
        },
        "buttons": [{ "label": "Play on YouTube Music", "url": url }],
    }))
}

// ------------------------------------------------------------------ the thread

fn run(rx: Receiver<Update>) {
    let mut want: Update = None;
    let mut dirty = false;
    let mut conn: Option<Conn> = None;
    let mut last_send = Instant::now() - MIN_GAP;
    let mut last_try: Option<Instant> = None;

    loop {
        let wait = if dirty { Duration::from_millis(500) } else { RETRY };
        match rx.recv_timeout(wait) {
            Ok(update) => {
                want = update;
                dirty = true;
                // A burst (skipping through songs): only the last one matters.
                while let Ok(update) = rx.recv_timeout(Duration::from_millis(400)) {
                    want = update;
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        if !dirty || last_send.elapsed() < MIN_GAP {
            continue;
        }
        if conn.is_none() {
            if last_try.is_some_and(|t| t.elapsed() < RETRY) {
                continue;
            }
            last_try = Some(Instant::now());
            conn = Conn::open().ok();
            if conn.is_none() {
                continue; // Discord isn't running: try again later
            }
        }
        let Some(c) = conn.as_mut() else { continue };
        match c.set_activity(want.as_ref()) {
            Ok(()) => {
                dirty = false;
                last_send = Instant::now();
            }
            Err(e) => {
                log::info!("[discord] lost the connection: {e}");
                conn = None; // Discord closed or restarted: reconnect and resend
                last_try = None;
            }
        }
    }
}

struct Conn {
    pipe: File,
    nonce: u64,
}

impl Conn {
    fn open() -> std::io::Result<Conn> {
        let mut last_err = std::io::Error::other("Discord isn't running");
        for i in 0..10 {
            match OpenOptions::new()
                .read(true)
                .write(true)
                .open(format!(r"\\.\pipe\discord-ipc-{i}"))
            {
                Ok(pipe) => {
                    let mut c = Conn { pipe, nonce: 0 };
                    c.write(0, &json!({ "v": 1, "client_id": CLIENT_ID }))?;
                    let (op, ready) = c.read()?;
                    if op == 2 {
                        return Err(std::io::Error::other(format!("Discord refused: {ready}")));
                    }
                    log::info!("[discord] connected on pipe {i}");
                    return Ok(c);
                }
                Err(e) => last_err = e,
            }
        }
        Err(last_err)
    }

    fn set_activity(&mut self, activity: Option<&Value>) -> std::io::Result<()> {
        self.nonce += 1;
        let payload = json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id(), "activity": activity },
            "nonce": self.nonce.to_string(),
        });
        self.write(1, &payload)?;
        let (_, reply) = self.read()?;
        if reply["evt"] == "ERROR" {
            log::warn!("[discord] rejected: {}", reply["data"]);
        } else if log::log_enabled!(log::Level::Debug) {
            let what = activity.map_or("(nothing: paused)".into(), |a| a["details"].to_string());
            log::debug!("[discord] showing {what}");
        }
        Ok(())
    }

    fn write(&mut self, op: u32, payload: &Value) -> std::io::Result<()> {
        let body = payload.to_string();
        let mut frame = Vec::with_capacity(8 + body.len());
        frame.extend_from_slice(&op.to_le_bytes());
        frame.extend_from_slice(&(body.len() as u32).to_le_bytes());
        frame.extend_from_slice(body.as_bytes());
        self.pipe.write_all(&frame)?;
        self.pipe.flush()
    }

    /// The next frame, answering pings on the way.
    fn read(&mut self) -> std::io::Result<(u32, Value)> {
        loop {
            let mut head = [0u8; 8];
            self.pipe.read_exact(&mut head)?;
            let op = u32::from_le_bytes(head[0..4].try_into().unwrap());
            let len = u32::from_le_bytes(head[4..8].try_into().unwrap()) as usize;
            if len > 1 << 20 {
                return Err(std::io::Error::other("frame too large"));
            }
            let mut body = vec![0u8; len];
            self.pipe.read_exact(&mut body)?;
            let value: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
            match op {
                3 => self.write(4, &value)?, // ping -> pong
                2 => return Err(std::io::Error::other(format!("Discord closed the connection: {value}"))),
                _ => return Ok((op, value)),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn playback(playing: bool) -> Value {
        json!({
            "videoId": "abc123", "title": "Satellite", "artist": "STARSET", "album": "Vessels",
            "artwork": "https://lh3.googleusercontent.com/x=w544-h544", "playing": playing,
            "position": 59.0, "duration": 239.0, "rate": 2.0,
        })
    }

    #[test]
    fn shows_the_song_while_playing() {
        let a = activity(&playback(true)).unwrap();
        assert_eq!(a["type"], 2);
        assert_eq!(a["details"], "Satellite");
        assert_eq!(a["state"], "STARSET");
        assert_eq!(a["assets"]["large_text"], "Vessels");
        assert_eq!(a["buttons"][0]["url"], "https://music.youtube.com/watch?v=abc123");
        // At 2x the song lasts half as long in real time.
        let (start, end) = (a["timestamps"]["start"].as_i64().unwrap(), a["timestamps"]["end"].as_i64().unwrap());
        assert_eq!(end - start, 119_500);
        assert!((now_ms() - start - 29_500).abs() < 1000);
    }

    #[test]
    fn clears_when_paused_or_empty() {
        assert!(activity(&playback(false)).is_none());
        assert!(activity(&json!({ "videoId": null, "playing": true })).is_none());
    }

    #[test]
    fn keeps_text_within_discords_limits() {
        assert_eq!(field("A"), "A ");
        assert_eq!(field(&"x".repeat(300)).chars().count(), 128);
    }
}
