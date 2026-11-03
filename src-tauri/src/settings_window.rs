use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "settings";

/// Opens the settings window, or brings it forward if it is already open.
pub fn open(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("mutxt · Настройки")
        .inner_size(1040.0, 720.0)
        .min_inner_size(780.0, 540.0)
        .decorations(false)
        .shadow(true)
        .center()
        .background_color(tauri::window::Color(22, 18, 24, 255))
        .build()?;
    Ok(())
}
