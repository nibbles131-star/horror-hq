/**
 * Self-updater. Claude publishes the app's source files as plain files in the
 * Drive folder "Horror HQ Code", plus a release.json that names the version and
 * the files in it (always uploaded last). This script reads that release and
 * replaces its own code with it through the Apps Script API, then points the
 * web app deployment at the new version. No copy-pasting after the first install.
 *
 * This file is deliberately self-contained (no dependency on other files) so it
 * can be pasted on its own as the very first install.
 *
 * One-time requirements:
 *   - appsscript.json from the repo (it declares the scopes used here)
 *   - Apps Script API switched on at https://script.google.com/home/usersettings
 *   - the script linked to a standard Google Cloud project with the Apps Script API enabled
 *     (the hidden default project can't call it)
 */

var UPDATER_FOLDER_NAME = 'Horror HQ Code';
var UPDATER_API = 'https://script.googleapis.com/v1/projects/';
var UPDATER_TYPES = { gs: 'SERVER_JS', html: 'HTML', json: 'JSON' };

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
    if (code === 403 && body.indexOf('User has not enabled the Apps Script API') >= 0) {
      throw new Error('Switch on "Google Apps Script API" at https://script.google.com/home/usersettings, wait a minute, then run this again.');
    }
    if (code === 403 && /has not been used in project|SERVICE_DISABLED|it is disabled/.test(body)) {
      throw new Error('This script is still on Google\'s hidden default Cloud project, which can\'t use the Apps Script API. ' +
        'Link it to your own Cloud project (SETUP.md, "Cloud project" step), then run this again. Google said: ' + body.slice(0, 400));
    }
    throw new Error('Apps Script API ' + method + ' ' + path + ' failed (' + code + '): ' + body);
  }
  return body ? JSON.parse(body) : {};
}

function newestFileIn_(folder, name) {
  var it = folder.getFilesByName(name);
  var newest = null;
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed()) continue;
    if (!newest || f.getLastUpdated() > newest.getLastUpdated()) newest = f;
  }
  return newest;
}

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** Reads release.json and every file it lists. Throws rather than installing a partial release. */
function readRelease_() {
  var folders = DriveApp.getFoldersByName(UPDATER_FOLDER_NAME);
  if (!folders.hasNext()) throw new Error('No "' + UPDATER_FOLDER_NAME + '" folder in your Drive yet.');
  var folder = folders.next();
  var rel = newestFileIn_(folder, 'release.json');
  if (!rel) throw new Error('No release.json in "' + UPDATER_FOLDER_NAME + '" yet.');
  var release = JSON.parse(rel.getBlob().getDataAsString());
  var files = (release.files || []).map(function (name) {
    var f = newestFileIn_(folder, name);
    if (!f) throw new Error('Release ' + release.version + ' lists ' + name + ' but it is not in the folder.');
    var ext = name.split('.').pop();
    if (!UPDATER_TYPES[ext]) throw new Error('Unknown file type: ' + name);
    var source = f.getBlob().getDataAsString('UTF-8');
    var expected = (release.sha256 || {})[name];
    if (expected && sha256Hex_(source) !== expected) {
      throw new Error(name + ' does not match its checksum in release ' + release.version + '; not installing.');
    }
    return { name: name.replace(/\.[^.]+$/, ''), type: UPDATER_TYPES[ext], source: source };
  });
  if (!files.some(function (f) { return f.name === 'appsscript' && f.type === 'JSON'; })) {
    throw new Error('Release has no appsscript.json; refusing to install.');
  }
  if (!files.some(function (f) { return f.name === 'Updater'; })) {
    throw new Error('Release has no Updater.gs; refusing to install (it would remove the updater).');
  }
  return { version: release.version, files: files };
}

/**
 * Installs the newest release if it differs from what is installed.
 * Run this by hand the first time (it asks for permissions); after that a
 * 15-minute trigger runs it.
 */
function installLatestUpdate(force) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 'Another update is already running.';
  try {
    var props = PropertiesService.getScriptProperties();
    var release = readRelease_();
    var installed = props.getProperty('INSTALLED_VERSION');
    if (installed === release.version && force !== true) return 'Already up to date (' + installed + ').';
    updaterFetch_('put', '/content', { files: release.files });
    var version = updaterFetch_('post', '/versions', { description: 'Horror HQ ' + release.version });
    var deploymentId = props.getProperty('WEBAPP_DEPLOYMENT_ID');
    var config = { versionNumber: version.versionNumber, manifestFileName: 'appsscript', description: 'Horror HQ' };
    var deployment = deploymentId
      ? updaterFetch_('put', '/deployments/' + deploymentId, { deploymentConfig: config })
      : updaterFetch_('post', '/deployments', config);
    props.setProperty('WEBAPP_DEPLOYMENT_ID', deployment.deploymentId);
    props.setProperty('INSTALLED_VERSION', release.version);
    var url = '';
    (deployment.entryPoints || []).forEach(function (e) { if (e.webApp) url = e.webApp.url; });
    if (url) props.setProperty('WEBAPP_URL', url);
    ensureUpdateTrigger_();
    var msg = 'Installed ' + release.version + (url ? '. Horror HQ lives at ' + url : '');
    Logger.log(msg);
    return msg;
  } finally {
    lock.releaseLock();
  }
}

/** Trigger handler: quietly installs a newer release when there is one. */
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
