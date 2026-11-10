mod ffmpeg;
mod media;
mod models;
mod overlay;
mod settings;

use ffmpeg::ExportState;
use models::{ExportRequest, ExportResult, ImportOutcome, ToolsStatus};
use std::path::Path;
use std::process::Command;
use tauri::{AppHandle, Manager};

#[tauri::command]
async fn check_tools() -> ToolsStatus {
    tauri::async_runtime::spawn_blocking(media::tools_status)
        .await
        .unwrap_or_else(|_| ToolsStatus {
            available: false,
            version: None,
            ffmpeg_path: None,
            ffprobe_path: None,
            error: Some("Couldn't check the FFmpeg installation.".to_string()),
        })
}

#[tauri::command]
async fn import_media(paths: Vec<String>) -> Result<ImportOutcome, String> {
    match tauri::async_runtime::spawn_blocking(move || media::import_paths(&paths)).await {
        Ok(result) => result,
        Err(error) => Err(format!("The import stopped unexpectedly: {error}")),
    }
}

#[tauri::command]
async fn import_gifs(app: AppHandle, paths: Vec<String>) -> Result<ImportOutcome, String> {
    let cache_root = app
        .path()
        .app_cache_dir()
        .map(|dir| dir.join("gif-imports"))
        .unwrap_or_else(|_| std::env::temp_dir().join("gifsmith-gif-imports"));

    match tauri::async_runtime::spawn_blocking(move || {
        media::import_gif_paths(&paths, &cache_root)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => Err(format!("The GIF import stopped unexpectedly: {error}")),
    }
}

#[tauri::command]
async fn export_gif(app: AppHandle, request: ExportRequest) -> Result<ExportResult, String> {
    let app_handle = app.clone();
    match tauri::async_runtime::spawn_blocking(move || {
        ffmpeg::perform_export(&app_handle, &request)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => Err(format!("The export stopped unexpectedly: {error}")),
    }
}

#[tauri::command]
fn cancel_export(state: tauri::State<'_, ExportState>) {
    state.cancel();
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err("That file no longer exists.".to_string());
    }
    let status = Command::new("open")
        .arg("-R")
        .arg(target)
        .status()
        .map_err(|error| format!("Couldn't reveal the file: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Couldn't reveal the file in Finder.".to_string())
    }
}

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err("That file no longer exists.".to_string());
    }
    Command::new("open")
        .arg(target)
        .status()
        .map_err(|error| format!("Couldn't open the file: {error}"))?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ExportState::default())
        .invoke_handler(tauri::generate_handler![
            check_tools,
            import_media,
            import_gifs,
            export_gif,
            cancel_export,
            reveal_in_finder,
            open_file,
            settings::load_settings,
            settings::save_settings,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                window.app_handle().state::<ExportState>().cancel();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Gifsmith");
}
