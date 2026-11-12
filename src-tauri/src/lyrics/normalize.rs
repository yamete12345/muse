//! Cleans up titles/artists reported by players so lyric lookups match.

use std::sync::LazyLock;

use regex::Regex;

static BRACKET_JUNK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\s*[\(\[][^\)\]]*\b(remaster(ed)?|live|version|edit|mix|mono|stereo|deluxe|bonus|demo|explicit|clean|official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|mv|feat\.?|ft\.?|prod\.?|with)\b[^\)\]]*[\)\]]",
    )
    .unwrap()
});
static DASH_JUNK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\s+-\s+((\d{4}\s+)?(digital\s+)?remaster(ed)?|live|mono|stereo|single|radio|edit|bonus|deluxe|acoustic|from\s).*$",
    )
    .unwrap()
});
static FEAT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\s+(feat\.?|ft\.?|featuring)\s+.*$").unwrap());
static ARTIST_SPLIT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\s*(,|;|/|\s&\s|\sx\s|\sи\s|\sfeat\.?\s|\sft\.?\s|\sfeaturing\s)\s*").unwrap()
});
static CHANNEL_SUFFIX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(\s*-\s*topic|vevo|\s*official)$").unwrap());
/// Versions of a song with the same words: remixes, sped up, slowed...
static VARIANT: LazyLock<Regex> = LazyLock::new(|| {
    let words = r"remix|rmx|flip|bootleg|sped\s*up|speed\s*up|slowed|reverb|nightcore|daycore|bass\s*boost(ed)?|8d";
    Regex::new(&format!(r"(?i)\s*[\(\[][^\)\]]*\b({words})\b[^\)\]]*[\)\]]|\s+-\s+[^-]*\b({words})\b.*$")).unwrap()
});
static TEMPO: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(sped\s*up|speed\s*up|slowed|nightcore|daycore)\b").unwrap());
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

pub fn clean_title(title: &str) -> String {
    let t = BRACKET_JUNK.replace_all(title, "");
    let t = DASH_JUNK.replace(&t, "");
    let t = FEAT.replace(&t, "");
    SPACES.replace_all(t.trim(), " ").into_owned()
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Variant {
    /// Same recording, faster or slower: timings scale with the duration.
    Tempo,
    /// Reworked: same words, different timing.
    Remix,
}

/// "Холод (flaksboi remix)" -> ("Холод", Remix); "Song (sped up)" -> ("Song", Tempo).
pub fn original_title(title: &str) -> Option<(String, Variant)> {
    let found = VARIANT.find(title)?;
    let variant = if TEMPO.is_match(found.as_str()) { Variant::Tempo } else { Variant::Remix };
    let rest = VARIANT.replace_all(title, "");
    let rest = clean_title(&rest);
    (!rest.is_empty()).then_some((rest, variant))
}

pub fn clean_artist(artist: &str) -> String {
    CHANNEL_SUFFIX.replace(artist.trim(), "").trim().to_string()
}

pub fn primary_artist(artist: &str) -> String {
    let a = clean_artist(artist);
    ARTIST_SPLIT.split(&a).next().unwrap_or("").trim().to_string()
}

/// Apple Music for Windows reports "Artist - Album" as the artist and no
/// album. Splits that back into the two (only the first dash: album names
/// such as "Song - Single" keep theirs).
pub fn split_artist_album(artist: &str) -> Option<(String, String)> {
    let (a, album) = artist.split_once(" - ").or_else(|| artist.split_once(" — "))?;
    let (a, album) = (a.trim(), album.trim());
    (!a.is_empty() && !album.is_empty()).then(|| (a.to_string(), album.to_string()))
}

/// Video sites report "Artist - Title (Official Video)" with the channel as the
/// artist. Splits that form when the artist looks like a channel name.
pub fn split_video_title(artist: &str, title: &str) -> (String, String) {
    let channelish = artist.trim().is_empty() || CHANNEL_SUFFIX.is_match(artist.trim());
    if let Some((left, right)) = title.split_once(" - ") {
        let a = fold(&clean_artist(artist));
        let left_matches = !a.is_empty() && fold(left).contains(&a);
        // A remixer's channel: "Artist - Song (Channel Remix)".
        let remixer = !a.is_empty() && VARIANT.find(right).is_some_and(|m| fold(m.as_str()).contains(&a));
        if channelish || left_matches || remixer {
            return (left.trim().to_string(), clean_title(right));
        }
    }
    (clean_artist(artist), title.trim().to_string())
}

pub fn fold(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

pub fn track_key(artist: &str, title: &str) -> String {
    format!("{}|{}", fold(&primary_artist(artist)), fold(&clean_title(title)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apple_music_artist_and_album() {
        assert_eq!(split_artist_album("ONDA ANDAR - KIDSCRY2DAY"), Some(("ONDA ANDAR".into(), "KIDSCRY2DAY".into())));
        assert_eq!(split_artist_album("Kai Angel - Flowers - Single"), Some(("Kai Angel".into(), "Flowers - Single".into())));
        assert_eq!(split_artist_album("9mice"), None);
    }

    #[test]
    fn keeps_meaningful_parentheses() {
        assert_eq!(clean_title("My Own Summer (Shove It)"), "My Own Summer (Shove It)");
    }

    #[test]
    fn strips_junk() {
        assert_eq!(clean_title("Paranoid Android (Remastered 2017)"), "Paranoid Android");
        assert_eq!(clean_title("Help! - Remastered 2009"), "Help!");
        assert_eq!(clean_title("Song (feat. Someone)"), "Song");
        assert_eq!(clean_title("Song feat. Someone"), "Song");
        assert_eq!(clean_title("Song [Official Music Video]"), "Song");
        assert_eq!(clean_title("Song - Live at Wembley"), "Song");
    }

    #[test]
    fn primary_artist_splits() {
        assert_eq!(primary_artist("Daft Punk, Pharrell Williams"), "Daft Punk");
        assert_eq!(primary_artist("Мот feat. Ани Лорак"), "Мот");
        assert_eq!(primary_artist("DeftonesVEVO"), "Deftones");
        assert_eq!(primary_artist("Deftones - Topic"), "Deftones");
    }

    #[test]
    fn splits_video_titles() {
        assert_eq!(
            split_video_title("DeftonesVEVO", "Deftones - Change (In the House of Flies) (Official Music Video)"),
            ("Deftones".to_string(), "Change (In the House of Flies)".to_string())
        );
        assert_eq!(
            split_video_title("Deftones", "My Own Summer (Shove It)"),
            ("Deftones".to_string(), "My Own Summer (Shove It)".to_string())
        );
    }

    #[test]
    fn finds_the_original_of_versions() {
        assert_eq!(original_title("Холод / Diamond (flaksboi remix)"), Some(("Холод / Diamond".to_string(), Variant::Remix)));
        assert_eq!(original_title("Song (Sped Up)"), Some(("Song".to_string(), Variant::Tempo)));
        assert_eq!(original_title("Song - slowed + reverb"), Some(("Song".to_string(), Variant::Tempo)));
        assert_eq!(original_title("Song [Nightcore]"), Some(("Song".to_string(), Variant::Tempo)));
        assert_eq!(original_title("My Own Summer (Shove It)"), None);
        assert_eq!(original_title("Remix"), None);
        // The uploader is the remixer, not the artist.
        assert_eq!(
            split_video_title("flaksboi", "KAI ANGEL feat. КОРЕШ - Холод / Diamond (flaksboi remix)"),
            ("KAI ANGEL feat. КОРЕШ".to_string(), "Холод / Diamond (flaksboi remix)".to_string())
        );
    }

    #[test]
    fn key_is_stable() {
        assert_eq!(track_key("Deftones", "My Own Summer (Shove It) - 2005 Remaster"), track_key("deftones", "My Own Summer (Shove It)"));
    }
}
