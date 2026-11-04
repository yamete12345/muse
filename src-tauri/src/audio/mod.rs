//! The beat of the playing app, for the background's pulse. Only that app's
//! sound is heard, only while a window shows the pulsing background, and it
//! is analysed on the spot: nothing is recorded or stored.

mod beat;
pub mod capture;
pub mod sessions;

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

use crate::state::AppState;

/// Windows that show the pulse right now.
static WANTED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

pub fn want(window: &str, on: bool) {
    let mut w = WANTED.lock().unwrap();
    let set = w.get_or_insert_with(HashSet::new);
    if on {
        set.insert(window.to_string());
    } else {
        set.remove(window);
    }
}

fn wanted() -> bool {
    WANTED.lock().unwrap().as_ref().is_some_and(|s| !s.is_empty())
}

struct Running {
    pid: u32,
    stop: Arc<AtomicBool>,
    failed: Arc<AtomicBool>,
}

impl Drop for Running {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Keeps a capture of the shown app running while some window wants beats.
pub fn spawn(app: AppHandle) {
    let _ = std::thread::Builder::new().name("beat".into()).spawn(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let mut running: Option<Running> = None;
        let mut refused: Option<(u32, std::time::Instant)> = None;
        loop {
            std::thread::sleep(Duration::from_millis(800));
            let media = app.state::<AppState>().media.lock().unwrap().clone();
            let playing = media.as_ref().filter(|m| m.playing && !m.app.is_empty());
            let Some(m) = playing.filter(|_| wanted()) else {
                running = None;
                continue;
            };
            let apps = sessions::list().unwrap_or_default();
            let Some(target) = sessions::find_for_app_id(&apps, &m.app) else {
                running = None;
                continue;
            };
            if running.as_ref().is_some_and(|r| r.failed.load(Ordering::Relaxed)) {
                refused = Some((target.pid, std::time::Instant::now()));
                running = None;
            }
            // Do not hammer an app that refuses to be heard.
            if refused.is_some_and(|(pid, at)| pid == target.pid && at.elapsed() < Duration::from_secs(30)) {
                continue;
            }
            if running.as_ref().map(|r| r.pid) != Some(target.pid) {
                running = Some(start(&app, target.pid, &target.exe));
            }
        }
    });
}

fn start(app: &AppHandle, pid: u32, exe: &str) -> Running {
    let stop = Arc::new(AtomicBool::new(false));
    let failed = Arc::new(AtomicBool::new(false));
    let (handle, stop2, failed2, exe) = (app.clone(), stop.clone(), failed.clone(), exe.to_string());
    crate::log_info!("audio", "beat of {exe} (pid {pid})");
    let _ = std::thread::Builder::new().name("beat-capture".into()).spawn(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let mut beats = beat::Beats::new(capture::RATE);
        let mut mono: Vec<i16> = Vec::new();
        let ch = capture::CHANNELS as usize;
        let result = capture::run(pid, stop2, |samples, _| {
            mono.clear();
            mono.extend(samples.chunks_exact(ch).map(|f| ((f[0] as i32 + f[1] as i32) / 2) as i16));
            beats.push(&mono, |s| {
                let _ = handle.emit("audio:beat", s);
            });
        });
        if let Err(e) = result {
            failed2.store(true, Ordering::Relaxed);
            // Process loopback needs Windows 10 2004 or later.
            crate::log_info!("audio", "cannot hear {exe}: {}", e.message());
        }
    });
    Running { pid, stop, failed }
}
