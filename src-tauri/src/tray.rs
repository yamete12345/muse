use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::state::AppState;

const TRAY_ID: &str = "main";

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
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

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let s = app.state::<AppState>().settings.lock().unwrap().clone();
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
            &MenuItem::with_id(app, "show", "Показать окно", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
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
        .tooltip("mutxt")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let s = app.state::<AppState>().settings.lock().unwrap().clone();
            let patch = match event.id().as_ref() {
                "show" => return show_main(app),
                "quit" => return app.exit(0),
                "widget" => serde_json::json!({ "widgetEnabled": !s.widget_enabled, "widgetEdit": false }),
                "widget-edit" => serde_json::json!({ "widgetEdit": !s.widget_edit }),
                "autostart" => serde_json::json!({ "autostart": !s.autostart }),
                id if id.starts_with("theme:") => serde_json::json!({ "theme": &id[6..] }),
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
