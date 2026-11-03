//! Who sings which part: Genius marks song sections ("[Verse 1: Artist]").
//! Rust fetches them for the playing track; the page lines them up with the
//! timed lyrics and labels the parts.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::genius::{self, Section};
use super::normalize;
use crate::state::{AppState, MediaState};

const CACHE: &str = "parts";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PartsPayload {
    pub key: String,
    pub sections: Vec<Section>,
}

/// Tracks with more than one artist in their name: the ones parts matter for.
fn several_artists(m: &MediaState) -> bool {
    let all = format!(" {} {} ", m.artist, m.title).to_lowercase();
    [" feat", " ft.", " ft ", " & ", ", ", " x ", " и ", "при уч", " with ", " vs"].iter().any(|s| all.contains(s))
}

fn cache_path(app: &AppHandle, key: &str) -> std::path::PathBuf {
    let dir = app.state::<AppState>().data_dir.join(CACHE);
    let _ = std::fs::create_dir_all(&dir);
    let name: String = key.chars().map(|c| if c.is_alphanumeric() { c } else { '_' }).collect();
    dir.join(format!("{name}.json"))
}

fn publish(app: &AppHandle, payload: Option<PartsPayload>) {
    let state = app.state::<AppState>();
    if let Some(p) = &payload {
        if state.current_key().as_deref() != Some(p.key.as_str()) {
            return;
        }
    }
    *state.parts.lock().unwrap() = payload.clone();
    let _ = app.emit("lyrics:parts", payload);
}

/// Clears the parts of the previous track.
pub fn clear(app: &AppHandle) {
    publish(app, None);
}

/// Looks up the parts of the playing track when the settings ask for them.
/// Results, including "Genius has nothing", are cached per track.
pub fn annotate(app: AppHandle, media: MediaState) {
    let mode = app.state::<AppState>().settings.lock().unwrap().song_parts.clone();
    if mode == "off" || (mode == "duets" && !several_artists(&media)) {
        return clear(&app);
    }
    tauri::async_runtime::spawn(async move {
        let path = cache_path(&app, &media.key);
        let cached: Option<Vec<Section>> = std::fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str(&t).ok());
        let sections = match cached {
            Some(s) => s,
            None => {
                let http = app.state::<AppState>().http.clone();
                let title = normalize::clean_title(&media.title);
                let artist = normalize::primary_artist(&media.artist);
                let found = match genius::best_hit(&http, &artist, &title).await {
                    Ok(Some(hit)) => genius::page(&http, &hit.url).await.map(|html| genius::sections(&html)).unwrap_or_default(),
                    Ok(None) => Vec::new(),
                    Err(e) => {
                        crate::log_warn!("parts", "genius lookup failed: {e}");
                        return;
                    }
                };
                crate::log_info!("parts", "{} - {}: {} marked parts", media.artist, media.title, found.len());
                if let Ok(text) = serde_json::to_string(&found) {
                    let _ = std::fs::write(&path, text);
                }
                found
            }
        };
        if sections.is_empty() {
            return clear(&app);
        }
        publish(&app, Some(PartsPayload { key: media.key.clone(), sections }));
    });
}

/// Re-applies the setting to the playing track (after it changes).
pub fn refresh(app: &AppHandle) {
    let media = app.state::<AppState>().media.lock().unwrap().clone();
    match media {
        Some(m) if !m.title.is_empty() => annotate(app.clone(), m),
        _ => clear(app),
    }
}

/// Forgets cached parts for a track, so the next lookup asks Genius again.
pub fn forget(app: &AppHandle, key: &str) {
    let _ = std::fs::remove_file(cache_path(app, key));
}
