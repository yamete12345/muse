pub mod cache;
pub mod genius;
pub mod lrclib;
pub mod normalize;
pub mod search;

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::state::{AppState, LyricsPayload, MediaState};

pub(crate) fn payload(key: &str, kind: &str, text: String, source: &str) -> LyricsPayload {
    LyricsPayload { key: key.into(), kind: kind.into(), text, source: source.into() }
}

pub(crate) fn from_record(key: &str, r: lrclib::Record) -> LyricsPayload {
    if let Some(s) = r.synced_lyrics.clone().filter(|_| r.has_synced()) {
        payload(key, "synced", s, "lrclib")
    } else if r.instrumental {
        payload(key, "instrumental", String::new(), "lrclib")
    } else {
        payload(key, "plain", r.plain_lyrics.unwrap_or_default(), "lrclib")
    }
}

/// Resolves lyrics for a track in the background and emits `lyrics:loaded`.
/// Results for a track that is no longer playing are dropped.
pub fn request(app: AppHandle, media: MediaState) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let key = media.key.clone();
        let publish = |p: LyricsPayload| {
            if state.current_key().as_deref() != Some(p.key.as_str()) {
                return;
            }
            *state.lyrics.lock().unwrap() = Some(p.clone());
            let _ = app.emit("lyrics:loaded", Some(p));
        };

        let own = cache::load(&state.data_dir, cache::USER, &key);
        if let Some(p) = own.or_else(|| cache::load(&state.data_dir, cache::FOUND, &key)) {
            publish(p);
            return;
        }
        publish(payload(&key, "loading", String::new(), ""));

        // Players often publish the duration a moment after the title.
        tokio::time::sleep(Duration::from_millis(400)).await;
        let media = match state.media.lock().unwrap().clone() {
            Some(m) if m.key == key => m,
            _ => return,
        };

        let result = find(&state.http, &media).await;
        let p = result.unwrap_or_else(|| payload(&key, "none", String::new(), ""));
        crate::log_info!("lyrics", "{} - {}: {} from {}", media.artist, media.title, p.kind, if p.source.is_empty() { "nowhere" } else { &p.source });
        if p.kind != "none" {
            cache::store(&state.data_dir, cache::FOUND, &p);
        }
        publish(p);
    });
}

async fn find(http: &reqwest::Client, m: &MediaState) -> Option<LyricsPayload> {
    let key = &m.key;
    let duration = (m.duration_ms > 0).then(|| m.duration_ms as f64 / 1000.0);
    let title = normalize::clean_title(&m.title);
    let artist = normalize::primary_artist(&m.artist);

    // 1. Exact lookups.
    let exact = [(m.artist.as_str(), m.title.as_str()), (artist.as_str(), title.as_str())];
    let mut plain_fallback: Option<lrclib::Record> = None;
    if duration.is_some() {
        for (a, t) in exact {
            if let Ok(Some(r)) = lrclib::get(http, a, t, &m.album, duration).await {
                if r.has_synced() || r.instrumental {
                    return Some(from_record(key, r));
                }
                plain_fallback.get_or_insert(r);
            }
        }
    }

    // 2. Search, picking the closest synced match.
    let free_text = format!("{artist} {title}");
    let searches: [Vec<(&str, &str)>; 2] = [
        vec![("track_name", title.as_str()), ("artist_name", artist.as_str())],
        vec![("q", free_text.as_str())],
    ];
    for q in searches {
        if let Ok(list) = lrclib::search(http, &q).await {
            if let Some(r) = lrclib::pick_best(list, &artist, &title, duration) {
                if r.has_synced() || r.instrumental {
                    return Some(from_record(key, r));
                }
                plain_fallback.get_or_insert(r);
            }
        }
    }
    if let Some(r) = plain_fallback {
        return Some(from_record(key, r));
    }

    // 3. Genius, plain text only.
    match genius::fetch(http, &artist, &title).await {
        Ok(Some(text)) => Some(payload(key, "plain", text, "genius")),
        _ => None,
    }
}
