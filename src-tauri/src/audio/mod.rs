//! The playing app's sound, for the background's pulse (beats) and the
//! widget's level bars (loudness of four bands). Only that app is heard, only
//! while a window shows one of those, and it is analysed on the spot: nothing
//! is recorded or stored.

mod beat;
pub mod capture;
mod levels;
pub mod sessions;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

use crate::state::AppState;

#[derive(Clone, Copy, Default)]
struct Want {
    beat: bool,
    levels: bool,
}

/// What each window shows right now: the pulsing background, level bars.
static WANTED: Mutex<Option<HashMap<String, Want>>> = Mutex::new(None);

fn set_want(window: &str, f: impl FnOnce(&mut Want)) {
    let mut w = WANTED.lock().unwrap();
    let map = w.get_or_insert_with(HashMap::new);
    let entry = map.entry(window.to_string()).or_default();
    f(entry);
    if !entry.beat && !entry.levels {
        map.remove(window);
    }
}

/// A window shows (or stops showing) the background that pulses to the beat.
pub fn want(window: &str, on: bool) {
    set_want(window, |w| w.beat = on);
}

/// A window shows (or stops showing) level bars.
pub fn want_levels(window: &str, on: bool) {
    set_want(window, |w| w.levels = on);
}

/// A window is gone: it wants nothing any more.
pub fn forget(window: &str) {
    if let Some(map) = WANTED.lock().unwrap().as_mut() {
        map.remove(window);
    }
}

fn wanted() -> bool {
    WANTED.lock().unwrap().as_ref().is_some_and(|m| !m.is_empty())
}

fn beat_wanted() -> bool {
    WANTED.lock().unwrap().as_ref().is_some_and(|m| m.values().any(|w| w.beat))
}

fn level_windows() -> Vec<String> {
    WANTED.lock().unwrap().as_ref().map(|m| m.iter().filter(|(_, w)| w.levels).map(|(k, _)| k.clone()).collect()).unwrap_or_default()
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
    crate::log_info!("audio", "hearing {exe} (pid {pid})");
    let _ = std::thread::Builder::new().name("beat-capture".into()).spawn(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let mut beats = beat::Beats::new(capture::RATE);
        let mut bands = levels::Levels::new(capture::RATE);
        let mut mono: Vec<i16> = Vec::new();
        let ch = capture::CHANNELS as usize;
        let result = capture::run(pid, stop2, |samples, _| {
            mono.clear();
            mono.extend(samples.chunks_exact(ch).map(|f| ((f[0] as i32 + f[1] as i32) / 2) as i16));
            if beat_wanted() {
                beats.push(&mono, |s| {
                    let _ = handle.emit("audio:beat", s);
                });
            }
            let targets = level_windows();
            if !targets.is_empty() {
                bands.push(&mono, |v| {
                    for label in &targets {
                        let _ = handle.emit_to(label.as_str(), "audio:levels", v);
                    }
                });
            }
        });
        if let Err(e) = result {
            failed2.store(true, Ordering::Relaxed);
            // Process loopback needs Windows 10 2004 or later.
            crate::log_info!("audio", "cannot hear {exe}: {}", e.message());
        }
    });
    Running { pid, stop, failed }
}
