/**
 * Reconciliation report: compares the old workbook's own dashboard numbers
 * against the same figures recomputed from the migrated tables. This replaces
 * the blueprint's long manual regression checklist.
 */

function legacyNumber_(sheet, a1) {
  var v = sheet.getRange(a1).getDisplayValue();
  var n = parseRating_(String(v).replace(/,/g, ''));
  return n === null ? v : n;
}

function reconcile_(L, src, m) {
  var lib = L.getSheetByName(LEGACY_TABS.filmLibrary);
  var rl = L.getSheetByName(LEGACY_TABS.ratingsLog);
  var arch = L.getSheetByName(LEGACY_TABS.archive);
  var pass = L.getSheetByName('Horror Passport 🌍');
  var hq = L.getSheetByName(LEGACY_TABS.hq);
  var ach = L.getSheetByName(LEGACY_TABS.achievements);

  var stateById = {};
  m.state.forEach(function (s) { stateById[s.film_id] = s; });
  var filmById = {};
  m.films.forEach(function (f) { filmById[f.film_id] = f; });
  var collById = {};
  m.collections.forEach(function (c) { collById[c.collection_id] = c; });

  var rlIds = {};
  var keyToId = {};
  m.films.forEach(function (f) { keyToId[f.display_key] = f.film_id; });
  src.ratingsLog.forEach(function (r) { if (String(r[0]).trim()) rlIds[keyToId[String(r[0]).trim()]] = true; });

  var inList = {};
  m.entries.forEach(function (e) { inList[e.film_id] = true; });

  function count(arr, pred) { return arr.filter(pred).length; }
  var watchedAll = count(m.state, function (s) { return s.viewing_status === 'Watched'; });
  var watchedRl = count(m.state, function (s) { return rlIds[s.film_id] && s.viewing_status === 'Watched'; });
  var ratedRl = count(m.state, function (s) { return rlIds[s.film_id] && s.rating_10 !== null; });
  var dnfRl = count(m.state, function (s) { return rlIds[s.film_id] && s.viewing_status === 'DNF'; });
  var knownMigrated = count(m.films, function (f) { return m.legacyKnown[f.display_key]; });

  var countriesByFilm = {};
  m.filmCountries.forEach(function (fc) { (countriesByFilm[fc.film_id] = countriesByFilm[fc.film_id] || []).push(fc.country_id); });
  var coverage = count(m.films, function (f) { return m.legacyKnown[f.display_key] && countriesByFilm[f.film_id]; });
  var passportCountries = {}, decades = {};
  m.state.forEach(function (s) {
    if (s.viewing_status !== 'Watched') return;
    (countriesByFilm[s.film_id] || []).forEach(function (c) { passportCountries[c] = true; });
    var y = filmById[s.film_id].release_year;
    if (y) decades[decadeOf_(y)] = true;
  });

  var franchiseEntries = m.entries.filter(function (e) { return collById[e.collection_id].family === 'Franchise'; });
  var franchiseWatched = count(franchiseEntries, function (e) { return stateById[e.film_id].viewing_status === 'Watched'; });

  var decisionsByType = {};
  dbRead('DiscoveryDecisions').forEach(function (d) { decisionsByType[d.decision] = (decisionsByType[d.decision] || 0) + 1; });

  var checks = [];
  function check(name, legacy, migrated, note) {
    var ok = String(legacy) === String(migrated);
    checks.push({ name: name, legacy: legacy, migrated: migrated, pass: ok, note: note || '' });
  }
  check('Known films (Film Library)', legacyNumber_(lib, 'A4'), knownMigrated);
  var extras = m.exceptions.filter(function (e) { return e.kind === 'film-not-in-library'; }).length;
  check('Films created in total (known + flagged extras)', knownMigrated + extras, m.films.length,
    'Extra films were referenced somewhere but unknown to the library; see exceptions.');
  check('Tracked films (Ratings Log rows)', legacyNumber_(rl, 'F3'), Object.keys(rlIds).length);
  check('Films with at least one list entry', legacyNumber_(lib, 'C4'), count(m.films, function (f) { return inList[f.film_id]; }),
    'Old ON LISTS also counts Ratings Archive-only films.');
  check('All films seen', legacyNumber_(lib, 'D4'), watchedAll);
  check('Listed films watched', legacyNumber_(rl, 'B2'), watchedRl);
  check('Listed films rated', legacyNumber_(rl, 'D2'), ratedRl);
  check('DNFs', legacyNumber_(rl, 'F2'), dnfRl);
  check('Maybes', legacyNumber_(lib, 'G4'), count(m.memory, function (x) { return x.discovery_status === '👀 Maybe'; }));
  check('Country coverage', String(lib.getRange('I4').getDisplayValue()), coverage + '/' + knownMigrated);
  check('Passport countries', legacyNumber_(pass, 'I3'), Object.keys(passportCountries).length);
  check('Passport decades', legacyNumber_(pass, 'G3'), Object.keys(decades).length);
  check('Franchise watched / entries', String(hq.getRange('K25').getDisplayValue()).replace(/\s/g, ''),
    franchiseWatched + '/' + franchiseEntries.length);
  check('Discovery candidates logged', legacyNumber_(arch, 'A4'), m.candidates.length);
  check('Discovery search batches', legacyNumber_(arch, 'C4'), m.searches.filter(function (s) { return s !== '(none)'; }).length);
  check('Discovery approved', legacyNumber_(arch, 'H4'), decisionsByType['✅ Approved'] || 0);
  check('Discovery seen / unlisted', legacyNumber_(arch, 'K4'), decisionsByType['👁️ Seen / unlisted'] || 0);
  check('Discovery rejected', legacyNumber_(arch, 'N4'), decisionsByType['🚫 Rejected'] || 0);
  check('Watch Agenda rows', src.agenda.filter(function (r) { return String(r[0]).trim() || String(r[1]).trim(); }).length, m.agenda.length);
  check('Event plans (List Index)', src.eventPlans.filter(function (r) { return String(r[0]).trim(); }).length, m.plans.length);
  check('Horror Awards labels', src.awards.filter(function (r) { return String(r[0]).trim(); }).length, m.awards.length);

  // Per-source row counts vs entries created from that tab.
  var bySource = {};
  m.entries.forEach(function (e) { bySource[e.source_tab] = (bySource[e.source_tab] || 0) + 1; });
  src.lists.forEach(function (l) {
    check('Entries from ' + l.tab, count(l.rows, function (r) { return String(r[2]).trim(); }), bySource[l.tab] || 0);
  });
  check('Entries from ' + LEGACY_TABS.alphabet, count(src.alphabet, function (r) { return String(r[1]).trim(); }), bySource[LEGACY_TABS.alphabet] || 0);
  check('Entries from ' + LEGACY_TABS.bubblegum, count(src.bubblegum, function (r) { return String(r[1]).trim(); }), bySource[LEGACY_TABS.bubblegum] || 0);

  // Bestiary listed counts per category vs the Achievements cabinet.
  var bestRows = ach.getRange(22, 1, 15, 3).getDisplayValues();
  bestRows.forEach(function (r) {
    var c = m.collections.filter(function (x) { return x.family === 'Bestiary' && x.name === r[0]; })[0];
    var listed = c ? count(m.entries, function (e) { return e.collection_id === c.collection_id; }) : 'missing';
    check('Bestiary listed: ' + r[0], Number(r[2]), listed);
  });

  var exCounts = { error: 0, warning: 0, info: 0 };
  m.exceptions.forEach(function (e) { exCounts[e.severity] = (exCounts[e.severity] || 0) + 1; });
  return {
    generated_at: nowIso_(),
    passed: checks.filter(function (c) { return c.pass; }).length,
    failed: checks.filter(function (c) { return !c.pass; }).length,
    checks: checks,
    exceptions: exCounts,
    tables: {
      Films: m.films.length, CollectionEntries: m.entries.length, Collections: m.collections.length,
      ExcavationCandidates: m.candidates.length, WatchAgenda: m.agenda.length
    }
  };
}

/** Human-readable copy of the report in a "Migration Report" tab of the database workbook. */
function writeReportTab_(report) {
  var ss = dbSpreadsheet_();
  var sh = ss.getSheetByName('Migration Report') || ss.insertSheet('Migration Report', 0);
  sh.clear();
  var rows = [['Horror HQ migration report', report.generated_at, '', ''],
    ['Checks passed', report.passed, 'Checks failed', report.failed],
    ['Exceptions', 'errors ' + report.exceptions.error + ' • warnings ' + report.exceptions.warning + ' • info ' + report.exceptions.info,
      'Details', 'MigrationExceptions tab'],
    ['', '', '', ''],
    ['Check', 'Old sheet', 'Migrated', 'Result']];
  report.checks.forEach(function (c) {
    rows.push([c.name, String(c.legacy), String(c.migrated), (c.pass ? '✅ match' : '❌ differs') + (c.note && !c.pass ? ' • ' + c.note : '')]);
  });
  sh.getRange(1, 1, rows.length, 4).setNumberFormat('@').setValues(rows);
  sh.getRange(1, 1, 1, 4).setFontWeight('bold').setFontSize(13);
  sh.getRange(5, 1, 1, 4).setFontWeight('bold');
  sh.setColumnWidth(1, 320); sh.setColumnWidth(2, 160); sh.setColumnWidth(3, 160); sh.setColumnWidth(4, 420);
}
