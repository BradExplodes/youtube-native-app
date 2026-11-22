//! "Made for you": mixes put together on this computer from your listening history
//! (history.jsonl), the things YouTube Music can't do because it doesn't keep
//! timestamps, skips or play counts.
//!
//! Only plays from before the start of today count, so a mix stays the same all day
//! and freshens a little each day. A mix with too few songs isn't offered at all.

use std::collections::HashMap;

use serde::Serialize;
use tauri::AppHandle;

use crate::history::{self, Play};

const DAY: u64 = 86_400;
/// Fewer songs than this and the mix isn't offered (there isn't enough history yet).
const MIN_TRACKS: usize = 15;
const MAX_TRACKS: usize = 50;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MixTrack {
    pub video_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Seconds (0 if unknown).
    pub duration: u32,
    /// Cover address; empty for songs only heard before covers were recorded.
    pub artwork: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mix {
    pub id: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub tracks: Vec<MixTrack>,
}

/// What we know about one song from a set of plays.
struct Song<'a> {
    /// The most recent play: its names are the most complete.
    latest: &'a Play,
    /// The most recent cover seen (older plays may have none).
    artwork: &'a str,
    /// Plays that count (finished, or at least 30 s).
    counted: u32,
    /// Every recorded play, skips included.
    recorded: u32,
    completed: u32,
}

fn songs<'a>(plays: impl Iterator<Item = &'a Play>) -> HashMap<&'a str, Song<'a>> {
    let mut out: HashMap<&str, Song> = HashMap::new();
    for p in plays {
        let s = out.entry(&p.video_id).or_insert(Song {
            latest: p,
            artwork: "",
            counted: 0,
            recorded: 0,
            completed: 0,
        });
        if p.ts >= s.latest.ts {
            s.latest = p;
        }
        if !p.artwork.is_empty() && (s.artwork.is_empty() || p.ts >= s.latest.ts) {
            s.artwork = &p.artwork;
        }
        s.counted += u32::from(p.counted());
        s.recorded += 1;
        s.completed += u32::from(p.completed);
    }
    out
}

/// The songs that pass `keep`, best first by `rank` (bigger first), then the most
/// recently played; at most MAX_TRACKS. Empty if fewer than MIN_TRACKS pass.
fn pick<'a>(
    songs: HashMap<&'a str, Song<'a>>,
    keep: impl Fn(&Song) -> bool,
    rank: impl Fn(&Song) -> u32,
) -> Vec<MixTrack> {
    let mut list: Vec<Song> = songs.into_values().filter(|s| keep(s)).collect();
    if list.len() < MIN_TRACKS {
        return Vec::new();
    }
    list.sort_by(|a, b| {
        rank(b)
            .cmp(&rank(a))
            .then(b.latest.ts.cmp(&a.latest.ts))
            .then(a.latest.video_id.cmp(&b.latest.video_id))
    });
    list.truncate(MAX_TRACKS);
    list.into_iter()
        .map(|s| MixTrack {
            video_id: s.latest.video_id.clone(),
            title: s.latest.title.clone(),
            artist: s.latest.artist.clone(),
            album: s.latest.album.clone(),
            duration: s.latest.duration,
            artwork: s.artwork.to_owned(),
        })
        .collect()
}

/// The local hour (0-23) a play started in.
fn hour(p: &Play, tz_offset_secs: i64) -> i64 {
    (p.ts as i64 + tz_offset_secs).rem_euclid(DAY as i64) / 3600
}

/// Every mix there's enough history for. `today` is the start of the local day
/// (Unix seconds); later plays are left out.
fn compute(plays: &[Play], today: u64, tz_offset_secs: i64) -> Vec<Mix> {
    let before_today = || plays.iter().filter(move |p| p.ts < today);
    let between = move |from: u64, to: u64| plays.iter().filter(move |p| p.ts >= from && p.ts < to.min(today));
    let ago = |days: u64| today.saturating_sub(days * DAY);

    let mut out = Vec::new();
    let mut add = |id, title, description, tracks: Vec<MixTrack>| {
        if !tracks.is_empty() {
            out.push(Mix { id, title, description, tracks });
        }
    };

    add(
        "on-repeat",
        "On repeat",
        "What you've played most in the last 30 days",
        pick(songs(between(ago(30), today)), |s| s.counted >= 2, |s| s.counted),
    );

    // Loved once (played a lot), but not heard for two months.
    let all = songs(before_today());
    add(
        "forgotten-favourites",
        "Forgotten favourites",
        "Songs you used to play a lot and haven't heard in a while",
        pick(all, |s| s.counted >= 4 && s.latest.ts < ago(60), |s| s.counted),
    );

    let year_ago = ago(365);
    add(
        "this-time-last-year",
        "This time last year",
        "What you were playing around this time a year ago",
        pick(
            songs(between(year_ago.saturating_sub(14 * DAY), year_ago + 14 * DAY)),
            |s| s.counted >= 1,
            |s| s.counted,
        ),
    );

    add(
        "never-skipped",
        "Never skipped",
        "Songs you always listen to all the way through",
        pick(
            songs(before_today()),
            |s| s.recorded >= 3 && s.completed == s.recorded,
            |s| s.recorded,
        ),
    );

    let recent = || between(ago(90), today);
    add(
        "late-night",
        "Late night",
        "What you play after 10 pm",
        pick(
            songs(recent().filter(|p| {
                let h = hour(p, tz_offset_secs);
                !(4..22).contains(&h)
            })),
            |s| s.counted >= 2,
            |s| s.counted,
        ),
    );
    add(
        "mornings",
        "Mornings",
        "What you play to start the day",
        pick(
            songs(recent().filter(|p| (5..11).contains(&hour(p, tz_offset_secs)))),
            |s| s.counted >= 2,
            |s| s.counted,
        ),
    );

    out
}

/// The start of today, local time, in Unix seconds.
fn start_of_today(now: u64, tz_offset_secs: i64) -> u64 {
    let local = now as i64 + tz_offset_secs;
    (local - local.rem_euclid(DAY as i64) - tz_offset_secs).max(0) as u64
}

/// The "Made for you" mixes there's enough history for. `tzOffsetMinutes` is minutes
/// east of UTC (`-new Date().getTimezoneOffset()`), for "today" and the time-of-day mixes.
#[tauri::command]
pub fn history_mixes(app: AppHandle, tz_offset_minutes: Option<i64>) -> Vec<Mix> {
    let tz = tz_offset_minutes.unwrap_or(0) * 60;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    compute(&history::load(&app), start_of_today(now, tz), tz)
}

/// How many times each song has been played (plays that count), in the same order.
/// For "Liked, rarely played", which matches this against your Liked Songs.
#[tauri::command]
pub fn history_play_counts(app: AppHandle, video_ids: Vec<String>) -> Vec<u32> {
    let plays = history::load(&app);
    let mut counts: HashMap<&str, u32> = HashMap::new();
    for p in plays.iter().filter(|p| p.counted()) {
        *counts.entry(&p.video_id).or_default() += 1;
    }
    video_ids.iter().map(|id| counts.get(id.as_str()).copied().unwrap_or(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const TODAY: u64 = 1_735_689_600; // 2025-01-01 00:00 UTC

    fn play(id: usize, ts: u64, listened: u32) -> Play {
        Play {
            ts,
            video_id: format!("song{id:02}"),
            title: format!("Song {id}"),
            artist: "Band".into(),
            album: String::new(),
            duration: 200,
            listened,
            completed: listened >= 195,
            artwork: String::new(),
        }
    }

    fn ids(mixes: &[Mix], id: &str) -> Vec<String> {
        mixes
            .iter()
            .find(|m| m.id == id)
            .map(|m| m.tracks.iter().map(|t| t.video_id.clone()).collect())
            .unwrap_or_default()
    }

    #[test]
    fn on_repeat_ranks_by_plays_and_needs_enough_songs() {
        // 20 songs, each played twice in the last week; song 0 three times.
        let mut plays: Vec<Play> = (0..20)
            .flat_map(|i| [play(i, TODAY - 3 * DAY, 200), play(i, TODAY - 2 * DAY, 100)])
            .collect();
        plays.push(play(0, TODAY - DAY, 200));
        // Today's plays don't count yet; a skip doesn't count at all.
        plays.push(play(19, TODAY + 60, 200));
        plays.push(play(19, TODAY - DAY, 10));
        let mixes = compute(&plays, TODAY, 0);
        let on_repeat = ids(&mixes, "on-repeat");
        assert_eq!(on_repeat.len(), 20);
        assert_eq!(on_repeat[0], "song00");

        // Only 10 songs: not enough for a mix.
        let few: Vec<Play> = plays.iter().filter(|p| p.video_id.as_str() < "song10").cloned().collect();
        assert!(ids(&compute(&few, TODAY, 0), "on-repeat").is_empty());
    }

    #[test]
    fn forgotten_favourites_and_never_skipped() {
        let mut plays = Vec::new();
        for i in 0..16 {
            // Played to the end four times, 100 days ago.
            for d in 0..4 {
                plays.push(play(i, TODAY - (100 + d) * DAY, 200));
            }
        }
        // Song 15 came back last week: no longer forgotten, and once it was skipped.
        plays.push(play(15, TODAY - 7 * DAY, 20));
        let mixes = compute(&plays, TODAY, 0);
        let forgotten = ids(&mixes, "forgotten-favourites");
        assert_eq!(forgotten.len(), 15);
        assert!(!forgotten.contains(&"song15".to_string()));
        let never_skipped = ids(&mixes, "never-skipped");
        assert_eq!(never_skipped.len(), 15);
        assert!(!never_skipped.contains(&"song15".to_string()));
    }

    #[test]
    fn time_of_day_uses_local_time() {
        // 23:00 UTC is 01:00 at UTC+2: late night either way; 07:00 UTC is 09:00, a morning.
        let mut plays = Vec::new();
        for i in 0..15 {
            for d in 1..=2 {
                plays.push(play(i, TODAY - d * DAY + 23 * 3600 - DAY, 200));
                plays.push(play(i + 20, TODAY - d * DAY + 7 * 3600, 200));
            }
        }
        let mixes = compute(&plays, TODAY, 2 * 3600);
        assert_eq!(ids(&mixes, "late-night").len(), 15);
        assert_eq!(ids(&mixes, "mornings").len(), 15);
        assert!(ids(&mixes, "late-night").iter().all(|id| id < &"song15".to_string()));
    }

    #[test]
    fn start_of_today_in_local_time() {
        // 2025-01-01 01:00 UTC is still 2024-12-31 at UTC-5.
        assert_eq!(start_of_today(TODAY + 3600, 0), TODAY);
        assert_eq!(start_of_today(TODAY + 3600, -5 * 3600), TODAY - DAY + 5 * 3600);
    }
}
