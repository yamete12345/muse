use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::state::LyricsPayload;

fn hash(key: &str) -> u64 {
    // FNV-1a: stable across runs, unlike std's RandomState.
    key.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3))
}

/// Lyrics found online; safe to drop and re-fetch.
pub const FOUND: &str = "lyrics";
/// Lyrics written by the user; never overwritten by lookups.
pub const USER: &str = "user";

fn lyrics_path(dir: &Path, kind: &str, key: &str) -> PathBuf {
    dir.join(kind).join(format!("{:016x}.json", hash(key)))
}

pub fn load(dir: &Path, kind: &str, key: &str) -> Option<LyricsPayload> {
    let text = std::fs::read_to_string(lyrics_path(dir, kind, key)).ok()?;
    let p: LyricsPayload = serde_json::from_str(&text).ok()?;
    (p.key == key).then_some(p)
}

pub fn store(dir: &Path, kind: &str, p: &LyricsPayload) {
    let path = lyrics_path(dir, kind, &p.key);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string(p) {
        let _ = std::fs::write(path, text);
    }
}

pub fn remove(dir: &Path, kind: &str, key: &str) {
    let _ = std::fs::remove_file(lyrics_path(dir, kind, key));
}

pub fn load_offsets(dir: &Path) -> HashMap<String, i64> {
    std::fs::read_to_string(dir.join("offsets.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save_offsets(dir: &Path, offsets: &HashMap<String, i64>) {
    if let Ok(text) = serde_json::to_string_pretty(offsets) {
        let _ = std::fs::write(dir.join("offsets.json"), text);
    }
}
