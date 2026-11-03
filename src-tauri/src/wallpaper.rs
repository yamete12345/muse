//! Live wallpaper: a window re-parented into the desktop's wallpaper layer,
//! below the icons (the technique Wallpaper Engine and Lively use).

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use windows::core::{w, BOOL};
use windows::Win32::Foundation::{HWND, LPARAM, RECT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetClassNameW, GetForegroundWindow, GetSystemMetrics, GetWindowLongPtrW,
    GetWindowRect, IsZoomed, SendMessageTimeoutW, SetParent, SetWindowLongPtrW, SetWindowPos, SystemParametersInfoW,
    GWL_EXSTYLE, GWL_STYLE, SMTO_NORMAL, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SPI_GETDESKWALLPAPER,
    SPI_SETDESKWALLPAPER, SWP_NOACTIVATE, SWP_NOZORDER, SWP_SHOWWINDOW, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS, WS_CAPTION,
    WS_CHILD, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_POPUP,
    WS_SYSMENU, WS_THICKFRAME,
};

use crate::state::AppState;

pub const LABEL: &str = "wallpaper";

/// Screen rect (x, y, w, h) of the monitor the wallpaper covers.
static TARGET: Mutex<Option<[i32; 4]>> = Mutex::new(None);

pub fn sync(app: &AppHandle) {
    let (enabled, monitor) = {
        let s = app.state::<AppState>().settings.lock().unwrap().clone();
        (s.wallpaper_enabled, s.wallpaper_monitor)
    };
    let existing = app.get_webview_window(LABEL);

    if !enabled {
        if let Some(w) = existing {
            let _ = w.destroy();
            restore_system_wallpaper();
        }
        *TARGET.lock().unwrap() = None;
        return;
    }

    let Some(rect) = monitor_rect(app, monitor) else { return };
    let win = match existing {
        Some(w) => w,
        None => match create(app) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("wallpaper: {e}");
                return;
            }
        },
    };
    attach(&win, rect);
}

/// Removes the wallpaper window; called on exit so the desktop redraws normally.
pub fn teardown(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.destroy();
        restore_system_wallpaper();
    }
}

fn create(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("mutxt wallpaper")
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()
}

pub fn monitors(app: &AppHandle) -> Vec<String> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let name = m.name().cloned().unwrap_or_else(|| format!("Монитор {}", i + 1));
            let name = name.trim_start_matches(r"\\.\").to_string();
            format!("{} · {}×{}", name, m.size().width, m.size().height)
        })
        .collect()
}

fn monitor_rect(app: &AppHandle, index: i32) -> Option<[i32; 4]> {
    let list = app.available_monitors().ok()?;
    let m = usize::try_from(index)
        .ok()
        .and_then(|i| list.get(i).cloned())
        .or_else(|| app.primary_monitor().ok().flatten())
        .or_else(|| list.first().cloned())?;
    Some([m.position().x, m.position().y, m.size().width as i32, m.size().height as i32])
}

/// Finds the window to parent into and the sibling to sit behind.
fn wallpaper_host() -> Option<(HWND, Option<HWND>)> {
    unsafe {
        let progman = FindWindowW(w!("Progman"), None).ok()?;
        // Ask Explorer to create the WorkerW that sits between icons and wallpaper.
        let mut result = 0usize;
        SendMessageTimeoutW(progman, 0x052C, WPARAM(0xD), LPARAM(0x1), SMTO_NORMAL, 1000, Some(&mut result));
        SendMessageTimeoutW(progman, 0x052C, WPARAM(0), LPARAM(0), SMTO_NORMAL, 1000, Some(&mut result));

        // Windows 11 24H2+: icons view and WorkerW are children of Progman; we go
        // into Progman right behind the icons view.
        if let Ok(defview) = FindWindowExW(Some(progman), None, w!("SHELLDLL_DefView"), None) {
            if FindWindowExW(Some(progman), None, w!("WorkerW"), None).is_ok() {
                return Some((progman, Some(defview)));
            }
        }

        // Older layout: the top-level WorkerW that follows the one hosting the icons.
        let mut worker = HWND::default();
        let _ = EnumWindows(Some(find_worker), LPARAM(&mut worker as *mut HWND as isize));
        if !worker.is_invalid() {
            return Some((worker, None));
        }
        None
    }
}

unsafe extern "system" fn find_worker(hwnd: HWND, lparam: LPARAM) -> BOOL {
    if FindWindowExW(Some(hwnd), None, w!("SHELLDLL_DefView"), None).is_ok() {
        if let Ok(worker) = FindWindowExW(None, Some(hwnd), w!("WorkerW"), None) {
            *(lparam.0 as *mut HWND) = worker;
            return BOOL(0);
        }
    }
    BOOL(1)
}

fn attach(win: &WebviewWindow, [x, y, w, h]: [i32; 4]) {
    let Ok(raw) = win.hwnd() else { return };
    let hwnd = HWND(raw.0 as _);
    let Some((parent, behind)) = wallpaper_host() else {
        eprintln!("wallpaper: desktop layer not found");
        return;
    };
    unsafe {
        let frame = (WS_POPUP.0 | WS_CAPTION.0 | WS_THICKFRAME.0 | WS_SYSMENU.0 | WS_MAXIMIZEBOX.0 | WS_MINIMIZEBOX.0) as isize;
        let style = (GetWindowLongPtrW(hwnd, GWL_STYLE) & !frame) | WS_CHILD.0 as isize;
        SetWindowLongPtrW(hwnd, GWL_STYLE, style);
        let ex = (GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & !(WS_EX_APPWINDOW.0 as isize))
            | (WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0) as isize;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
        let _ = SetParent(hwnd, Some(parent));

        // Child coordinates are relative to the parent, which spans the virtual screen.
        let vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let flags = SWP_NOACTIVATE | SWP_SHOWWINDOW | if behind.is_none() { SWP_NOZORDER } else { Default::default() };
        let _ = SetWindowPos(hwnd, behind, x - vx, y - vy, w, h, flags);
    }
    *TARGET.lock().unwrap() = Some([x, y, w, h]);
}

/// Re-applies the user's wallpaper so the last frame we drew disappears.
fn restore_system_wallpaper() {
    unsafe {
        let mut buf = [0u16; 520];
        let flags = SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0);
        if SystemParametersInfoW(SPI_GETDESKWALLPAPER, buf.len() as u32, Some(buf.as_mut_ptr() as *mut _), flags).is_ok() {
            let _ = SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, Some(buf.as_mut_ptr() as *mut _), flags);
        }
    }
}

/// Whether a maximized or fullscreen window hides the wallpaper's monitor.
fn covered() -> bool {
    let Some([x, y, w, h]) = *TARGET.lock().unwrap() else { return false };
    unsafe {
        let fg = GetForegroundWindow();
        if fg.is_invalid() {
            return false;
        }
        let mut class = [0u16; 64];
        let n = GetClassNameW(fg, &mut class).max(0) as usize;
        let name = String::from_utf16_lossy(&class[..n]);
        if matches!(name.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd") {
            return false;
        }
        let mut r = RECT::default();
        if GetWindowRect(fg, &mut r).is_err() {
            return false;
        }
        let (cx, cy) = ((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        let on_monitor = cx >= x && cx < x + w && cy >= y && cy < y + h;
        let fullscreen = r.left <= x && r.top <= y && r.right >= x + w && r.bottom >= y + h;
        fullscreen || (on_monitor && IsZoomed(fg).as_bool())
    }
}

/// Tells the wallpaper window to pause while it cannot be seen.
pub fn spawn_watcher(app: AppHandle) {
    let _ = std::thread::Builder::new().name("wallpaper-watch".into()).spawn(move || {
        let mut last = false;
        loop {
            std::thread::sleep(Duration::from_millis(1200));
            let pause_enabled = {
                let s = app.state::<AppState>().settings.lock().unwrap().clone();
                s.wallpaper_enabled && s.wallpaper_pause_covered
            };
            let now = pause_enabled && covered();
            if now != last {
                last = now;
                let _ = app.emit_to(LABEL, "wallpaper:covered", now);
            }
        }
    });
}
