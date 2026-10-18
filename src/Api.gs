/**
 * Server functions the web app calls through google.script.run.
 *
 * Reads: apiBootstrap() ships the whole (small) collection to the browser once,
 * so searching, filtering and stats are instant. Writes go through the small
 * functions below: each validates, checks the record version so a stale tab
 * can't overwrite a newer edit, writes only the affected rows and records an audit entry.
 */

function withWriteLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Horror HQ is busy saving something else. Try again in a moment.');
  try {
    dbClearMemo();
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function audit_(action, entity, entityId, before, after) {
  dbAppend('Audit', [{ audit_id: 'AU' + Date.now() + Math.floor(Math.random() * 1000), at: nowIso_(), action: action,
    entity: entity, entity_id: entityId, before: before || null, after: after || null, source: 'app' }]);
}

function stripRow_(rec) {
  var out = {};
  Object.keys(rec).forEach(function (k) { if (k !== '_row') out[k] = rec[k]; });
  return out;
}

/** Everything the browser needs to render the app, in compact form. */
function apiBootstrap() {
  dbClearMemo();
  var t0 = Date.now();
  var migrated = null;
  try { migrated = getSetting('migrated_at', null); } catch (e) { migrated = null; }
  if (!migrated) return { needsMigration: true, version: PropertiesService.getScriptProperties().getProperty('INSTALLED_VERSION') || 'dev' };
  var films = dbRead('Films').map(function (f) { return [f.film_id, f.display_key, f.title, f.release_year, String(f.poster_url || '').replace(POSTER_BASE_, '')]; });
  var state = {};
  dbRead('FilmState').forEach(function (s) { state[s.film_id] = [s.viewing_status, s.rating_10, s.reaction, s.version, s.modified_at]; });
  var collections = dbRead('Collections').map(stripRow_);
  var entries = dbRead('CollectionEntries').map(function (e) {
    return [e.entry_id, e.collection_id, e.film_id, e.slot_label, e.sequence, e.source_note, e.context_note];
  });
  var special = {};
  dbRead('SpecialRatings').forEach(function (s) { special[s.film_id] = [s.cuntometer_5, s.serve_note]; });
  var countries = {};
  dbRead('Countries').forEach(function (c) { countries[c.country_id] = c.name; });
  var filmCountries = {};
  dbRead('FilmCountries').sort(function (a, b) { return a.country_order - b.country_order; }).forEach(function (fc) {
    (filmCountries[fc.film_id] = filmCountries[fc.film_id] || []).push(fc.country_id);
  });
  var memory = {};
  dbRead('DiscoveryMemory').forEach(function (m) {
    memory[m.film_id] = [m.discovery_status, m.exclusion_reason, m.origin, m.memory_notes, m.research_source, m.date_added];
  });
  var aliases = dbRead('FilmAliases').map(function (a) { return [a.film_id, a.alias_display_key, a.status, a.match_key]; });
  var openExceptions = dbRead('MigrationExceptions').filter(function (e) { return !e.resolved && e.severity !== 'info'; }).length;
  return {
    films: films, state: state, collections: collections, entries: entries, special: special,
    countries: countries, filmCountries: filmCountries, memory: memory, aliases: aliases,
    agenda: dbRead('WatchAgenda').map(stripRow_),
    plans: dbRead('EventPlans').map(stripRow_),
    awards: dbRead('Awards').map(stripRow_),
    trophies: dbRead('TrophyDefinitions').map(stripRow_),
    burials: dbRead('ManualBurials').map(stripRow_),
    challenges: dbRead('Challenges').map(stripRow_),
    criteria: dbRead('ChallengeCriteria').map(stripRow_),
    assignments: dbRead('ChallengeAssignments').map(stripRow_),
    openExceptions: openExceptions,
    posters: getSetting('poster_provider', null),
    fun: { hall_of_fame: getSetting('hall_of_fame', []), bingo_card: getSetting('bingo_card', null), trophies_seen: getSetting('trophies_seen', null),
      franchise_branches: getSetting('franchise_branches', {}), franchises_done: getSetting('franchises_done', null) },
    version: PropertiesService.getScriptProperties().getProperty('INSTALLED_VERSION') || 'dev',
    loadMs: Date.now() - t0
  };
}

/** Small per-app preferences for the fun pages (Hall of Fame picks, the Bingo card, trophies and franchises already celebrated, filmstrip branches). */
var UI_SETTINGS_ = ['hall_of_fame', 'bingo_card', 'trophies_seen', 'franchise_branches', 'franchises_done'];
function apiSaveUiSetting(key, value) {
  if (UI_SETTINGS_.indexOf(key) < 0) throw new Error('Unknown setting ' + key);
  if (JSON.stringify(value).length > 45000) throw new Error('That is too big to save.');
  return withWriteLock_(function () {
    setSetting(key, value);
    return value;
  });
}

function validateRating_(r) {
  if (r === null || r === undefined || r === '') return null;
  var n = Number(r);
  if (isNaN(n) || n !== Math.round(n) || n < 1 || n > 10) throw new Error('Ratings are whole numbers from 1 to 10.');
  return n;
}

function filmInFamily_(filmId, family) {
  var colls = dbIndex('Collections');
  return dbRead('CollectionEntries').some(function (e) {
    return e.film_id === filmId && colls[e.collection_id] && colls[e.collection_id].family === family;
  });
}

/**
 * Saves status / rating / reaction for one film.
 * patch may contain viewing_status, rating_10 (null clears it) and reaction.
 * expectedVersion must match the stored version, otherwise the save is refused
 * and the current record is returned so the browser can show what changed.
 */
function apiSaveFilmState(filmId, patch, expectedVersion) {
  return withWriteLock_(function () {
    var cur = dbIndex('FilmState')[filmId];
    if (!cur) throw new Error('Unknown film ' + filmId);
    if (expectedVersion !== undefined && expectedVersion !== null && Number(cur.version) !== Number(expectedVersion)) {
      return { conflict: true, state: stripRow_(cur) };
    }
    var next = { film_id: filmId };
    if (Object.prototype.hasOwnProperty.call(patch, 'viewing_status')) {
      if (VIEWING_STATUSES.indexOf(patch.viewing_status) < 0) throw new Error('Unknown status ' + patch.viewing_status);
      if (patch.viewing_status === 'Unsure' && !filmInFamily_(filmId, 'Franchise')) {
        throw new Error('Unsure is only for franchise entries.');
      }
      next.viewing_status = patch.viewing_status;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'rating_10')) {
      next.rating_10 = validateRating_(patch.rating_10);
      next.raw_rating = next.rating_10 === null ? '' : String(next.rating_10);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'reaction')) next.reaction = String(patch.reaction || '').slice(0, 5000);
    next.version = Number(cur.version || 0) + 1;
    next.modified_at = nowIso_();
    dbUpdate('FilmState', [next]);
    audit_('save-film-state', 'FilmState', filmId, stripRow_(cur), next);
    return { conflict: false, state: stripRow_(dbIndex('FilmState')[filmId]) };
  });
}

function apiSaveCuntometer(filmId, value, serveNote) {
  return withWriteLock_(function () {
    var v = value === null || value === '' || value === undefined ? null : Number(value);
    if (v !== null && (isNaN(v) || v !== Math.round(v) || v < 1 || v > 5)) throw new Error('The Cuntometer goes from 1 to 5.');
    var cur = dbIndex('SpecialRatings')[filmId];
    var rec = { film_id: filmId, cuntometer_5: v, serve_note: String(serveNote || ''), raw_cuntometer: v === null ? '' : String(v),
      modified_at: nowIso_() };
    if (cur) dbUpdate('SpecialRatings', [rec]); else dbAppend('SpecialRatings', [rec]);
    audit_('save-cuntometer', 'SpecialRatings', filmId, cur ? stripRow_(cur) : null, rec);
    return rec;
  });
}

/** Finds a film by exact key, normalised key or alias. Returns {film, via} or null. */
function findFilm_(displayKey) {
  var mk = matchKey_(displayKey);
  var films = dbRead('Films');
  var exact = films.filter(function (f) { return f.display_key === displayKey; })[0];
  if (exact) return { film: exact, via: 'exact' };
  var norm = films.filter(function (f) { return f.match_key === mk; })[0];
  if (norm) return { film: norm, via: 'same title, different punctuation' };
  var alias = dbRead('FilmAliases').filter(function (a) { return a.match_key === mk && a.film_id; })[0];
  if (alias) return { film: dbIndex('Films')[alias.film_id], via: 'alias ' + alias.alias_display_key };
  return null;
}

/**
 * Adds a film to the library (and FilmState) unless it already exists.
 * Replaces the old "NEW FILMS TO ADD" chore. Returns {film, state, created, via}.
 */
function apiAddFilm(title, year, force) {
  return withWriteLock_(function () {
    title = String(title || '').trim();
    year = Number(year);
    if (!title) throw new Error('Give the film a title.');
    if (!year || year < 1890 || year > 2100) throw new Error('Give the film a four-digit release year.');
    var key = title + ' (' + year + ')';
    var hit = findFilm_(key);
    if (hit && (hit.via === 'exact' || !force)) {
      return { created: false, via: hit.via, film: stripRow_(hit.film), state: stripRow_(dbIndex('FilmState')[hit.film.film_id]) };
    }
    var films = dbRead('Films');
    var maxId = films.reduce(function (m, f) { return Math.max(m, Number(String(f.film_id).slice(1)) || 0); }, 0);
    var now = nowIso_();
    var film = { film_id: 'F' + pad_(maxId + 1, 5), display_key: key, title: title, release_year: year, match_key: matchKey_(key),
      original_title: '', tmdb_id: '', poster_url: '', import_source: 'app', created_at: now, updated_at: now };
    var st = { film_id: film.film_id, viewing_status: 'Not watched', rating_10: null, reaction: '', raw_rating: '', version: 1, modified_at: now };
    dbAppend('Films', [film]);
    dbAppend('FilmState', [st]);
    audit_('add-film', 'Films', film.film_id, null, film);
    return { created: true, via: '', film: film, state: st };
  });
}

function nextEntrySequence_(collectionId) {
  return dbRead('CollectionEntries').filter(function (e) { return e.collection_id === collectionId; })
    .reduce(function (m, e) { return Math.max(m, Number(e.sequence) || 0); }, 0) + 1;
}

function apiAddEntry(collectionId, filmId, slotLabel, contextNote, allowRepeat) {
  return withWriteLock_(function () {
    if (!dbIndex('Collections')[collectionId]) throw new Error('Unknown list ' + collectionId);
    if (!dbIndex('Films')[filmId]) throw new Error('Unknown film ' + filmId);
    var dup = dbRead('CollectionEntries').filter(function (e) { return e.collection_id === collectionId && e.film_id === filmId; })[0];
    if (dup && !allowRepeat) throw new Error('That film is already on this list (slot ' + (dup.slot_label || dup.sequence) + ').');
    var entries = dbRead('CollectionEntries');
    var maxId = entries.reduce(function (m, e) { return Math.max(m, Number(String(e.entry_id).slice(1)) || 0); }, 0);
    var rec = { entry_id: 'E' + pad_(maxId + 1, 5), collection_id: collectionId, film_id: filmId, slot_label: String(slotLabel || ''),
      sequence: nextEntrySequence_(collectionId), source_note: '', context_note: String(contextNote || ''), raw_film: dbIndex('Films')[filmId].display_key,
      source_tab: 'app', source_row: null, created_at: nowIso_() };
    dbAppend('CollectionEntries', [rec]);
    audit_('add-entry', 'CollectionEntries', rec.entry_id, null, rec);
    return rec;
  });
}

function apiUpdateEntry(entryId, patch) {
  return withWriteLock_(function () {
    var cur = dbIndex('CollectionEntries')[entryId];
    if (!cur) throw new Error('Unknown list entry ' + entryId);
    var next = { entry_id: entryId };
    ['slot_label', 'context_note', 'source_note'].forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) next[k] = String(patch[k] || '');
    });
    dbUpdate('CollectionEntries', [next]);
    audit_('update-entry', 'CollectionEntries', entryId, stripRow_(cur), next);
    return stripRow_(dbIndex('CollectionEntries')[entryId]);
  });
}

/** Removes a film from one list. The film itself, its rating and its other lists are untouched. */
function apiRemoveEntry(entryId) {
  return withWriteLock_(function () {
    var cur = dbIndex('CollectionEntries')[entryId];
    if (!cur) throw new Error('Unknown list entry ' + entryId);
    dbDelete('CollectionEntries', [entryId]);
    audit_('remove-entry', 'CollectionEntries', entryId, stripRow_(cur), null);
    return { removed: entryId };
  });
}

/** Moves an entry to a new position within its list and renumbers the sequence. */
function apiMoveEntry(entryId, newIndex) {
  return withWriteLock_(function () {
    var cur = dbIndex('CollectionEntries')[entryId];
    if (!cur) throw new Error('Unknown list entry ' + entryId);
    var list = dbRead('CollectionEntries').filter(function (e) { return e.collection_id === cur.collection_id; })
      .sort(function (a, b) { return a.sequence - b.sequence; });
    var ids = list.map(function (e) { return e.entry_id; });
    ids.splice(ids.indexOf(entryId), 1);
    ids.splice(Math.max(0, Math.min(newIndex, ids.length)), 0, entryId);
    var changes = [];
    ids.forEach(function (id, i) {
      var e = list.filter(function (x) { return x.entry_id === id; })[0];
      if (Number(e.sequence) !== i + 1) changes.push({ entry_id: id, sequence: i + 1 });
    });
    dbUpdate('CollectionEntries', changes);
    audit_('move-entry', 'CollectionEntries', entryId, { sequence: cur.sequence }, { index: newIndex });
    return ids;
  });
}
