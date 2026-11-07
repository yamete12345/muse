use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::state::AppState;

const TRAY_ID: &str = "main";

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Shows the main window on its settings tab.
pub fn show_settings(app: &AppHandle) {
    show_main(app);
    let _ = app.emit_to("main", "ui:settings", ());
}

pub fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show_main(app);
        }
    }
}

/// Shows the main window with the lyrics search open.
pub fn show_search(app: &AppHandle) {
    show_main(app);
    let _ = app.emit_to("main", "ui:search", ());
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let state = app.state::<AppState>();
    let s = state.settings.lock().unwrap().clone();
    let media = state.media.lock().unwrap().clone().filter(|m| !m.title.is_empty());
    let offset = media.as_ref().map(|m| state.offset_for(&m.key)).unwrap_or(0);
    let playing = media.is_some();

    let now = match &media {
        Some(m) if !m.artist.is_empty() => format!("{} — {}", m.artist, m.title),
        Some(m) => m.title.clone(),
        None => "Ничего не играет".to_string(),
    };
    // Long names would make the menu very wide.
    let now: String = if now.chars().count() > 48 { now.chars().take(47).chain(['…']).collect() } else { now };
    let reset_label = if offset == 0 {
        "Сдвиг текста: нет".to_string()
    } else {
        format!("Сбросить сдвиг ({:+.1} с)", offset as f64 / 1000.0)
    };
    let lyrics = Submenu::with_items(
        app,
        "Текст песни",
        playing,
        &[
            &MenuItem::with_id(app, "offset:earlier", "Раньше на 0.1 с", playing, None::<&str>)?,
            &MenuItem::with_id(app, "offset:later", "Позже на 0.1 с", playing, None::<&str>)?,
            &MenuItem::with_id(app, "offset:reset", reset_label, playing && offset != 0, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "lyrics:wrong", "Текст неправильный…", playing, None::<&str>)?,
            &MenuItem::with_id(app, "lyrics:retry", "Найти заново", playing, None::<&str>)?,
        ],
    )?;
    // Everything in the media flyout; a pick stays shown until "automatic".
    let sources = crate::media::gsmtc::known_sources();
    let source = Submenu::with_id(app, "source", "Источник", sources.len() > 1)?;
    source.append(&CheckMenuItem::with_id(app, "source:", "Автоматически: что играет", true, s.media_source.is_empty(), None::<&str>)?)?;
    source.append(&PredefinedMenuItem::separator(app)?)?;
    for (id, name, shown) in &sources {
        let label = if *shown && s.media_source.is_empty() { format!("{name} · сейчас") } else { name.clone() };
        source.append(&CheckMenuItem::with_id(app, format!("source:{id}"), label, true, s.media_source == *id, None::<&str>)?)?;
    }
    source.append(&PredefinedMenuItem::separator(app)?)?;
    source.append(&MenuItem::with_id(app, "source:hint", "Следующий: Ctrl+Alt+S", false, None::<&str>)?)?;
    let theme = Submenu::with_items(
        app,
        "Тема",
        true,
        &[
            &CheckMenuItem::with_id(app, "theme:dark", "Тёмная", true, s.theme == "dark", None::<&str>)?,
            &CheckMenuItem::with_id(app, "theme:light", "Светлая", true, s.theme == "light", None::<&str>)?,
            &CheckMenuItem::with_id(app, "theme:system", "Как в системе", true, s.theme == "system", None::<&str>)?,
        ],
    )?;
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "now", now, false, None::<&str>)?,
            &MenuItem::with_id(app, "track:prev", "Предыдущий трек", playing, None::<&str>)?,
            &MenuItem::with_id(app, "track:next", "Следующий трек", playing, None::<&str>)?,
            &lyrics,
            &source,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "show", "Показать окно", true, None::<&str>)?,
            &MenuItem::with_id(app, "settings", "Настройки…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &CheckMenuItem::with_id(app, "wallpaper", "Живые обои", true, s.wallpaper_enabled, None::<&str>)?,
            &CheckMenuItem::with_id(app, "widget", "Виджет на рабочем столе", true, s.widget_enabled, None::<&str>)?,
            &CheckMenuItem::with_id(app, "widget-edit", "Переместить виджет", s.widget_enabled, s.widget_edit, None::<&str>)?,
            &theme,
            &CheckMenuItem::with_id(app, "autostart", "Запускать вместе с Windows", true, s.autostart, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?,
        ],
    )
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("MUSE")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let s = app.state::<AppState>().settings.lock().unwrap().clone();
            let patch = match event.id().as_ref() {
                "show" => return show_main(app),
                "settings" => return show_settings(app),
                "quit" => return app.exit(0),
                "offset:earlier" => {
                    crate::change_offset(app, |v| v + 100);
                    return;
                }
                "offset:later" => {
                    crate::change_offset(app, |v| v - 100);
                    return;
                }
                "offset:reset" => {
                    crate::change_offset(app, |_| 0);
                    return;
                }
                "track:next" => return crate::media::commands::skip(app, true),
                "track:prev" => return crate::media::commands::skip(app, false),
                "lyrics:wrong" => return show_search(app),
                "lyrics:retry" => return crate::retry(app),
                "wallpaper" => serde_json::json!({ "wallpaperEnabled": !s.wallpaper_enabled }),
                "widget" => serde_json::json!({ "widgetEnabled": !s.widget_enabled, "widgetEdit": false }),
                "widget-edit" => serde_json::json!({ "widgetEdit": !s.widget_edit }),
                "autostart" => serde_json::json!({ "autostart": !s.autostart }),
                id if id.starts_with("theme:") => serde_json::json!({ "theme": &id[6..] }),
                "source:hint" => return,
                id if id.starts_with("source:") => serde_json::json!({ "mediaSource": &id[7..] }),
                _ => return,
            };
            let _ = crate::settings::update(app, patch);
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Rebuilds the menu so check marks follow the settings.
pub fn refresh(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY_ID), build_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}
