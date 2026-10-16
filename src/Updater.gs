/**
 * Self-updater. Claude publishes the whole app as one JSON bundle file in
 * Tommy's Google Drive (UPDATER_BUNDLE_NAME). This script reads that file and
 * replaces its own code with it through the Apps Script API, then points the
 * web app deployment at the new version. No copy-pasting after the first install.
 *
 * This file is deliberately self-contained (no dependency on other files) so it
 * can be pasted on its own as the very first install.
 *
 * One-time requirements:
 *   - appsscript.json from the repo (it declares the scopes used here)
 *   - Apps Script API switched on at https://script.google.com/home/usersettings
 */

var UPDATER_BUNDLE_NAME = 'horror-hq-update-bundle.json';
var UPDATER_API = 'https://script.googleapis.com/v1/projects/';

function updaterFetch_(method, path, payload) {
  var res = UrlFetchApp.fetch(UPDATER_API + ScriptApp.getScriptId() + path, {
    method: method,
    contentType: 'application/json',
    payload: payload ? JSON.stringify(payload) : undefined,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code >= 300) {
    if (code === 403 && body.indexOf('Apps Script API') >= 0) {
      throw new Error('Switch on "Google Apps Script API" at https://script.google.com/home/usersettings, wait a minute, then run this again.');
    }
    throw new Error('Apps Script API ' + method + ' ' + path + ' failed (' + code + '): ' + body);
  }
  return body ? JSON.parse(body) : {};
}

function readUpdateBundle_() {
  var it = DriveApp.getFilesByName(UPDATER_BUNDLE_NAME);
  var newest = null;
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed()) continue;
    if (!newest || f.getLastUpdated() > newest.getLastUpdated()) newest = f;
  }
  if (!newest) throw new Error('No "' + UPDATER_BUNDLE_NAME + '" found in your Drive yet.');
  var bundle = JSON.parse(newest.getBlob().getDataAsString());
  if (!bundle.version || !bundle.files || !bundle.files.length) throw new Error('Update bundle looks broken.');
  if (!bundle.files.some(function (f) { return f.name === 'appsscript' && f.type === 'JSON'; })) {
    throw new Error('Update bundle has no manifest; refusing to install.');
  }
  return bundle;
}

/**
 * Installs the newest bundle if it differs from what is installed.
 * Run this by hand the first time (it asks for permissions), after that the
 * hourly trigger runs it.
 */
function installLatestUpdate(force) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 'Another update is already running.';
  try {
    var props = PropertiesService.getScriptProperties();
    var bundle = readUpdateBundle_();
    var installed = props.getProperty('INSTALLED_VERSION');
    if (installed === bundle.version && force !== true) {
      Logger.log('Already on ' + installed);
      return 'Already up to date (' + installed + ').';
    }
    updaterFetch_('put', '/content', { files: bundle.files });
    var version = updaterFetch_('post', '/versions', { description: 'Horror HQ ' + bundle.version });
    var deploymentId = props.getProperty('WEBAPP_DEPLOYMENT_ID');
    var config = { versionNumber: version.versionNumber, manifestFileName: 'appsscript', description: 'Horror HQ' };
    var deployment = deploymentId
      ? updaterFetch_('put', '/deployments/' + deploymentId, { deploymentConfig: config })
      : updaterFetch_('post', '/deployments', config);
    props.setProperty('WEBAPP_DEPLOYMENT_ID', deployment.deploymentId);
    props.setProperty('INSTALLED_VERSION', bundle.version);
    var url = '';
    (deployment.entryPoints || []).forEach(function (e) { if (e.webApp) url = e.webApp.url; });
    if (url) props.setProperty('WEBAPP_URL', url);
    ensureUpdateTrigger_();
    var msg = 'Installed ' + bundle.version + (url ? '. Horror HQ lives at ' + url : '');
    Logger.log(msg);
    return msg;
  } finally {
    lock.releaseLock();
  }
}

/** Trigger handler: quietly installs a newer bundle when there is one. */
function checkForUpdate() {
  try {
    installLatestUpdate(false);
  } catch (e) {
    Logger.log('Update check failed: ' + e.message);
  }
}

function ensureUpdateTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'checkForUpdate'; });
  if (!exists) ScriptApp.newTrigger('checkForUpdate').timeBased().everyMinutes(15).create();
}

/** Prints the web app link (handy if you lose it). */
function showAppLink() {
  var url = PropertiesService.getScriptProperties().getProperty('WEBAPP_URL') || 'not deployed yet';
  Logger.log(url);
  return url;
}
