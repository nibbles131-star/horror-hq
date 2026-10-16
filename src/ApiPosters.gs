/**
 * Posters from TMDB (free). Each film is matched once by title + year and the result is kept on its Films row:
 *   tmdb_id ''      never looked up yet
 *   tmdb_id 'none'  TMDB had no confident match (fix it by hand from the film drawer)
 *   tmdb_id '1234'  matched; poster_url is the w342 image, or '' when TMDB has no poster for it
 * Admin runs the backlog in small slices with a progress bar; an hourly trigger catches films added later.
 */

var POSTER_BASE_ = 'https://image.tmdb.org/t/p/w342';
var POSTER_SLICE_ = 20;

function tmdbKey_() {
  return PropertiesService.getScriptProperties().getProperty('TMDB_API_KEY');
}

function tmdbRequest_(key, path) {
  var bearer = key.length > 60;
  var url = 'https://api.themoviedb.org/3' + path + (bearer ? '' : (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(key));
  return { url: url, muteHttpExceptions: true, headers: bearer ? { Authorization: 'Bearer ' + key } : {} };
}

function tmdbSearchPath_(title, year) {
  return '/search/movie?include_adult=false&query=' + encodeURIComponent(title) + (year ? '&year=' + year : '');
}

function posterTitleKey_(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/^(the|a|an) /, '').trim();
}

/**
 * Picks the TMDB result that is really this film, or null. Wrong posters are worse than none,
 * so the title has to line up and the year has to be within one (release dates differ by country).
 */
function pickTmdbMatch_(film, results, strict) {
  var want = posterTitleKey_(film.title);
  var best = null, bestScore = 0;
  (results || []).forEach(function (r, i) {
    var titles = [r.title, r.original_title].map(posterTitleKey_);
    var eq = titles.indexOf(want) >= 0;
    var near = !eq && want.length >= 4 && titles.some(function (t) { return t.length >= 4 && (t.indexOf(want) >= 0 || want.indexOf(t) >= 0); });
    var y = Number(String(r.release_date || '').slice(0, 4)) || null;
    var dy = film.release_year && y ? Math.abs(y - film.release_year) : 99;
    if (dy > 1) return;
    if (strict && !eq) return;
    var score = (eq ? 4 : near ? 2 : 0) + (dy === 0 ? 3 : 2) + ((r.genre_ids || []).indexOf(27) >= 0 ? 1 : 0) +
      (results.length === 1 ? 1 : 0) + (i === 0 ? 0.5 : 0) + (r.poster_path ? 0.25 : 0);
    if (score > bestScore) { best = r; bestScore = score; }
  });
  return bestScore >= 5 ? best : null;
}

function posterFields_(hit) {
  if (!hit) return { tmdb_id: 'none', poster_url: '' };
  return { tmdb_id: String(hit.id), poster_url: hit.poster_path ? POSTER_BASE_ + hit.poster_path : '' };
}

/** Parses one fetchAll response: {results} on success, {retry:true} for rate limits/outages; throws on a bad key. */
function tmdbParse_(res) {
  var code = res.getResponseCode();
  if (code === 401) throw new Error('TMDB rejected the key. Paste it again in Admin › Posters.');
  if (code !== 200) return { retry: true };
  try { return { results: JSON.parse(res.getContentText()).results || [] }; } catch (e) { return { retry: true }; }
}

/** Looks up a slice of films: year-filtered search first, then a strict no-year search for the misses. */
function matchPosterSlice_(key, films) {
  var out = {};
  var first = UrlFetchApp.fetchAll(films.map(function (f) { return tmdbRequest_(key, tmdbSearchPath_(f.title, f.release_year)); }));
  var again = [];
  films.forEach(function (f, i) {
    var p = tmdbParse_(first[i]);
    if (p.retry) return;
    var hit = pickTmdbMatch_(f, p.results, false);
    if (hit) out[f.film_id] = posterFields_(hit);
    else again.push(f);
  });
  if (again.length) {
    var second = UrlFetchApp.fetchAll(again.map(function (f) { return tmdbRequest_(key, tmdbSearchPath_(f.title, null)); }));
    again.forEach(function (f, i) {
      var p = tmdbParse_(second[i]);
      if (!p.retry) out[f.film_id] = posterFields_(pickTmdbMatch_(f, p.results, true));
    });
  }
  return out;
}

/** Writes tmdb_id + poster_url for many films in one go (one range write, not one per row). */
function writeFilmPosters_(updates) {
  var ids = Object.keys(updates);
  if (!ids.length) return 0;
  var sh = dbSheet_('Films');
  var cols = schemaColumns_('Films');
  var c = cols.indexOf('tmdb_id');
  if (cols[c + 1] !== 'poster_url') throw new Error('Films columns moved; poster writer needs updating.');
  var idx = dbIndex('Films');
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var range = sh.getRange(2, c + 1, last - 1, 2);
  var vals = range.getValues();
  var n = 0;
  ids.forEach(function (id) {
    var rec = idx[id];
    if (!rec) return; // merged away while we were fetching
    vals[rec._row - 2] = [updates[id].tmdb_id, updates[id].poster_url];
    n++;
  });
  range.setNumberFormat('@');
  range.setValues(vals);
  delete DB_MEMO_.Films;
  return n;
}

function posterCounts_() {
  var films = dbRead('Films');
  var c = { total: films.length, withPoster: 0, noImage: 0, notFound: 0, todo: 0, missing: [] };
  films.forEach(function (f) {
    var id = String(f.tmdb_id || '').trim();
    if (!id) c.todo++;
    else if (id === 'none') { c.notFound++; c.missing.push([f.film_id, f.display_key]); }
    else if (f.poster_url) c.withPoster++;
    else { c.noImage++; c.missing.push([f.film_id, f.display_key]); }
  });
  c.missing.sort(function (a, b) { return a[1] < b[1] ? -1 : 1; });
  return c;
}

/** Works through films never looked up, for up to budgetMs. Safe to call repeatedly; it picks up where it left off. */
function posterBatch_(budgetMs) {
  var key = tmdbKey_();
  if (!key) throw new Error('Add your TMDB key in Admin › Posters first.');
  var t0 = Date.now();
  dbClearMemo();
  var todo = dbRead('Films').filter(function (f) { return !String(f.tmdb_id || '').trim(); });
  var updates = {};
  var looked = 0;
  for (var i = 0; i < todo.length && Date.now() - t0 < budgetMs; i += POSTER_SLICE_) {
    var slice = todo.slice(i, i + POSTER_SLICE_);
    var got = matchPosterSlice_(key, slice);
    Object.keys(got).forEach(function (id) { updates[id] = got[id]; });
    looked += slice.length;
  }
  var written = withWriteLock_(function () { return writeFilmPosters_(updates); });
  return { looked: looked, written: written };
}

/** Admin › Posters: runs one slice (~25s) and returns progress. The page keeps calling until todo hits 0. */
function apiPosterRun() {
  var r = posterBatch_(25000);
  ensurePosterTrigger_();
  dbClearMemo();
  var c = posterCounts_();
  c.written = r.written;
  return c;
}

function apiPosterStatus() {
  dbClearMemo();
  var c = posterCounts_();
  c.keySet = !!tmdbKey_();
  return c;
}

/** Hourly trigger: posters for films added since the last run. Silent; never throws into the trigger log twice. */
function posterSweep() {
  try {
    if (!tmdbKey_()) return;
    posterBatch_(240000);
  } catch (e) {
    Logger.log('Poster sweep: ' + e.message);
  }
}

function ensurePosterTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'posterSweep'; });
  if (!exists) ScriptApp.newTrigger('posterSweep').timeBased().everyHours(1).create();
}

/** Film drawer: looks one film up straight away if it never has been. */
function apiPosterForFilm(filmId) {
  var key = tmdbKey_();
  if (!key) return { poster: '' };
  dbClearMemo();
  var f = dbIndex('Films')[filmId];
  if (!f) throw new Error('No film ' + filmId);
  if (String(f.tmdb_id || '').trim()) return { poster: f.poster_url || '', tmdb_id: f.tmdb_id };
  var got = matchPosterSlice_(key, [f]);
  if (!got[filmId]) return { poster: '' };
  withWriteLock_(function () { writeFilmPosters_(got); });
  return { poster: got[filmId].poster_url, tmdb_id: got[filmId].tmdb_id };
}

/** Film drawer "Change poster": TMDB search results to pick from. */
function apiPosterSearch(query, year) {
  var key = tmdbKey_();
  if (!key) throw new Error('Add your TMDB key in Admin › Posters first.');
  var res = UrlFetchApp.fetchAll([tmdbRequest_(key, tmdbSearchPath_(String(query || '').trim(), year || null))])[0];
  var p = tmdbParse_(res);
  if (p.retry) throw new Error('TMDB is not answering right now. Try again in a minute.');
  return p.results.slice(0, 12).map(function (r) {
    return { id: r.id, title: r.title, year: String(r.release_date || '').slice(0, 4), poster: r.poster_path ? POSTER_BASE_ + r.poster_path : '',
      horror: (r.genre_ids || []).indexOf(27) >= 0 };
  });
}

/** Pins a film to a TMDB entry (or 'none' to show no poster). Checked against TMDB, never trusted blind. */
function apiSetPoster(filmId, tmdbId) {
  var key = tmdbKey_();
  if (!key) throw new Error('Add your TMDB key in Admin › Posters first.');
  var fields = { tmdb_id: 'none', poster_url: '' };
  if (tmdbId !== 'none') {
    var res = UrlFetchApp.fetchAll([tmdbRequest_(key, '/movie/' + encodeURIComponent(tmdbId))])[0];
    if (res.getResponseCode() !== 200) throw new Error('TMDB has no film with id ' + tmdbId + '.');
    fields = posterFields_(JSON.parse(res.getContentText()));
  }
  return withWriteLock_(function () {
    var before = dbIndex('Films')[filmId];
    if (!before) throw new Error('No film ' + filmId);
    var upd = {};
    upd[filmId] = fields;
    writeFilmPosters_(upd);
    audit_('set-poster', 'Films', filmId, { tmdb_id: before.tmdb_id, poster_url: before.poster_url }, fields);
    return { poster: fields.poster_url, tmdb_id: fields.tmdb_id };
  });
}
