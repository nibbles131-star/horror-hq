/**
 * One-shot migration from the old "Horror Movie Master Sheet" into the
 * database workbook. It only ever READS the old workbook.
 *
 * Re-runnable: every run rebuilds all tables from scratch, so if the report
 * finds a problem we fix the code and run it again. Nothing is merged or
 * "fixed" silently: anything odd goes to MigrationExceptions with its raw value.
 *
 * Entry point: runMigration() (Script editor ▸ Run, or the Horror HQ menu).
 */

var LEGACY_TABS = {
  ratingsLog: 'Ratings Log ⭐',
  filmLibrary: 'Film Library 🎞️',
  metadata: 'Film Metadata 🌐',
  agenda: 'Watch Agenda 🎬',
  listIndex: 'List Index 🗂️',
  archive: 'Discovery Archive 🗄️',
  excavator: 'Horror Excavator 🔎',
  graveyard: 'Graveyard 🪦',
  challenge: 'Challenge Builder 🎃',
  ratingsArchive: 'Ratings Archive 🗃️',
  listLegacy: 'List Legacy 🧾',
  achievements: 'Achievements 🏆',
  hq: 'Horror HQ 🏠',
  bubblegum: 'Bubblegum & Cunt 🫧',
  alphabet: 'Alphabet List 🔤',
  franchise: 'Franchise Tracker 🔪'
};

// Standard seven-column list tabs: A list/category, B slot, C film, D status, E rating, F notes, G source note.
var STANDARD_LIST_TABS = [
  { tab: 'Yearly List 📆', family: 'Yearly' },
  { tab: 'Seasonal & Countdowns 🎃', family: 'Seasonal' },
  { tab: 'Curated Lists 🩸', family: 'Curated' },
  { tab: 'Classic Studios 🦇', family: 'Classics' },
  { tab: 'Horror Bestiary 👹', family: 'Bestiary' },
  { tab: 'Franchise Tracker 🔪', family: 'Franchise' }
];

var FAMILY_ICONS = {
  Yearly: '📆', Seasonal: '🎃', Curated: '🩸', Classics: '🦇', Bestiary: '👹',
  Alphabet: '🔤', Franchise: '🔪', Bubblegum: '🫧'
};

/** Reads a block of display values, trimming trailing fully-blank rows. */
function readBlock_(sheet, startRow, startCol, numCols, lastRowHint) {
  var last = Math.max(sheet.getLastRow(), lastRowHint || 0);
  if (last < startRow) return [];
  var vals = sheet.getRange(startRow, startCol, last - startRow + 1, numCols).getDisplayValues();
  var end = vals.length;
  while (end > 0 && vals[end - 1].every(function (v) { return String(v).trim() === ''; })) end--;
  return vals.slice(0, end);
}

function legacyTab_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Old workbook is missing the tab "' + name + '"');
  return sh;
}

function runMigration(force) {
  // Once the app is live, a re-run would replace every table and wipe everything changed in the app since.
  if (force !== true) {
    var done = null;
    try { done = getSetting('migrated_at', null); } catch (e) { done = null; }
    if (done) throw new Error('Horror HQ was already migrated (' + done + '). Running it again would replace every table and wipe ' +
      'everything you have changed in the app since, so it is switched off. Nothing was touched.');
  }
  var started = new Date();
  setupDatabase();
  var L = legacySpreadsheet_();
  var now = nowIso_();
  var ex = [];
  var exId = makeIdGen_('EX', 4);
  function exception(severity, kind, tab, ref, raw, detail) {
    ex.push({ exception_id: exId(), severity: severity, kind: kind, source_tab: tab, source_ref: ref,
      raw_value: raw === undefined ? '' : String(raw), detail: detail, resolution: '', resolved: false });
  }

  // ---------------------------------------------------------------- read sources
  var src = {};
  var rl = legacyTab_(L, LEGACY_TABS.ratingsLog);
  src.ratingsLog = readBlock_(rl, 10, 1, 6);                 // A Film, B context, C rating, D verdict, E status, F notes
  src.awards = rl.getRange(3, 8, 14, 3).getDisplayValues();   // H:J from row 3
  src.newFilmsToAdd = readBlock_(rl, 21, 8, 1);               // H21:H — pending NEW FILMS TO ADD handoff
  src.lists = STANDARD_LIST_TABS.map(function (t) {
    return { tab: t.tab, family: t.family, rows: readBlock_(legacyTab_(L, t.tab), 4, 1, 7) };
  });
  src.alphabet = readBlock_(legacyTab_(L, LEGACY_TABS.alphabet), 4, 1, 6);
  src.bubblegum = readBlock_(legacyTab_(L, LEGACY_TABS.bubblegum), 4, 1, 6);
  var lib = legacyTab_(L, LEGACY_TABS.filmLibrary);
  src.libraryBackend = readBlock_(lib, 7, 12, 10);            // L:U
  src.libraryView = readBlock_(lib, 7, 1, 10);                // A:J (derived; used for reconciliation)
  var meta = legacyTab_(L, LEGACY_TABS.metadata);
  src.countryRegister = readBlock_(meta, 5, 6, 2);            // F:G
  src.aliasRegister = readBlock_(meta, 5, 9, 2);              // I:J
  src.agenda = readBlock_(legacyTab_(L, LEGACY_TABS.agenda), 2, 1, 4);
  src.eventPlans = readBlock_(legacyTab_(L, LEGACY_TABS.listIndex), 2, 1, 5);
  src.archive = readBlock_(legacyTab_(L, LEGACY_TABS.archive), 7, 1, 16);
  var exc = legacyTab_(L, LEGACY_TABS.excavator);
  src.excavatorControls = exc.getRange(4, 1, 4, 16).getDisplayValues();
  src.excavatorStatus = exc.getRange(10, 1, 1, 17).getDisplayValues()[0];
  src.excavatorInbox = readBlock_(exc, 13, 1, 20);
  src.graveyard = readBlock_(legacyTab_(L, LEGACY_TABS.graveyard), 6, 6, 5);
  var ch = legacyTab_(L, LEGACY_TABS.challenge);
  src.challengeName = ch.getRange(3, 2).getDisplayValue();
  src.challengeCriteria = readBlock_(ch, 7, 1, 2);
  src.challengeAssignments = readBlock_(ch, 7, 6, 4);
  src.ratingsArchive = readBlock_(legacyTab_(L, LEGACY_TABS.ratingsArchive), 2, 1, 5);
  src.listLegacy = readBlock_(legacyTab_(L, LEGACY_TABS.listLegacy), 2, 1, 9);
  src.achievements = legacyTab_(L, LEGACY_TABS.achievements).getRange(9, 1, 7, 9).getDisplayValues();

  // ---------------------------------------------------------------- film registry
  var films = {};        // display_key -> film record
  var filmOrder = [];
  var filmSources = {};  // display_key -> Set of where we saw it
  function seeFilm(rawKey, where) {
    var key = String(rawKey || '').trim();
    if (!key) return null;
    if (!films[key]) {
      var p = parseFilmKey_(key);
      films[key] = { display_key: key, title: p.title, release_year: p.year, match_key: matchKey_(key),
        original_title: '', tmdb_id: '', poster_url: '', import_source: where, created_at: now, updated_at: now };
      filmOrder.push(key);
      filmSources[key] = {};
      if (p.year === null) exception('warning', 'malformed-title-year', where, key, key, 'Film key has no clean "(YYYY)" year.');
    }
    filmSources[key][where] = true;
    return films[key];
  }

  // The legacy "known films" universe = Ratings Log keys ∪ Film Library backend keys.
  src.ratingsLog.forEach(function (r) { seeFilm(r[0], LEGACY_TABS.ratingsLog); });
  src.libraryBackend.forEach(function (r) { seeFilm(r[0], LEGACY_TABS.filmLibrary); });
  var legacyKnown = {};
  filmOrder.forEach(function (k) { legacyKnown[k] = true; });

  // Anything referenced elsewhere but not known to the Film Library is still kept, and flagged.
  function seeReferenced(rawKey, where, ref) {
    var key = String(rawKey || '').trim();
    if (!key) return null;
    if (!films[key]) exception('warning', 'film-not-in-library', where, ref, key,
      'Referenced here but absent from Ratings Log and Film Library backend; created as a new film.');
    return seeFilm(key, where);
  }
  src.lists.forEach(function (l) { l.rows.forEach(function (r, i) { seeReferenced(r[2], l.tab, 'row ' + (i + 4)); }); });
  src.alphabet.forEach(function (r, i) { seeReferenced(r[1], LEGACY_TABS.alphabet, 'row ' + (i + 4)); });
  src.bubblegum.forEach(function (r, i) { seeReferenced(r[1], LEGACY_TABS.bubblegum, 'row ' + (i + 4)); });
  src.agenda.forEach(function (r, i) { seeReferenced(r[1], LEGACY_TABS.agenda, 'row ' + (i + 2)); });
  src.archive.forEach(function (r, i) { seeReferenced(r[5], LEGACY_TABS.archive, 'row ' + (i + 7)); });
  src.countryRegister.forEach(function (r, i) {
    if (r[0] && !films[String(r[0]).trim()]) {
      exception('info', 'country-for-unknown-film', LEGACY_TABS.metadata, 'F' + (i + 5), r[0],
        'Country register entry for a film not in the library; kept as LegacyRecord only.');
    }
  });

  // Stable ids in alphabetical order of display key (matches the old library's sort).
  var sortedKeys = filmOrder.slice().sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
  var nextFilmId = makeIdGen_('F', 5);
  sortedKeys.forEach(function (k) { films[k].film_id = nextFilmId(); });
  function fid(rawKey) {
    var f = films[String(rawKey || '').trim()];
    return f ? f.film_id : '';
  }

  // Same normalised key under two display keys = possible duplicate (never merged).
  var byMatch = {};
  sortedKeys.forEach(function (k) {
    var m = films[k].match_key;
    (byMatch[m] = byMatch[m] || []).push(k);
  });
  Object.keys(byMatch).forEach(function (m) {
    if (byMatch[m].length > 1) exception('warning', 'possible-duplicate', 'Films', m, byMatch[m].join(' / '),
      'Different spellings normalise to the same key. Kept as separate films for manual review.');
  });

  // ---------------------------------------------------------------- film state
  var state = {};
  function setState(key, status, rawRating, reaction, where, ref) {
    var f = films[key];
    if (!f) return;
    var st = String(status || '').trim() || 'Not watched';
    if (VIEWING_STATUSES.indexOf(st) < 0) {
      exception('error', 'unknown-status', where, ref, st, 'Unrecognised viewing status; stored as Not watched, raw kept.');
      st = 'Not watched';
    }
    var rating = parseRating_(rawRating);
    if (!isBlank_(rawRating) && (rating === null || rating < 1 || rating > 10 || rating !== Math.round(rating))) {
      exception('warning', 'odd-rating', where, ref, rawRating, 'Rating is not a whole number 1-10; parsed as ' + rating + ', raw kept.');
    }
    if (rating !== null && (rating < 1 || rating > 10)) rating = null;
    state[key] = { film_id: f.film_id, viewing_status: st, rating_10: rating, reaction: reaction || '',
      raw_rating: rawRating || '', version: 1, modified_at: now };
  }
  src.ratingsLog.forEach(function (r, i) {
    var key = String(r[0]).trim();
    if (!key) return;
    if (state[key]) {
      exception('error', 'duplicate-ratings-log-row', LEGACY_TABS.ratingsLog, 'row ' + (i + 10), key,
        'Film appears twice in Ratings Log; first row kept.');
      return;
    }
    setState(key, r[4], r[2], r[5], LEGACY_TABS.ratingsLog, 'row ' + (i + 10));
  });
  src.libraryBackend.forEach(function (r, i) {
    var key = String(r[0]).trim();
    if (!key || state[key]) return;
    setState(key, r[1], r[2], '', LEGACY_TABS.filmLibrary, 'L' + (i + 7));
  });
  sortedKeys.forEach(function (k) { if (!state[k]) setState(k, 'Not watched', '', '', 'default', k); });

  // ---------------------------------------------------------------- collections + entries
  var collections = [];
  var collByKey = {};
  var entries = [];
  var nextColl = makeIdGen_('C', 3);
  var nextEntry = makeIdGen_('E', 5);
  function collection(family, name, tab) {
    var k = family + '|~|' + name;
    if (!collByKey[k]) {
      var c = { collection_id: nextColl(), family: family, name: name, icon: FAMILY_ICONS[family] || '',
        description: '', sort_order: collections.length + 1, active: true, source_tab: tab, created_at: now };
      if (family === 'Bestiary') {
        var cat = BESTIARY_CATEGORIES.filter(function (b) { return b.name === name; })[0];
        if (cat) c.icon = cat.icon;
        else exception('warning', 'unknown-bestiary-category', tab, name, name, 'Not one of the 15 locked categories.');
      }
      collByKey[k] = c;
      collections.push(c);
    }
    return collByKey[k];
  }
  // Make sure all 15 Bestiary categories and 5 studios exist even when empty (e.g. Killer Animals).
  BESTIARY_CATEGORIES.forEach(function (b) { collection('Bestiary', b.name, 'Horror Bestiary 👹'); });
  CLASSIC_STUDIOS.forEach(function (s) { collection('Classics', s, 'Classic Studios 🦇'); });

  var seqByColl = {};
  var seenMembership = {};
  var crossCheck = []; // list-tab status vs Ratings Log status
  function addEntry(coll, rawFilm, slot, sourceNote, tab, row, shownStatus) {
    var key = String(rawFilm || '').trim();
    if (!key) {
      if (slot || sourceNote) exception('info', 'empty-slot', tab, 'row ' + row, slot, 'Slot with no film; not migrated as an entry.');
      return;
    }
    seqByColl[coll.collection_id] = (seqByColl[coll.collection_id] || 0) + 1;
    var mk = coll.collection_id + '|~|' + key;
    if (seenMembership[mk]) exception('warning', 'repeated-membership', tab, 'row ' + row, key,
      'Same film appears twice in ' + coll.name + '; both entries kept.');
    seenMembership[mk] = true;
    entries.push({ entry_id: nextEntry(), collection_id: coll.collection_id, film_id: fid(key), slot_label: slot,
      sequence: seqByColl[coll.collection_id], source_note: sourceNote || '', context_note: '', raw_film: key,
      source_tab: tab, source_row: row, created_at: now });
    if (shownStatus && state[key] && shownStatus !== state[key].viewing_status) {
      crossCheck.push(key);
      exception('warning', 'status-mismatch', tab, 'row ' + row, shownStatus,
        key + ': list shows "' + shownStatus + '" but Ratings Log says "' + state[key].viewing_status + '". Ratings Log wins.');
    }
  }
  src.lists.forEach(function (l) {
    l.rows.forEach(function (r, i) {
      if (!String(r[0]).trim() && !String(r[2]).trim()) return;
      var name = String(r[0]).trim() || '(unnamed)';
      addEntry(collection(l.family, name, l.tab), r[2], String(r[1]).trim(), r[6], l.tab, i + 4, String(r[3]).trim());
    });
  });
  var alpha = collection('Alphabet', 'Alphabet List', LEGACY_TABS.alphabet);
  src.alphabet.forEach(function (r, i) { addEntry(alpha, r[1], String(r[0]).trim(), r[5], LEGACY_TABS.alphabet, i + 4, String(r[2]).trim()); });
  var bubble = collection('Bubblegum', 'Bubblegum & Cunt', LEGACY_TABS.bubblegum);
  var special = [];
  src.bubblegum.forEach(function (r, i) {
    addEntry(bubble, r[1], String(r[0]).trim(), '', LEGACY_TABS.bubblegum, i + 4, String(r[2]).trim());
    var key = String(r[1]).trim();
    if (!key) return;
    var raw = String(r[5]).trim();
    var cm = parseRating_(raw);
    if (raw && (cm === null || cm < 1 || cm > 5)) {
      exception('warning', 'odd-cuntometer', LEGACY_TABS.bubblegum, 'F' + (i + 4), raw, 'Cuntometer is not 1-5; raw kept.');
      cm = null;
    }
    var note = String(r[4]).trim();
    var reaction = state[key] ? state[key].reaction : '';
    if (raw || (note && note !== reaction)) {
      special.push({ film_id: fid(key), cuntometer_5: cm, serve_note: note === reaction ? '' : note,
        raw_cuntometer: raw, modified_at: now });
    }
  });

  // Unsure is franchise-only.
  var franchiseFilms = {};
  entries.forEach(function (e) {
    var c = collections.filter(function (x) { return x.collection_id === e.collection_id; })[0];
    if (c.family === 'Franchise') franchiseFilms[e.film_id] = true;
  });
  Object.keys(state).forEach(function (k) {
    if (state[k].viewing_status === 'Unsure' && !franchiseFilms[state[k].film_id]) {
      exception('warning', 'unsure-outside-franchise', 'FilmState', k, 'Unsure', 'Unsure on a film that is not in any franchise.');
    }
  });

  // ---------------------------------------------------------------- countries
  var countries = [];
  var countryByName = {};
  var nextCountry = makeIdGen_('CO', 3);
  var filmCountries = [];
  var nextFC = makeIdGen_('FC', 5);
  var legacy = [];
  var nextLegacy = makeIdGen_('LG', 5);
  var registerSeen = {};
  src.countryRegister.forEach(function (r, i) {
    var key = String(r[0]).trim();
    if (!key) return;
    if (registerSeen[key]) {
      exception('warning', 'duplicate-country-register', LEGACY_TABS.metadata, 'F' + (i + 5), key, 'Film registered twice; first kept.');
      return;
    }
    registerSeen[key] = true;
    if (!films[key]) {
      legacy.push({ legacy_id: nextLegacy(), source_tab: LEGACY_TABS.metadata, source_row: i + 5, film_id: '',
        raw: { film: key, countries: r[1] }, note: 'Country register row for a film not in the library' });
      return;
    }
    splitPipes_(r[1]).forEach(function (name, j) {
      if (!countryByName[name]) {
        countryByName[name] = { country_id: nextCountry(), name: name };
        countries.push(countryByName[name]);
      }
      filmCountries.push({ film_country_id: nextFC(), film_id: fid(key), country_id: countryByName[name].country_id,
        country_order: j + 1, source: 'Film Metadata register G' + (i + 5), raw_value: r[1] });
    });
  });

  // ---------------------------------------------------------------- aliases
  var aliases = [];
  var nextAlias = makeIdGen_('A', 4);
  src.aliasRegister.forEach(function (r, i) {
    var alt = String(r[0]).trim(), canon = String(r[1]).trim();
    if (!alt && !canon) return;
    var p = parseFilmKey_(alt);
    var target = films[canon];
    if (!target) {
      exception('warning', 'alias-target-missing', LEGACY_TABS.metadata, 'J' + (i + 5), canon, 'Alias points at a film that is not in the library.');
    }
    var bothExist = !!films[alt];
    if (bothExist) exception('warning', 'possible-duplicate', LEGACY_TABS.metadata, 'I' + (i + 5), alt + ' / ' + canon,
      'Both titles exist as separate films. Review before merging; nothing was merged.');
    aliases.push({ alias_id: nextAlias(), film_id: target ? target.film_id : '', alias_display_key: alt, alias_title: p.title,
      alias_year: p.year, match_key: matchKey_(alt), status: bothExist ? 'review: both exist' : 'alternate title',
      provenance: 'Film Metadata alias register I' + (i + 5), created_at: now });
  });
  if (films['Horror of Dracula (1958)']) {
    aliases.push({ alias_id: nextAlias(), film_id: fid('Horror of Dracula (1958)'), alias_display_key: 'Dracula (1958)',
      alias_title: 'Dracula', alias_year: 1958, match_key: matchKey_('Dracula (1958)'), status: 'alternate title',
      provenance: 'Hammer source-list title (operating guide §8.4)', created_at: now });
  }

  // ---------------------------------------------------------------- discovery memory (Film Library L:U)
  var memory = [];
  src.libraryBackend.forEach(function (r, i) {
    var key = String(r[0]).trim();
    if (!key) return;
    var ds = String(r[3]).trim();
    if (ds && DISCOVERY_STATUSES.indexOf(ds) < 0) exception('warning', 'unknown-discovery-status', LEGACY_TABS.filmLibrary, 'O' + (i + 7), ds, 'Raw value kept.');
    var d = parseDate_(r[5]);
    if (r[5] && !d) exception('info', 'unparsed-date', LEGACY_TABS.filmLibrary, 'Q' + (i + 7), r[5], 'Date kept raw only.');
    memory.push({ film_id: fid(key), discovery_status: ds, exclusion_reason: r[4], date_added: d, origin: r[6],
      memory_notes: r[7], research_source: r[9], raw_viewing_status: r[1], raw_rating: r[2], raw_country: r[8],
      raw_date_added: r[5], source_row: i + 7, modified_at: now });
  });

  // ---------------------------------------------------------------- excavator: searches, candidates, decisions
  var searches = {};
  var searchOrder = [];
  var candidates = [];
  var decisions = [];
  var nextCand = makeIdGen_('CA', 5);
  var nextDec = makeIdGen_('DE', 5);
  var orderInSearch = {};
  var candByKey = {};
  src.archive.forEach(function (r, i) {
    var sid = String(r[0]).trim();
    if (!sid) { exception('warning', 'archive-row-without-search', LEGACY_TABS.archive, 'row ' + (i + 7), r[5], 'Kept with search id "(none)".'); sid = '(none)'; }
    if (!searches[sid]) {
      searches[sid] = { search_id: sid, search_date: parseDate_(r[1]), search_type: r[2], destination: '', target: r[3],
        wanted: null, style: '', known_policy: '', must_include: '', avoid: '', brief: r[4], state: 'Archived', created_at: now };
      searchOrder.push(sid);
    }
    orderInSearch[sid] = (orderInSearch[sid] || 0) + 1;
    var p = parseFilmKey_(r[5]);
    var cand = { candidate_id: nextCand(), search_id: sid, film_id: fid(r[5]), surfaced_title: String(r[5]).trim(),
      surfaced_year: p.year, why_it_fits: r[6], sources: r[7], evidence_note: r[8], known_before: r[9],
      original_order: orderInSearch[sid], archive_notes: r[14], source_row: i + 7, created_at: now };
    candidates.push(cand);
    candByKey[sid + '|~|' + cand.surfaced_title] = cand;
    if (String(r[10]).trim()) {
      decisions.push({ decision_id: nextDec(), candidate_id: cand.candidate_id, decision: String(r[10]).trim(), reason: r[11],
        decision_date: parseDate_(r[12]), destination_result: r[13], actor: 'Tommy (migrated)', created_at: now });
    }
  });
  // Current inbox: link rows to archive candidates, flag anything unsynced or disagreeing.
  src.excavatorInbox.forEach(function (r, i) {
    var film = String(r[1]).trim();
    if (!film) return;
    var sid = String(r[15]).trim();
    var cand = candByKey[sid + '|~|' + film];
    var ref = 'row ' + (i + 13);
    if (!cand) { exception('error', 'inbox-not-in-archive', LEGACY_TABS.excavator, ref, film, 'Inbox candidate missing from Discovery Archive.'); return; }
    var sync = String(r[14]).trim();
    if (sync && sync.indexOf('Synced') < 0) exception('error', 'unsynced-decision', LEGACY_TABS.excavator, ref, sync,
      film + ': decision "' + r[8] + '" was not fully processed in the old sheet. Needs a decision before cutover.');
    var archived = decisions.filter(function (d) { return d.candidate_id === cand.candidate_id; })[0];
    var inboxDecision = String(r[8]).trim();
    if (inboxDecision && (!archived || archived.decision !== inboxDecision)) exception('warning', 'decision-mismatch', LEGACY_TABS.excavator, ref,
      inboxDecision, film + ': inbox says "' + inboxDecision + '", archive says "' + (archived ? archived.decision : 'none') + '".');
  });
  var c = src.excavatorControls;
  var draft = { search_type: c[0][1], destination: c[0][5], wanted: parseRating_(c[0][9]), style: c[0][11], known_policy: c[0][15],
    target: c[1][1], must_include: c[1][9], avoid: c[1][15], brief: c[2][1] };
  var activeId = String(src.excavatorStatus[0]).trim();
  if (activeId && searches[activeId]) {
    var s = searches[activeId];
    s.state = 'Open'; // the old inbox stays the app's inbox until Tommy archives it
    if (s.target === draft.target) {
      s.destination = draft.destination; s.wanted = draft.wanted; s.style = draft.style; s.known_policy = draft.known_policy;
      s.must_include = draft.must_include; s.avoid = draft.avoid;
    }
  }

  // ---------------------------------------------------------------- planner
  var agenda = [];
  var nextSched = makeIdGen_('S', 5);
  src.agenda.forEach(function (r, i) {
    if (!String(r[0]).trim() && !String(r[1]).trim()) return;
    var d = parseDate_(r[0]);
    if (!d) exception('warning', 'unparsed-date', LEGACY_TABS.agenda, 'A' + (i + 2), r[0], 'Agenda date not recognised; raw kept.');
    agenda.push({ schedule_id: nextSched(), planned_date: d, film_id: fid(r[1]), occasion: r[2], context_note: r[3],
      sort_order: i + 1, raw_film: String(r[1]).trim(), raw_date: r[0], source_row: i + 2, created_at: now });
  });
  var plans = [];
  var nextPlan = makeIdGen_('EP', 3);
  src.eventPlans.forEach(function (r, i) {
    if (!String(r[0]).trim()) return;
    plans.push({ event_plan_id: nextPlan(), name: r[0], start_date: parseDate_(r[1]), end_date: parseDate_(r[2]),
      intended_films: r[3], planning_note: r[4], occasion_key: '', sort_order: i + 1,
      raw_row: { a: r[0], b: r[1], c: r[2], d: r[3], e: r[4], row: i + 2 } });
  });

  // ---------------------------------------------------------------- challenges
  var challenges = [], criteria = [], assignments = [];
  var critLabels = src.challengeCriteria.filter(function (r) { return String(r[0]).trim(); });
  if (critLabels.length || src.challengeAssignments.some(function (r) { return String(r[1]).trim(); })) {
    challenges.push({ challenge_id: 'CH001', title: src.challengeName || 'Challenge', period: '', active: true, created_at: now });
    var critByLabel = {};
    critLabels.forEach(function (r, i) {
      var id = 'CR' + pad_(i + 1, 3);
      critByLabel[String(r[0]).trim()] = id;
      criteria.push({ criterion_id: id, challenge_id: 'CH001', label: String(r[0]).trim(), required_count: parseRating_(r[1]) || 1,
        display_order: i + 1, notes: '' });
    });
    src.challengeAssignments.forEach(function (r, i) {
      if (!String(r[1]).trim()) return;
      var cid = critByLabel[String(r[0]).trim()];
      if (!cid) { exception('warning', 'assignment-unknown-criterion', LEGACY_TABS.challenge, 'row ' + (i + 7), r[0], 'Kept as LegacyRecord.'); return; }
      assignments.push({ assignment_id: 'AS' + pad_(assignments.length + 1, 4), criterion_id: cid, film_id: fid(r[1]),
        fit_notes: r[3], created_at: now });
    });
  }

  // ---------------------------------------------------------------- graveyard, awards, trophies
  var burials = [];
  src.graveyard.forEach(function (r, i) {
    var film = String(r[0]).trim();
    if (!film || /^no corpses/i.test(film)) return;
    burials.push({ burial_id: 'B' + pad_(burials.length + 1, 4), film_id: fid(film), raw_film: film, context: r[1],
      cause_of_death: r[2], interred_date: parseDate_(r[3]), notes: r[4], created_at: now });
  });
  var awards = [];
  src.awards.forEach(function (r, i) {
    var label = String(r[0]).trim();
    if (!label) return;
    var winner = String(r[1]).trim();
    if (winner && !films[winner]) exception('warning', 'award-winner-unknown', LEGACY_TABS.ratingsLog, 'I' + (i + 3), winner, 'Winner kept as raw text.');
    awards.push({ award_id: 'AW' + pad_(awards.length + 1, 2), label: label, sort_order: awards.length + 1,
      winner_film_id: fid(winner), raw_winner: winner, award_rating: r[2], source_cell: 'Ratings Log H' + (i + 3),
      notes: '', modified_at: now });
  });
  var trophies = trophyDefinitions_();
  src.achievements.forEach(function (r) {
    var fam = String(r[0]).trim();
    [3, 5, 7].forEach(function (col, t) {
      var m = String(r[col]).match(/^(.*?)\s*•\s*(\d+)$/);
      if (!m) return;
      var def = trophies.filter(function (d) { return d.family === fam && d.tier === ['Bronze', 'Silver', 'Gold'][t]; })[0];
      if (!def || def.threshold !== Number(m[2]) || def.name !== m[1]) {
        exception('error', 'trophy-definition-mismatch', LEGACY_TABS.achievements, fam, r[col],
          'Live trophy differs from the frozen definition: ' + (def ? def.name + ' • ' + def.threshold : 'missing'));
      }
    });
  });

  // ---------------------------------------------------------------- legacy records + leftovers
  src.ratingsArchive.forEach(function (r, i) {
    legacy.push({ legacy_id: nextLegacy(), source_tab: LEGACY_TABS.ratingsArchive, source_row: i + 2, film_id: fid(r[0]),
      raw: { film: r[0], context: r[1], rating: r[2], status: r[3], notes: r[4] }, note: '' });
    var key = String(r[0]).trim();
    var st = state[key];
    if (st && parseRating_(r[2]) !== null && parseRating_(r[2]) !== st.rating_10) {
      exception('info', 'archive-rating-differs', LEGACY_TABS.ratingsArchive, 'row ' + (i + 2), r[2],
        key + ': archive rating ' + r[2] + ' vs current ' + (st.rating_10 === null ? 'blank' : st.rating_10) + '. Current kept.');
    }
  });
  src.listLegacy.forEach(function (r, i) {
    legacy.push({ legacy_id: nextLegacy(), source_tab: LEGACY_TABS.listLegacy, source_row: i + 2, film_id: fid(r[3]),
      raw: { group: r[0], list: r[1], slot: r[2], film: r[3], status: r[4], rating: r[5], notes: r[6], source_note: r[7], key: r[8] }, note: '' });
  });
  src.newFilmsToAdd.forEach(function (r, i) {
    if (String(r[0]).trim()) exception('warning', 'pending-new-film', LEGACY_TABS.ratingsLog, 'H' + (i + 21), r[0],
      'Was waiting in NEW FILMS TO ADD. The app adds films automatically now.');
  });

  // Ratings Log context labels that point at a list the film is not actually on.
  var listedIds = {};
  entries.forEach(function (e) { listedIds[e.film_id] = true; });
  src.ratingsLog.forEach(function (r, i) {
    var key = String(r[0]).trim(), label = String(r[1]).trim();
    if (key && label && films[key] && !listedIds[films[key].film_id]) exception('warning', 'stale-list-label', LEGACY_TABS.ratingsLog,
      'B' + (i + 10), label, key + ' is labelled "' + label + '" in Ratings Log but sits on no list tab. Kept as an unlisted film.');
  });

  // ---------------------------------------------------------------- write everything
  var filmRows = sortedKeys.map(function (k) { return films[k]; });
  var stateRows = sortedKeys.map(function (k) { return state[k]; });
  dbReplaceAll('Films', filmRows);
  dbReplaceAll('FilmState', stateRows);
  dbReplaceAll('FilmAliases', aliases);
  dbReplaceAll('Collections', collections);
  dbReplaceAll('CollectionEntries', entries);
  dbReplaceAll('SpecialRatings', special);
  dbReplaceAll('Countries', countries);
  dbReplaceAll('FilmCountries', filmCountries);
  dbReplaceAll('WatchAgenda', agenda);
  dbReplaceAll('EventPlans', plans);
  dbReplaceAll('Challenges', challenges);
  dbReplaceAll('ChallengeCriteria', criteria);
  dbReplaceAll('ChallengeAssignments', assignments);
  dbReplaceAll('ExcavationSearches', searchOrder.map(function (id) { return searches[id]; }));
  dbReplaceAll('ExcavationCandidates', candidates);
  dbReplaceAll('DiscoveryDecisions', decisions);
  dbReplaceAll('DiscoveryMemory', memory);
  dbReplaceAll('ManualBurials', burials);
  dbReplaceAll('Awards', awards);
  dbReplaceAll('TrophyDefinitions', trophies);
  dbReplaceAll('LegacyRecords', legacy);
  dbReplaceAll('MigrationExceptions', ex);
  dbReplaceAll('Audit', [{ audit_id: 'AU' + Date.now(), at: now, action: 'migration', entity: '*', entity_id: '',
    before: null, after: { films: filmRows.length, entries: entries.length }, source: 'runMigration' }]);
  dbReplaceAll('Settings', [
    { key: 'excavator_draft', value: draft, modified_at: now },
    { key: 'migrated_at', value: now, modified_at: now },
    { key: 'poster_provider', value: { provider: 'TMDB', enabled: false, note: 'Add a free TMDB API key in Admin to switch posters on.' }, modified_at: now }
  ]);

  var report = reconcile_(L, src, { films: filmRows, state: stateRows, entries: entries, collections: collections,
    candidates: candidates, searches: searchOrder, agenda: agenda, plans: plans, awards: awards, filmCountries: filmCountries,
    memory: memory, legacyKnown: legacyKnown, exceptions: ex });
  report.seconds = Math.round((new Date() - started) / 1000);
  setSetting('migration_report', report);
  writeReportTab_(report);
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

/** Frozen trophy rules (operating guide §15). Platinum is versioned "founding-v1" and must never change retroactively. */
function trophyDefinitions_() {
  var core = [
    ['Horror Devotee', 'Films watched', ['Fresh Meat', 25], ['Genre Addict', 100], ['Horror Devotee', 250]],
    ['The Critic', 'Films rated', ['First Review', 10], ['Opinionated', 50], ['Everybody\'s A Critic', 100]],
    ['Taste Maker', '🖤 / 👑 verdicts', ['Love at First Fright', 1], ['Sicko Certified', 10], ['Personal Pantheon', 25]],
    ['Passport Control', 'Countries watched', ['First Stamp', 5], ['Frequent Flyer', 15], ['Passport Control', 30]],
    ['Time Traveller', 'Decades watched', ['Decade Hopper', 3], ['Time Traveller', 6], ['Century of Screams', 10]],
    ['Franchise Fiend', 'Franchise entries watched', ['Sequel Curious', 10], ['Franchise Fiend', 50], ['Completionist Brain', 100]],
    ['Beastmaster', 'Unique Bestiary films watched', ['First Contact', 5], ['Creature Collector', 25], ['Beastmaster', 50]]
  ];
  var out = [];
  var order = 0;
  core.forEach(function (c) {
    ['Bronze', 'Silver', 'Gold'].forEach(function (tier, i) {
      order++;
      out.push({ trophy_id: 'T-' + slug_(c[0]) + '-' + tier.toLowerCase(), family: c[0], metric: c[1], tier: tier,
        name: c[2 + i][0], threshold: c[2 + i][1], rule_version: 'founding-v1', sort_order: order });
    });
  });
  ['Bronze', 'Silver', 'Gold'].forEach(function (tier, i) {
    order++;
    out.push({ trophy_id: 'T-bestiary-' + tier.toLowerCase(), family: 'Bestiary category', metric: 'Watched in category',
      tier: tier, name: tier, threshold: [1, 5, 10][i], rule_version: 'founding-v1', sort_order: order });
  });
  out.push({ trophy_id: 'T-platinum', family: 'Platinum', metric: 'All 7 core Golds + Gold in 5 Bestiary categories',
    tier: 'Platinum', name: 'Platinum', threshold: 5, rule_version: 'founding-v1', sort_order: order + 1 });
  return out;
}
