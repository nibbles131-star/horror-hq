// Horror HQ for Mac. The screens and their logic are the Apps Script app's own files,
// bundled by build_web.js; this side only reads and writes the data file in Documents.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use tauri::Manager;

const FOLDER: &str = "Horror HQ";
const FILE: &str = "Horror HQ Data.json";

fn data_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let paths = app.path();
    let docs = match paths.document_dir() {
        Ok(dir) => dir,
        Err(_) => paths.home_dir().map_err(|e| e.to_string())?.join("Documents"),
    };
    Ok(docs.join(FOLDER).join(FILE))
}

/// The data file's contents, or None before the first import.
#[tauri::command]
fn load_data(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = data_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Couldn't read {}: {}", path.display(), e))
}

/// Writes the data file via a temp file and rename, so a crash mid-save can't leave half a file.
#[tauri::command]
fn save_data(app: tauri::AppHandle, json: String) -> Result<String, String> {
    let path = data_path(&app)?;
    let dir = path.parent().ok_or("No folder for the data file")?;
    fs::create_dir_all(dir).map_err(|e| format!("Couldn't create {}: {}", dir.display(), e))?;
    let tmp = dir.join(format!(".{}.tmp", FILE));
    fs::write(&tmp, json).map_err(|e| format!("Couldn't write {}: {}", tmp.display(), e))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Couldn't save {}: {}", path.display(), e))?;
    Ok(path.display().to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![load_data, save_data])
        .run(tauri::generate_context!())
        .expect("error while running Horror HQ");
}
