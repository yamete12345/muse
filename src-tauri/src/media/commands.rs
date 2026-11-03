use tauri::State;
use windows::Media::Control::GlobalSystemMediaTransportControlsSession as Session;

use crate::state::AppState;

fn with_session(
    state: &AppState,
    f: impl FnOnce(&Session) -> windows::core::Result<bool>,
) -> Result<(), String> {
    let session = state.session.lock().unwrap().clone().ok_or("no media session")?;
    match f(&session) {
        Ok(true) => Ok(()),
        Ok(false) => Err("player rejected the command".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn media_toggle(state: State<'_, AppState>) -> Result<(), String> {
    with_session(&state, |s| s.TryTogglePlayPauseAsync()?.get())
}

#[tauri::command]
pub async fn media_next(state: State<'_, AppState>) -> Result<(), String> {
    with_session(&state, |s| s.TrySkipNextAsync()?.get())
}

#[tauri::command]
pub async fn media_prev(state: State<'_, AppState>) -> Result<(), String> {
    with_session(&state, |s| s.TrySkipPreviousAsync()?.get())
}

#[tauri::command]
pub async fn media_seek(state: State<'_, AppState>, ms: i64) -> Result<(), String> {
    with_session(&state, |s| {
        let start = s.GetTimelineProperties()?.StartTime()?.Duration;
        s.TryChangePlaybackPositionAsync(start + ms.max(0) * 10_000)?.get()
    })
}
