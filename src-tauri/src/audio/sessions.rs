//! Apps that are playing sound right now (audio sessions on the default
//! output device), with their process ids and exe names.

use serde::Serialize;
use windows::core::Interface;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Media::Audio::{
    eConsole, eRender, AudioSessionStateActive, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
    MMDeviceEnumerator,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};
use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId, IsWindowVisible};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioApp {
    pub pid: u32,
    /// Exe file name without the extension, e.g. "chrome", "Spotify".
    pub exe: String,
    /// Sound is being played right now.
    pub active: bool,
}

fn exe_name(pid: u32) -> Option<String> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 520];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(h);
        if !ok {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        let file = path.rsplit(['\\', '/']).next().unwrap_or(&path).to_string();
        Some(file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(&file).to_string())
    }
}

/// Audio sessions of the default output device. COM must be initialized on
/// the calling thread.
pub fn list() -> windows::core::Result<Vec<AudioApp>> {
    unsafe {
        let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = devices.GetDefaultAudioEndpoint(eRender, eConsole)?;
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
        let sessions = manager.GetSessionEnumerator()?;
        let mut out: Vec<AudioApp> = Vec::new();
        for i in 0..sessions.GetCount()? {
            let Ok(control) = sessions.GetSession(i) else { continue };
            let Ok(control) = control.cast::<IAudioSessionControl2>() else { continue };
            let pid = control.GetProcessId().unwrap_or(0);
            // pid 0 is the system sounds session.
            if pid == 0 {
                continue;
            }
            let active = control.GetState().map(|s| s == AudioSessionStateActive).unwrap_or(false);
            let Some(exe) = exe_name(pid) else { continue };
            match out.iter_mut().find(|a| a.pid == pid) {
                Some(a) => a.active |= active,
                None => out.push(AudioApp { pid, exe, active }),
            }
        }
        Ok(out)
    }
}

/// The process owning a top-level window whose AppUserModelID is `app_id`
/// (players like Yandex Music set it on their windows: "ru.yandex.desktop.music"
/// while the exe is "Яндекс Музыка"). Capturing that process includes its
/// children, where the sound is often actually played.
pub fn pid_for_app_id(app_id: &str) -> Option<u32> {
    struct Search<'a> {
        id: &'a str,
        found: Option<u32>,
    }
    unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
        let search = &mut *(lparam.0 as *mut Search);
        if !IsWindowVisible(hwnd).as_bool() {
            return true.into();
        }
        if let Ok(store) = SHGetPropertyStoreForWindow::<IPropertyStore>(hwnd) {
            if let Ok(value) = store.GetValue(&PKEY_AppUserModel_ID) {
                if let Ok(text) = PropVariantToStringAlloc(&value) {
                    let id = text.to_string().unwrap_or_default();
                    CoTaskMemFree(Some(text.0 as *const _));
                    if id.eq_ignore_ascii_case(search.id) {
                        let mut pid = 0u32;
                        GetWindowThreadProcessId(hwnd, Some(&mut pid));
                        search.found = Some(pid);
                        return false.into();
                    }
                }
            }
        }
        true.into()
    }
    let mut search = Search { id: app_id, found: None };
    unsafe {
        let _ = EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize));
    }
    search.found.filter(|&p| p != 0)
}

/// The app to listen to for a media session: the owner of its window when the
/// player tags its windows, otherwise the audio session with a matching name.
pub fn find_for_app_id(apps: &[AudioApp], app_id: &str) -> Option<AudioApp> {
    if let Some(pid) = pid_for_app_id(app_id) {
        let exe = exe_name(pid).unwrap_or_default();
        return Some(AudioApp { pid, exe, active: true });
    }
    match_app(apps, app_id).cloned()
}

/// Lower-case letters and digits only: "Yandex.Music" -> "yandexmusic".
fn squash(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// Cyrillic to Latin, close enough to compare names ("Яндекс" -> "yandeks").
fn translit(s: &str) -> String {
    const MAP: [(&str, &str); 33] = [
        ("а", "a"), ("б", "b"), ("в", "v"), ("г", "g"), ("д", "d"), ("е", "e"), ("ё", "e"), ("ж", "zh"), ("з", "z"), ("и", "i"), ("й", "y"),
        ("к", "k"), ("л", "l"), ("м", "m"), ("н", "n"), ("о", "o"), ("п", "p"), ("р", "r"), ("с", "s"), ("т", "t"), ("у", "u"), ("ф", "f"),
        ("х", "h"), ("ц", "ts"), ("ч", "ch"), ("ш", "sh"), ("щ", "sch"), ("ъ", ""), ("ы", "y"), ("ь", ""), ("э", "e"), ("ю", "yu"), ("я", "ya"),
    ];
    s.to_lowercase()
        .chars()
        .map(|c| MAP.iter().find(|(k, _)| k.starts_with(c)).map(|(_, v)| v.to_string()).unwrap_or_else(|| c.to_string()))
        .collect()
}

/// Words of a name, transliterated, without the ones every app has.
fn words(s: &str) -> Vec<String> {
    const GENERIC: [&str; 12] = ["ru", "com", "org", "net", "app", "desktop", "music", "player", "client", "exe", "windows", "microsoft"];
    // "SpotifyMusic" -> "spotify music": split camel case first.
    let mut spaced = String::new();
    let mut prev_lower = false;
    for c in s.chars() {
        if c.is_uppercase() && prev_lower {
            spaced.push(' ');
        }
        prev_lower = c.is_lowercase();
        spaced.push(c);
    }
    translit(&spaced)
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() >= 3 && !GENERIC.contains(w))
        .map(str::to_string)
        .collect()
}

/// The audio session that most likely belongs to a media session, given its
/// app id ("Spotify.exe", "Chrome", "SpotifyAB.SpotifyMusic_...!Spotify",
/// "ru.yandex.desktop.music" for "Яндекс Музыка").
pub fn match_app<'a>(apps: &'a [AudioApp], app_id: &str) -> Option<&'a AudioApp> {
    let id = squash(app_id);
    let last = squash(app_id.rsplit(['!', '\\', '/']).next().unwrap_or(app_id).trim_end_matches(".exe"));
    let id_words = words(app_id);
    let score = |a: &AudioApp| {
        let exe = squash(&a.exe);
        if exe.is_empty() {
            return 0;
        }
        let base = if exe == last {
            4
        } else if id.contains(&exe) || (last.len() >= 4 && exe.contains(&last)) {
            3
        } else if words(&a.exe).iter().any(|w| id_words.iter().any(|v| w.len() >= 4 && v.len() >= 4 && w[..4] == v[..4])) {
            // Shared word start, across alphabets: "yandeks" ~ "yandex".
            2
        } else {
            0
        };
        // Prefer the session that is actually making sound.
        if base > 0 && a.active { base + 1 } else { base }
    };
    apps.iter().filter(|a| score(a) > 0).max_by_key(|a| score(a))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(pid: u32, exe: &str, active: bool) -> AudioApp {
        AudioApp { pid, exe: exe.into(), active }
    }

    #[test]
    fn matches_media_app_ids_to_audio_sessions() {
        let apps = [app(1, "chrome", false), app(2, "chrome", true), app(3, "Spotify", true), app(4, "Discord", true)];
        assert_eq!(match_app(&apps, "Chrome").map(|a| a.pid), Some(2));
        assert_eq!(match_app(&apps, "Spotify.exe").map(|a| a.pid), Some(3));
        assert_eq!(match_app(&apps, "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify").map(|a| a.pid), Some(3));
        assert_eq!(match_app(&apps, "Yandex.Music"), None);
        // Cyrillic exe names match a Latin app id by word starts.
        let ru = [app(5, "Яндекс Музыка", true), app(6, "SignalRgb", true)];
        assert_eq!(match_app(&ru, "ru.yandex.desktop.music").map(|a| a.pid), Some(5));
        // Generic words alone ("music", "desktop") never match.
        assert_eq!(match_app(&[app(7, "Apple Music", true)], "ru.yandex.desktop.music"), None);
    }
}
