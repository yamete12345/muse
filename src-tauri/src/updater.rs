//! Updates from GitHub Releases: find the newest release, download its
//! installer, check it against the SHA-256 digest GitHub publishes, and hand
//! over to the installer (which closes MUSE, updates and starts it again).

use std::io::Write;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;

const REPO: &str = "yamete12345/muse";
/// First automatic check after start, then the interval between checks.
const FIRST_CHECK: Duration = Duration::from_secs(20);
const INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub version: String,
    pub available: bool,
    pub notes: String,
    pub published: String,
    pub page: String,
    pub size: u64,
    #[serde(skip)]
    download: Option<(String, Option<String>)>,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    body: Option<String>,
    html_url: String,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    size: u64,
    browser_download_url: String,
    #[serde(default)]
    digest: Option<String>,
}

#[derive(Serialize, Clone)]
struct Progress {
    received: u64,
    total: u64,
}

/// The last release found; installing always uses this, never a URL from the page.
static LATEST: Mutex<Option<UpdateInfo>> = Mutex::new(None);

fn parse(v: &str) -> Vec<u64> {
    v.trim_start_matches('v').split(['.', '-']).take(3).map(|p| p.parse().unwrap_or(0)).collect()
}

/// Whether version `a` is newer than `b` (plain x.y.z).
fn newer(a: &str, b: &str) -> bool {
    parse(a) > parse(b)
}

/// The release page redirects to the newest tag; no API quota involved. It has
/// no checksum or notes, so the API stays the first choice.
async fn latest_from_page(http: &reqwest::Client) -> Result<Release, String> {
    let resp = http
        .get(format!("https://github.com/{REPO}/releases/latest"))
        .send()
        .await
        .map_err(|e| format!("нет связи с GitHub: {e}"))?;
    let tag = resp
        .url()
        .path()
        .rsplit_once("/tag/")
        .map(|(_, t)| t.to_string())
        .ok_or("на GitHub пока нет релизов")?;
    let version = tag.trim_start_matches('v');
    Ok(Release {
        html_url: resp.url().to_string(),
        assets: vec![Asset {
            name: format!("MUSE_{version}_x64-setup.exe"),
            size: 0,
            browser_download_url: format!("https://github.com/{REPO}/releases/download/{tag}/MUSE_{version}_x64-setup.exe"),
            digest: None,
        }],
        tag_name: tag,
        body: None,
        published_at: None,
    })
}

pub async fn check(app: &AppHandle) -> Result<UpdateInfo, String> {
    let http = app.state::<AppState>().http.clone();
    let resp = http
        .get(format!("https://api.github.com/repos/{REPO}/releases/latest"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("нет связи с GitHub: {e}"))?;
    // Unauthenticated API calls are limited to 60 an hour per address.
    let release: Release = if matches!(resp.status().as_u16(), 403 | 429) {
        latest_from_page(&http).await?
    } else {
        resp.error_for_status()
            .map_err(|e| format!("GitHub ответил ошибкой: {e}"))?
            .json()
            .await
            .map_err(|e| format!("не удалось прочитать ответ GitHub: {e}"))?
    };

    let current = env!("CARGO_PKG_VERSION").to_string();
    let version = release.tag_name.trim_start_matches('v').to_string();
    let asset = release.assets.iter().find(|a| a.name.ends_with("-setup.exe"));
    let info = UpdateInfo {
        available: asset.is_some() && newer(&version, &current),
        current,
        version,
        notes: release.body.unwrap_or_default(),
        published: release.published_at.unwrap_or_default(),
        page: release.html_url,
        size: asset.map(|a| a.size).unwrap_or(0),
        download: asset.map(|a| (a.browser_download_url.clone(), a.digest.clone())),
    };
    *LATEST.lock().unwrap() = Some(info.clone());
    Ok(info)
}

/// Downloads the installer of the release found by `check`, verifies it and
/// starts it. On success MUSE exits so the installer can replace it.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let info = LATEST.lock().unwrap().clone().ok_or("сначала проверьте обновления")?;
    if !info.available {
        return Err("установлена последняя версия".into());
    }
    let (url, digest) = info.download.clone().ok_or("в релизе нет установщика")?;
    if !url.starts_with(&format!("https://github.com/{REPO}/releases/download/")) {
        return Err("неожиданный адрес установщика".into());
    }

    let http = app.state::<AppState>().http.clone();
    let mut resp = http
        .get(&url)
        .timeout(Duration::from_secs(600))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("не удалось скачать: {e}"))?;
    let total = resp.content_length().unwrap_or(info.size);

    let path = std::env::temp_dir().join(format!("MUSE_{}_setup.exe", info.version));
    let mut file = std::fs::File::create(&path).map_err(|e| format!("не удалось сохранить файл: {e}"))?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let mut last_emit = 0u64;
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("загрузка прервалась: {e}"))? {
        file.write_all(&chunk).map_err(|e| format!("не удалось сохранить файл: {e}"))?;
        hasher.update(&chunk);
        received += chunk.len() as u64;
        if received - last_emit > 64 * 1024 || received == total {
            last_emit = received;
            let _ = app.emit("update:progress", Progress { received, total });
        }
    }
    drop(file);

    if let Some(expected) = digest.as_deref().and_then(|d| d.strip_prefix("sha256:")) {
        let actual: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
        if !actual.eq_ignore_ascii_case(expected) {
            let _ = std::fs::remove_file(&path);
            return Err("файл повреждён: контрольная сумма не совпала".into());
        }
    }

    run_installer(&path)?;
    // Let the installer start, then leave so it can replace the files.
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(600)).await;
        app.exit(0);
    });
    Ok(())
}

/// Starts the NSIS installer like Tauri's own updater does: passive (progress
/// only), update mode, and start MUSE again when done.
fn run_installer(path: &std::path::Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{w, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOW;

    let file: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe { ShellExecuteW(None, w!("open"), PCWSTR(file.as_ptr()), w!("/P /UPDATE /R"), None, SW_SHOW) };
    if result.0 as isize <= 32 {
        return Err(format!("не удалось запустить установщик (код {})", result.0 as isize));
    }
    Ok(())
}

/// Opens one of the app's own links in the default browser.
pub fn open_link(url: &str) -> Result<(), String> {
    use windows::core::{w, HSTRING};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOW;

    const ALLOWED: [&str; 4] = ["https://github.com/yamete12345/muse", "https://lrclib.net", "https://genius.com", "https://tauri.app"];
    if !ALLOWED.iter().any(|a| url == *a || url.starts_with(&format!("{a}/"))) {
        return Err("ссылка не из списка разрешённых".into());
    }
    let target = HSTRING::from(url);
    unsafe { ShellExecuteW(None, w!("open"), &target, None, None, SW_SHOW) };
    Ok(())
}

/// Checks in the background now and then; tells the windows when a newer
/// version shows up (once per version).
pub fn spawn_checker(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        let mut announced = String::new();
        loop {
            let enabled = app.state::<AppState>().settings.lock().unwrap().update_check;
            if enabled {
                if let Ok(info) = check(&app).await {
                    if info.available && info.version != announced {
                        announced = info.version.clone();
                        let _ = app.emit("update:available", &info);
                    }
                }
            }
            tokio::time::sleep(INTERVAL).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::newer;

    #[test]
    fn compares_versions() {
        assert!(newer("0.2.1", "0.2.0"));
        assert!(newer("v0.10.0", "0.9.9"));
        assert!(newer("1.0.0", "0.99.0"));
        assert!(!newer("0.2.0", "0.2.0"));
        assert!(!newer("0.1.9", "0.2.0"));
    }
}
