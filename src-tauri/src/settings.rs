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
    pub widget_acrylic: bool,
    pub widget_font_size: u32,
    /// Physical pixels: x, y, width, height.
    pub widget_bounds: Option<[i32; 4]>,
    pub simple_glass: bool,
    pub bg_fps: u32,
    pub autostart: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            widget_enabled: false,
            widget_edit: false,
            widget_acrylic: false,
            widget_font_size: 26,
            widget_bounds: None,
            simple_glass: false,
            bg_fps: 30,
            autostart: false,
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
        || old.theme != new.theme
    {
        crate::widget::sync(app);
    }
    crate::tray::refresh(app);
    let _ = app.emit("settings:changed", &new);
    Ok(new)
}
