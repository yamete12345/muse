use serde::Deserialize;

use super::normalize::fold;

const BASE: &str = "https://lrclib.net/api";

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    #[serde(default)]
    pub track_name: String,
    #[serde(default)]
    pub artist_name: String,
    pub duration: Option<f64>,
    #[serde(default)]
    pub instrumental: bool,
    pub plain_lyrics: Option<String>,
    pub synced_lyrics: Option<String>,
}

impl Record {
    pub fn has_synced(&self) -> bool {
        self.synced_lyrics.as_deref().is_some_and(|s| !s.trim().is_empty())
    }
    pub fn has_plain(&self) -> bool {
        self.plain_lyrics.as_deref().is_some_and(|s| !s.trim().is_empty())
    }
    pub fn usable(&self) -> bool {
        self.instrumental || self.has_synced() || self.has_plain()
    }
}

pub async fn get(
    http: &reqwest::Client,
    artist: &str,
    title: &str,
    album: &str,
    duration_s: Option<f64>,
) -> reqwest::Result<Option<Record>> {
    let mut q: Vec<(&str, String)> = vec![("artist_name", artist.into()), ("track_name", title.into())];
    if !album.trim().is_empty() {
        q.push(("album_name", album.into()));
    }
    if let Some(d) = duration_s {
        q.push(("duration", format!("{}", d.round() as i64)));
    }
    let resp = http.get(format!("{BASE}/get")).query(&q).send().await?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let rec: Record = resp.error_for_status()?.json().await?;
    Ok(Some(rec).filter(Record::usable))
}

pub async fn search(http: &reqwest::Client, query: &[(&str, &str)]) -> reqwest::Result<Vec<Record>> {
    http.get(format!("{BASE}/search")).query(query).send().await?.error_for_status()?.json().await
}

/// Picks the record that best matches the track: synced lyrics first, then
/// closeness of duration and names.
pub fn pick_best(records: Vec<Record>, artist: &str, title: &str, duration_s: Option<f64>) -> Option<Record> {
    let (fa, ft) = (fold(artist), fold(title));
    records
        .into_iter()
        .filter(Record::usable)
        .filter_map(|r| {
            let mut score = if r.has_synced() { 100.0 } else if r.has_plain() { 40.0 } else { 30.0 };
            if let (Some(d), Some(rd)) = (duration_s, r.duration) {
                let diff = (d - rd).abs();
                if diff > 10.0 {
                    return None;
                }
                score -= diff * 5.0;
            }
            let (ra, rt) = (fold(&r.artist_name), fold(&r.track_name));
            score += if rt == ft { 30.0 } else if rt.contains(&ft) || ft.contains(&rt) { 10.0 } else { -40.0 };
            score += if ra == fa { 30.0 } else if ra.contains(&fa) || fa.contains(&ra) { 10.0 } else { -40.0 };
            Some((score, r))
        })
        .max_by(|a, b| a.0.total_cmp(&b.0))
        .filter(|(score, _)| *score > 0.0)
        .map(|(_, r)| r)
}
