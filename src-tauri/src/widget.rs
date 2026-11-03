//! Desktop widget: a transparent window that lives on the wallpaper layer.

use tauri::window::{Effect, EffectsBuilder};
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
                eprintln!("widget: {e}");
                return;
            }
        },
    };

    // Locked: clicks fall through to the desktop. Edit mode: drag and resize.
    let _ = win.set_ignore_cursor_events(!settings.widget_edit);
    let effects = settings.widget_acrylic.then(|| EffectsBuilder::new().effect(Effect::Acrylic).build());
    let _ = win.set_effects(effects);
}

fn create(app: &AppHandle, bounds: Option<[i32; 4]>) -> tauri::Result<WebviewWindow> {
    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("mutxt widget")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_bottom(true)
        .resizable(true)
        .focused(false)
        .visible(false)
        .inner_size(560.0, 260.0)
        .min_inner_size(260.0, 120.0)
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

    pin_to_desktop(&win);
    let _ = win.show();
    Ok(win)
}

/// Makes Progman the owner window. Owned windows stay above their owner, so the
/// widget survives "Show desktop" (Win+D) while always-on-bottom keeps it
/// beneath regular windows.
fn pin_to_desktop(win: &WebviewWindow) {
    let Ok(hwnd) = win.hwnd() else { return };
    let hwnd = HWND(hwnd.0 as _);
    unsafe {
        if let Ok(progman) = FindWindowW(w!("Progman"), None) {
            SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, progman.0 as isize);
        }
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
