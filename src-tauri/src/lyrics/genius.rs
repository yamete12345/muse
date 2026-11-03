//! Fallback source: plain (unsynced) lyrics scraped from genius.com.

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

/// Lyrics from a Genius song page.
pub async fn fetch_url(http: &reqwest::Client, url: &str) -> reqwest::Result<Option<String>> {
    let html = http
        .get(url)
        .header(reqwest::header::USER_AGENT, UA)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    Ok(extract(&html))
}

pub async fn fetch(http: &reqwest::Client, artist: &str, title: &str) -> reqwest::Result<Option<String>> {
    let (fa, ft) = (fold(artist), fold(title));
    let hits = search(http, &format!("{artist} {title}"), 5).await?;
    let hit = hits.into_iter().find(|h| {
        let (ha, ht) = (fold(&h.artist), fold(&h.title));
        let artist_ok = !ha.is_empty() && (ha.contains(&fa) || fa.contains(&ha));
        let title_ok = !ht.is_empty() && (ht.contains(&ft) || ft.contains(&ht));
        artist_ok && title_ok
    });
    match hit {
        Some(h) => fetch_url(http, &h.url).await,
        None => Ok(None),
    }
}

pub fn extract(html: &str) -> Option<String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_lyrics_containers() {
        let html = r#"<html><body>
            <div data-lyrics-container="true"><div data-exclude-from-selection="true">12 Contributors</div>[Verse 1]<br>Line one<br><a><span>Line two</span></a><br></div>
            <div data-lyrics-container="true">[Chorus]<br>Line three</div>
        </body></html>"#;
        assert_eq!(extract(html).as_deref(), Some("Line one\nLine two\n\nLine three"));
    }
}
