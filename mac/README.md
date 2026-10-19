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

Stage 2 (current): editing everywhere that is open (Home, Film Library, Collections, Codex, Admin's
Health/Review/Posters/Change log). Planner, Excavator, Wall, Funhouse, Shrine and Stats are locked;
Admin's Merge and Backup tabs are hidden until stage 4.

Build: push a change under `mac/` and the "Mac app" workflow publishes `Horror-HQ.dmg` as a
pre-release. Locally: `npm ci && npm run build` (needs Rust; on Linux, libwebkit2gtk-4.1-dev).
Icons come from `art/icon.svg` → `art/icon.png` → `npm run icons`.
