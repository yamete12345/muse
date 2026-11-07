#[macro_use]
mod audio;
mod logger;
mod lyrics;
mod media;
mod settings;
mod state;
mod tray;
mod updater;
mod wallpaper;
mod widget;

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use settings::Settings;
use state::{AppState, LyricsPayload, Snapshot};

const OFFSET_STEP_MS: i64 = 100;

#[tauri::command]
fn get_snapshot(state: State<'_, AppState>) -> Snapshot {
    state.snapshot()
}

// Async on purpose: sync commands run on the main thread, and creating the
// widget window from there deadlocks the event loop on Windows.
#[tauri::command]
async fn set_settings(app: AppHandle, patch: serde_json::Value) -> Result<Settings, String> {
    settings::update(&app, patch)
}

#[tauri::command]
async fn set_widget_geometry(app: AppHandle, x: f64, y: f64, width: f64, height: f64) {
    widget::set_geometry(&app, x, y, width, height);
}

#[tauri::command]
async fn get_widget_geometry(app: AppHandle) -> Option<widget::Geometry> {
    widget::geometry(&app)
}

#[tauri::command]
async fn search_lyrics(app: AppHandle, query: String) -> Result<Vec<lyrics::search::Candidate>, String> {
    lyrics::search::search(&app, &query).await
}

#[tauri::command]
async fn choose_lyrics(app: AppHandle, id: usize) -> Result<LyricsPayload, String> {
    lyrics::search::choose(&app, id).await
}

/// Errors from the pages end up in the same log as Rust's.
#[tauri::command]
fn log_frontend(level: String, message: String) {
    let level = if level == "error" { "ERROR" } else { "WARN" };
    logger::write(level, "page", &message.chars().take(2000).collect::<String>());
}

#[tauri::command]
fn open_log(app: AppHandle) {
    let dir = app.state::<AppState>().data_dir.clone();
    let path = logger::file_path(&dir);
    if !path.exists() {
        let _ = std::fs::write(&path, "");
    }
    updater::shell_open(&path.to_string_lossy());
}

#[tauri::command]
fn open_log_folder(app: AppHandle) {
    let dir = app.state::<AppState>().data_dir.clone();
    updater::shell_open(&logger::dir(&dir).to_string_lossy());
}

/// Saves a share picture (PNG, base64) to Pictures\MUSE and returns its path.
#[tauri::command]
async fn save_share_image(app: AppHandle, png_base64: String, name: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(png_base64).map_err(|e| e.to_string())?;
    let dir = app.path().picture_dir().map_err(|e| e.to_string())?.join("MUSE");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Keep the name to safe characters; the page builds it from the track title.
    let safe: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.') { c } else { '_' })
        .collect::<String>()
        .trim()
        .chars()
        .take(90)
        .collect();
    let path = dir.join(format!("{}.png", if safe.is_empty() { "MUSE" } else { &safe }));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    log_info!("share", "saved {}", path.display());
    Ok(path.to_string_lossy().to_string())
}

/// Opens Explorer with a saved share picture selected.
#[tauri::command]
fn reveal_file(app: AppHandle, path: String) -> Result<(), String> {
    // Only files MUSE itself wrote to Pictures\MUSE.
    let dir = app.path().picture_dir().map_err(|e| e.to_string())?.join("MUSE");
    let p = std::path::PathBuf::from(&path);
    if !p.starts_with(&dir) {
        return Err("not a MUSE picture".into());
    }
    let _ = std::process::Command::new("explorer").arg("/select,").arg(&p).spawn();
    Ok(())
}

#[tauri::command]
async fn list_media_sources(app: AppHandle) -> Vec<media::gsmtc::MediaSource> {
    media::gsmtc::sources(&app)
}

#[tauri::command]
fn source_cover(key: String) -> Option<String> {
    media::gsmtc::source_cover(&key)
}

#[tauri::command]
async fn check_update(app: AppHandle) -> Result<updater::UpdateInfo, String> {
    updater::check(&app).await
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    updater::install(&app).await
}

#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    updater::open_link(&url)
}

#[tauri::command]
async fn list_monitors(app: AppHandle) -> Vec<wallpaper::MonitorInfo> {
    wallpaper::monitors(&app)
}

/// Stores lyrics written by the user for the current track; they win over any source.
#[tauri::command]
async fn save_user_lyrics(app: AppHandle, kind: String, text: String) -> Result<(), String> {
    if kind != "synced" && kind != "plain" {
        return Err(format!("unsupported lyrics kind: {kind}"));
    }
    let state = app.state::<AppState>();
    let key = state.current_key().ok_or("nothing is playing")?;
    let payload = LyricsPayload { key, kind, text, source: "user".into(), note: String::new() };
    lyrics::cache::store(&state.data_dir, lyrics::cache::USER, &payload);
    *state.lyrics.lock().unwrap() = Some(payload.clone());
    let synced = payload.kind == "synced";
    let _ = app.emit("lyrics:loaded", Some(payload));
    if let Some(m) = state.media.lock().unwrap().clone().filter(|_| synced) {
        lyrics::parts::annotate(app.clone(), m);
    }
    Ok(())
}

#[tauri::command]
async fn delete_user_lyrics(app: AppHandle) {
    let state = app.state::<AppState>();
    let media = state.media.lock().unwrap().clone();
    if let Some(m) = media {
        lyrics::cache::remove(&state.data_dir, lyrics::cache::USER, &m.key);
        lyrics::request(app.clone(), m);
    }
}

pub(crate) fn change_offset(app: &AppHandle, f: impl FnOnce(i64) -> i64) -> Option<i64> {
    let state = app.state::<AppState>();
    let key = state.current_key()?;
    let value = {
        let mut offsets = state.offsets.lock().unwrap();
        let v = f(offsets.get(&key).copied().unwrap_or(0)).clamp(-30_000, 30_000);
        if v == 0 {
            offsets.remove(&key);
        } else {
            offsets.insert(key, v);
        }
        lyrics::cache::save_offsets(&state.data_dir, &offsets);
        v
    };
    let _ = app.emit("offset:changed", value);
    tray::refresh(app);
    Some(value)
}

#[tauri::command]
fn set_offset(app: AppHandle, ms: i64) -> i64 {
    change_offset(&app, |_| ms).unwrap_or(0)
}

/// Relative change, so quick repeated clicks all count.
#[tauri::command]
fn shift_offset(app: AppHandle, delta: i64) -> i64 {
    change_offset(&app, |v| v + delta).unwrap_or(0)
}

/// Forgets the cached lyrics of the playing track and looks them up again.
pub(crate) fn retry(app: &AppHandle) {
    let state = app.state::<AppState>();
    let media = state.media.lock().unwrap().clone();
    if let Some(m) = media {
        lyrics::cache::remove(&state.data_dir, lyrics::cache::FOUND, &m.key);
        lyrics::parts::forget(app, &m.key);
        lyrics::request(app.clone(), m);
    }
}

#[tauri::command]
fn retry_lyrics(app: AppHandle) {
    retry(&app);
}

fn shortcuts() -> [(Shortcut, &'static str); 6] {
    let mods = Some(Modifiers::CONTROL | Modifiers::ALT);
    [
        (Shortcut::new(mods, Code::KeyL), "toggle"),
        (Shortcut::new(mods, Code::ArrowRight), "next"),
        (Shortcut::new(mods, Code::ArrowLeft), "prev"),
        (Shortcut::new(mods, Code::BracketLeft), "later"),
        (Shortcut::new(mods, Code::BracketRight), "earlier"),
        (Shortcut::new(mods, Code::KeyS), "source"),
    ]
}

/// The app used to be called mutxt: carry its settings, lyrics and offsets over.
fn migrate_data_dir(dir: &std::path::Path) {
    if dir.exists() {
        return;
    }
    if let Some(old) = dir.parent().map(|p| p.join("com.mutxt.app")) {
        if old.is_dir() {
            let _ = std::fs::rename(&old, dir);
        }
    }
}

/// A window shows (or stops showing) the background that pulses to the beat.
#[tauri::command]
fn listen_beat(window: tauri::Window, on: bool) {
    audio::want(window.label(), on);
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_main(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    match shortcuts().iter().find(|(s, _)| s == shortcut).map(|(_, a)| *a) {
                        Some("toggle") => tray::toggle_main(app),
                        Some("source") => media::gsmtc::cycle(app),
                        Some("next") => media::commands::skip(app, true),
                        Some("prev") => media::commands::skip(app, false),
                        Some("later") => {
                            change_offset(app, |v| v - OFFSET_STEP_MS);
                        }
                        Some("earlier") => {
                            change_offset(app, |v| v + OFFSET_STEP_MS);
                        }
                        _ => {}
                    }
                })
                .build(),
        )
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            migrate_data_dir(&data_dir);
            std::fs::create_dir_all(&data_dir)?;
            logger::init(&data_dir);
            log_info!("app", "MUSE {} starting", env!("CARGO_PKG_VERSION"));

            let mut settings = settings::load(&data_dir);
            settings.autostart = app.autolaunch().is_enabled().unwrap_or(false);

            let http = reqwest::Client::builder()
                .user_agent(concat!("MUSE/", env!("CARGO_PKG_VERSION"), " (https://github.com/yamete12345/muse)"))
                .timeout(std::time::Duration::from_secs(10))
                .build()?;

            app.manage(AppState {
                offsets: Mutex::new(lyrics::cache::load_offsets(&data_dir)),
                data_dir,
                http,
                media: Mutex::new(None),
                cover: Mutex::new(None),
                lyrics: Mutex::new(None),
                parts: Mutex::new(None),
                settings: Mutex::new(settings),
                session: Mutex::new(None),
            });

            let handle = app.handle();
            tray::create(handle)?;
            for (s, _) in shortcuts() {
                let _ = handle.global_shortcut().register(s);
            }
            media::gsmtc::spawn(handle.clone());
            audio::spawn(handle.clone());
            widget::sync(handle);
            wallpaper::sync(handle);
            wallpaper::spawn_watcher(handle.clone());
            updater::spawn_checker(handle.clone());

            if !std::env::args().any(|a| a == "--hidden") {
                tray::show_main(handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            ("main", WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let to_tray = window.app_handle().state::<AppState>().settings.lock().unwrap().close_to_tray;
                if to_tray {
                    let _ = window.hide();
                } else {
                    window.app_handle().exit(0);
                }
            }
            (widget::LABEL, WindowEvent::Moved(_) | WindowEvent::Resized(_)) => {
                widget::remember_bounds(window);
                let _ = window.app_handle().emit_to("main", "widget:moved", ());
            }
            (label, WindowEvent::Destroyed) => audio::want(label, false),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            listen_beat,
            get_snapshot,
            set_settings,
            set_offset,
            shift_offset,
            retry_lyrics,
            save_user_lyrics,
            delete_user_lyrics,
            set_widget_geometry,
            get_widget_geometry,
            list_monitors,
            check_update,
            list_media_sources,
            source_cover,
            install_update,
            open_link,
            search_lyrics,
            choose_lyrics,
            log_frontend,
            open_log,
            open_log_folder,
            save_share_image,
            reveal_file,
            media::commands::media_toggle,
            media::commands::media_next,
            media::commands::media_prev,
            media::commands::media_seek,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build MUSE");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            wallpaper::teardown(app);
            let state = app.state::<AppState>();
            settings::save(&state.data_dir, &state.settings.lock().unwrap());
        }
    });
}
