use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use windows::Media::Control::GlobalSystemMediaTransportControlsSession;

use crate::settings::Settings;

/// Raw state reported by the media session. The frontend extrapolates
/// the position from `updated_at_ms` because sessions report it rarely.
#[derive(Clone, Serialize, PartialEq, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    pub key: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: i64,
    pub position_ms: i64,
    pub updated_at_ms: i64,
    pub playing: bool,
    pub rate: f64,
    pub can_seek: bool,
    pub app: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LyricsPayload {
    pub key: String,
    /// "loading" | "synced" | "plain" | "instrumental" | "none"
    pub kind: String,
    pub text: String,
    /// "lrclib" | "genius" | "user" | ""
    pub source: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverPayload {
    pub key: String,
    pub data_url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub media: Option<MediaState>,
    pub cover: Option<CoverPayload>,
    pub lyrics: Option<LyricsPayload>,
    pub settings: Settings,
    pub offset_ms: i64,
}

pub struct AppState {
    pub data_dir: PathBuf,
    pub http: reqwest::Client,
    pub media: Mutex<Option<MediaState>>,
    pub cover: Mutex<Option<CoverPayload>>,
    pub lyrics: Mutex<Option<LyricsPayload>>,
    pub settings: Mutex<Settings>,
    pub offsets: Mutex<HashMap<String, i64>>,
    pub session: Mutex<Option<GlobalSystemMediaTransportControlsSession>>,
}

impl AppState {
    pub fn current_key(&self) -> Option<String> {
        self.media.lock().unwrap().as_ref().map(|m| m.key.clone())
    }

    pub fn offset_for(&self, key: &str) -> i64 {
        self.offsets.lock().unwrap().get(key).copied().unwrap_or(0)
    }

    pub fn snapshot(&self) -> Snapshot {
        let media = self.media.lock().unwrap().clone();
        let offset_ms = media.as_ref().map(|m| self.offset_for(&m.key)).unwrap_or(0);
        Snapshot {
            media,
            cover: self.cover.lock().unwrap().clone(),
            lyrics: self.lyrics.lock().unwrap().clone(),
            settings: self.settings.lock().unwrap().clone(),
            offset_ms,
        }
    }
}
