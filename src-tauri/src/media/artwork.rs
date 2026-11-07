//! Large artwork for the shown track. Players hand Windows a small thumbnail
//! (often 200–300 px), which shows its pixels once the wallpaper stretches it
//! over half the screen. The same cover usually sits in the iTunes and Deezer
//! catalogues at 1000 px: it is fetched by artist and title, and only taken
//! when the catalogue entry is clearly the same song.

use std::collections::HashMap;
use std::sync::Mutex;

use base64::Engine;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::lyrics::normalize::{clean_title, fold, primary_artist};
use crate::state::{AppState, CoverPayload, MediaState};

/// A thumbnail at least this wide already looks sharp enough.
const SHARP_PX: u32 = 600;
/// Results per track (None: nothing found), so a song coming back costs nothing.
static FOUND: Mutex<Option<HashMap<String, Option<String>>>> = Mutex::new(None);
const KEEP: usize = 60;

/// Width × height of a PNG, JPEG or WebP, from its header.
pub fn image_size(b: &[u8]) -> Option<(u32, u32)> {
    if b.starts_with(&[0x89, b'P', b'N', b'G']) && b.len() >= 24 {
        let be = |i: usize| u32::from_be_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]);
        return Some((be(16), be(20)));
    }
    if b.starts_with(b"RIFF") && b.len() >= 30 && &b[8..12] == b"WEBP" {
        let le24 = |i: usize| u32::from(b[i]) | u32::from(b[i + 1]) << 8 | u32::from(b[i + 2]) << 16;
        return match &b[12..16] {
            b"VP8X" => Some((le24(24) + 1, le24(27) + 1)),
            b"VP8 " => Some((u32::from(u16::from_le_bytes([b[26], b[27]]) & 0x3fff), u32::from(u16::from_le_bytes([b[28], b[29]]) & 0x3fff))),
            b"VP8L" => {
                let v = u32::from_le_bytes([b[21], b[22], b[23], b[24]]);
                Some(((v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1))
            }
            _ => None,
        };
    }
    if b.starts_with(&[0xff, 0xd8]) {
        // Walk the JPEG segments to the frame header (SOF0..SOF15, not DHT/JPG/DAC).
        let mut i = 2;
        while i + 9 < b.len() {
            if b[i] != 0xff {
                i += 1;
                continue;
            }
            let marker = b[i + 1];
            let len = usize::from(u16::from_be_bytes([b[i + 2], b[i + 3]]));
            if (0xc0..=0xcf).contains(&marker) && ![0xc4, 0xc8, 0xcc].contains(&marker) {
                let h = u32::from(u16::from_be_bytes([b[i + 5], b[i + 6]]));
                let w = u32::from(u16::from_be_bytes([b[i + 7], b[i + 8]]));
                return Some((w, h));
            }
            i += 2 + len;
        }
    }
    None
}

/// Whether a catalogue entry is the song that plays.
fn same_song(want_artist: &str, want_title: &str, artist: &str, title: &str) -> bool {
    let (wa, wt) = (fold(want_artist), fold(want_title));
    let (a, t) = (fold(artist), fold(&clean_title(title)));
    if wa.is_empty() || wt.is_empty() || a.is_empty() || t.is_empty() {
        return false;
    }
    let artist_ok = a.contains(&wa) || wa.contains(&a);
    let title_ok = t == wt || (wt.chars().count() >= 4 && (t.starts_with(&wt) || wt.starts_with(&t)));
    artist_ok && title_ok
}

#[derive(Deserialize)]
struct ItunesResults {
    results: Vec<ItunesSong>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ItunesSong {
    #[serde(default)]
    artist_name: String,
    #[serde(default)]
    track_name: String,
    #[serde(default)]
    artwork_url100: String,
}

#[derive(Deserialize)]
struct DeezerResults {
    #[serde(default)]
    data: Vec<DeezerSong>,
}

#[derive(Deserialize)]
struct DeezerSong {
    #[serde(default)]
    title: String,
    artist: DeezerName,
    album: DeezerAlbum,
}

#[derive(Deserialize)]
struct DeezerName {
    #[serde(default)]
    name: String,
}

#[derive(Deserialize)]
struct DeezerAlbum {
    #[serde(default)]
    cover_xl: String,
}

/// The address of a 1000 px cover for the song, if a catalogue has it.
async fn artwork_url(http: &reqwest::Client, artist: &str, title: &str) -> Option<String> {
    let term = format!("{artist} {title}");
    if let Ok(r) = http
        .get("https://itunes.apple.com/search")
        .query(&[("term", term.as_str()), ("entity", "song"), ("limit", "15")])
        .send()
        .await
    {
        if let Ok(list) = r.json::<ItunesResults>().await {
            let hit = list.results.into_iter().find(|s| !s.artwork_url100.is_empty() && same_song(artist, title, &s.artist_name, &s.track_name));
            if let Some(s) = hit {
                return Some(s.artwork_url100.replace("100x100bb", "1000x1000bb"));
            }
        }
    }
    let q = format!("artist:\"{artist}\" track:\"{title}\"");
    let r = http.get("https://api.deezer.com/search").query(&[("q", q.as_str()), ("limit", "10")]).send().await.ok()?;
    let list = r.json::<DeezerResults>().await.ok()?;
    list.data
        .into_iter()
        .find(|s| !s.album.cover_xl.is_empty() && same_song(artist, title, &s.artist.name, &s.title))
        .map(|s| s.album.cover_xl)
}

async fn fetch(http: &reqwest::Client, m: &MediaState) -> Option<String> {
    let artist = primary_artist(&m.artist);
    let title = clean_title(&m.title);
    let url = artwork_url(http, &artist, &title).await?;
    let bytes = http.get(&url).send().await.ok()?.error_for_status().ok()?.bytes().await.ok()?;
    let (w, _) = image_size(&bytes)?;
    (w >= SHARP_PX).then(|| format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

/// Swaps a small (or missing) thumbnail for large artwork, in the background.
/// `thumb` is the player's thumbnail, if any.
pub fn upgrade(app: &AppHandle, m: &MediaState, thumb: Option<&[u8]>) {
    if m.title.is_empty() || thumb.and_then(image_size).is_some_and(|(w, _)| w >= SHARP_PX) {
        return;
    }
    let cached = FOUND.lock().unwrap().as_ref().and_then(|c| c.get(&m.key).cloned());
    let (app, m) = (app.clone(), m.clone());
    tauri::async_runtime::spawn(async move {
        let url = match cached {
            Some(hit) => hit,
            None => {
                let http = app.state::<AppState>().http.clone();
                let hit = fetch(&http, &m).await;
                let mut found = FOUND.lock().unwrap();
                let map = found.get_or_insert_with(HashMap::new);
                if map.len() >= KEEP {
                    map.clear();
                }
                map.insert(m.key.clone(), hit.clone());
                crate::log_info!("cover", "{} - {}: {}", m.artist, m.title, if hit.is_some() { "large artwork" } else { "no large artwork" });
                hit
            }
        };
        let Some(data_url) = url else { return };
        let state = app.state::<AppState>();
        // Still the same song?
        if state.current_key().as_deref() != Some(m.key.as_str()) {
            return;
        }
        let payload = CoverPayload { key: m.key.clone(), data_url };
        *state.cover.lock().unwrap() = Some(payload.clone());
        let _ = app.emit("media:cover", payload);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_image_sizes() {
        let mut png = vec![0x89, b'P', b'N', b'G', 13, 10, 26, 10, 0, 0, 0, 13, b'I', b'H', b'D', b'R'];
        png.extend_from_slice(&300u32.to_be_bytes());
        png.extend_from_slice(&200u32.to_be_bytes());
        assert_eq!(image_size(&png), Some((300, 200)));
        // SOI, an APP0 segment of 4 bytes, then SOF0 with 8-bit precision, 256 high, 512 wide.
        let jpg = [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 1, 0, 2, 0, 3, 0, 0];
        assert_eq!(image_size(&jpg), Some((512, 256)));
    }

    #[test]
    fn takes_only_the_same_song() {
        assert!(same_song("Kai Angel", "TV", "Kai Angel", "TV"));
        assert!(same_song("Daft Punk", "Get Lucky", "Daft Punk", "Get Lucky (feat. Pharrell Williams)"));
        assert!(same_song("Pharaoh", "Позволив", "PHARAOH", "Позволив"));
        assert!(!same_song("Kai Angel", "TV", "Kai Angel", "Diamond"));
        assert!(!same_song("Kai Angel", "TV", "Someone Else", "TV"));
    }
}
