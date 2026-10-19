// Self-updates from the GitHub releases the "Mac app" workflow publishes (tag mac-build-N, asset
// Horror-HQ.dmg). The build number is baked in at compile time from HQ_BUILD; a release with a
// higher N is an update. Installing downloads the .dmg (checked against GitHub's sha256 digest),
// copies the app out of it over this one and restarts. Downloaded this way the app carries no
// quarantine flag, so macOS doesn't ask for "Open Anyway" again.

use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;

const RELEASES: &str = "https://api.github.com/repos/nibbles131-star/horror-hq/releases?per_page=20";
const ASSET: &str = "Horror-HQ.dmg";

pub fn current_build() -> u64 {
    option_env!("HQ_BUILD").and_then(|b| b.parse().ok()).unwrap_or(0)
}

/// The newest release newer than this build: {build, url, digest, size}, or null.
#[tauri::command]
pub fn check_update() -> Result<Value, String> {
    let mut res = ureq::get(RELEASES)
        .header("User-Agent", "Horror-HQ-Mac")
        .header("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("Couldn't reach GitHub for updates ({})", e))?;
    let list: Value = res.body_mut().read_json().map_err(|e| e.to_string())?;
    Ok(pick_update(&list, current_build()))
}

fn pick_update(list: &Value, mine: u64) -> Value {
    let mut best: Option<Value> = None;
    for rel in list.as_array().cloned().unwrap_or_default() {
        if rel["draft"].as_bool().unwrap_or(false) {
            continue;
        }
        let build = match rel["tag_name"].as_str().and_then(|t| t.strip_prefix("mac-build-")).and_then(|n| n.parse::<u64>().ok()) {
            Some(n) if n > mine => n,
            _ => continue,
        };
        let asset = rel["assets"].as_array().and_then(|a| a.iter().find(|x| x["name"] == ASSET)).cloned();
        let asset = match asset {
            Some(a) => a,
            None => continue,
        };
        if best.as_ref().map_or(true, |b| build > b["build"].as_u64().unwrap_or(0)) {
            best = Some(serde_json::json!({
                "build": build,
                "url": asset["browser_download_url"],
                "digest": asset["digest"],
                "size": asset["size"],
            }));
        }
    }
    best.unwrap_or(Value::Null)
}

/// Downloads and installs the update, then restarts the app. Returns only on failure.
#[tauri::command]
pub fn install_update(app: tauri::AppHandle, url: String, digest: Option<String>) -> Result<(), String> {
    if !url.starts_with("https://github.com/nibbles131-star/horror-hq/releases/download/") {
        return Err("That update doesn't come from Horror HQ's releases".into());
    }
    let bundle = app_bundle()?;
    let work = std::env::temp_dir().join(format!("horror-hq-update-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let result = install(&url, digest.as_deref(), &bundle, &work);
    let _ = std::fs::remove_dir_all(&work);
    result?;
    // Reopen once this process has gone, so the new copy starts fresh.
    Command::new("sh")
        .arg("-c")
        .arg(format!("sleep 1; open \"{}\"", bundle.display()))
        .spawn()
        .map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

fn install(url: &str, digest: Option<&str>, bundle: &Path, work: &Path) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    let mut res = ureq::get(url).call().map_err(|e| format!("Download failed ({})", e))?;
    let bytes = res
        .body_mut()
        .with_config()
        .limit(300 * 1024 * 1024)
        .read_to_vec()
        .map_err(|e| format!("Download failed ({})", e))?;
    if let Some(want) = digest.and_then(|d| d.strip_prefix("sha256:")) {
        let got: String = Sha256::digest(&bytes).iter().map(|b| format!("{:02x}", b)).collect();
        if got != want.to_lowercase() {
            return Err("The download was damaged on the way (checksum mismatch). Nothing was changed; try again.".into());
        }
    }
    let dmg = work.join(ASSET);
    std::fs::write(&dmg, &bytes).map_err(|e| e.to_string())?;
    let mnt = work.join("mnt");
    std::fs::create_dir_all(&mnt).map_err(|e| e.to_string())?;
    run(Command::new("hdiutil").args(["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint"]).arg(&mnt).arg(&dmg))?;
    let copied = copy_app(&mnt, bundle);
    let _ = run(Command::new("hdiutil").args(["detach", "-force"]).arg(&mnt));
    copied
}

/// Swaps the new .app in beside the old one, so a failure part-way leaves the old one working.
fn copy_app(mnt: &Path, bundle: &Path) -> Result<(), String> {
    let new_app = std::fs::read_dir(mnt)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .find(|p| p.extension().map_or(false, |x| x == "app"))
        .ok_or("The update didn't contain the app")?;
    let staged = bundle.with_extension("app.new");
    let old = bundle.with_extension("app.old");
    let _ = std::fs::remove_dir_all(&staged);
    let _ = std::fs::remove_dir_all(&old);
    run(Command::new("ditto").arg(&new_app).arg(&staged))?;
    std::fs::rename(bundle, &old).map_err(|e| format!("Couldn't replace the app ({}). Is it in Applications?", e))?;
    if let Err(e) = std::fs::rename(&staged, bundle) {
        let _ = std::fs::rename(&old, bundle);
        return Err(format!("Couldn't put the new app in place ({})", e));
    }
    let _ = std::fs::remove_dir_all(&old);
    Ok(())
}

/// …/Horror HQ.app, from …/Horror HQ.app/Contents/MacOS/horror-hq.
fn app_bundle() -> Result<PathBuf, String> {
    if !cfg!(target_os = "macos") {
        return Err("Updating installs only work on a Mac".into());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let bundle = exe
        .ancestors()
        .nth(3)
        .filter(|p| p.extension().map_or(false, |x| x == "app"))
        .map(Path::to_path_buf)
        .ok_or("Horror HQ isn't running from an app bundle")?;
    let shown = bundle.display().to_string();
    if shown.contains("AppTranslocation") || shown.starts_with("/Volumes/") {
        return Err("Drag Horror HQ into Applications and open it from there first, then update.".into());
    }
    Ok(bundle)
}

fn run(cmd: &mut Command) -> Result<(), String> {
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::pick_update;
    use serde_json::json;

    #[test]
    fn picks_the_newest_newer_build_with_a_dmg() {
        let asset = |n: u64| json!([{ "name": "Horror-HQ.dmg", "browser_download_url": format!("https://github.com/x/mac-build-{}", n), "digest": "sha256:ab", "size": 1 }]);
        let list = json!([
            { "tag_name": "mac-build-7", "draft": true, "assets": asset(7) },
            { "tag_name": "mac-build-6", "draft": false, "assets": [] },
            { "tag_name": "mac-build-5", "draft": false, "assets": asset(5) },
            { "tag_name": "v1.0", "draft": false, "assets": asset(9) },
            { "tag_name": "mac-build-4", "draft": false, "assets": asset(4) }
        ]);
        assert_eq!(pick_update(&list, 3)["build"], 5);
        assert!(pick_update(&list, 5).is_null());
    }
}
