# Horror HQ for Mac

A Tauri app that runs the same screens and server code as the Apps Script web app, on a data
file in `~/Documents/Horror HQ/Horror HQ Data.json` instead of the Google Sheet.

- `build_web.js` turns `../src` into `dist/index.html`: HTML includes inlined, every `.gs` file
  wrapped into `makeServer_(globals)`, embedded as the worker source.
  `HQ.posterUrl` in Logic.html is the one line it rewrites, so posters come from the app's cache.
- `shim-worker.js` runs that server code in a worker. It stands in for SpreadsheetApp,
  PropertiesService and friends with in-memory tabs filled from the data file (UrlFetchApp is a
  synchronous XHR, fine off the main thread). After any call not in READS it sends the whole
  database back to be saved: the Admin › Download JSON format plus `mac.props` (the TMDB key).
- `shim.js` is the window side: `google.script.run` posts to the worker, saves are queued to
  `save_data`, poster URLs become `poster://localhost/w342/...`, and it shows the import screen
  (first run, or Horror HQ › Import a Fresh Copy…) and the section locks.
- `src-tauri/` is the native shell: `load_data`/`save_data` (daily copy into
  `Documents/Horror HQ/Backups`, last 14 kept), the `poster://` cache in the app's cache folder,
  and the menu item.

Stages 3+4: every section is open. The Mac stands in where an app window differs from a
browser: `<a download>` saves into Downloads (`save_download`), web links open in the default browser
(`open_url`), and Admin › Backup & export asks `HQMac.backupPanel()` for a Mac version (snapshot into
Backups, Show in Finder, `.xlsx` export via `export_xlsx`) instead of the Drive one. That `window.HQMac`
check in ViewAdmin.html is the only Mac-specific line in `src/`.

Stage 5: self-updates (`src-tauri/src/updater.rs`). The workflow bakes `HQ_BUILD` (its run number) into
the binary; at start-up, and from Horror HQ › Check for Updates…, the app asks the GitHub releases API for a
newer `mac-build-N` with a `Horror-HQ.dmg`, downloads it (checked against GitHub's sha256 digest), copies
the app out of the mounted .dmg over itself and reopens. This needs the repo to stay public.

Build: push a change under `mac/` and the "Mac app" workflow publishes `Horror-HQ.dmg` as a
pre-release. Locally: `npm ci && npm run build` (needs Rust; on Linux, libwebkit2gtk-4.1-dev).
Icons come from `art/icon.svg` → `art/icon.png` → `npm run icons`.
