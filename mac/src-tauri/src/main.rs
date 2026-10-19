// Horror HQ for Mac. The screens and their logic are the Apps Script app's own files,
// bundled by build_web.js; this side reads and writes the data file in Documents, keeps
// daily backups of it, and serves posters from a cache on disk (poster://localhost/w342/abc.jpg).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use tauri::http::{Request, Response};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{Emitter, Manager};

const FOLDER: &str = "Horror HQ";
const FILE: &str = "Horror HQ Data.json";
const BACKUPS_KEPT: usize = 14;
const TMDB_IMAGES: &str = "https://image.tmdb.org/t/p/";

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let paths = app.path();
    let docs = match paths.document_dir() {
        Ok(dir) => dir,
        Err(_) => paths.home_dir().map_err(|e| e.to_string())?.join("Documents"),
    };
    Ok(docs.join(FOLDER))
}

/// The data file's contents, or None before the first import.
#[tauri::command]
fn load_data(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = data_dir(&app)?.join(FILE);
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Couldn't read {}: {}", path.display(), e))
}

/// Writes the data file via a temp file and rename, so a crash mid-save can't leave half a file.
/// The first save of each day (`day` is the Mac's local date) first copies yesterday's file into Backups.
#[tauri::command]
fn save_data(app: tauri::AppHandle, json: String, day: String) -> Result<String, String> {
    let dir = data_dir(&app)?;
    let path = dir.join(FILE);
    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {}", dir.display(), e))?;
    if path.exists() && is_day(&day) {
        backup(&dir, &path, &day)?;
    }
    let tmp = dir.join(format!(".{}.tmp", FILE));
    fs::write(&tmp, json).map_err(|e| format!("Couldn't write {}: {}", tmp.display(), e))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Couldn't save {}: {}", path.display(), e))?;
    Ok(path.display().to_string())
}

fn is_day(day: &str) -> bool {
    day.len() == 10 && day.chars().all(|c| c.is_ascii_digit() || c == '-')
}

fn backup(dir: &Path, path: &Path, day: &str) -> Result<(), String> {
    let backups = dir.join("Backups");
    let target = backups.join(format!("Horror HQ Data {}.json", day));
    if target.exists() {
        return Ok(());
    }
    fs::create_dir_all(&backups).map_err(|e| format!("Couldn't create {}: {}", backups.display(), e))?;
    fs::copy(path, &target).map_err(|e| format!("Couldn't back up to {}: {}", target.display(), e))?;
    // Names sort by date, so the oldest come first.
    let mut old: Vec<PathBuf> = fs::read_dir(&backups)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.file_name().map_or(false, |n| n.to_string_lossy().starts_with("Horror HQ Data ")))
        .collect();
    old.sort();
    while old.len() > BACKUPS_KEPT {
        let _ = fs::remove_file(old.remove(0));
    }
    Ok(())
}

/// poster://localhost/w342/abc.jpg -> the cached copy of https://image.tmdb.org/t/p/w342/abc.jpg,
/// downloaded the first time it is asked for.
fn poster(cache: &Path, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let rel = request.uri().path().trim_start_matches('/').to_string();
    let safe = !rel.is_empty()
        && !rel.contains("..")
        && rel.chars().all(|c| c.is_ascii_alphanumeric() || "._-/".contains(c));
    if !safe {
        return reply(400, "text/plain", b"bad poster path".to_vec());
    }
    let file = cache.join(&rel);
    if let Ok(bytes) = fs::read(&file) {
        return reply(200, "image/jpeg", bytes);
    }
    match ureq::get(&format!("{}{}", TMDB_IMAGES, rel)).call() {
        Ok(mut res) => match res.body_mut().read_to_vec() {
            Ok(bytes) => {
                if let Some(parent) = file.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = fs::write(&file, &bytes);
                reply(200, "image/jpeg", bytes)
            }
            Err(_) => reply(502, "text/plain", b"poster download failed".to_vec()),
        },
        Err(_) => reply(404, "text/plain", b"poster not available offline".to_vec()),
    }
}

fn reply(status: u16, kind: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", kind)
        .header("Access-Control-Allow-Origin", "*")
        .body(body)
        .unwrap()
}

fn main() {
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("poster", |ctx, request, responder| {
            let cache = ctx
                .app_handle()
                .path()
                .app_cache_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("horror-hq"))
                .join("posters");
            std::thread::spawn(move || responder.respond(poster(&cache, &request)));
        })
        .setup(|app| {
            // The standard Mac menus, plus "Import a Fresh Copy…" under Horror HQ.
            let menu = Menu::default(app.handle())?;
            let fresh = MenuItem::with_id(app, "import-fresh", "Import a Fresh Copy…", true, None::<&str>)?;
            if let Some(first) = menu.items()?.first().and_then(|i| i.as_submenu().cloned()) {
                first.insert(&PredefinedMenuItem::separator(app)?, 1)?;
                first.insert(&fresh, 2)?;
            }
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "import-fresh" {
                let _ = app.emit("import-fresh", ());
            }
        })
        .invoke_handler(tauri::generate_handler![load_data, save_data])
        .run(tauri::generate_context!())
        .expect("error while running Horror HQ");
}
