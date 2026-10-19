// Horror HQ for Mac. The screens and their logic are the Apps Script app's own files,
// bundled by build_web.js; this side reads and writes the data file in Documents, keeps
// daily backups of it, serves posters from a cache on disk (poster://localhost/w342/abc.jpg),
// and does the few things a web page can't: saving downloads, spreadsheet export, Finder and links.
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

/// Where the data file lives, for "Show in Finder".
#[tauri::command]
fn data_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(data_dir(&app)?.join(FILE).display().to_string())
}

/// Admin > Back up now: a dated snapshot in Backups that the daily rotation never deletes.
#[tauri::command]
fn backup_now(app: tauri::AppHandle, json: String, stamp: String) -> Result<String, String> {
    let backups = data_dir(&app)?.join("Backups");
    fs::create_dir_all(&backups).map_err(|e| format!("Couldn't create {}: {}", backups.display(), e))?;
    let path = backups.join(format!("Horror HQ Snapshot {}.json", clean_name(&stamp)));
    fs::write(&path, json).map_err(|e| format!("Couldn't write {}: {}", path.display(), e))?;
    Ok(path.display().to_string())
}

/// A file the page wanted to download (base64), saved into Downloads without overwriting anything.
#[tauri::command]
fn save_download(app: tauri::AppHandle, name: String, data: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("Bad download data: {}", e))?;
    let path = free_path(&downloads(&app)?, &clean_name(&name));
    fs::write(&path, bytes).map_err(|e| format!("Couldn't save {}: {}", path.display(), e))?;
    Ok(path.display().to_string())
}

/// Every table as a tab in an .xlsx in Downloads, from the same JSON the data file holds.
#[tauri::command]
fn export_xlsx(app: tauri::AppHandle, json: String, day: String) -> Result<String, String> {
    use rust_xlsxwriter::{Format, Workbook};
    let data: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    let tables = data["tables"].as_object().ok_or("No tables in the data")?;
    let bold = Format::new().set_bold();
    let mut book = Workbook::new();
    for (name, rows) in tables {
        let rows = rows.as_array().cloned().unwrap_or_default();
        let mut cols: Vec<String> = Vec::new();
        for row in &rows {
            for key in row.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default() {
                if !cols.contains(&key) {
                    cols.push(key);
                }
            }
        }
        let sheet = book.add_worksheet();
        let xl = |e: rust_xlsxwriter::XlsxError| e.to_string();
        sheet.set_name(name.chars().take(31).collect::<String>()).map_err(xl)?;
        for (c, col) in cols.iter().enumerate() {
            sheet.write_string_with_format(0, c as u16, col, &bold).map_err(xl)?;
        }
        for (r, row) in rows.iter().enumerate() {
            let r = r as u32 + 1;
            for (c, col) in cols.iter().enumerate() {
                let c = c as u16;
                match &row[col] {
                    serde_json::Value::Null => {}
                    serde_json::Value::Bool(b) => { sheet.write_boolean(r, c, *b).map_err(xl)?; }
                    serde_json::Value::Number(n) => { sheet.write_number(r, c, n.as_f64().unwrap_or(0.0)).map_err(xl)?; }
                    serde_json::Value::String(s) => { sheet.write_string(r, c, cell(s)).map_err(xl)?; }
                    other => { sheet.write_string(r, c, cell(&other.to_string())).map_err(xl)?; }
                }
            }
        }
        sheet.set_freeze_panes(1, 0).map_err(xl)?;
        sheet.autofit();
    }
    let path = free_path(&downloads(&app)?, &format!("Horror HQ {}.xlsx", clean_name(&day)));
    book.save(&path).map_err(|e| format!("Couldn't save {}: {}", path.display(), e))?;
    Ok(path.display().to_string())
}

/// Shows a file in Finder.
#[tauri::command]
fn reveal(path: String) -> Result<(), String> {
    let mut cmd = std::process::Command::new(if cfg!(target_os = "macos") { "open" } else { "xdg-open" });
    if cfg!(target_os = "macos") {
        cmd.arg("-R").arg(&path);
    } else {
        cmd.arg(Path::new(&path).parent().unwrap_or(Path::new("/")));
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Opens a web link in the default browser (links can't open new windows inside the app).
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only web links can be opened".into());
    }
    std::process::Command::new(if cfg!(target_os = "macos") { "open" } else { "xdg-open" })
        .arg(&url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn downloads(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let paths = app.path();
    let dir = match paths.download_dir() {
        Ok(dir) => dir,
        Err(_) => paths.home_dir().map_err(|e| e.to_string())?.join("Downloads"),
    };
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Keeps a file name to letters, digits and a little punctuation, so it can't climb out of its folder.
fn clean_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || " ._-()".contains(c) { c } else { '-' })
        .collect();
    let s = s.trim_start_matches('.').trim().to_string();
    if s.is_empty() { "Horror HQ".into() } else { s }
}

/// "name.ext", or "name 2.ext", "name 3.ext"... whichever doesn't exist yet.
fn free_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) => (&name[..i], &name[i..]),
        None => (name, ""),
    };
    (2..)
        .map(|n| dir.join(format!("{} {}{}", stem, n, ext)))
        .find(|p| !p.exists())
        .unwrap()
}

/// Spreadsheet cells hold at most 32,767 characters.
fn cell(s: &str) -> &str {
    match s.char_indices().nth(32000) {
        Some((i, _)) => &s[..i],
        None => s,
    }
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
        .invoke_handler(tauri::generate_handler![load_data, save_data, data_path, backup_now, save_download, export_xlsx, reveal, open_url])
        .run(tauri::generate_context!())
        .expect("error while running Horror HQ");
}
