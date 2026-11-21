//! Library data: our UI asks for a YouTube Music "browse" page (Liked Songs, a
//! playlist, an album…); the bridge fetches it from inside music.youtube.com, using
//! the page's own signed-in session, and hands the raw JSON back here.

use std::{collections::HashMap, sync::Mutex, time::Duration};

use serde_json::{Value, json};
use tauri::{AppHandle, State};
use tokio::sync::oneshot;

use crate::player::player_window;

type Reply = Result<Value, String>;

/// Requests waiting for the bridge to answer, by id.
#[derive(Default)]
pub struct Pending(Mutex<(u64, HashMap<u64, oneshot::Sender<Reply>>)>);

const TIMEOUT: Duration = Duration::from_secs(30);

/// Fetch one browse page or search. `request` is `{browseId, params?}`,
/// `{query, params?}` (a search) or `{continuation, search?}` (the next batch of
/// either; `search: true` for search results).
#[tauri::command]
pub async fn browse(app: AppHandle, pending: State<'_, Pending>, request: Value) -> Reply {
    // Rebuild the request from known string fields only.
    let field = |k: &str| request.get(k).and_then(Value::as_str).map(str::to_owned);
    let search = request
        .get("search")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let clean = match (field("browseId"), field("query"), field("continuation")) {
        (Some(id), _, _) => json!({ "browseId": id, "params": field("params") }),
        (None, Some(query), _) => json!({ "query": query, "params": field("params") }),
        (None, None, Some(token)) => json!({ "continuation": token, "search": search }),
        _ => return Err("browse needs a browseId, a query or a continuation".into()),
    };

    let started = std::time::Instant::now();
    let reply = ask(&app, &pending, |id| {
        // `clean` is serialized by serde_json, so it is a JSON literal, never code.
        format!("window.__ytmn ? window.__ytmn.browse({id}, {clean}) : 0;")
    })
    .await;
    if log::log_enabled!(log::Level::Debug) {
        let what = clean
            .get("browseId")
            .and_then(Value::as_str)
            .or(clean.get("query").map(|_| "(search)"))
            .unwrap_or("(continuation)");
        let outcome = match &reply {
            Ok(_) => "ok".to_owned(),
            Err(e) => format!("FAILED: {e}"),
        };
        log::debug!(
            "[browse] {what} {outcome} in {} ms",
            started.elapsed().as_millis()
        );
    }
    reply
}

/// YouTube Music actions our UI may take, besides reading pages: liking songs,
/// editing your playlists (and seeing which ones hold a song) and finding lyrics. Anything else is refused.
const ACTIONS: &[&str] = &[
    "next",
    "like/like",
    "like/removelike",
    "browse/edit_playlist",
    "playlist/create",
    "playlist/delete",
    "playlist/get_add_to_playlist",
];

/// Call one of `ACTIONS` with a JSON body (the page adds its own session context).
#[tauri::command]
pub async fn ytm_call(app: AppHandle, pending: State<'_, Pending>, endpoint: String, body: Value) -> Reply {
    if !ACTIONS.contains(&endpoint.as_str()) {
        return Err(format!("{endpoint} isn't an allowed action"));
    }
    if !body.is_object() {
        return Err("the body must be a JSON object".into());
    }
    let endpoint = Value::String(endpoint);
    let reply = ask(&app, &pending, |id| {
        // Both are serialized by serde_json, so they are JSON literals, never code.
        format!("window.__ytmn ? window.__ytmn.call({id}, {endpoint}, {body}) : 0;")
    })
    .await;
    if log::log_enabled!(log::Level::Debug) {
        let outcome = match &reply {
            Ok(_) => "ok".to_owned(),
            Err(e) => format!("FAILED: {e}"),
        };
        log::debug!("[call] {endpoint} {outcome}");
    }
    reply
}

/// Run `js(id)` in the player window and wait for the bridge to answer request `id`.
async fn ask(app: &AppHandle, pending: &Pending, js: impl FnOnce(u64) -> String) -> Reply {
    let (tx, rx) = oneshot::channel();
    let id = {
        let mut p = pending.0.lock().unwrap();
        p.0 += 1;
        let id = p.0;
        p.1.insert(id, tx);
        id
    };
    if let Err(e) = player_window(app).and_then(|w| w.eval(js(id)).map_err(|e| e.to_string())) {
        pending.0.lock().unwrap().1.remove(&id);
        return Err(e);
    }
    match tokio::time::timeout(TIMEOUT, rx).await {
        Ok(Ok(reply)) => reply,
        _ => {
            pending.0.lock().unwrap().1.remove(&id);
            Err("YouTube Music didn't answer in time".into())
        }
    }
}

/// Detail from our UI (navigation, clicks) for the log: the dev terminal, and the log
/// file in verbose mode. Errors and warnings go through `settings::ui_log` instead.
#[tauri::command]
pub fn dev_log(message: String) {
    let message: String = message.chars().take(4000).collect();
    log::debug!("[ui] {message}");
}

/// The bridge's answer to `browse`, delivered through `player_event`.
pub fn resolve(pending: &Pending, data: &Value) {
    let Some(id) = data.get("id").and_then(Value::as_u64) else {
        return;
    };
    let Some(tx) = pending.0.lock().unwrap().1.remove(&id) else {
        return;
    };
    let reply = match data.get("error").and_then(Value::as_str) {
        Some(err) => Err(err.to_owned()),
        None => Ok(data.get("body").cloned().unwrap_or(Value::Null)),
    };
    let _ = tx.send(reply);
}

/// Development only: save a real response as a test fixture. These contain personal
/// data, so they go to a gitignored folder and never ship.
#[tauri::command]
pub fn dev_save_fixture(name: String, data: Value) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("only available in development builds".into());
    }
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("bad fixture name".into());
    }
    let dir =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/lib/ytm/__fixtures__/raw");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{name}.json")), text).map_err(|e| e.to_string())
}
