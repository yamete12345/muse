//! Desktop widget: a transparent window that lives on the wallpaper layer.

use tauri::window::{Effect, EffectsBuilder};
use serde::Serialize;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use windows::core::w;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, SetWindowLongPtrW, GWLP_HWNDPARENT};

use crate::state::AppState;

pub const LABEL: &str = "widget";

pub fn sync(app: &AppHandle) {
    let settings = app.state::<AppState>().settings.lock().unwrap().clone();
    let existing = app.get_webview_window(LABEL);

    if !settings.widget_enabled {
        if let Some(w) = existing {
            let _ = w.destroy();
        }
        return;
    }

    let win = match existing {
        Some(w) => w,
        None => match create(app, settings.widget_bounds) {
            Ok(w) => w,
            Err(e) => {
                crate::log_error!("widget", "could not create the window: {e}");
                return;
            }
        },
    };

    // Locked + click-through: clicks fall through. Edit mode: drag and resize.
    let interactive = settings.widget_edit || !settings.widget_click_through;
    let _ = win.set_ignore_cursor_events(!interactive);
    let effects = settings.widget_acrylic.then(|| EffectsBuilder::new().effect(Effect::Acrylic).build());
    let _ = win.set_effects(effects);
    set_layer(&win, settings.widget_on_top);
}

fn set_layer(win: &WebviewWindow, on_top: bool) {
    if on_top {
        let _ = win.set_always_on_bottom(false);
        let _ = win.set_always_on_top(true);
        set_owner(win, false);
    } else {
        let _ = win.set_always_on_top(false);
        let _ = win.set_always_on_bottom(true);
        set_owner(win, true);
    }
}

const MIN_W: f64 = 240.0;
const MIN_H: f64 = 110.0;

/// Widget bounds in logical pixels, relative to its monitor's work area.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub area_width: f64,
    pub area_height: f64,
}

/// The work area (screen minus taskbar) of the widget's monitor, physical pixels.
fn work_area(win: &WebviewWindow) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>, f64)> {
    let m = win.current_monitor().ok().flatten().or_else(|| win.primary_monitor().ok().flatten())?;
    let area = m.work_area();
    Some((area.position, area.size, m.scale_factor()))
}

pub fn geometry(app: &AppHandle) -> Option<Geometry> {
    let win = app.get_webview_window(LABEL)?;
    let (origin, area, scale) = work_area(&win)?;
    let pos = win.outer_position().ok()?;
    let size = win.outer_size().ok()?;
    Some(Geometry {
        x: (pos.x - origin.x) as f64 / scale,
        y: (pos.y - origin.y) as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
        area_width: area.width as f64 / scale,
        area_height: area.height as f64 / scale,
    })
}

/// Moves and resizes the widget (logical pixels within the work area) and remembers it.
pub fn set_geometry(app: &AppHandle, x: f64, y: f64, width: f64, height: f64) {
    let Some(win) = app.get_webview_window(LABEL) else { return };
    let Some((origin, area, scale)) = work_area(&win) else { return };
    let (aw, ah) = (area.width as f64 / scale, area.height as f64 / scale);
    let w = width.clamp(MIN_W, aw.max(MIN_W));
    let h = height.clamp(MIN_H, ah.max(MIN_H));
    let x = x.clamp(0.0, (aw - w).max(0.0));
    let y = y.clamp(0.0, (ah - h).max(0.0));
    let bounds = [
        origin.x + (x * scale).round() as i32,
        origin.y + (y * scale).round() as i32,
        (w * scale).round() as i32,
        (h * scale).round() as i32,
    ];
    let _ = win.set_size(PhysicalSize::new(bounds[2] as u32, bounds[3] as u32));
    let _ = win.set_position(PhysicalPosition::new(bounds[0], bounds[1]));
    let state = app.state::<AppState>();
    let mut s = state.settings.lock().unwrap();
    s.widget_bounds = Some(bounds);
    crate::settings::save(&state.data_dir, &s);
}

fn create(app: &AppHandle, bounds: Option<[i32; 4]>) -> tauri::Result<WebviewWindow> {
    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("MUSE widget")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_bottom(true)
        .resizable(true)
        .focused(false)
        .visible(false)
        .inner_size(560.0, 260.0)
        .min_inner_size(MIN_W, MIN_H)
        .build()?;

    match bounds {
        Some([x, y, w, h]) => {
            let _ = win.set_position(PhysicalPosition::new(x, y));
            let _ = win.set_size(PhysicalSize::new(w.max(200) as u32, h.max(100) as u32));
        }
        None => {
            if let Ok(Some(m)) = win.current_monitor() {
                let size = win.outer_size().unwrap_or(PhysicalSize::new(560, 260));
                let pos = m.position();
                let x = pos.x + m.size().width as i32 - size.width as i32 - 48;
                let y = pos.y + 64;
                let _ = win.set_position(PhysicalPosition::new(x, y));
            }
        }
    }

    let _ = win.show();
    Ok(win)
}

/// With `pinned`, makes Progman the owner window. Owned windows stay above their
/// owner, so the widget survives "Show desktop" (Win+D) while always-on-bottom
/// keeps it beneath regular windows.
fn set_owner(win: &WebviewWindow, pinned: bool) {
    let Ok(hwnd) = win.hwnd() else { return };
    let hwnd = HWND(hwnd.0 as _);
    unsafe {
        let owner = if pinned { FindWindowW(w!("Progman"), None).map(|p| p.0 as isize).unwrap_or(0) } else { 0 };
        SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, owner);
    }
}

/// Remembers the widget's bounds while the user drags or resizes it.
pub fn remember_bounds(win: &tauri::Window) {
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) else { return };
    let state = win.app_handle().state::<AppState>();
    let mut s = state.settings.lock().unwrap();
    if s.widget_edit {
        s.widget_bounds = Some([pos.x, pos.y, size.width as i32, size.height as i32]);
    }
}
