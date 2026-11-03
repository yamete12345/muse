//! Fallback source: plain (unsynced) lyrics scraped from genius.com.

use serde::{Deserialize, Serialize};
use scraper::{Html, Node, Selector};

use super::normalize::fold;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

pub struct Hit {
    pub title: String,
    pub artist: String,
    pub url: String,
}

/// Songs Genius finds for a free-text query, best first.
pub async fn search(http: &reqwest::Client, query: &str, limit: usize) -> reqwest::Result<Vec<Hit>> {
    // The endpoint rejects more than 5 per page (422).
    let per_page = limit.clamp(1, 5).to_string();
    let v: serde_json::Value = http
        .get("https://genius.com/api/search/multi")
        .query(&[("per_page", per_page.as_str()), ("q", query)])
        .header(reqwest::header::USER_AGENT, UA)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let mut out: Vec<Hit> = Vec::new();
    for section in v.pointer("/response/sections").and_then(|s| s.as_array()).into_iter().flatten() {
        for hit in section.get("hits").and_then(|h| h.as_array()).into_iter().flatten() {
            if hit.get("type").and_then(|t| t.as_str()) != Some("song") {
                continue;
            }
            let r = &hit["result"];
            let (Some(title), Some(url)) = (r.get("title").and_then(|s| s.as_str()), r.get("url").and_then(|u| u.as_str())) else {
                continue;
            };
            if out.iter().any(|h| h.url == url) {
                continue;
            }
            out.push(Hit {
                title: title.to_string(),
                artist: r.pointer("/primary_artist/name").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                url: url.to_string(),
            });
        }
    }
    out.truncate(limit);
    Ok(out)
}

/// The HTML of a Genius song page.
pub async fn page(http: &reqwest::Client, url: &str) -> reqwest::Result<String> {
    http.get(url).header(reqwest::header::USER_AGENT, UA).send().await?.error_for_status()?.text().await
}

/// Lyrics from a Genius song page.
pub async fn fetch_url(http: &reqwest::Client, url: &str) -> reqwest::Result<Option<String>> {
    Ok(extract(&page(http, url).await?))
}

/// The search hit for this artist and title, if Genius has the song.
pub async fn best_hit(http: &reqwest::Client, artist: &str, title: &str) -> reqwest::Result<Option<Hit>> {
    let (fa, ft) = (fold(artist), fold(title));
    let hits = search(http, &format!("{artist} {title}"), 5).await?;
    Ok(hits.into_iter().find(|h| {
        let (ha, ht) = (fold(&h.artist), fold(&h.title));
        let artist_ok = !ha.is_empty() && (ha.contains(&fa) || fa.contains(&ha));
        let title_ok = !ht.is_empty() && (ht.contains(&ft) || ft.contains(&ht));
        artist_ok && title_ok
    }))
}

pub async fn fetch(http: &reqwest::Client, artist: &str, title: &str) -> reqwest::Result<Option<String>> {
    match best_hit(http, artist, title).await? {
        Some(h) => fetch_url(http, &h.url).await,
        None => Ok(None),
    }
}

/// The lyrics containers' text, one line per line, section headers included.
fn raw_text(html: &str) -> Option<String> {
    let doc = Html::parse_document(html);
    let sel = Selector::parse(r#"div[data-lyrics-container="true"]"#).ok()?;
    let mut out = String::new();
    for container in doc.select(&sel) {
        for node in container.descendants() {
            let excluded = node.ancestors().any(|a| {
                a.value().as_element().is_some_and(|e| e.attr("data-exclude-from-selection").is_some())
            });
            if excluded {
                continue;
            }
            match node.value() {
                Node::Text(t) => out.push_str(t),
                Node::Element(e) if e.name() == "br" => out.push('\n'),
                _ => {}
            }
        }
        out.push('\n');
    }
    Some(out)
}

pub fn extract(html: &str) -> Option<String> {
    let out = raw_text(html)?;
    // Drop section headers like "[Chorus]" and keep one blank line between stanzas.
    let mut lines: Vec<&str> = Vec::new();
    for line in out.lines().map(str::trim) {
        if line.starts_with('[') && line.ends_with(']') {
            if lines.last().is_some_and(|l| !l.is_empty()) {
                lines.push("");
            }
            continue;
        }
        if line.is_empty() && lines.last().is_none_or(|l| l.is_empty()) {
            continue;
        }
        lines.push(line);
    }
    let text = lines.join("\n").trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// A part of a song as Genius marks it: "[Verse 1: Bradley Cooper]".
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    /// "Verse", "Chorus", "Куплет"... as written; empty before the first header.
    pub kind: String,
    pub number: Option<u32>,
    pub artists: Vec<String>,
    pub lines: Vec<String>,
}

/// Splits "[Kind N: A & B]" into its parts.
fn parse_header(line: &str) -> Option<(String, Option<u32>, Vec<String>)> {
    let inner = line.strip_prefix('[')?.strip_suffix(']')?.trim();
    let (head, who) = match inner.split_once(':') {
        Some((h, w)) => (h.trim(), w.trim()),
        None => (inner, ""),
    };
    let (kind, number) = match head.rsplit_once(' ') {
        Some((k, n)) if n.chars().all(|c| c.is_ascii_digit()) && !n.is_empty() => (k.trim(), n.parse().ok()),
        _ => (head, None),
    };
    let mut who = who.to_string();
    for sep in [" & ", " and ", " и ", " x ", " + ", " with ", " feat. ", " ft. ", "/"] {
        who = who.replace(sep, ",");
    }
    let artists = who
        .split(',')
        .map(|a| a.trim_matches(|c: char| c.is_whitespace() || matches!(c, '*' | '_' | '(' | ')')).to_string())
        .filter(|a| !a.is_empty())
        .collect();
    Some((kind.to_string(), number, artists))
}

/// The song split into its marked parts, in order.
pub fn sections(html: &str) -> Vec<Section> {
    let Some(text) = raw_text(html) else { return Vec::new() };
    let mut out: Vec<Section> = Vec::new();
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if line.starts_with('[') && line.ends_with(']') {
            if let Some((kind, number, artists)) = parse_header(line) {
                out.push(Section { kind, number, artists, lines: Vec::new() });
                continue;
            }
        }
        match out.last_mut() {
            Some(s) => s.lines.push(line.to_string()),
            None => out.push(Section { kind: String::new(), number: None, artists: Vec::new(), lines: vec![line.to_string()] }),
        }
    }
    out.retain(|s| !s.lines.is_empty());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_sections_with_singers() {
        let html = r#"<div data-lyrics-container="true">[Verse 1: Bradley Cooper]<br>Tell me something, girl<br>Are you happy<br><br>[Chorus: Lady Gaga &amp; Bradley Cooper]<br>I'm off the deep end<br>[Bridge]<br>Ooh</div>"#;
        let s = sections(html);
        assert_eq!(s.len(), 3);
        assert_eq!((s[0].kind.as_str(), s[0].number, s[0].artists.clone()), ("Verse", Some(1), vec!["Bradley Cooper".to_string()]));
        assert_eq!(s[0].lines, vec!["Tell me something, girl", "Are you happy"]);
        assert_eq!(s[1].artists, vec!["Lady Gaga", "Bradley Cooper"]);
        assert_eq!((s[2].kind.as_str(), s[2].artists.len()), ("Bridge", 0));
    }

    #[test]
    fn parses_russian_headers() {
        let (kind, number, artists) = parse_header("[Куплет 2: FACE и Морги]").unwrap();
        assert_eq!((kind.as_str(), number), ("Куплет", Some(2)));
        assert_eq!(artists, vec!["FACE", "Морги"]);
    }

    #[test]
    fn extracts_lyrics_containers() {
        let html = r#"<html><body>
            <div data-lyrics-container="true"><div data-exclude-from-selection="true">12 Contributors</div>[Verse 1]<br>Line one<br><a><span>Line two</span></a><br></div>
            <div data-lyrics-container="true">[Chorus]<br>Line three</div>
        </body></html>"#;
        assert_eq!(extract(html).as_deref(), Some("Line one\nLine two\n\nLine three"));
    }
}
