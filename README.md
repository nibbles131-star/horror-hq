# Horror HQ

A private Google Apps Script web app that replaces the 31-tab "Horror Movie Master Sheet".

- **Old workbook** (read-only backup): `1K4jvoXbBLMT13XXTlUDAgbo3U_VD-wXZtI-IMCQunQw`
- **Database workbook** (the app's data, one tab per table): `1h1sgPL6_5b1womrFQoqF-Gob7rlsFYZyFozaTJyR4Zc`
- The Apps Script project is bound to the database workbook.

## Layout

| Path | What |
|---|---|
| `src/Schema.gs` | Every database table and its columns |
| `src/Db.gs` | Data-access layer (read, append, update, replace) |
| `src/Migration.gs` | One-shot, re-runnable import from the old workbook |
| `src/Reconcile.gs` | Compares old dashboard numbers with migrated data, writes the Migration Report tab |
| `src/Updater.gs` | Self-updater: installs `horror-hq-update-bundle.json` from Drive via the Apps Script API |
| `src/Code.gs`, `src/*.html` | Web app and the sheet menu |
| `tools/` | Bundle builder and the Node test harness with mocked Sheets |

## Develop

```sh
node tools/run_migration_test.js   # migration against a fixture copy of the old workbook
python3 tools/build_bundle.py      # writes dist/horror-hq-update-bundle.json
```

Upload the bundle to Drive as `horror-hq-update-bundle.json` (same file each time). The installed
app checks every 15 minutes and installs newer bundles itself; **🎃 Horror HQ ▸ Install latest update**
in the database workbook forces it.

## First-time install

See [SETUP.md](SETUP.md).
