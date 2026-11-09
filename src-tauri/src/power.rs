//! When MUSE should go easy: on battery power, and while a game (or a video)
//! fills the screen. Checked every 1.5 s; windows get `power:state` on change.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN};
use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId};

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PowerState {
    /// Running on battery (a laptop away from its charger).
    pub battery: bool,
    /// Something other than MUSE fills the screen in front: a game, a video.
    pub game: bool,
}

static STATE: Mutex<PowerState> = Mutex::new(PowerState { battery: false, game: false });

pub fn state() -> PowerState {
    *STATE.lock().unwrap()
}

fn on_battery() -> bool {
    let mut s = SYSTEM_POWER_STATUS::default();
    // ACLineStatus: 0 offline, 1 online, 255 unknown (desktops report online).
    unsafe { GetSystemPowerStatus(&mut s) }.is_ok() && s.ACLineStatus == 0
}

/// The foreground window covers its whole monitor and is not the desktop,
/// the taskbar or MUSE itself (its own fullscreen lyrics are no game).
fn fullscreen_app() -> bool {
    unsafe {
        let fg = GetForegroundWindow();
        if fg.is_invalid() {
            return false;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(fg, Some(&mut pid));
        if pid == std::process::id() {
            return false;
        }
        let mut class = [0u16; 64];
        let n = GetClassNameW(fg, &mut class).max(0) as usize;
        if matches!(String::from_utf16_lossy(&class[..n]).as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd") {
            return false;
        }
        // Exclusive fullscreen and presentations are reported by the shell.
        if let Ok(q) = SHQueryUserNotificationState() {
            if q == QUNS_RUNNING_D3D_FULL_SCREEN || q == QUNS_PRESENTATION_MODE {
                return true;
            }
        }
        // Borderless fullscreen games often go unreported: the window filling
        // its whole monitor is the sign (a maximized one leaves the taskbar).
        let mut r = Default::default();
        if GetWindowRect(fg, &mut r).is_err() {
            return false;
        }
        let mon = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(mon, &mut info).as_bool() {
            return false;
        }
        let m = info.rcMonitor;
        r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom
    }
}

pub fn spawn(app: AppHandle) {
    let _ = std::thread::Builder::new().name("power".into()).spawn(move || loop {
        let now = PowerState { battery: on_battery(), game: fullscreen_app() };
        let changed = {
            let mut s = STATE.lock().unwrap();
            let changed = *s != now;
            *s = now;
            changed
        };
        if changed {
            crate::log_info!("power", "battery: {}, fullscreen app: {}", now.battery, now.game);
            let _ = app.emit("power:state", now);
        }
        std::thread::sleep(Duration::from_millis(1500));
    });
}
