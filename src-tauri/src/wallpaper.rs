//! Live wallpaper: windows re-parented into the desktop's wallpaper layer,
//! below the icons (the technique Wallpaper Engine and Lively use). One
//! window per chosen monitor, labelled `wallpaper-<monitor index>`.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Monitor, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use windows::core::{w, BOOL};
use windows::Win32::Foundation::{HWND, LPARAM, RECT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetClassNameW, GetForegroundWindow, GetParent, GetSystemMetrics,
    GetWindowLongPtrW, GetWindowRect, IsZoomed, SendMessageTimeoutW, SetParent, SetWindowLongPtrW, SetWindowPos, SystemParametersInfoW,
    GWL_EXSTYLE, GWL_STYLE, SMTO_NORMAL, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SPI_GETDESKWALLPAPER,
    SPI_SETDESKWALLPAPER, SWP_NOACTIVATE, SWP_NOZORDER, SWP_SHOWWINDOW, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS, WS_CAPTION,
    WS_CHILD, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_POPUP,
    WS_SYSMENU, WS_THICKFRAME,
};

use crate::state::AppState;

pub const PREFIX: &str = "wallpaper-";

/// Screen rect (x, y, w, h) covered by each wallpaper window, by label.
static TARGETS: Mutex<Vec<(String, [i32; 4])>> = Mutex::new(Vec::new());

/// Windows already shown through Tauri. A window made visible only by Win32
/// calls leaves its WebView believing it is hidden, and then it draws nothing.
static SHOWN: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn rect(m: &Monitor) -> [i32; 4] {
    [m.position().x, m.position().y, m.size().width as i32, m.size().height as i32]
}

/// Monitor indexes and rects the settings ask for; -1 means the primary monitor.
fn wanted(app: &AppHandle, picks: &[i32]) -> Vec<(usize, [i32; 4])> {
    let list = app.available_monitors().unwrap_or_default();
    let primary = app.primary_monitor().ok().flatten().map(|m| rect(&m));
    let primary_idx = list.iter().position(|m| Some(rect(m)) == primary).unwrap_or(0);
    let mut out: Vec<(usize, [i32; 4])> = Vec::new();
    for &p in picks {
        let i = if p < 0 { primary_idx } else { p as usize };
        if let Some(m) = list.get(i) {
            if !out.iter().any(|(j, _)| *j == i) {
                out.push((i, rect(m)));
            }
        }
    }
    out
}

pub fn sync(app: &AppHandle) {
    let s = app.state::<AppState>().settings.lock().unwrap().clone();
    let targets: Vec<(String, [i32; 4])> = if s.wallpaper_enabled {
        wanted(app, &s.wallpaper_monitors).into_iter().map(|(i, r)| (format!("{PREFIX}{i}"), r)).collect()
    } else {
        Vec::new()
    };

    let mut removed = false;
    for (label, w) in app.webview_windows() {
        if label.starts_with(PREFIX) && !targets.iter().any(|(l, _)| *l == label) {
            let _ = w.destroy();
            forget(&label);
            removed = true;
        }
    }
    if removed {
        restore_system_wallpaper();
    }

    for (label, _) in &targets {
        if app.get_webview_window(label).is_none() {
            if let Err(e) = create(app, label) {
                eprintln!("wallpaper: {e}");
            }
        }
    }
    *TARGETS.lock().unwrap() = targets;
    attach_all(app);

    // Explorer may still be rebuilding its desktop layer (and a new WebView
    // may still be starting): check once more shortly after.
    let later = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(900));
        attach_all(&later);
    });
}

/// Puts every wanted wallpaper window into the desktop layer. Win32 parenting
/// runs on the thread that owns the windows, never from a command thread.
fn attach_all(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let targets = TARGETS.lock().unwrap().clone();
        for (label, r) in targets {
            if let Some(win) = handle.get_webview_window(&label) {
                attach(&win, &label, r);
            }
        }
    });
}

fn forget(label: &str) {
    if let Some(set) = SHOWN.lock().unwrap().as_mut() {
        set.remove(label);
    }
}

/// Removes the wallpaper windows; called on exit so the desktop redraws normally.
pub fn teardown(app: &AppHandle) {
    let mut removed = false;
    for (label, w) in app.webview_windows() {
        if label.starts_with(PREFIX) {
            let _ = w.destroy();
            forget(&label);
            removed = true;
        }
    }
    TARGETS.lock().unwrap().clear();
    if removed {
        restore_system_wallpaper();
    }
}

fn create(app: &AppHandle, label: &str) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("MUSE wallpaper")
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub name: String,
    pub primary: bool,
}

pub fn monitors(app: &AppHandle) -> Vec<MonitorInfo> {
    let primary = app.primary_monitor().ok().flatten().map(|m| rect(&m));
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(i, m)| MonitorInfo {
            name: format!("Монитор {} · {}×{}", i + 1, m.size().width, m.size().height),
            primary: Some(rect(m)) == primary,
        })
        .collect()
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

fn attach(win: &WebviewWindow, label: &str, [x, y, w, h]: [i32; 4]) {
    let Ok(raw) = win.hwnd() else { return };
    let hwnd = HWND(raw.0 as _);
    let Some((parent, behind)) = wallpaper_host() else {
        eprintln!("wallpaper: desktop layer not found");
        return;
    };
    unsafe {
        // Already in place: leave it alone, re-parenting makes it flicker.
        let mut r = RECT::default();
        let placed = GetParent(hwnd).ok() == Some(parent)
            && GetWindowRect(hwnd, &mut r).is_ok()
            && [r.left, r.top, r.right - r.left, r.bottom - r.top] == [x, y, w, h];
        if !placed {
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
    }

    let first = SHOWN.lock().unwrap().get_or_insert_with(HashSet::new).insert(label.to_string());
    if first {
        let _ = win.show();
    }
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

/// Whether a maximized or fullscreen window hides the given monitor rect.
fn covered([x, y, w, h]: [i32; 4]) -> bool {
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

/// Tells each wallpaper window to pause while it cannot be seen.
pub fn spawn_watcher(app: AppHandle) {
    let _ = std::thread::Builder::new().name("wallpaper-watch".into()).spawn(move || {
        let mut last: HashMap<String, bool> = HashMap::new();
        loop {
            std::thread::sleep(Duration::from_millis(1200));
            let pause_enabled = {
                let state = app.state::<AppState>();
                let s = state.settings.lock().unwrap();
                s.wallpaper_enabled && s.wallpaper_pause_covered
            };
            let targets = TARGETS.lock().unwrap().clone();
            last.retain(|label, _| targets.iter().any(|(l, _)| l == label));
            for (label, r) in targets {
                let now = pause_enabled && covered(r);
                if last.get(&label) != Some(&now) {
                    last.insert(label.clone(), now);
                    let _ = app.emit_to(label.as_str(), "wallpaper:covered", now);
                }
            }
        }
    });
}
