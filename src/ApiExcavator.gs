/**
 * Horror Excavator: the Arnold handoff without the spreadsheet chores.
 *
 * 1. Tommy builds the hunt; the app writes the request (plus the exclusion list
 *    for the chosen known-film policy) for him to paste to Arnold.
 * 2. He pastes Arnold's answer back; apiImportCandidates() records the search,
 *    every surfaced candidate (the permanent archive) and new films as 🔎 Candidate.
 * 3. Each decision is committed as he makes it (what "PROCESS EXCAVATOR" used to do).
 */

var EXCAVATOR_DESTINATIONS = {
  'Yearly List 📆': 'Yearly', 'Horror Bestiary 👹': 'Bestiary', 'Alphabet List 🔤': 'Alphabet',
  'Franchise Tracker 🔪': 'Franchise', 'Seasonal & Countdowns 🎃': 'Seasonal', 'Curated Lists 🩸': 'Curated',
  'Classic Studios 🦇': 'Classics', 'Bubblegum & Cunt 🫧': 'Bubblegum', 'Film Library only': '', 'Other / decide later': ''
};

function apiSaveExcavatorDraft(draft) {
  return withWriteLock_(function () {
    setSetting('excavator_draft', draft || {});
    return draft;
  });
}

/** Search history, every surfaced candidate and every decision, compact. Loaded when the Excavator opens. */
function apiExcavatorData() {
  dbClearMemo();
  return {
    draft: getSetting('excavator_draft', {}),
    searches: dbRead('ExcavationSearches').map(stripRow_),
    candidates: dbRead('ExcavationCandidates').map(function (c) {
      return [c.candidate_id, c.search_id, c.film_id, c.surfaced_title, c.why_it_fits, c.sources, c.evidence_note, c.known_before, c.original_order, c.archive_notes];
    }),
    decisions: dbRead('DiscoveryDecisions').map(function (d) {
      return [d.decision_id, d.candidate_id, d.decision, d.reason, d.decision_date, d.destination_result, d.created_at];
    })
  };
}

/** The old sheet's "Known before?" value for a film, given what the database knows right now. */
function knownBefore_(filmId, surfacedFilmIds) {
  if (!filmId) return 'No';
  var st = dbIndex('FilmState')[filmId];
  var mem = dbIndex('DiscoveryMemory')[filmId];
  var listed = dbRead('CollectionEntries').some(function (e) { return e.film_id === filmId; });
  if (listed) return 'Yes • tracked';
  if (st && (st.viewing_status === 'Watched' || st.viewing_status === 'DNF')) return 'Yes • seen';
  var ds = mem ? mem.discovery_status : '';
  if (ds === '🚫 Rejected') return 'Yes • rejected';
  if (ds === '👀 Maybe') return 'Yes • maybe';
  if (ds === '👁️ Seen / unlisted') return 'Yes • seen';
  if (ds) return 'Yes • candidate';
  if (surfacedFilmIds[filmId]) return 'Yes • surfaced before';
  return 'Yes • tracked';
}

function nextSearchId_(dateIso) {
  var max = dbRead('ExcavationSearches').reduce(function (m, s) {
    var mm = String(s.search_id).match(/^EXC-\d{8}-(\d+)$/);
    return mm ? Math.max(m, Number(mm[1])) : m;
  }, 0);
  return 'EXC-' + dateIso.replace(/-/g, '') + '-' + pad_(max + 1, 3);
}

function countryIdFor_(name, created) {
  var key = String(name || '').trim();
  if (!key) return null;
  var hit = dbRead('Countries').concat(created).filter(function (c) { return c.name.toLowerCase() === key.toLowerCase(); })[0];
  if (hit) return hit.country_id;
  var all = dbRead('Countries').concat(created);
  var max = all.reduce(function (m, c) { return Math.max(m, Number(String(c.country_id).slice(2)) || 0); }, 0);
  var rec = { country_id: 'CO' + pad_(max + 1, 3), name: key };
  created.push(rec);
  return rec.country_id;
}

/**
 * Records a search run by Arnold. rows: [{title, year, why, sources, evidence, countries}].
 * Never decides anything: every candidate starts Pending.
 */
function apiImportCandidates(draft, rows) {
  return withWriteLock_(function () {
    if (!rows || !rows.length) throw new Error('No candidates to import. Paste Arnold\'s answer first.');
    var today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
    var now = nowIso_();
    var searchId = nextSearchId_(today);
    var search = { search_id: searchId, search_date: today, search_type: draft.search_type || '', destination: draft.destination || '',
      target: draft.target || '', wanted: draft.wanted ? Number(draft.wanted) : null, style: draft.style || '',
      known_policy: draft.known_policy || '', must_include: draft.must_include || '', avoid: draft.avoid || '',
      brief: draft.brief || '', state: 'Open', created_at: now };
    var surfaced = {};
    dbRead('ExcavationCandidates').forEach(function (c) { if (c.film_id) surfaced[c.film_id] = true; });
    var films = dbRead('Films');
    var maxFilm = films.reduce(function (m, f) { return Math.max(m, Number(String(f.film_id).slice(1)) || 0); }, 0);
    var maxCand = dbRead('ExcavationCandidates').reduce(function (m, c) { return Math.max(m, Number(String(c.candidate_id).slice(2)) || 0); }, 0);
    var maxFc = dbRead('FilmCountries').reduce(function (m, c) { return Math.max(m, Number(String(c.film_country_id).slice(2)) || 0); }, 0);
    var newFilms = [], newStates = [], newMemory = [], candidates = [], newCountries = [], newFilmCountries = [], seenInRun = {};
    rows.forEach(function (r, i) {
      var title = String(r.title || '').trim();
      var year = Number(r.year);
      if (!title || !year) return;
      var key = title + ' (' + year + ')';
      var hit = findFilm_(key) || (function () {
        var f = newFilms.filter(function (x) { return x.match_key === matchKey_(key); })[0];
        return f ? { film: f, via: 'this run' } : null;
      })();
      var filmId, known;
      if (hit) {
        filmId = hit.film.film_id;
        known = hit.via === 'this run' ? 'No' : knownBefore_(filmId, surfaced);
      } else {
        filmId = 'F' + pad_(++maxFilm, 5);
        known = 'No';
        newFilms.push({ film_id: filmId, display_key: key, title: title, release_year: year, match_key: matchKey_(key), original_title: '',
          tmdb_id: '', poster_url: '', import_source: 'excavator ' + searchId, created_at: now, updated_at: now });
        newStates.push({ film_id: filmId, viewing_status: 'Not watched', rating_10: null, reaction: '', raw_rating: '', version: 1, modified_at: now });
        newMemory.push({ film_id: filmId, discovery_status: '🔎 Candidate', exclusion_reason: '', date_added: today, origin: 'Horror Excavator',
          memory_notes: searchId + (draft.search_type ? ' • ' + draft.search_type : ''), research_source: String(r.sources || '').split(/\s*[;|]\s*/)[0] || '',
          raw_viewing_status: '', raw_rating: '', raw_country: '', raw_date_added: '', source_row: null, modified_at: now });
        var hasCountry = {};
        String(r.countries || '').split(/\s*[,/|]\s*/).forEach(function (name, n) {
          var cid = countryIdFor_(name, newCountries);
          if (!cid || hasCountry[cid]) return;
          hasCountry[cid] = true;
          newFilmCountries.push({ film_country_id: 'FC' + pad_(++maxFc, 5), film_id: filmId, country_id: cid, country_order: n + 1,
            source: 'Excavator ' + searchId, raw_value: String(r.countries) });
        });
      }
      if (seenInRun[filmId]) return;
      seenInRun[filmId] = true;
      candidates.push({ candidate_id: 'CA' + pad_(++maxCand, 5), search_id: searchId, film_id: filmId, surfaced_title: key, surfaced_year: year,
        why_it_fits: String(r.why || ''), sources: String(r.sources || ''), evidence_note: String(r.evidence || ''), known_before: known,
        original_order: candidates.length + 1, archive_notes: '', source_row: null, created_at: now });
    });
    if (!candidates.length) throw new Error('None of those lines looked like "Title (YYYY) | why | sources".');
    dbAppend('ExcavationSearches', [search]);
    if (newFilms.length) { dbAppend('Films', newFilms); dbAppend('FilmState', newStates); dbAppend('DiscoveryMemory', newMemory); }
    if (newCountries.length) dbAppend('Countries', newCountries);
    if (newFilmCountries.length) dbAppend('FilmCountries', newFilmCountries);
    dbAppend('ExcavationCandidates', candidates);
    setSetting('excavator_draft', draft || {});
    audit_('import-candidates', 'ExcavationSearches', searchId, null, { candidates: candidates.length, newFilms: newFilms.length });
    return { search: search, candidates: candidates, films: newFilms, states: newStates, memory: newMemory,
      countries: newCountries, filmCountries: newFilmCountries };
  });
}

function setMemory_(filmId, patch, now) {
  var cur = dbIndex('DiscoveryMemory')[filmId];
  var rec = Object.assign({ film_id: filmId, modified_at: now }, patch);
  if (cur) dbUpdate('DiscoveryMemory', [rec]);
  else dbAppend('DiscoveryMemory', [Object.assign({ discovery_status: '', exclusion_reason: '', date_added: now.slice(0, 10), origin: 'Horror Excavator',
    memory_notes: '', research_source: '', raw_viewing_status: '', raw_rating: '', raw_country: '', raw_date_added: '', source_row: null }, rec)]);
  dbClearMemo();
  return stripRow_(dbIndex('DiscoveryMemory')[filmId]);
}

/**
 * Commits one decision, exactly as PROCESS EXCAVATOR did:
 *   ✅ Approved: add to the chosen list (unless Film Library only), memory = Approved
 *   👁️ Seen / unlisted: viewing status Watched (optional rating), memory = Seen / unlisted, no list
 *   🚫 Rejected / 👀 Maybe: memory updated with the reason, no list
 *   📚 Already tracked: nothing changes except the archive record
 *   ⏳ Pending: records that the decision was reopened
 * opts: { collection_id, slot, rating }
 */
function apiDecideCandidate(candidateId, decision, reason, opts) {
  return withWriteLock_(function () {
    opts = opts || {};
    var cand = dbIndex('ExcavationCandidates')[candidateId];
    if (!cand) throw new Error('Unknown candidate ' + candidateId);
    if (EXCAVATOR_DECISIONS.indexOf(decision) < 0) throw new Error('Unknown decision ' + decision);
    var film = dbIndex('Films')[cand.film_id];
    if (!film) throw new Error('Candidate ' + cand.surfaced_title + ' is not linked to a film.');
    var now = nowIso_(), today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
    reason = String(reason || '');
    var out = { entry: null, state: null, memory: null };
    var result = '';
    if (decision === '✅ Approved') {
      if (opts.collection_id) {
        var coll = dbIndex('Collections')[opts.collection_id];
        if (!coll) throw new Error('Unknown list ' + opts.collection_id);
        var dup = dbRead('CollectionEntries').filter(function (e) { return e.collection_id === coll.collection_id && e.film_id === film.film_id; })[0];
        if (dup) {
          result = 'Already on ' + coll.family + ' • ' + coll.name;
        } else {
          var maxE = dbRead('CollectionEntries').reduce(function (m, e) { return Math.max(m, Number(String(e.entry_id).slice(1)) || 0); }, 0);
          out.entry = { entry_id: 'E' + pad_(maxE + 1, 5), collection_id: coll.collection_id, film_id: film.film_id, slot_label: String(opts.slot || ''),
            sequence: nextEntrySequence_(coll.collection_id), source_note: 'Excavator ' + cand.search_id, context_note: '', raw_film: film.display_key,
            source_tab: 'app', source_row: null, created_at: now };
          dbAppend('CollectionEntries', [out.entry]);
          result = 'Added to ' + coll.family + ' • ' + coll.name + (opts.slot ? ' (slot ' + opts.slot + ')' : '');
        }
      } else {
        result = 'Film Library only';
      }
      out.memory = setMemory_(film.film_id, { discovery_status: '✅ Approved', exclusion_reason: '' }, now);
    } else if (decision === '👁️ Seen / unlisted') {
      var st = dbIndex('FilmState')[film.film_id];
      var next = { film_id: film.film_id, viewing_status: 'Watched', version: Number(st.version || 0) + 1, modified_at: now };
      if (opts.rating !== undefined && opts.rating !== null && opts.rating !== '') {
        next.rating_10 = validateRating_(opts.rating);
        next.raw_rating = String(next.rating_10);
      }
      dbUpdate('FilmState', [next]);
      dbClearMemo();
      out.state = stripRow_(dbIndex('FilmState')[film.film_id]);
      out.memory = setMemory_(film.film_id, { discovery_status: '👁️ Seen / unlisted' }, now);
      result = 'Seen, kept off the lists';
    } else if (decision === '🚫 Rejected') {
      out.memory = setMemory_(film.film_id, { discovery_status: '🚫 Rejected', exclusion_reason: reason }, now);
      result = 'Rejected';
    } else if (decision === '👀 Maybe') {
      out.memory = setMemory_(film.film_id, { discovery_status: '👀 Maybe', exclusion_reason: reason }, now);
      result = 'Maybe';
    } else if (decision === '📚 Already tracked') {
      var names = dbRead('CollectionEntries').filter(function (e) { return e.film_id === film.film_id; }).map(function (e) {
        var c = dbIndex('Collections')[e.collection_id];
        return c ? c.name : e.collection_id;
      });
      result = names.length ? 'Already on ' + names.join(', ') : 'Already known';
    } else {
      result = 'Reopened';
    }
    var maxD = dbRead('DiscoveryDecisions').reduce(function (m, d) { return Math.max(m, Number(String(d.decision_id).slice(2)) || 0); }, 0);
    var dec = { decision_id: 'DE' + pad_(maxD + 1, 5), candidate_id: candidateId, decision: decision, reason: reason, decision_date: today,
      destination_result: result, actor: 'Tommy', created_at: now };
    dbAppend('DiscoveryDecisions', [dec]);
    audit_('decide-candidate', 'ExcavationCandidates', candidateId, null, { decision: dec, entry: out.entry, state: out.state });
    out.decision = dec;
    return out;
  });
}

/** Marks a search as done so it leaves the inbox. Its candidates stay in the archive forever. */
function apiSetSearchState(searchId, state) {
  return withWriteLock_(function () {
    var cur = dbIndex('ExcavationSearches')[searchId];
    if (!cur) throw new Error('Unknown search ' + searchId);
    if (['Open', 'Archived'].indexOf(state) < 0) throw new Error('Unknown search state ' + state);
    dbUpdate('ExcavationSearches', [{ search_id: searchId, state: state }]);
    audit_('search-state', 'ExcavationSearches', searchId, { state: cur.state }, { state: state });
    return state;
  });
}
