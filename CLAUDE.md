# Horror HQ — notes for Claude

- Apps Script web app bound to the "Horror HQ Database" workbook. Old workbook is read-only; never write to it.
- Run `node tools/run_migration_test.js` after touching Migration/Reconcile/Db/Util.
- Deploying: `python3 tools/build_bundle.py`, then upload each changed file from `dist/release/` to the Drive
  folder "Horror HQ Code" (id 1UOg3cr8DBLyUOlH3cRogc06hl1hOc975) with the Drive connector as text/plain,
  disableConversionToGoogleType=true, exact file contents, and upload `release.json` LAST. Check each upload's
  fileSize equals the local byte count. The installed app verifies sha256 and auto-installs within 15 minutes.
  Duplicate filenames are fine: the updater uses the newest file per name.

- Upload gotcha: the Drive connector turns a typed `\uXXXX` into the real character, so sources must not use
  `\u` escapes (write the literal character, or String.fromCharCode). Before uploading, run
  `grep -nP '\\u[0-9a-fA-F]{4}' dist/release/*` and expect only the known `\u0001` separators in Db.gs/Migration.gs
  (type those as `\\u0001`). A size mismatch after upload means a byte changed: fix and re-upload before release.json.
- Never upload release.json until every listed file is up; an install that runs mid-upload fails its checksum check
  (harmless, but it scares Tommy).
