/**
 * Fixed configuration. The database workbook is the spreadsheet this script is
 * bound to; the old workbook is only ever opened read-only by the migration.
 */
var CONFIG = {
  APP_NAME: 'Horror HQ',
  LEGACY_SPREADSHEET_ID: '1K4jvoXbBLMT13XXTlUDAgbo3U_VD-wXZtI-IMCQunQw',
  DATABASE_SPREADSHEET_ID: '1h1sgPL6_5b1womrFQoqF-Gob7rlsFYZyFozaTJyR4Zc',
  // Name of the Drive file Claude publishes code updates to (see Updater.gs).
  UPDATE_BUNDLE_NAME: 'horror-hq-update-bundle.json',
  TIMEZONE: 'Europe/London'
};

function dbSpreadsheet_() {
  return SpreadsheetApp.openById(CONFIG.DATABASE_SPREADSHEET_ID);
}

function legacySpreadsheet_() {
  return SpreadsheetApp.openById(CONFIG.LEGACY_SPREADSHEET_ID);
}
