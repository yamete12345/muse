use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::state::AppState;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// "dark" | "light" | "system"
    pub theme: String,
    pub widget_enabled: bool,
    /// Not persisted: the widget always starts locked.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub widget_edit: bool,
    /// The desktop blurred behind the widget (its glass in the beautiful mode).
    pub widget_acrylic: bool,
    /// Corner radius of that glass, logical pixels: Windows cuts the blur to it.
    pub widget_glass_radius: f64,
    /// Above all windows instead of on the wallpaper layer.
    pub widget_on_top: bool,
    /// Clicks pass through the widget to whatever is below.
    pub widget_click_through: bool,
    /// Widget appearance follows the main window's lyrics style.
    pub widget_linked: bool,
    /// Physical pixels: x, y, width, height.
    pub widget_bounds: Option<[i32; 4]>,
    /// Live wallpaper: the lyrics view embedded behind the desktop icons.
    pub wallpaper_enabled: bool,
    /// Old single-monitor choice, read once and folded into `wallpaper_monitors`.
    #[serde(skip_serializing)]
    pub wallpaper_monitor: i32,
    /// Indexes into the monitor list that get the wallpaper; -1 is the primary monitor.
    pub wallpaper_monitors: Vec<i32>,
    /// Each monitor keeps its own wallpaper look instead of sharing one.
    pub wallpaper_split: bool,
    /// Per-monitor appearance blobs keyed by monitor index (used when split).
    pub wallpaper_styles: serde_json::Value,
    /// The user's saved presets, owned by the frontend.
    pub user_presets: serde_json::Value,
    /// Pause animation while a maximized/fullscreen window hides the desktop.
    pub wallpaper_pause_covered: bool,
    pub wallpaper_linked: bool,
    /// Appearance blobs owned by the frontend; Rust only stores them.
    pub main_style: serde_json::Value,
    pub widget_style: serde_json::Value,
    pub wallpaper_style: serde_json::Value,
    pub simple_glass: bool,
    /// Old background-only frame rate; `fps` covers everything now.
    pub bg_fps: u32,
    /// Frames per second of all animation: 24, 30 or 60.
    pub fps: u32,
    /// On battery, go easy like in game mode.
    pub battery_saver: bool,
    /// "auto": while something fills the screen; "always"; "off".
    pub game_mode: String,
    pub autostart: bool,
    /// The close button hides the main window to the tray instead of quitting.
    pub close_to_tray: bool,
    /// Look for new versions on GitHub in the background.
    pub update_check: bool,
    /// Covers drift, tilt and catch a highlight while music plays.
    pub live_cover: bool,
    /// Label song parts and their singers: off, duets or all.
    pub song_parts: String,
    /// App id of the media session to show; empty: whatever plays.
    pub media_source: String,
    /// Extra lyrics offset per app id (a browser may lag behind a player), ms.
    pub app_offsets: std::collections::BTreeMap<String, i64>,
    /// Latin letters for Japanese and Korean lyrics: "under", "instead" or "off".
    pub romaji: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            widget_enabled: false,
            widget_edit: false,
            widget_acrylic: false,
            widget_glass_radius: 8.0,
            widget_on_top: false,
            widget_click_through: true,
            widget_linked: false,
            widget_bounds: None,
            wallpaper_enabled: false,
            wallpaper_monitor: -1,
            wallpaper_monitors: vec![-1],
            wallpaper_split: false,
            wallpaper_styles: serde_json::Value::Null,
            user_presets: serde_json::Value::Null,
            wallpaper_pause_covered: true,
            wallpaper_linked: false,
            main_style: serde_json::Value::Null,
            widget_style: serde_json::Value::Null,
            wallpaper_style: serde_json::Value::Null,
            simple_glass: false,
            bg_fps: 30,
            fps: 60,
            battery_saver: true,
            game_mode: "auto".into(),
            autostart: false,
            close_to_tray: true,
            update_check: true,
            live_cover: true,
            song_parts: "duets".into(),
            media_source: String::new(),
            app_offsets: Default::default(),
            romaji: "under".into(),
        }
    }
}

fn file(dir: &Path) -> std::path::PathBuf {
    dir.join("settings.json")
}

pub fn load(dir: &Path) -> Settings {
    let mut s: Settings = std::fs::read_to_string(file(dir))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    s.widget_edit = false;
    if s.wallpaper_monitor >= 0 && s.wallpaper_monitors == [-1] {
        s.wallpaper_monitors = vec![s.wallpaper_monitor];
    }
    if s.wallpaper_monitors.is_empty() {
        s.wallpaper_monitors = vec![-1];
    }
    s
}

pub fn save(dir: &Path, s: &Settings) {
    let mut s = s.clone();
    s.widget_edit = false;
    if let Ok(text) = serde_json::to_string_pretty(&s) {
        let _ = std::fs::write(file(dir), text);
    }
}

/// Merges a partial JSON object into the settings, persists them and
/// applies side effects (widget, autostart, tray).
pub fn update(app: &AppHandle, patch: serde_json::Value) -> Result<Settings, String> {
    let state = app.state::<AppState>();
    let (old, new) = {
        let mut guard = state.settings.lock().unwrap();
        let old = guard.clone();
        let mut value = serde_json::to_value(&old).map_err(|e| e.to_string())?;
        if let (Some(dst), Some(src)) = (value.as_object_mut(), patch.as_object()) {
            for (k, v) in src {
                dst.insert(k.clone(), v.clone());
            }
        }
        let mut new: Settings = serde_json::from_value(value).map_err(|e| e.to_string())?;
        // widget_edit is skipped when false, so an explicit patch must win.
        if let Some(v) = patch.get("widgetEdit").and_then(|v| v.as_bool()) {
            new.widget_edit = v;
        } else {
            new.widget_edit = old.widget_edit;
        }
        *guard = new.clone();
        (old, new)
    };
    if old == new {
        return Ok(new);
    }
    save(&state.data_dir, &new);

    if old.autostart != new.autostart {
        let launcher = app.autolaunch();
        let _ = if new.autostart { launcher.enable() } else { launcher.disable() };
    }
    if old.widget_enabled != new.widget_enabled
        || old.widget_edit != new.widget_edit
        || old.widget_acrylic != new.widget_acrylic
        || old.widget_glass_radius != new.widget_glass_radius
        || old.widget_on_top != new.widget_on_top
        || old.widget_click_through != new.widget_click_through
        || old.theme != new.theme
    {
        crate::widget::sync(app);
    }
    if old.wallpaper_enabled != new.wallpaper_enabled || old.wallpaper_monitors != new.wallpaper_monitors {
        crate::wallpaper::sync(app);
    }
    if old.song_parts != new.song_parts {
        crate::lyrics::parts::refresh(app);
    }
    if old.media_source != new.media_source {
        crate::media::gsmtc::wake();
    }
    crate::tray::refresh(app);
    let _ = app.emit("settings:changed", &new);
    Ok(new)
}
