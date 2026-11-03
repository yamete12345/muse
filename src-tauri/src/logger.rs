//! A small log file in the app's data folder (`logs\muse.log`), so problems
//! that only show up on someone's machine leave a trace. Rotates at 1 MB,
//! keeping one previous file.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const MAX_BYTES: u64 = 1024 * 1024;

struct Log {
    path: PathBuf,
    file: File,
    written: u64,
}

static LOG: Mutex<Option<Log>> = Mutex::new(None);

pub fn dir(data_dir: &Path) -> PathBuf {
    data_dir.join("logs")
}

pub fn file_path(data_dir: &Path) -> PathBuf {
    dir(data_dir).join("muse.log")
}

/// Opens the log and records panics in it. Call once at startup.
pub fn init(data_dir: &Path) {
    let path = file_path(data_dir);
    let _ = std::fs::create_dir_all(dir(data_dir));
    if let Ok(file) = OpenOptions::new().create(true).append(true).open(&path) {
        let written = file.metadata().map(|m| m.len()).unwrap_or(0);
        *LOG.lock().unwrap() = Some(Log { path, file, written });
    }

    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        write("PANIC", "panic", &info.to_string());
        default(info);
    }));
}

/// Local date and time, to the millisecond.
fn stamp() -> String {
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, t.wMilliseconds)
}

pub fn write(level: &str, area: &str, message: &str) {
    let line = format!("{} {level:<5} [{area}] {message}\n", stamp());
    if cfg!(debug_assertions) {
        eprint!("{line}");
    }
    let mut guard = LOG.lock().unwrap();
    let Some(log) = guard.as_mut() else { return };
    if log.written + line.len() as u64 > MAX_BYTES {
        let old = log.path.with_file_name("muse.old.log");
        let _ = std::fs::remove_file(&old);
        let _ = std::fs::rename(&log.path, &old);
        match File::create(&log.path) {
            Ok(f) => {
                log.file = f;
                log.written = 0;
            }
            Err(_) => return,
        }
    }
    if log.file.write_all(line.as_bytes()).is_ok() {
        log.written += line.len() as u64;
    }
}

#[macro_export]
macro_rules! log_info {
    ($area:expr, $($arg:tt)*) => { $crate::logger::write("INFO", $area, &format!($($arg)*)) };
}

#[macro_export]
macro_rules! log_warn {
    ($area:expr, $($arg:tt)*) => { $crate::logger::write("WARN", $area, &format!($($arg)*)) };
}

#[macro_export]
macro_rules! log_error {
    ($area:expr, $($arg:tt)*) => { $crate::logger::write("ERROR", $area, &format!($($arg)*)) };
}
