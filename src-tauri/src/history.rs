//! Listening history: every song you actually listen to, kept in `history.jsonl` in
//! the app's data folder (one JSON object per line, appended when a song ends).
//!
//! YouTube Music's own history has no timestamps, play counts or skip information,
//! so we keep our own. It's cheap: the tracker is a few fields updated on each
//! playback report the bridge already sends, and the file gets one small write per
//! song. Stats are only computed when asked for.

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

/// Shorter listens than this (a quick skip, a misclick) aren't recorded at all.
const MIN_RECORDED_SECS: f64 = 5.0;
/// A play "counts" (for play counts and top lists) once it's this long or finished.
const COUNTED_SECS: u32 = 30;
/// Reports arrive about once a second while playing. A longer gap (the PC slept,
/// the page hung) only counts up to this much listening.
const MAX_GAP: Duration = Duration::from_secs(10);

/// One listen, as stored in the file.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Play {
    /// When it started, in Unix seconds.
    pub ts: u64,
    pub video_id: String,
    pub title: String,
    pub artist: String,
    #[serde(default)]
    pub album: String,
    /// The song's length in seconds (0 if unknown).
    pub duration: u32,
    /// Seconds actually listened (pauses and seeked-over parts don't count).
    pub listened: u32,
    /// Played through to (nearly) the end.
    pub completed: bool,
}

impl Play {
    fn counted(&self) -> bool {
        self.completed || self.listened >= COUNTED_SECS
    }
}

/// The song playing now, until it ends or another one starts.
struct Current {
    started: u64,
    video_id: String,
    title: String,
    artist: String,
    album: String,
    duration: f64,
    listened: f64,
    last_pos: f64,
    max_pos: f64,
    playing: bool,
    last_at: Instant,
}

impl Current {
    fn new(video_id: &str, data: &Value, now: Instant, unix: u64) -> Self {
        let mut c = Current {
            started: unix,
            video_id: video_id.to_owned(),
            title: String::new(),
            artist: String::new(),
            album: String::new(),
            duration: 0.0,
            listened: 0.0,
            last_pos: 0.0,
            max_pos: 0.0,
            playing: false,
            last_at: now,
        };
        c.apply(data, now);
        c
    }

    /// Take in a playback report for this same song.
    fn apply(&mut self, data: &Value, now: Instant) {
        if self.playing {
            self.listened += now.saturating_duration_since(self.last_at).min(MAX_GAP).as_secs_f64();
        }
        self.last_at = now;
        self.playing = data["playing"].as_bool().unwrap_or(false);
        let pos = data["position"].as_f64().unwrap_or(0.0);
        self.last_pos = pos;
        self.max_pos = self.max_pos.max(pos);
        if let Some(d) = data["duration"].as_f64().filter(|d| *d > 0.0) {
            self.duration = d;
        }
        // Names can arrive a moment after the song starts (the album especially).
        for (field, key) in [
            (&mut self.title, "title"),
            (&mut self.artist, "artist"),
            (&mut self.album, "album"),
        ] {
            if let Some(s) = data[key].as_str().filter(|s| !s.is_empty()) {
                *field = s.to_owned();
            }
        }
    }

    /// Back at the start after reaching the end: repeat-one started it again.
    fn restarted(&self, data: &Value) -> bool {
        let pos = data["position"].as_f64().unwrap_or(0.0);
        self.duration > 0.0 && pos < 3.0 && self.last_pos >= self.duration - 5.0
    }

    fn finish(mut self, now: Instant) -> Option<Play> {
        if self.playing {
            self.listened += now.saturating_duration_since(self.last_at).min(MAX_GAP).as_secs_f64();
        }
        if self.listened < MIN_RECORDED_SECS {
            return None;
        }
        let completed = self.duration > 0.0
            && self.max_pos >= self.duration - 5.0
            && self.listened >= self.duration * 0.5;
        Some(Play {
            ts: self.started,
            video_id: self.video_id,
            title: self.title,
            artist: self.artist,
            album: self.album,
            duration: self.duration.round() as u32,
            listened: self.listened.round() as u32,
            completed,
        })
    }
}

/// Follows playback reports and hands back each finished listen.
#[derive(Default)]
struct Tracker(Option<Current>);

impl Tracker {
    fn on_playback(&mut self, data: &Value, now: Instant, unix: u64) -> Option<Play> {
        let video_id = data["videoId"].as_str().filter(|s| !s.is_empty())?;
        match &mut self.0 {
            Some(c) if c.video_id == video_id && !c.restarted(data) => {
                c.apply(data, now);
                None
            }
            _ => {
                let done = self.0.take().and_then(|c| c.finish(now));
                self.0 = Some(Current::new(video_id, data, now, unix));
                done
            }
        }
    }

    fn flush(&mut self, now: Instant) -> Option<Play> {
        self.0.take().and_then(|c| c.finish(now))
    }
}

static TRACKER: Mutex<Tracker> = Mutex::new(Tracker(None));

fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|dir| dir.join("history.jsonl"))
}

fn append(app: &AppHandle, play: &Play) {
    let Some(path) = file(app) else { return };
    let _ = std::fs::create_dir_all(path.parent().unwrap_or(&path));
    let line = match serde_json::to_string(play) {
        Ok(line) => line,
        Err(_) => return,
    };
    let result = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| writeln!(f, "{line}"));
    match result {
        Ok(()) => log::debug!("[history] {} - {} ({}s)", play.artist, play.title, play.listened),
        Err(e) => log::warn!("[history] couldn't write {}: {e}", path.display()),
    }
}

/// Called for every playback report from the bridge.
pub fn on_playback(app: &AppHandle, data: &Value) {
    let done = TRACKER.lock().unwrap().on_playback(data, Instant::now(), unix_now());
    if let Some(play) = done {
        append(app, &play);
    }
}

/// Record the song in progress (when the app quits).
pub fn flush(app: &AppHandle) {
    let done = TRACKER.lock().unwrap().flush(Instant::now());
    if let Some(play) = done {
        append(app, &play);
    }
}

fn load(app: &AppHandle) -> Vec<Play> {
    let Some(text) = file(app).and_then(|f| std::fs::read_to_string(f).ok()) else {
        return Vec::new();
    };
    // A line cut short by a crash is skipped, not fatal.
    text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect()
}

// ---------------------------------------------------------------- queries

/// Recent listens, newest first. `before` (Unix seconds) pages further back.
#[tauri::command]
pub fn history_recent(app: AppHandle, limit: Option<usize>, before: Option<u64>) -> Vec<Play> {
    let mut plays = load(&app);
    plays.retain(|p| before.is_none_or(|b| p.ts < b));
    plays.reverse();
    plays.truncate(limit.unwrap_or(50));
    plays
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackStat {
    pub video_id: String,
    pub title: String,
    pub artist: String,
    pub plays: u32,
    pub seconds: u64,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistStat {
    pub artist: String,
    pub plays: u32,
    pub seconds: u64,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayStat {
    /// Local date, "YYYY-MM-DD".
    pub date: String,
    pub plays: u32,
    pub seconds: u64,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    /// Plays that count (finished, or at least 30 s).
    pub plays: u32,
    pub completed: u32,
    /// Recorded but left early (under 30 s and not finished).
    pub skipped: u32,
    /// Total listening time.
    pub seconds: u64,
    pub distinct_tracks: u32,
    pub distinct_artists: u32,
    pub top_tracks: Vec<TrackStat>,
    pub top_artists: Vec<ArtistStat>,
    /// Listening seconds per local hour of the day (0-23).
    pub by_hour: [u64; 24],
    /// Listening seconds per local weekday, Monday first.
    pub by_weekday: [u64; 7],
    /// One entry per local day with listening, oldest first.
    pub by_day: Vec<DayStat>,
    pub first: Option<u64>,
    pub last: Option<u64>,
}

/// Days since 1970-01-01 to a calendar date (Howard Hinnant's algorithm).
fn civil_date(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

fn compute(plays: &[Play], since: Option<u64>, until: Option<u64>, tz_offset_secs: i64, limit: usize) -> Stats {
    let mut s = Stats::default();
    let mut tracks: HashMap<&str, TrackStat> = HashMap::new();
    let mut artists: HashMap<&str, ArtistStat> = HashMap::new();
    let mut days: std::collections::BTreeMap<i64, (u32, u64)> = Default::default();

    for p in plays
        .iter()
        .filter(|p| since.is_none_or(|t| p.ts >= t) && until.is_none_or(|t| p.ts < t))
    {
        let secs = u64::from(p.listened);
        let counted = u32::from(p.counted());
        s.seconds += secs;
        s.plays += counted;
        s.completed += u32::from(p.completed);
        s.skipped += 1 - counted;
        s.first = Some(s.first.map_or(p.ts, |f| f.min(p.ts)));
        s.last = Some(s.last.map_or(p.ts, |l| l.max(p.ts)));

        let t = tracks.entry(&p.video_id).or_insert_with(|| TrackStat {
            video_id: p.video_id.clone(),
            ..Default::default()
        });
        // The latest names win: they're the most complete.
        t.title.clone_from(&p.title);
        t.artist.clone_from(&p.artist);
        t.plays += counted;
        t.seconds += secs;
        if !p.artist.is_empty() {
            let a = artists.entry(&p.artist).or_insert_with(|| ArtistStat {
                artist: p.artist.clone(),
                ..Default::default()
            });
            a.plays += counted;
            a.seconds += secs;
        }

        let local = p.ts as i64 + tz_offset_secs;
        let day = local.div_euclid(86_400);
        s.by_hour[(local.rem_euclid(86_400) / 3600) as usize] += secs;
        // 1970-01-01 was a Thursday (index 3 with Monday first).
        s.by_weekday[(day + 3).rem_euclid(7) as usize] += secs;
        let d = days.entry(day).or_default();
        d.0 += counted;
        d.1 += secs;
    }

    s.distinct_tracks = tracks.len() as u32;
    s.distinct_artists = artists.len() as u32;
    let mut top_tracks: Vec<_> = tracks.into_values().collect();
    top_tracks.sort_by(|a, b| b.plays.cmp(&a.plays).then(b.seconds.cmp(&a.seconds)));
    top_tracks.truncate(limit);
    s.top_tracks = top_tracks;
    let mut top_artists: Vec<_> = artists.into_values().collect();
    top_artists.sort_by(|a, b| b.seconds.cmp(&a.seconds).then(b.plays.cmp(&a.plays)));
    top_artists.truncate(limit);
    s.top_artists = top_artists;
    s.by_day = days
        .into_iter()
        .map(|(day, (plays, seconds))| {
            let (y, m, d) = civil_date(day);
            DayStat { date: format!("{y:04}-{m:02}-{d:02}"), plays, seconds }
        })
        .collect();
    s
}

/// Listening stats between `since` and `until` (Unix seconds; both optional).
/// `tzOffsetMinutes` is minutes east of UTC, i.e. `-new Date().getTimezoneOffset()`,
/// for the hour, weekday and day buckets.
#[tauri::command]
pub fn history_stats(
    app: AppHandle,
    since: Option<u64>,
    until: Option<u64>,
    tz_offset_minutes: Option<i64>,
    limit: Option<usize>,
) -> Stats {
    compute(&load(&app), since, until, tz_offset_minutes.unwrap_or(0) * 60, limit.unwrap_or(20))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn report(id: &str, pos: f64, playing: bool) -> Value {
        json!({"videoId": id, "title": "Song", "artist": "Band", "position": pos, "duration": 200.0, "playing": playing})
    }

    #[test]
    fn records_listening_time_and_ignores_pauses() {
        let t0 = Instant::now();
        let mut tr = Tracker::default();
        assert!(tr.on_playback(&report("a", 0.0, true), t0, 1000).is_none());
        // Reports arrive every second while playing.
        for i in 1..60u32 {
            tr.on_playback(&report("a", f64::from(i), true), t0 + Duration::from_secs(i.into()), 0);
        }
        assert!(tr.on_playback(&report("a", 60.0, false), t0 + Duration::from_secs(60), 0).is_none());
        // Paused for an hour: none of it counts.
        assert!(tr.on_playback(&report("a", 60.0, true), t0 + Duration::from_secs(3660), 0).is_none());
        let play = tr.on_playback(&report("b", 0.0, true), t0 + Duration::from_secs(3670), 2000).unwrap();
        assert_eq!(play.video_id, "a");
        assert_eq!(play.ts, 1000);
        assert_eq!(play.listened, 70);
        assert!(!play.completed);
        assert!(play.counted());
    }

    #[test]
    fn long_gaps_are_capped() {
        let t0 = Instant::now();
        let mut tr = Tracker::default();
        tr.on_playback(&report("a", 0.0, true), t0, 0);
        // The PC slept for an hour mid-song.
        let play = tr.flush(t0 + Duration::from_secs(3600)).unwrap();
        assert_eq!(play.listened, MAX_GAP.as_secs() as u32);
    }

    #[test]
    fn quick_skips_are_not_recorded() {
        let t0 = Instant::now();
        let mut tr = Tracker::default();
        tr.on_playback(&report("a", 0.0, true), t0, 0);
        assert!(tr.on_playback(&report("b", 0.0, true), t0 + Duration::from_secs(2), 0).is_none());
    }

    #[test]
    fn finished_and_repeated_songs() {
        let t0 = Instant::now();
        let mut tr = Tracker::default();
        let mut now = t0;
        for i in 0..=198 {
            tr.on_playback(&report("a", f64::from(i), true), now, 0);
            now += Duration::from_secs(1);
        }
        // Repeat-one: same song, back at the start.
        let play = tr.on_playback(&report("a", 0.5, true), now, 0).unwrap();
        assert!(play.completed);
        assert_eq!(play.listened, 199);
    }

    #[test]
    fn stats_buckets() {
        let mk = |ts, id: &str, artist: &str, listened| Play {
            ts,
            video_id: id.into(),
            title: id.into(),
            artist: artist.into(),
            album: String::new(),
            duration: 200,
            listened,
            completed: listened >= 190,
        };
        // 2024-01-01 was a Monday. 23:30 UTC = 00:30 the next day at UTC+1.
        let monday_2330 = 1_704_151_800;
        let plays = vec![
            mk(monday_2330, "x", "A", 200),
            mk(monday_2330 + 300, "x", "A", 100),
            mk(monday_2330 + 600, "y", "B", 10),
        ];
        let s = compute(&plays, None, None, 0, 10);
        assert_eq!((s.plays, s.completed, s.skipped, s.seconds), (2, 1, 1, 310));
        assert_eq!(s.top_tracks[0].video_id, "x");
        assert_eq!(s.top_tracks[0].plays, 2);
        assert_eq!(s.top_artists[0].artist, "A");
        assert_eq!(s.by_hour[23], 310);
        assert_eq!(s.by_weekday[0], 310);
        assert_eq!(s.by_day[0].date, "2024-01-01");

        let s = compute(&plays, None, None, 3600, 10);
        assert_eq!(s.by_hour[0], 310);
        assert_eq!(s.by_weekday[1], 310);
        assert_eq!(s.by_day[0].date, "2024-01-02");

        let s = compute(&plays, Some(monday_2330 + 1), None, 0, 10);
        assert_eq!(s.seconds, 110);
    }
}
