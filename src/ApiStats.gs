/** Server functions for Stats + Trophies: manual burials and the Horror Awards. Trophies and stats are derived, never stored. */

/**
 * Creates (no burial_id) or updates a manual burial. Burials are a separate record:
 * burying a film never changes its viewing status, rating or discovery memory.
 */
function apiSaveBurial(rec) {
  return withWriteLock_(function () {
    var film = rec.film_id ? dbIndex('Films')[rec.film_id] : null;
    if (rec.film_id && !film) throw new Error('Unknown film ' + rec.film_id);
    var rawFilm = film ? film.display_key : String(rec.raw_film || '').trim();
    if (!rawFilm) throw new Error('Pick the film you are burying.');
    var out = { film_id: film ? film.film_id : '', raw_film: rawFilm, context: String(rec.context || '').trim(),
      cause_of_death: String(rec.cause_of_death || '').trim(), notes: String(rec.notes || '').trim(),
      interred_date: rec.interred_date ? requireDate_(rec.interred_date, 'Date interred') : null };
    if (rec.burial_id) {
      var cur = dbIndex('ManualBurials')[rec.burial_id];
      if (!cur) throw new Error('Unknown burial ' + rec.burial_id);
      out.burial_id = rec.burial_id;
      dbUpdate('ManualBurials', [out]);
      audit_('update-burial', 'ManualBurials', rec.burial_id, stripRow_(cur), out);
    } else {
      out.burial_id = nextId_('ManualBurials', 'B', 4);
      out.created_at = nowIso_();
      dbAppend('ManualBurials', [out]);
      audit_('add-burial', 'ManualBurials', out.burial_id, null, out);
    }
    return stripRow_(dbIndex('ManualBurials')[out.burial_id]);
  });
}

/** Digs a manual burial back up. The film itself is untouched. */
function apiDeleteBurial(burialId) {
  return withWriteLock_(function () {
    var cur = dbIndex('ManualBurials')[burialId];
    if (!cur) throw new Error('Unknown burial ' + burialId);
    dbDelete('ManualBurials', [burialId]);
    audit_('delete-burial', 'ManualBurials', burialId, stripRow_(cur), null);
    return { removed: burialId };
  });
}

/**
 * Creates (no award_id) or updates a Horror Award: its label, winner and notes.
 * award_rating records the winner's rating at the moment it won; an empty winner clears the award.
 */
function apiSaveAward(rec) {
  return withWriteLock_(function () {
    var label = String(rec.label || '').trim();
    if (!label) throw new Error('An award needs a name.');
    var film = rec.winner_film_id ? dbIndex('Films')[rec.winner_film_id] : null;
    if (rec.winner_film_id && !film) throw new Error('Unknown film ' + rec.winner_film_id);
    var state = film ? dbIndex('FilmState')[film.film_id] : null;
    var rating = state && state.rating_10 !== null && state.rating_10 !== '' ? String(state.rating_10) : '';
    var out = { label: label, winner_film_id: film ? film.film_id : '', raw_winner: film ? film.display_key : '',
      award_rating: rating, notes: String(rec.notes || '').trim(), modified_at: nowIso_() };
    var all = dbRead('Awards');
    var clash = all.filter(function (x) { return x.award_id !== rec.award_id && matchKey_(x.label) === matchKey_(label); })[0];
    if (clash) throw new Error('There is already an award called ' + clash.label + '.');
    if (rec.award_id) {
      var cur = dbIndex('Awards')[rec.award_id];
      if (!cur) throw new Error('Unknown award ' + rec.award_id);
      out.award_id = rec.award_id;
      dbUpdate('Awards', [out]);
      audit_('update-award', 'Awards', rec.award_id, stripRow_(cur), out);
    } else {
      out.award_id = nextId_('Awards', 'AW', 2);
      out.sort_order = all.reduce(function (m, x) { return Math.max(m, Number(x.sort_order) || 0); }, 0) + 1;
      out.source_cell = 'app';
      dbAppend('Awards', [out]);
      audit_('add-award', 'Awards', out.award_id, null, out);
    }
    return stripRow_(dbIndex('Awards')[out.award_id]);
  });
}

function apiDeleteAward(awardId) {
  return withWriteLock_(function () {
    var cur = dbIndex('Awards')[awardId];
    if (!cur) throw new Error('Unknown award ' + awardId);
    dbDelete('Awards', [awardId]);
    audit_('delete-award', 'Awards', awardId, stripRow_(cur), null);
    return { removed: awardId };
  });
}
