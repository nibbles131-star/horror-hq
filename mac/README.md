# Horror HQ for Mac

A Tauri app that runs the same screens and server code as the Apps Script web app, on a data
file in `~/Documents/Horror HQ/Horror HQ Data.json` instead of the Google Sheet.

- `build_web.js` turns `../src` into `dist/index.html`: HTML includes inlined, every `.gs` file
  wrapped into `makeServer_(globals)`.
- `shim.js` stands in for SpreadsheetApp, PropertiesService and friends with in-memory tabs filled
  from the data file, and answers `google.script.run` locally. It also shows the first-run import
  screen, which takes the JSON from Admin › Backup & export › Download JSON.
- `src-tauri/` is the native shell: `load_data` and `save_data` read and write the data file.

Stage 1 is read-only (only the read calls in `shim.js` READS run) and opens Home, Film Library,
Collections and the Bestiary Codex; the other sections show a lock.

Build: push a change under `mac/` and the "Mac app" workflow publishes `Horror-HQ.dmg` as a
pre-release. Locally: `npm ci && npm run build` (needs Rust; on Linux, libwebkit2gtk-4.1-dev).
Icons come from `art/icon.svg` → `art/icon.png` → `npm run icons`.
