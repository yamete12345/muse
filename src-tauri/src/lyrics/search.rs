//! Manual lyrics search: when the automatic pick is wrong, the user searches
//! lrclib and Genius and picks the right result. The pick replaces the cached
//! lyrics for the track.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::{cache, from_record, genius, lrclib, normalize::fold, payload};
use crate::state::{AppState, LyricsPayload};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub id: usize,
    /// "lrclib" | "genius"
    pub source: &'static str,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Seconds, when the source knows it.
    pub duration: Option<f64>,
    /// "synced" | "plain" | "instrumental"
    pub kind: &'static str,
    /// The first couple of lines, to tell versions apart.
    pub preview: String,
}

enum Pick {
    Lrclib(lrclib::Record),
    Genius(String),
}

/// Results of the last search; choosing goes by index into this list, so the
/// page never hands lyrics or URLs back to Rust.
static LAST: Mutex<Vec<Pick>> = Mutex::new(Vec::new());

fn preview(text: &str) -> String {
    text.lines()
        .map(|l| l.trim_start_matches(|c: char| c == '[' || c.is_ascii_digit() || c == ':' || c == '.' || c == ']').trim())
        .filter(|l| !l.is_empty())
        .take(2)
        .collect::<Vec<_>>()
        .join(" / ")
}

pub async fn search(app: &AppHandle, query: &str) -> Result<Vec<Candidate>, String> {
    let state = app.state::<AppState>();
    let http = state.http.clone();
    let duration = state.media.lock().unwrap().as_ref().and_then(|m| (m.duration_ms > 0).then(|| m.duration_ms as f64 / 1000.0));
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let lrclib_query = [("q", query)];
    let (lrc, gen) = tokio::join!(lrclib::search(&http, &lrclib_query), genius::search(&http, query, 5));
    if let (Err(a), Err(b)) = (&lrc, &gen) {
        crate::log_warn!("lyrics", "manual search failed: lrclib: {a}; genius: {b}");
        return Err("lrclib и Genius сейчас не отвечают, попробуйте чуть позже".into());
    }
    let mut records = lrc.unwrap_or_else(|e| {
        crate::log_warn!("lyrics", "lrclib search failed: {e}");
        Vec::new()
    });
    records.retain(lrclib::Record::usable);
    // Synced first, then the ones whose length matches the playing track.
    records.sort_by(|a, b| {
        let rank = |r: &lrclib::Record| {
            let synced = if r.has_synced() { 0.0 } else { 1000.0 };
            let off = match (duration, r.duration) {
                (Some(d), Some(rd)) => (d - rd).abs().min(999.0),
                _ => 500.0,
            };
            synced + off
        };
        rank(a).total_cmp(&rank(b))
    });
    records.truncate(25);

    let mut picks = Vec::new();
    let mut out = Vec::new();
    for r in records {
        let kind = if r.has_synced() { "synced" } else if r.instrumental { "instrumental" } else { "plain" };
        let text = r.synced_lyrics.as_deref().filter(|_| r.has_synced()).or(r.plain_lyrics.as_deref()).unwrap_or("");
        out.push(Candidate {
            id: out.len(),
            source: "lrclib",
            title: r.track_name.clone(),
            artist: r.artist_name.clone(),
            album: r.album_name.clone(),
            duration: r.duration,
            kind,
            preview: preview(text),
        });
        picks.push(Pick::Lrclib(r));
    }

    // Genius songs that lrclib did not already cover.
    let seen: Vec<(String, String)> = out.iter().map(|c| (fold(&c.artist), fold(&c.title))).collect();
    for hit in gen.unwrap_or_else(|e| {
        crate::log_warn!("lyrics", "genius search failed: {e}");
        Vec::new()
    }) {
        if seen.contains(&(fold(&hit.artist), fold(&hit.title))) {
            continue;
        }
        out.push(Candidate {
            id: out.len(),
            source: "genius",
            title: hit.title,
            artist: hit.artist,
            album: String::new(),
            duration: None,
            kind: "plain",
            preview: String::new(),
        });
        picks.push(Pick::Genius(hit.url));
    }

    crate::log_info!("lyrics", "manual search \"{query}\": {} results", out.len());
    *LAST.lock().unwrap() = picks;
    Ok(out)
}

/// Uses result `id` of the last search for the playing track.
pub async fn choose(app: &AppHandle, id: usize) -> Result<LyricsPayload, String> {
    let state = app.state::<AppState>();
    let key = state.current_key().ok_or("сейчас ничего не играет")?;
    let pick = {
        let last = LAST.lock().unwrap();
        match last.get(id).ok_or("результат поиска устарел, поищите ещё раз")? {
            Pick::Lrclib(r) => Pick::Lrclib(r.clone()),
            Pick::Genius(u) => Pick::Genius(u.clone()),
        }
    };
    let p = match pick {
        Pick::Lrclib(r) => from_record(&key, r),
        Pick::Genius(url) => {
            let text = genius::fetch_url(&state.http, &url)
                .await
                .map_err(|e| format!("Genius не ответил: {e}"))?
                .ok_or("на странице Genius не нашлось текста")?;
            payload(&key, "plain", text, "genius")
        }
    };

    // The pick wins over anything found or written before for this track.
    cache::remove(&state.data_dir, cache::USER, &key);
    cache::store(&state.data_dir, cache::FOUND, &p);
    *state.lyrics.lock().unwrap() = Some(p.clone());
    let _ = app.emit("lyrics:loaded", Some(p.clone()));
    crate::log_info!("lyrics", "picked {} lyrics ({}) for {key}", p.source, p.kind);
    Ok(p)
}
