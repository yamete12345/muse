pub mod cache;
pub mod genius;
pub mod lrclib;
pub mod normalize;
pub mod parts;
pub mod search;

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::state::{AppState, LyricsPayload, MediaState};

pub(crate) fn payload(key: &str, kind: &str, text: String, source: &str) -> LyricsPayload {
    LyricsPayload { key: key.into(), kind: kind.into(), text, source: source.into(), note: String::new() }
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
            let synced = p.kind == "synced";
            *state.lyrics.lock().unwrap() = Some(p.clone());
            let _ = app.emit("lyrics:loaded", Some(p));
            if synced {
                parts::annotate(app.clone(), media.clone());
            }
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
    // 3. A sped up or slowed version: the original's synced lyrics, stretched
    // to this tempo, beat this version's own unsynced text.
    // From the raw title: cleaning drops "(Sped Up Version)" as a mere version.
    let original = normalize::original_title(&m.title);
    if let (Some((orig, normalize::Variant::Tempo)), Some(d)) = (&original, duration) {
        if let Some(p) = original_stretched(http, key, &artist, orig, &m.title, d).await {
            return Some(p);
        }
    }
    if let Some(r) = plain_fallback {
        return Some(from_record(key, r));
    }

    // 4. Genius, plain text only.
    if let Ok(Some(text)) = genius::fetch(http, &artist, &title).await {
        return Some(payload(key, "plain", text, "genius"));
    }

    // 5. A remix nobody has lyrics for: the original's words, without timings.
    let (orig, _) = original?;
    let mut p = original_plain(http, key, &artist, &orig).await?;
    p.note = "Текст оригинала: в этой версии может отличаться".into();
    Some(p)
}

/// The original's synced lyrics with every timestamp scaled to `duration_s`.
async fn original_stretched(http: &reqwest::Client, key: &str, artist: &str, title: &str, raw_title: &str, duration_s: f64) -> Option<LyricsPayload> {
    let q = [("track_name", title), ("artist_name", artist)];
    let list = lrclib::search(http, &q).await.ok()?;
    // Sped up versions are shorter than the original, slowed ones longer;
    // that also tells a radio edit from the album version.
    let faster = !regex::Regex::new(r"(?i)slowed|daycore").unwrap().is_match(raw_title);
    let fits = |r: &lrclib::Record| {
        r.duration.filter(|d| *d > 0.0).is_some_and(|d| {
            let f = duration_s / d;
            // Beyond this it is not the same recording at another speed.
            if faster { (0.6..0.98).contains(&f) } else { (1.02..1.5).contains(&f) }
        })
    };
    let r = lrclib::pick_best(list.into_iter().filter(|r| r.has_synced() && fits(r)).collect(), artist, title, None)?;
    let factor = duration_s / r.duration?;
    let text = stretch_lrc(r.synced_lyrics.as_deref()?, factor);
    let mut p = payload(key, "synced", text, "lrclib");
    p.note = format!("Текст оригинала, тайминги под скорость ×{:.2}", 1.0 / factor);
    Some(p)
}

/// The original's words as plain text (lrclib, then Genius).
async fn original_plain(http: &reqwest::Client, key: &str, artist: &str, title: &str) -> Option<LyricsPayload> {
    let q = [("track_name", title), ("artist_name", artist)];
    if let Ok(list) = lrclib::search(http, &q).await {
        if let Some(r) = lrclib::pick_best(list, artist, title, None) {
            let text = match (&r.plain_lyrics, &r.synced_lyrics) {
                (Some(p), _) if !p.trim().is_empty() => p.clone(),
                (_, Some(s)) => strip_lrc(s),
                _ => String::new(),
            };
            if !text.trim().is_empty() {
                return Some(payload(key, "plain", text, "lrclib"));
            }
        }
    }
    match genius::fetch(http, artist, title).await {
        Ok(Some(text)) => Some(payload(key, "plain", text, "genius")),
        _ => None,
    }
}

static STAMP: std::sync::LazyLock<regex::Regex> =
    std::sync::LazyLock::new(|| regex::Regex::new(r"([\[<])(\d+):(\d+(?:\.\d+)?)([\]>])").unwrap());

/// Scales `[mm:ss.xx]` and word `<mm:ss.xx>` stamps by `factor`.
fn stretch_lrc(text: &str, factor: f64) -> String {
    STAMP
        .replace_all(text, |c: &regex::Captures| {
            let secs = c[2].parse::<f64>().unwrap_or(0.0) * 60.0 + c[3].parse::<f64>().unwrap_or(0.0);
            let t = (secs * factor * 100.0).round() as i64;
            format!("{}{:02}:{:02}.{:02}{}", &c[1], t / 6000, (t / 100) % 60, t % 100, &c[4])
        })
        .into_owned()
}

/// Synced lyrics without their stamps.
fn strip_lrc(text: &str) -> String {
    text.lines()
        .map(|l| STAMP.replace_all(l, "").trim().to_string())
        .filter(|l| !l.starts_with('[') || !l.contains(':'))
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stretches_and_strips_lrc() {
        assert_eq!(stretch_lrc("[01:00.00]Hi <01:01.00>there", 0.8), "[00:48.00]Hi <00:48.80>there");
        assert_eq!(strip_lrc("[ar:Someone]\n[00:01.00]Hi\n[00:02.50]There"), "Hi\nThere");
    }
}

#[cfg(test)]
mod online {
    use super::*;

    fn media(title: &str, duration_ms: i64) -> MediaState {
        MediaState { key: "k".into(), title: title.into(), artist: "Daft Punk".into(), duration_ms, playing: true, rate: 1.0, ..Default::default() }
    }

    /// Talks to lrclib: `cargo test --lib online -- --ignored`.
    #[test]
    #[ignore]
    fn versions_get_the_originals_lyrics() {
        let http = reqwest::Client::builder().user_agent("MUSE tests").build().unwrap();
        tauri::async_runtime::block_on(async {
            // Get Lucky is ~369 s on the album; sped up by 1.25 it lasts ~295 s.
            let p = find(&http, &media("Get Lucky (sped up)", 295_000)).await.expect("sped up");
            eprintln!("{} {} {}", p.kind, p.note, p.text.lines().nth(3).unwrap_or(""));
            assert_eq!(p.kind, "synced");
            assert!(p.note.contains("скорость"));
            assert!(p.note.contains("×1."), "faster than the original: {}", p.note);
            let p = find(&http, &media("Get Lucky (Some Producer Remix)", 412_000)).await.expect("remix");
            eprintln!("{} {} {}", p.kind, p.note, p.text.lines().next().unwrap_or(""));
            assert_eq!(p.kind, "plain");
            assert!(p.note.contains("оригинала"));
        });
    }
}
