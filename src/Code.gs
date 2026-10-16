/** Web app entry point and the admin menu on the database workbook. */

function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  return t.evaluate()
    .setTitle('Horror HQ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Lets HTML templates pull in other HTML files: <?!= include('Styles') ?> */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🎃 Horror HQ')
    .addItem('Open the app link', 'menuShowAppLink')
    .addItem('Install latest update', 'menuInstallUpdate')
    .addSeparator()
    .addItem('Run migration from the old sheet', 'menuRunMigration')
    .addToUi();
}

function menuShowAppLink() {
  SpreadsheetApp.getUi().alert('Horror HQ', showAppLink(), SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuInstallUpdate() {
  SpreadsheetApp.getUi().alert('Horror HQ', installLatestUpdate(true), SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuRunMigration() {
  var r;
  try { r = runMigration(); } catch (e) {
    SpreadsheetApp.getUi().alert('Migration not run', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }
  SpreadsheetApp.getUi().alert('Migration finished',
    r.passed + ' checks matched, ' + r.failed + ' differ. ' + r.exceptions.error + ' errors, ' + r.exceptions.warning +
    ' warnings. See the Migration Report tab.', SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Called by the placeholder page. */
function apiMigrationStatus() {
  try {
    return { report: getSetting('migration_report', null), version: PropertiesService.getScriptProperties().getProperty('INSTALLED_VERSION') };
  } catch (e) {
    return { report: null, error: e.message };
  }
}
