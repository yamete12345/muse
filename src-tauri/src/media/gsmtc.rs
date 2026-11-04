//! Watches Windows' Global System Media Transport Controls (the media flyout)
//! and mirrors the active session into `AppState`, emitting events to the UI.

use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::time::Duration;

use base64::Engine;
use tauri::{AppHandle, Emitter, Manager};
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    CurrentSessionChangedEventArgs, GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as SessionManager,
    GlobalSystemMediaTransportControlsSessionMediaProperties as Props,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status, MediaPropertiesChangedEventArgs,
    PlaybackInfoChangedEventArgs, SessionsChangedEventArgs, TimelinePropertiesChangedEventArgs,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

use crate::lyrics::normalize;
use crate::state::{AppState, CoverPayload, MediaState};

/// 1601-01-01 → 1970-01-01 in 100 ns ticks.
const EPOCH_DIFF_TICKS: i64 = 116_444_736_000_000_000;

enum Sig {
    Sessions,
    Props,
    Info,
}

/// A session we are subscribed to; handlers are removed on drop.
struct Watched {
    session: Session,
    id: String,
    unsubscribe: Vec<Box<dyn FnOnce()>>,
}

impl Watched {
    fn new(session: Session, tx: &Sender<Sig>) -> windows::core::Result<Self> {
        let id = app_id(&session);
        let mut unsubscribe: Vec<Box<dyn FnOnce()>> = Vec::new();

        let t = tx.clone();
        let token = session.MediaPropertiesChanged(&TypedEventHandler::<Session, MediaPropertiesChangedEventArgs>::new(
            move |_, _| {
                let _ = t.send(Sig::Props);
                Ok(())
            },
        ))?;
        let s = session.clone();
        unsubscribe.push(Box::new(move || {
            let _ = s.RemoveMediaPropertiesChanged(token);
        }));

        let t = tx.clone();
        let token = session.PlaybackInfoChanged(&TypedEventHandler::<Session, PlaybackInfoChangedEventArgs>::new(
            move |_, _| {
                let _ = t.send(Sig::Info);
                Ok(())
            },
        ))?;
        let s = session.clone();
        unsubscribe.push(Box::new(move || {
            let _ = s.RemovePlaybackInfoChanged(token);
        }));

        let t = tx.clone();
        let token = session.TimelinePropertiesChanged(
            &TypedEventHandler::<Session, TimelinePropertiesChangedEventArgs>::new(move |_, _| {
                let _ = t.send(Sig::Info);
                Ok(())
            }),
        )?;
        let s = session.clone();
        unsubscribe.push(Box::new(move || {
            let _ = s.RemoveTimelinePropertiesChanged(token);
        }));

        Ok(Self { session, id, unsubscribe })
    }
}

impl Drop for Watched {
    fn drop(&mut self) {
        for f in self.unsubscribe.drain(..) {
            f();
        }
    }
}

struct TrackProps {
    props: Props,
    title: String,
    artist: String,
    album: String,
}

/// App ids in the media flyout (in Windows' order, one per app) and the one shown.
static KNOWN: std::sync::Mutex<(Vec<String>, String)> = std::sync::Mutex::new((Vec::new(), String::new()));

fn session_ids(m: &SessionManager) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    if let Ok(list) = m.GetSessions() {
        for s in list {
            let id = app_id(&s);
            if !id.is_empty() && !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    ids
}

/// Sources for the tray: (app id, readable name, shown now).
pub fn known_sources() -> Vec<(String, String, bool)> {
    let (ids, shown) = KNOWN.lock().unwrap().clone();
    ids.into_iter()
        .map(|id| {
            let name = display_name(&id);
            let is_shown = id == shown;
            (id, name, is_shown)
        })
        .collect()
}

/// Shows the next source (Ctrl+Alt+S), keeping it shown.
pub fn cycle(app: &AppHandle) {
    let (ids, shown) = KNOWN.lock().unwrap().clone();
    if ids.len() < 2 {
        return;
    }
    let pinned = app.state::<AppState>().settings.lock().unwrap().media_source.clone();
    let current = if ids.contains(&pinned) { pinned } else { shown };
    let next = ids.iter().position(|id| *id == current).map(|i| (i + 1) % ids.len()).unwrap_or(0);
    let _ = crate::settings::update(app, serde_json::json!({ "mediaSource": ids[next] }));
}

/// Lets other code nudge the watcher to pick the session again at once.
static WAKE: std::sync::Mutex<Option<Sender<Sig>>> = std::sync::Mutex::new(None);

/// Re-picks the session now (the chosen source changed).
pub fn wake() {
    if let Some(tx) = WAKE.lock().unwrap().as_ref() {
        let _ = tx.send(Sig::Sessions);
    }
}

pub fn spawn(app: AppHandle) {
    let _ = std::thread::Builder::new().name("gsmtc".into()).spawn(move || {
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        loop {
            if let Err(e) = run(&app) {
                crate::log_error!("media", "watcher failed: {e:?}");
            }
            std::thread::sleep(Duration::from_secs(3));
        }
    });
}

fn app_id(s: &Session) -> String {
    s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default()
}

fn is_playing(s: &Session) -> bool {
    s.GetPlaybackInfo()
        .and_then(|i| i.PlaybackStatus())
        .map(|st| st == Status::Playing)
        .unwrap_or(false)
}

/// The source picked in settings while it is open, even paused. Otherwise
/// prefers whatever is actually playing, but sticks to the watched session
/// while nothing else plays so pausing does not lose the lyrics.
fn pick_session(m: &SessionManager, watched: Option<&str>, pinned: &str) -> Option<Session> {
    let list: Vec<Session> = m.GetSessions().map(|l| l.into_iter().collect()).unwrap_or_default();
    let current = m.GetCurrentSession().ok();
    let by_id = |id: &str| list.iter().find(|s| app_id(s) == id).cloned();

    if !pinned.is_empty() {
        let mine: Vec<&Session> = list.iter().filter(|s| app_id(s) == pinned).collect();
        if let Some(p) = mine.iter().find(|s| is_playing(s)).or(mine.first()) {
            return Some((*p).clone());
        }
    }

    if let Some(w) = watched.and_then(by_id) {
        if is_playing(&w) {
            return Some(w);
        }
    }
    if let Some(c) = current.as_ref().filter(|c| is_playing(c)) {
        return Some(c.clone());
    }
    if let Some(p) = list.iter().find(|s| is_playing(s)) {
        return Some(p.clone());
    }
    watched.and_then(by_id).or(current).or_else(|| list.first().cloned())
}

fn read_props(s: &Session) -> windows::core::Result<TrackProps> {
    let props = s.TryGetMediaPropertiesAsync()?.get()?;
    let title = props.Title()?.to_string();
    let mut artist = props.Artist()?.to_string();
    if artist.trim().is_empty() {
        artist = props.AlbumArtist().map(|h| h.to_string()).unwrap_or_default();
    }
    let album = props.AlbumTitle().map(|h| h.to_string()).unwrap_or_default();
    Ok(TrackProps { props, title, artist, album })
}

fn read_thumbnail(props: &Props) -> Option<Vec<u8>> {
    let reference = props.Thumbnail().ok()?;
    let stream = reference.OpenReadAsync().ok()?.get().ok()?;
    let size = stream.Size().ok()? as u32;
    if size == 0 {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    reader.LoadAsync(size).ok()?.get().ok()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf).ok()?;
    Some(buf)
}

fn data_url(bytes: &[u8]) -> String {
    let mime = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.starts_with(b"RIFF") {
        "image/webp"
    } else {
        "image/jpeg"
    };
    format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn read_state(s: &Session, id: &str, p: &TrackProps) -> windows::core::Result<MediaState> {
    let info = s.GetPlaybackInfo()?;
    let playing = info.PlaybackStatus()? == Status::Playing;
    let rate = info.PlaybackRate().ok().and_then(|r| r.Value().ok()).unwrap_or(1.0);
    let can_seek = info.Controls().and_then(|c| c.IsPlaybackPositionEnabled()).unwrap_or(false);

    let tl = s.GetTimelineProperties()?;
    let start = tl.StartTime()?.Duration;
    let end = tl.EndTime()?.Duration;
    let pos = tl.Position()?.Duration;
    let updated = tl.LastUpdatedTime()?.UniversalTime;
    let updated_at_ms = if updated > EPOCH_DIFF_TICKS { (updated - EPOCH_DIFF_TICKS) / 10_000 } else { 0 };

    let (artist, title) = normalize::split_video_title(&p.artist, &p.title);
    Ok(MediaState {
        key: normalize::track_key(&artist, &title),
        title,
        artist,
        album: p.album.clone(),
        duration_ms: ((end - start).max(0)) / 10_000,
        position_ms: ((pos - start).max(0)) / 10_000,
        updated_at_ms,
        playing,
        rate: if rate > 0.0 { rate } else { 1.0 },
        can_seek,
        app: id.to_string(),
        app_name: display_name(id),
    })
}

fn run(app: &AppHandle) -> windows::core::Result<()> {
    let state = app.state::<AppState>();
    let manager = SessionManager::RequestAsync()?.get()?;
    let (tx, rx) = mpsc::channel::<Sig>();
    *WAKE.lock().unwrap() = Some(tx.clone());

    let t = tx.clone();
    let tok_current = manager.CurrentSessionChanged(
        &TypedEventHandler::<SessionManager, CurrentSessionChangedEventArgs>::new(move |_, _| {
            let _ = t.send(Sig::Sessions);
            Ok(())
        }),
    )?;
    let t = tx.clone();
    let tok_sessions = manager.SessionsChanged(&TypedEventHandler::<SessionManager, SessionsChangedEventArgs>::new(
        move |_, _| {
            let _ = t.send(Sig::Sessions);
            Ok(())
        },
    ))?;

    let mut watched: Option<Watched> = None;
    let mut props: Option<TrackProps> = None;
    let mut need_props = true;
    // Cover bookkeeping: some players publish the thumbnail after the title.
    let mut cover_key = String::new();
    let mut cover_len = 0usize;
    let mut cover_tries = 0u32;
    let mut last_key = String::new();

    let result = loop {
        let pinned = state.settings.lock().unwrap().media_source.clone();
        let session = pick_session(&manager, watched.as_ref().map(|w| w.id.as_str()), &pinned);
        let changed = match (&watched, &session) {
            (Some(w), Some(s)) => w.id != app_id(s),
            (None, None) => false,
            _ => true,
        };
        if changed {
            watched = match session {
                Some(s) => Some(Watched::new(s, &tx)?),
                None => None,
            };
            *state.session.lock().unwrap() = watched.as_ref().map(|w| w.session.clone());
            need_props = true;
        }
        // The tray's source list follows the apps in the media flyout.
        let ids = session_ids(&manager);
        let shown = watched.as_ref().map(|w| w.id.clone()).unwrap_or_default();
        let known_changed = {
            let mut k = KNOWN.lock().unwrap();
            let fresh = (ids, shown);
            let differs = *k != fresh;
            *k = fresh;
            differs
        };
        if known_changed {
            crate::tray::refresh(app);
        }

        match &watched {
            Some(w) => {
                if need_props {
                    props = read_props(&w.session).ok();
                    need_props = false;
                    cover_tries = 0;
                }
                if let Some(p) = &props {
                    if let Ok(ms) = read_state(&w.session, &w.id, p) {
                        let key_changed = ms.key != last_key;
                        if key_changed {
                            last_key = ms.key.clone();
                            cover_len = 0;
                            cover_tries = 0;
                        }
                        publish_media(app, &state, Some(ms.clone()), key_changed);

                        if cover_tries < 6 && !ms.title.is_empty() {
                            cover_tries += 1;
                            if let Some(bytes) = read_thumbnail(&p.props) {
                                if cover_key != ms.key || cover_len != bytes.len() {
                                    cover_key = ms.key.clone();
                                    cover_len = bytes.len();
                                    cover_tries = 6;
                                    let payload = CoverPayload { key: ms.key.clone(), data_url: data_url(&bytes) };
                                    *state.cover.lock().unwrap() = Some(payload.clone());
                                    let _ = app.emit("media:cover", payload);
                                }
                            } else if key_changed {
                                *state.cover.lock().unwrap() = None;
                                let _ = app.emit("media:cover", CoverPayload { key: ms.key.clone(), data_url: String::new() });
                            }
                        }
                    }
                }
            }
            None => {
                if !last_key.is_empty() {
                    last_key.clear();
                    publish_media(app, &state, None, true);
                }
            }
        }

        // Wait for an event, or poll once a second as a safety net.
        match rx.recv_timeout(Duration::from_millis(1000)) {
            Ok(sig) => {
                let mut sigs = vec![sig];
                std::thread::sleep(Duration::from_millis(40));
                sigs.extend(rx.try_iter());
                for s in sigs {
                    match s {
                        Sig::Props => {
                            need_props = true;
                        }
                        Sig::Sessions | Sig::Info => {}
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break Ok(()),
        }
    };

    let _ = manager.RemoveCurrentSessionChanged(tok_current);
    let _ = manager.RemoveSessionsChanged(tok_sessions);
    result
}

fn publish_media(app: &AppHandle, state: &AppState, ms: Option<MediaState>, key_changed: bool) {
    {
        let mut cur = state.media.lock().unwrap();
        if *cur == ms {
            return;
        }
        *cur = ms.clone();
    }
    let _ = app.emit("media:state", &ms);
    if key_changed {
        // The previous track's parts go now; the new ones arrive with its lyrics.
        crate::lyrics::parts::clear(app);
        match ms {
            Some(m) if !m.title.is_empty() => {
                let _ = app.emit("offset:changed", state.offset_for(&m.key));
                crate::lyrics::request(app.clone(), m);
                crate::tray::refresh(app);
            }
            _ => {
                *state.lyrics.lock().unwrap() = None;
                let _ = app.emit("lyrics:loaded", Option::<crate::state::LyricsPayload>::None);
            }
        }
    }
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaSource {
    pub app_id: String,
    /// "Яндекс Музыка", "Google Chrome"...
    pub name: String,
    pub title: String,
    pub artist: String,
    pub playing: bool,
    /// MUSE shows this one right now.
    pub shown: bool,
    /// Key for `source_cover`; empty when the player has no picture yet.
    pub cover: String,
}

/// Recent source covers as data URLs, by track. Kept small: a cover is
/// fetched once per track, not on every refresh of the list.
static COVERS: std::sync::Mutex<Vec<(String, String)>> = std::sync::Mutex::new(Vec::new());
const COVERS_KEPT: usize = 12;

pub fn source_cover(key: &str) -> Option<String> {
    COVERS.lock().unwrap().iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
}

/// Every app showing in Windows' media flyout right now, for the source picker.
pub fn sources(app: &AppHandle) -> Vec<MediaSource> {
    let shown_id = app.state::<AppState>().session.lock().unwrap().as_ref().map(app_id).unwrap_or_default();
    std::thread::spawn(move || {
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        let Ok(manager) = SessionManager::RequestAsync().and_then(|op| op.get()) else { return Vec::new() };
        let all: Vec<Session> = manager.GetSessions().map(|l| l.into_iter().collect()).unwrap_or_default();
        // One entry per app (a browser may have a session per tab): the playing
        // one, in Windows' order so the covers do not jump around.
        let mut list: Vec<(String, Session)> = Vec::new();
        for s in all {
            let id = app_id(&s);
            if id.is_empty() {
                continue;
            }
            match list.iter_mut().find(|(i, _)| *i == id) {
                Some(entry) => {
                    if !is_playing(&entry.1) && is_playing(&s) {
                        entry.1 = s;
                    }
                }
                None => list.push((id, s)),
            }
        }
        let mut out: Vec<MediaSource> = Vec::new();
        for (id, s) in list {
            let props = read_props(&s).ok();
            let (artist, title) = props.as_ref().map(|p| normalize::split_video_title(&p.artist, &p.title)).unwrap_or_default();
            let key = format!("{id}|{artist}|{title}");
            let mut cover = String::new();
            if source_cover(&key).is_some() {
                cover = key;
            } else if let Some(bytes) = props.as_ref().and_then(|p| read_thumbnail(&p.props)) {
                let mut covers = COVERS.lock().unwrap();
                covers.push((key.clone(), data_url(&bytes)));
                let extra = covers.len().saturating_sub(COVERS_KEPT);
                covers.drain(..extra);
                cover = key;
            }
            out.push(MediaSource { name: display_name(&id), shown: id == shown_id, playing: is_playing(&s), app_id: id, title, artist, cover });
        }
        out
    })
    .join()
    .unwrap_or_default()
}

/// A readable name for an app id: what Windows calls the app, or a cleaned-up id.
pub fn display_name(id: &str) -> String {
    static NAMES: std::sync::Mutex<Vec<(String, String)>> = std::sync::Mutex::new(Vec::new());
    if let Some((_, n)) = NAMES.lock().unwrap().iter().find(|(k, _)| k == id) {
        return n.clone();
    }
    let name = lookup_name(id);
    NAMES.lock().unwrap().push((id.to_string(), name.clone()));
    name
}

fn lookup_name(id: &str) -> String {
    let lower = id.to_lowercase();
    const KNOWN: [(&str, &str); 12] = [
        ("ru.yandex.desktop.music", "Яндекс Музыка"),
        ("yandex", "Яндекс"),
        ("chrome", "Google Chrome"),
        ("msedge", "Microsoft Edge"),
        ("firefox", "Firefox"),
        ("308046b0af4a39cb", "Firefox"),
        ("opera", "Opera"),
        ("brave", "Brave"),
        ("spotify", "Spotify"),
        ("applemusic", "Apple Music"),
        ("telegram", "Telegram"),
        ("vlc", "VLC"),
    ];
    if let Some((_, name)) = KNOWN.iter().find(|(k, _)| lower.contains(k)) {
        return name.to_string();
    }
    if let Ok(name) = windows::ApplicationModel::AppInfo::GetFromAppUserModelId(&windows::core::HSTRING::from(id))
        .and_then(|info| info.DisplayInfo())
        .and_then(|d| d.DisplayName())
    {
        let name = name.to_string();
        if !name.trim().is_empty() {
            return name;
        }
    }
    // "SomeVendor.Player_8wekyb3d8bbwe!App" / "C:\Apps\player.exe" -> "Player"
    let tail = id.rsplit(['\\', '/']).next().unwrap_or(id);
    let tail = tail.trim_end_matches(".exe").trim_end_matches(".EXE");
    let base = tail.split('!').next().unwrap_or(tail);
    let base = base.split('_').next().unwrap_or(base);
    let word = base.rsplit('.').find(|w| !w.is_empty() && !["desktop", "app", "exe"].contains(&w.to_lowercase().as_str())).unwrap_or(base);
    let mut c = word.chars();
    match c.next() {
        Some(f) => f.to_uppercase().chain(c).collect(),
        None => id.to_string(),
    }
}
