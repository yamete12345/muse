//! Desktop widget: a transparent window that lives on the wallpaper layer.

use serde::Serialize;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use windows::core::w;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND, DWMWCP_ROUND};
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
    // Older versions used the system acrylic backdrop: make sure it is gone.
    let _ = win.set_effects(None);
    set_glass(&win, settings.widget_acrylic, settings.widget_glass_radius);
    set_layer(&win, settings.widget_on_top);
}

#[repr(C)]
struct AccentPolicy {
    state: u32,
    flags: u32,
    /// Tint, 0xAABBGGRR; the page draws its own, so fully transparent.
    color: u32,
    animation: u32,
}

#[repr(C)]
struct CompositionData {
    attribute: u32,
    data: *mut core::ffi::c_void,
    size: usize,
}

/// `SetWindowCompositionAttribute` from user32. Undocumented (so not in the
/// import library, looked up at run time), but the one way to blur behind a
/// window that is never active: Windows 11's system backdrops (acrylic, mica)
/// turn into a flat fill on inactive windows, and the widget never is active.
type SetComposition = unsafe extern "system" fn(isize, *mut CompositionData) -> i32;

fn set_composition() -> Option<SetComposition> {
    use windows::core::{s, w};
    use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
    unsafe {
        let user32 = GetModuleHandleW(w!("user32.dll")).ok()?;
        let f = GetProcAddress(user32, s!("SetWindowCompositionAttribute"))?;
        Some(std::mem::transmute::<unsafe extern "system" fn() -> isize, SetComposition>(f))
    }
}

const WCA_ACCENT_POLICY: u32 = 19;
const ACCENT_DISABLED: u32 = 0;
const ACCENT_ENABLE_BLURBEHIND: u32 = 3;

/// Glass widget: the desktop behind it blurred by Windows, with rounded
/// corners of `radius` (logical pixels). Drawn by the compositor where it can
/// (any radius, smooth edges, see glass.rs); otherwise the window's accent blur
/// with the system's own rounded corners.
fn set_glass(win: &WebviewWindow, on: bool, radius: f64) {
    let w = win.clone();
    let _ = win.run_on_main_thread(move || {
        let Ok(h) = w.hwnd() else { return };
        let hwnd = h.0 as isize;
        let composed = on && show_pane(&w, radius);
        if !on {
            crate::glass::hide();
        }
        let accent = on && !composed;
        let mut policy = AccentPolicy { state: if accent { ACCENT_ENABLE_BLURBEHIND } else { ACCENT_DISABLED }, flags: 0, color: 0, animation: 0 };
        let mut data = CompositionData { attribute: WCA_ACCENT_POLICY, data: &mut policy as *mut _ as *mut _, size: std::mem::size_of::<AccentPolicy>() };
        let corners = if accent { DWMWCP_ROUND } else { DWMWCP_DONOTROUND };
        unsafe {
            if let Some(set) = set_composition() {
                set(hwnd, &mut data);
            }
            let _ = DwmSetWindowAttribute(HWND(hwnd as _), DWMWA_WINDOW_CORNER_PREFERENCE, &corners as *const _ as *const _, std::mem::size_of_val(&corners) as u32);
        }
    });
}

/// The compositor's glass at the window's size. Main thread only.
fn show_pane(win: &WebviewWindow, radius: f64) -> bool {
    let (Ok(h), Ok(size)) = (win.hwnd(), win.inner_size()) else { return false };
    let scale = win.scale_factor().unwrap_or(1.0);
    match crate::glass::show(h.0 as isize, size.width as f32, size.height as f32, (radius * scale) as f32) {
        Ok(()) => true,
        Err(e) => {
            crate::log_warn!("widget", "compositor glass unavailable, using the accent blur: {e}");
            crate::glass::hide();
            false
        }
    }
}

/// The widget changed size: the glass follows. Called on the main thread.
pub fn resized(app: &AppHandle) {
    let Some(win) = app.get_webview_window(LABEL) else { return };
    let Ok(h) = win.hwnd() else { return };
    if crate::glass::showing(h.0 as isize) {
        let radius = app.state::<AppState>().settings.lock().unwrap().widget_glass_radius;
        show_pane(&win, radius);
    }
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
