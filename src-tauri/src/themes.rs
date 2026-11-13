//! Theme packs: a folder with `theme.json`, and optionally a stylesheet and a
//! background shader, in `<app data>/themes/<id>`.
//!
//! A theme is data, not a program: the styles are checked field by field by
//! the frontend (core/themes.ts), the stylesheet is cleaned here so it cannot
//! load anything from the network, and the shader runs on the GPU only. The
//! format is described in docs/THEMES.md.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::state::AppState;

/// The theme.json format this version reads.
pub const FORMAT: u64 = 1;
const MAX_JSON: u64 = 256 * 1024;
const MAX_CSS: u64 = 256 * 1024;
const MAX_SHADER: u64 = 64 * 1024;

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    /// Folder name.
    pub id: String,
    pub name: String,
    pub author: String,
    pub version: String,
    pub description: String,
    /// Two swatch colours for the theme's card.
    pub colors: Vec<String>,
    /// The whole theme.json; the frontend picks and checks the styles in it.
    pub data: Value,
    pub css: Option<String>,
    pub shader: Option<String>,
    /// Why the theme can't be used, if it can't.
    pub error: Option<String>,
}

fn dir(app: &AppHandle) -> PathBuf {
    app.state::<AppState>().data_dir.join("themes")
}

/// Every installed theme, broken ones included (with `error`), by name.
pub fn list(app: &AppHandle) -> Vec<Theme> {
    let Ok(entries) = fs::read_dir(dir(app)) else { return Vec::new() };
    let mut out: Vec<Theme> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| {
            let id = e.file_name().to_string_lossy().to_string();
            load(&e.path()).map(|t| Theme { id: id.clone(), ..t }).unwrap_or_else(|error| Theme {
                name: id.clone(),
                id,
                error: Some(error),
                ..Default::default()
            })
        })
        .collect();
    out.sort_by_key(|t| t.name.to_lowercase());
    out
}

pub fn get(app: &AppHandle, id: &str) -> Option<Theme> {
    let path = dir(app).join(safe_id(id)?);
    load(&path).ok().map(|t| Theme { id: id.to_string(), ..t })
}

fn read_limited(path: &Path, max: u64) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|_| format!("нет файла {}", file_name(path)))?;
    if meta.len() > max {
        return Err(format!("{} больше {} КБ", file_name(path), max / 1024));
    }
    fs::read_to_string(path).map_err(|_| format!("{} не читается как текст UTF-8", file_name(path)))
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

/// A file named in theme.json, which must stay inside the theme's folder.
fn inner_file(root: &Path, name: &str) -> Result<PathBuf, String> {
    let rel = Path::new(name);
    let plain = rel.components().all(|c| matches!(c, std::path::Component::Normal(_)));
    if !plain || name.is_empty() {
        return Err(format!("путь «{name}» должен вести к файлу внутри папки темы"));
    }
    Ok(root.join(rel))
}

fn text(v: &Value, key: &str, max: usize) -> String {
    v.get(key).and_then(Value::as_str).map(|s| s.trim().chars().take(max).collect()).unwrap_or_default()
}

/// Reads and checks a theme folder.
pub fn load(root: &Path) -> Result<Theme, String> {
    let raw = read_limited(&root.join("theme.json"), MAX_JSON)?;
    let data: Value = serde_json::from_str(&raw).map_err(|e| format!("theme.json: {e}"))?;
    if !data.is_object() {
        return Err("theme.json должен быть объектом { … }".into());
    }
    let format = data.get("muse").and_then(Value::as_u64).unwrap_or(FORMAT);
    if format > FORMAT {
        return Err(format!("тема для более новой MUSE (формат {format}), обновите приложение"));
    }
    let name = text(&data, "name", 60);
    if name.is_empty() {
        return Err("в theme.json нет названия (\"name\")".into());
    }
    let css = match data.get("css").and_then(Value::as_str) {
        Some(f) => Some(clean_css(&read_limited(&inner_file(root, f)?, MAX_CSS)?)),
        None => None,
    };
    let shader = match data.get("shader").and_then(Value::as_str) {
        Some(f) => Some(read_limited(&inner_file(root, f)?, MAX_SHADER)?),
        None => None,
    };
    let colors = data
        .get("colors")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).filter(|c| is_hex(c)).take(2).map(str::to_string).collect())
        .unwrap_or_default();
    Ok(Theme {
        id: String::new(),
        author: text(&data, "author", 60),
        version: text(&data, "version", 20),
        description: text(&data, "description", 240),
        name,
        colors,
        data,
        css,
        shader,
        error: None,
    })
}

fn is_hex(c: &str) -> bool {
    static HEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^#[0-9a-fA-F]{6}$").unwrap());
    HEX.is_match(c)
}

/// A theme's stylesheet may restyle MUSE, but not reach the network: no
/// @import, and url() only for data: URIs (images or fonts inside the file).
pub fn clean_css(css: &str) -> String {
    static IMPORT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)@import[^;]*;?").unwrap());
    static URL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)url\(\s*(['"]?)([^)]*?)(['"]?)\s*\)"#).unwrap());
    let css = IMPORT.replace_all(css, "/* @import removed */");
    URL.replace_all(&css, |c: &regex::Captures| {
        if c[2].trim_start().to_ascii_lowercase().starts_with("data:") {
            c[0].to_string()
        } else {
            "none".to_string()
        }
    })
    .to_string()
}

fn safe_id(id: &str) -> Option<&str> {
    let ok = !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    ok.then_some(id)
}

/// A folder name from the theme's name: latin letters, digits and dashes.
fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.to_lowercase().chars() {
        let t = translit(c);
        if t.is_empty() {
            if !out.ends_with('-') {
                out.push('-');
            }
        } else {
            out.push_str(t);
        }
    }
    let s: String = out.trim_matches('-').chars().take(40).collect();
    if s.is_empty() { "theme".into() } else { s }
}

fn translit(c: char) -> &'static str {
    const RU: [(&str, &str); 33] = [
        ("а", "a"), ("б", "b"), ("в", "v"), ("г", "g"), ("д", "d"), ("е", "e"), ("ё", "e"), ("ж", "zh"), ("з", "z"), ("и", "i"), ("й", "y"),
        ("к", "k"), ("л", "l"), ("м", "m"), ("н", "n"), ("о", "o"), ("п", "p"), ("р", "r"), ("с", "s"), ("т", "t"), ("у", "u"), ("ф", "f"),
        ("х", "h"), ("ц", "c"), ("ч", "ch"), ("ш", "sh"), ("щ", "sch"), ("ъ", ""), ("ы", "y"), ("ь", ""), ("э", "e"), ("ю", "yu"), ("я", "ya"),
    ];
    const ASCII: &str = "abcdefghijklmnopqrstuvwxyz0123456789";
    if let Some(i) = ASCII.find(c) {
        return &ASCII[i..i + 1];
    }
    let mut buf = [0u8; 4];
    let s = c.encode_utf8(&mut buf);
    RU.iter().find(|(k, _)| *k == s).map(|(_, v)| *v).unwrap_or("")
}

/// Files of a theme: theme.json and what it names.
fn theme_files(data: &Value) -> Vec<String> {
    let mut files = vec!["theme.json".to_string()];
    for key in ["css", "shader"] {
        if let Some(f) = data.get(key).and_then(Value::as_str) {
            files.push(f.replace('\\', "/"));
        }
    }
    files
}

/// Installs from a theme.json (its folder) or a .zip; a theme of the same
/// name is updated. Returns the theme's id.
pub fn install_from(app: &AppHandle, path: &Path) -> Result<String, String> {
    let staging = dir(app).join(".incoming");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let result = (|| {
        let is_zip = path.extension().is_some_and(|e| e.eq_ignore_ascii_case("zip"));
        if is_zip {
            unzip_theme(path, &staging)?;
        } else {
            let root = if path.is_dir() { path.to_path_buf() } else { path.parent().ok_or("нет папки")?.to_path_buf() };
            let raw = read_limited(&root.join("theme.json"), MAX_JSON)?;
            let data: Value = serde_json::from_str(&raw).map_err(|e| format!("theme.json: {e}"))?;
            for f in theme_files(&data) {
                let from = inner_file(&root, &f)?;
                let to = staging.join(&f);
                if let Some(p) = to.parent() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
                fs::copy(&from, &to).map_err(|_| format!("не получилось скопировать {f}"))?;
            }
        }
        let theme = load(&staging)?;
        let id = slug(&theme.name);
        let dest = dir(app).join(&id);
        let _ = fs::remove_dir_all(&dest);
        fs::rename(&staging, &dest).map_err(|e| e.to_string())?;
        Ok(id)
    })();
    let _ = fs::remove_dir_all(&staging);
    result
}

/// Takes theme.json and the files it names out of a zip, from its top level
/// or the one folder everything is in.
fn unzip_theme(path: &Path, to: &Path) -> Result<(), String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "это не zip-архив".to_string())?;
    let names: Vec<String> = (0..zip.len()).filter_map(|i| zip.by_index(i).ok().map(|f| f.name().replace('\\', "/"))).collect();
    let json = names
        .iter()
        .filter(|n| n.ends_with("theme.json") && n.matches('/').count() <= 1)
        .min_by_key(|n| n.len())
        .ok_or("в архиве нет theme.json")?
        .clone();
    let prefix = json.trim_end_matches("theme.json").to_string();
    let mut read = |name: &str, max: u64| -> Result<Vec<u8>, String> {
        let mut f = zip.by_name(&format!("{prefix}{name}")).map_err(|_| format!("в архиве нет {name}"))?;
        if f.size() > max {
            return Err(format!("{name} больше {} КБ", max / 1024));
        }
        let mut buf = Vec::new();
        f.by_ref().take(max + 1).read_to_end(&mut buf).map_err(|e| e.to_string())?;
        Ok(buf)
    };
    let raw = read("theme.json", MAX_JSON)?;
    let data: Value = serde_json::from_slice(&raw).map_err(|e| format!("theme.json: {e}"))?;
    for f in theme_files(&data) {
        let bytes = if f == "theme.json" { raw.clone() } else { read(&f, MAX_CSS.max(MAX_SHADER))? };
        let dest = inner_file(to, &f)?;
        if let Some(p) = dest.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn remove(app: &AppHandle, id: &str) -> Result<(), String> {
    let id = safe_id(id).ok_or("неверная тема")?;
    fs::remove_dir_all(dir(app).join(id)).map_err(|e| e.to_string())
}

/// Writes a theme zip: theme.json, plus style.css and background.frag when given.
pub fn write_zip(path: &Path, data: &Value, css: Option<&str>, shader: Option<&str>) -> Result<(), String> {
    let mut data = data.clone();
    if css.is_some() {
        data["css"] = "style.css".into();
    }
    if shader.is_some() {
        data["shader"] = "background.frag".into();
    }
    let file = fs::File::create(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default();
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    for (name, body) in [("theme.json", Some(json.as_str())), ("style.css", css), ("background.frag", shader)] {
        if let Some(body) = body {
            zip.start_file(name, opts).map_err(|e| e.to_string())?;
            zip.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
        }
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn changed(app: &AppHandle) {
    let _ = app.emit("themes:changed", ());
}

// ---- Commands ----

#[tauri::command]
pub fn list_themes(app: AppHandle) -> Vec<Theme> {
    list(&app)
}

#[tauri::command]
pub fn get_theme(app: AppHandle, id: String) -> Option<Theme> {
    get(&app, &id)
}

/// Asks for a .zip or a theme.json and installs it. None: the user cancelled.
#[tauri::command]
pub async fn install_theme(app: AppHandle) -> Result<Option<String>, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Установить тему MUSE")
        .add_filter("Тема MUSE", &["zip", "json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let id = install_from(&app, &path)?;
    crate::log_info!("themes", "installed {id}");
    changed(&app);
    Ok(Some(id))
}

#[tauri::command]
pub fn remove_theme(app: AppHandle, id: String) -> Result<(), String> {
    remove(&app, &id)?;
    changed(&app);
    Ok(())
}

/// Asks where to save, and writes the theme there as a zip. None: cancelled.
#[tauri::command]
pub async fn export_theme(app: AppHandle, data: Value, css: Option<String>, shader: Option<String>) -> Result<Option<String>, String> {
    let name = slug(&text(&data, "name", 60));
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Сохранить тему MUSE")
        .set_file_name(format!("{name}.zip"))
        .add_filter("Тема MUSE", &["zip"])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    write_zip(&path, &data, css.as_deref(), shader.as_deref())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn open_themes_folder(app: AppHandle) {
    let d = dir(&app);
    let _ = fs::create_dir_all(&d);
    let _ = std::process::Command::new("explorer").arg(&d).spawn();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn css_cannot_reach_the_network() {
        let css = "@import url(https://x.y/a.css); .a{background:url('https://x.y/i.png')} .b{background:url(data:image/png;base64,AAA)}";
        let out = clean_css(css);
        assert!(!out.contains("https"), "{out}");
        assert!(out.contains("url(data:image/png;base64,AAA)"));
        assert!(out.contains("background:none"));
    }

    #[test]
    fn names_become_folder_names() {
        assert_eq!(slug("Ночной неон"), "nochnoy-neon");
        assert_eq!(slug("Aurora 2!"), "aurora-2");
        assert_eq!(slug("✨"), "theme");
    }

    #[test]
    fn files_stay_inside_the_theme() {
        let root = Path::new("C:/t");
        assert!(inner_file(root, "../evil.css").is_err());
        assert!(inner_file(root, "C:/Windows/x.css").is_err());
        assert!(inner_file(root, "css/style.css").is_ok());
    }

    #[test]
    fn a_theme_round_trips_through_a_zip() {
        let tmp = std::env::temp_dir().join(format!("muse-theme-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let zip_path = tmp.join("t.zip");
        let data = serde_json::json!({ "muse": 1, "name": "Тест", "main": { "lyrics": { "glow": 2 } } });
        write_zip(&zip_path, &data, Some(".lx-line{color:red}"), Some("void main(){gl_FragColor=vec4(1.0);}")).unwrap();
        let out = tmp.join("out");
        fs::create_dir_all(&out).unwrap();
        unzip_theme(&zip_path, &out).unwrap();
        let t = load(&out).unwrap();
        assert_eq!(t.name, "Тест");
        assert_eq!(t.css.as_deref(), Some(".lx-line{color:red}"));
        assert!(t.shader.unwrap().contains("gl_FragColor"));
        let _ = fs::remove_dir_all(&tmp);
    }
}
