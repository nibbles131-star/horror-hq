/**
 * Server functions for the Admin / quality centre: migration notes, duplicate review and
 * manual film merges, backups and export, the TMDB poster key, and the audit trail.
 */

// Every table that points at a film, and the column that holds the film id.
var FILM_REFS_ = [['CollectionEntries', 'film_id'], ['FilmCountries', 'film_id'], ['FilmAliases', 'film_id'], ['WatchAgenda', 'film_id'],
  ['ChallengeAssignments', 'film_id'], ['ExcavationCandidates', 'film_id'], ['ManualBurials', 'film_id'], ['Awards', 'winner_film_id'],
  ['LegacyRecords', 'film_id']];
// Tables with one record per film, and the fields a merge has to reconcile.
var FILM_KEYED_ = {
  FilmState: ['viewing_status', 'rating_10', 'reaction'],
  SpecialRatings: ['cuntometer_5', 'serve_note'],
  DiscoveryMemory: ['discovery_status', 'exclusion_reason', 'origin', 'memory_notes', 'research_source', 'date_added']
};

function adminTrim_(v, max) {
  if (v === null || v === undefined || v === '') return '';
  var s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function weeklyBackupOn_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'weeklyBackup'; });
}

/** Everything the Admin screen shows. Read-only. */
function apiAdminData() {
  dbClearMemo();
  var props = PropertiesService.getScriptProperties();
  var counts = {};
  Object.keys(SCHEMA).forEach(function (t) { counts[t] = dbRead(t).length; });
  var audit = dbRead('Audit').slice(-150).reverse().map(function (a) {
    return { id: a.audit_id, at: a.at, action: a.action, entity: a.entity, entity_id: a.entity_id, source: a.source,
      before: adminTrim_(a.before, 1500), after: adminTrim_(a.after, 1500) };
  });
  return {
    version: props.getProperty('INSTALLED_VERSION') || 'dev',
    webAppUrl: props.getProperty('WEBAPP_URL') || '',
    migratedAt: getSetting('migrated_at', null),
    report: getSetting('migration_report', null),
    exceptions: dbRead('MigrationExceptions').map(stripRow_),
    audit: audit,
    counts: counts,
    lastBackup: getSetting('last_backup', null),
    lastWeekly: getSetting('last_weekly_backup', null),
    weeklyOn: weeklyBackupOn_(),
    poster: { keySet: !!props.getProperty('TMDB_API_KEY'), provider: getSetting('poster_provider', null) }
  };
}

/** Marks a migration note resolved (or reopens it) with a short note on what was done. */
function apiResolveException(exceptionId, resolution, resolved) {
  return withWriteLock_(function () {
    var cur = dbIndex('MigrationExceptions')[exceptionId];
    if (!cur) throw new Error('Unknown note ' + exceptionId);
    var next = { exception_id: exceptionId, resolution: String(resolution || '').trim(), resolved: resolved !== false };
    dbUpdate('MigrationExceptions', [next]);
    audit_(next.resolved ? 'resolve-exception' : 'reopen-exception', 'MigrationExceptions', exceptionId, stripRow_(cur), next);
    return stripRow_(dbIndex('MigrationExceptions')[exceptionId]);
  });
}

/** The two films named in a possible-duplicate note ("A / B"), when both still exist. */
function duplicatePair_(ex) {
  var byKey = {};
  dbRead('Films').forEach(function (f) { byKey[f.display_key] = f; });
  var parts = String(ex.raw_value).split(' / ').map(function (s) { return s.trim(); });
  var films = parts.map(function (k) { return byKey[k]; }).filter(Boolean);
  return films.length === 2 ? films : null;
}

/** "Keep separate": closes the note and drops any review alias that tied the two films together. */
function apiKeepSeparate(exceptionId) {
  return withWriteLock_(function () {
    var ex = dbIndex('MigrationExceptions')[exceptionId];
    if (!ex) throw new Error('Unknown note ' + exceptionId);
    var pair = duplicatePair_(ex);
    var removed = [];
    if (pair) {
      var keys = {}, ids = {};
      pair.forEach(function (f) { keys[f.match_key] = true; ids[f.film_id] = true; });
      var doomed = dbRead('FilmAliases').filter(function (a) { return /^review/.test(a.status) && keys[a.match_key] && ids[a.film_id]; });
      removed = doomed.map(stripRow_);
      if (doomed.length) dbDelete('FilmAliases', doomed.map(function (a) { return a.alias_id; }));
    }
    var next = { exception_id: exceptionId, resolution: 'Kept as separate films', resolved: true };
    dbUpdate('MigrationExceptions', [next]);
    audit_('keep-separate', 'MigrationExceptions', exceptionId, { exception: stripRow_(ex), aliases: removed }, next);
    return { exception: stripRow_(dbIndex('MigrationExceptions')[exceptionId]), removedAliases: removed.map(function (a) { return a.alias_id; }) };
  });
}

function mergeEmpty_(field, v) {
  return v === null || v === undefined || v === '' || (field === 'viewing_status' && v === 'Not watched');
}

/**
 * Works out a merge of dropId into keepId without writing anything.
 * prefer maps "Table.field" to 'drop' where both films hold different values and the dropped film's should win.
 */
function mergePlan_(keepId, dropId, prefer) {
  prefer = prefer || {};
  if (!keepId || !dropId || keepId === dropId) throw new Error('Pick two different films.');
  var films = dbIndex('Films');
  var keep = films[keepId], drop = films[dropId];
  if (!keep || !drop) throw new Error('One of those films no longer exists.');
  var plan = { keep: stripRow_(keep), drop: stripRow_(drop), conflicts: [], patches: {}, creates: {}, moves: {}, dupes: {}, aliasMerged: [], newAlias: null };

  Object.keys(FILM_KEYED_).forEach(function (t) {
    var idx = dbIndex(t), k = idx[keepId], d = idx[dropId];
    if (!d) return;
    if (!k) { var copy = stripRow_(d); copy.film_id = keepId; plan.creates[t] = copy; return; }
    var patch = {};
    FILM_KEYED_[t].forEach(function (f) {
      var kv = k[f], dv = d[f];
      if (mergeEmpty_(f, dv)) return;
      if (mergeEmpty_(f, kv)) { patch[f] = dv; return; }
      if (String(kv) === String(dv)) return;
      plan.conflicts.push({ key: t + '.' + f, table: t, field: f, keep: kv, drop: dv });
      if (prefer[t + '.' + f] === 'drop') patch[f] = dv;
    });
    if (Object.keys(patch).length) plan.patches[t] = patch;
  });

  FILM_REFS_.forEach(function (ref) {
    var t = ref[0], col = ref[1], key = SCHEMA[t].key;
    var rows = dbRead(t);
    var mine = rows.filter(function (r) { return r[col] === keepId; });
    var theirs = rows.filter(function (r) { return r[col] === dropId; });
    var moves = [], dupes = [];
    var seen = {};
    if (t === 'CollectionEntries') mine.forEach(function (r) { seen[r.collection_id] = true; });
    if (t === 'FilmCountries') mine.forEach(function (r) { seen[r.country_id] = true; });
    if (t === 'ChallengeAssignments') mine.forEach(function (r) { seen[r.criterion_id] = true; });
    var order = mine.reduce(function (m, r) { return Math.max(m, Number(r.country_order) || 0); }, 0);
    theirs.forEach(function (r) {
      var dupKey = t === 'CollectionEntries' ? r.collection_id : t === 'FilmCountries' ? r.country_id : t === 'ChallengeAssignments' ? r.criterion_id : null;
      if (dupKey !== null && seen[dupKey]) { dupes.push(r[key]); return; }
      if (dupKey !== null) seen[dupKey] = true;
      var m = {}; m[key] = r[key]; m[col] = keepId;
      if (t === 'FilmCountries') m.country_order = ++order;
      if (t === 'ManualBurials') m.raw_film = keep.display_key;
      if (t === 'Awards') m.raw_winner = keep.display_key;
      if (t === 'WatchAgenda') m.raw_film = keep.display_key;
      moves.push(m);
    });
    if (moves.length) plan.moves[t] = moves;
    if (dupes.length) plan.dupes[t] = dupes;
  });

  // The dropped film's own title becomes an alias of the kept film, so searches and future imports still find it.
  var existing = dbRead('FilmAliases').filter(function (a) { return a.match_key === drop.match_key; });
  plan.aliasMerged = existing.map(function (a) { return a.alias_id; });
  if (!existing.length) {
    plan.newAlias = { film_id: keepId, alias_display_key: drop.display_key, alias_title: drop.title, alias_year: drop.release_year,
      match_key: drop.match_key, status: 'merged', provenance: 'Merged from ' + dropId };
  }
  return plan;
}

/** What a merge would do, for the confirmation screen. */
function apiMergePreview(keepId, dropId) {
  dbClearMemo();
  var p = mergePlan_(keepId, dropId, {});
  var count = function (o) { var n = {}; Object.keys(o).forEach(function (t) { n[t] = o[t].length; }); return n; };
  return { keep: p.keep, drop: p.drop, conflicts: p.conflicts, fills: Object.keys(p.patches).concat(Object.keys(p.creates)),
    moves: count(p.moves), dupes: count(p.dupes), aliasMerged: p.aliasMerged.length, newAlias: !!p.newAlias };
}

/**
 * Merges dropId into keepId: every list entry, schedule, burial, award, country and alias moves across,
 * duplicates on the same list collapse, empty fields on the kept film are filled, and the dropped film is deleted.
 * The full before-state goes into the audit log so a merge can always be reconstructed.
 */
function apiMergeFilms(keepId, dropId, prefer) {
  return withWriteLock_(function () {
    var p = mergePlan_(keepId, dropId, prefer);
    var before = { keep: p.keep, drop: p.drop, rows: {} };
    var snap = function (t, keys) {
      var idx = dbIndex(t);
      before.rows[t] = (before.rows[t] || []).concat(keys.filter(function (k) { return idx[k]; }).map(function (k) { return stripRow_(idx[k]); }));
    };
    Object.keys(p.moves).forEach(function (t) { snap(t, p.moves[t].map(function (m) { return m[SCHEMA[t].key]; })); });
    Object.keys(p.dupes).forEach(function (t) { snap(t, p.dupes[t]); });
    Object.keys(FILM_KEYED_).forEach(function (t) { snap(t, [keepId, dropId]); });
    snap('FilmAliases', p.aliasMerged);

    Object.keys(p.moves).forEach(function (t) { dbUpdate(t, p.moves[t]); });
    Object.keys(p.dupes).forEach(function (t) { dbDelete(t, p.dupes[t]); });
    Object.keys(p.patches).forEach(function (t) {
      var patch = p.patches[t];
      patch.film_id = keepId;
      if (t === 'FilmState') {
        patch.version = Number(dbIndex('FilmState')[keepId].version || 0) + 1;
        if (Object.prototype.hasOwnProperty.call(patch, 'rating_10')) patch.raw_rating = patch.rating_10 === null ? '' : String(patch.rating_10);
      }
      patch.modified_at = nowIso_();
      dbUpdate(t, [patch]);
    });
    Object.keys(p.creates).forEach(function (t) { dbAppend(t, [p.creates[t]]); });
    Object.keys(FILM_KEYED_).forEach(function (t) { if (dbIndex(t)[dropId]) dbDelete(t, [dropId]); });
    if (p.aliasMerged.length) dbUpdate('FilmAliases', p.aliasMerged.map(function (id) { return { alias_id: id, film_id: keepId, status: 'merged' }; }));
    if (p.newAlias) {
      p.newAlias.alias_id = nextId_('FilmAliases', 'A', 4);
      p.newAlias.created_at = nowIso_();
      dbAppend('FilmAliases', [p.newAlias]);
    }
    dbDelete('Films', [dropId]);

    // Close any duplicate note that named this pair.
    var closed = dbRead('MigrationExceptions').filter(function (e) {
      return !e.resolved && e.kind === 'possible-duplicate' && String(e.raw_value).indexOf(p.drop.display_key) >= 0 && String(e.raw_value).indexOf(p.keep.display_key) >= 0;
    }).map(function (e) { return { exception_id: e.exception_id, resolved: true, resolution: 'Merged into ' + p.keep.display_key }; });
    if (closed.length) dbUpdate('MigrationExceptions', closed);

    audit_('merge-films', 'Films', keepId, before, { kept: keepId, dropped: dropId, prefer: prefer || {}, closedNotes: closed.length });
    return { kept: keepId, dropped: dropId, closedNotes: closed.length };
  });
}

// ------------------------------------------------------------------ backups and export

function backupStamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

/** Copies every table tab into ss, replacing whatever it held. Uses only the spreadsheets permission. */
function backupInto_(ss) {
  var src = dbSpreadsheet_();
  var holder = ss.insertSheet('backup-in-progress-' + Date.now());
  ss.getSheets().forEach(function (s) { if (s.getSheetId() !== holder.getSheetId()) ss.deleteSheet(s); });
  Object.keys(SCHEMA).forEach(function (t) {
    var sh = src.getSheetByName(t);
    if (sh) sh.copyTo(ss).setName(t);
  });
  var about = ss.insertSheet('About this backup', 0);
  about.getRange(1, 1, 3, 2).setValues([['Backed up', backupStamp_()], ['From', src.getName() + ' (' + src.getId() + ')'],
    ['Restore', 'Copy a tab back into the database workbook over the tab with the same name.']]);
  ss.deleteSheet(holder);
}

/** A dated snapshot copy of the whole database in your Drive. */
function apiBackupNow() {
  return withWriteLock_(function () {
    var ss = SpreadsheetApp.create('Horror HQ backup ' + backupStamp_());
    backupInto_(ss);
    var info = { at: nowIso_(), url: ss.getUrl(), name: ss.getName() };
    setSetting('last_backup', info);
    audit_('backup', 'Settings', 'last_backup', null, info);
    return info;
  });
}

/** Trigger handler: refreshes one rolling "weekly" backup workbook, so backups never pile up. */
function weeklyBackup() {
  withWriteLock_(function () {
    var id = getSetting('rolling_backup_id', null), ss = null;
    if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
    if (!ss) { ss = SpreadsheetApp.create('Horror HQ backup (weekly, rolling)'); setSetting('rolling_backup_id', ss.getId()); }
    backupInto_(ss);
    setSetting('last_weekly_backup', { at: nowIso_(), url: ss.getUrl(), name: ss.getName() });
  });
}

function apiSetWeeklyBackup(on) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'weeklyBackup') ScriptApp.deleteTrigger(t); });
  if (on) ScriptApp.newTrigger('weeklyBackup').timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(4).create();
  return { weeklyOn: weeklyBackupOn_() };
}

/** Every table as plain JSON, for the browser to save as a file. */
function apiExportAll() {
  dbClearMemo();
  var tables = {};
  Object.keys(SCHEMA).forEach(function (t) { tables[t] = dbRead(t).map(stripRow_); });
  return { app: 'Horror HQ', exported_at: nowIso_(), version: PropertiesService.getScriptProperties().getProperty('INSTALLED_VERSION') || 'dev', tables: tables };
}

// ------------------------------------------------------------------ posters (TMDB hook)

function tmdbFetch_(key, path) {
  var bearer = key.length > 60;
  var url = 'https://api.themoviedb.org/3' + path + (bearer ? '' : (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(key));
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: bearer ? { Authorization: 'Bearer ' + key } : {} });
  if (res.getResponseCode() !== 200) throw new Error('TMDB said ' + res.getResponseCode() + '. Check the key is the v3 API key or the v4 read access token.');
  return JSON.parse(res.getContentText());
}

/** Stores the free TMDB key in script properties (never in the sheet) and switches the poster hook on. Empty key switches it off. */
function apiSavePosterKey(key) {
  return withWriteLock_(function () {
    key = String(key || '').trim();
    var props = PropertiesService.getScriptProperties();
    if (key) {
      tmdbFetch_(key, '/configuration');
      props.setProperty('TMDB_API_KEY', key);
    } else {
      props.deleteProperty('TMDB_API_KEY');
    }
    var setting = { provider: 'TMDB', enabled: !!key, note: key ? 'Key saved. Poster fetching is the next feature to switch on.' : 'Add a free TMDB API key in Admin to switch posters on.' };
    setSetting('poster_provider', setting);
    audit_('poster-key', 'Settings', 'poster_provider', null, { enabled: !!key });
    return { keySet: !!key, provider: setting };
  });
}

/** Proves the saved key works by looking up one film's poster. */
function apiTestPosterKey(title, year) {
  var key = PropertiesService.getScriptProperties().getProperty('TMDB_API_KEY');
  if (!key) throw new Error('No TMDB key saved yet.');
  var data = tmdbFetch_(key, '/search/movie?query=' + encodeURIComponent(title || 'Halloween') + (year ? '&year=' + year : ''));
  var hit = (data.results || [])[0];
  if (!hit) return { found: false };
  return { found: true, title: hit.title, year: String(hit.release_date || '').slice(0, 4),
    poster: hit.poster_path ? 'https://image.tmdb.org/t/p/w342' + hit.poster_path : '' };
}
