/** Server functions for the Watch Planner: schedule, event plans and the Challenge Builder. */

function nextId_(table, prefix, width) {
  var key = SCHEMA[table].key;
  var max = dbRead(table).reduce(function (m, r) {
    var n = Number(String(r[key]).slice(prefix.length));
    return String(r[key]).indexOf(prefix) === 0 && !isNaN(n) ? Math.max(m, n) : m;
  }, 0);
  return prefix + pad_(max + 1, width);
}

function requireDate_(v, label) {
  var d = parseDate_(v);
  if (!d) throw new Error((label || 'Date') + ' must be a real date.');
  return d;
}

/** Creates (no schedule_id) or updates a Watch Agenda row. */
function apiSaveAgenda(rec) {
  return withWriteLock_(function () {
    var film = dbIndex('Films')[rec.film_id];
    if (!film) throw new Error('Pick a film for the schedule.');
    var out = { planned_date: requireDate_(rec.planned_date), film_id: film.film_id, occasion: String(rec.occasion || '').trim(),
      context_note: String(rec.context_note || '').trim(), raw_film: film.display_key };
    if (rec.schedule_id) {
      var cur = dbIndex('WatchAgenda')[rec.schedule_id];
      if (!cur) throw new Error('Unknown schedule entry ' + rec.schedule_id);
      out.schedule_id = rec.schedule_id;
      dbUpdate('WatchAgenda', [out]);
      audit_('update-agenda', 'WatchAgenda', rec.schedule_id, stripRow_(cur), out);
    } else {
      out.schedule_id = nextId_('WatchAgenda', 'S', 5);
      out.sort_order = dbRead('WatchAgenda').reduce(function (m, a) { return Math.max(m, Number(a.sort_order) || 0); }, 0) + 1;
      out.raw_date = out.planned_date;
      out.source_row = null;
      out.created_at = nowIso_();
      dbAppend('WatchAgenda', [out]);
      audit_('add-agenda', 'WatchAgenda', out.schedule_id, null, out);
    }
    return stripRow_(dbIndex('WatchAgenda')[out.schedule_id]);
  });
}

function apiDeleteAgenda(scheduleId) {
  return withWriteLock_(function () {
    var cur = dbIndex('WatchAgenda')[scheduleId];
    if (!cur) throw new Error('Unknown schedule entry ' + scheduleId);
    dbDelete('WatchAgenda', [scheduleId]);
    audit_('delete-agenda', 'WatchAgenda', scheduleId, stripRow_(cur), null);
    return { removed: scheduleId };
  });
}

/** Creates or updates a season/event plan (the old List Index rows). */
function apiSaveEventPlan(rec) {
  return withWriteLock_(function () {
    var name = String(rec.name || '').trim();
    if (!name) throw new Error('Give the event a name.');
    var out = { name: name, start_date: requireDate_(rec.start_date, 'Start'), end_date: requireDate_(rec.end_date, 'End'),
      intended_films: String(rec.intended_films || ''), planning_note: String(rec.planning_note || ''), occasion_key: String(rec.occasion_key || '') };
    if (out.end_date < out.start_date) throw new Error('The event ends before it starts.');
    if (rec.event_plan_id) {
      var cur = dbIndex('EventPlans')[rec.event_plan_id];
      if (!cur) throw new Error('Unknown event ' + rec.event_plan_id);
      out.event_plan_id = rec.event_plan_id;
      dbUpdate('EventPlans', [out]);
      audit_('update-event', 'EventPlans', out.event_plan_id, stripRow_(cur), out);
    } else {
      out.event_plan_id = nextId_('EventPlans', 'EP', 3);
      out.sort_order = dbRead('EventPlans').reduce(function (m, a) { return Math.max(m, Number(a.sort_order) || 0); }, 0) + 1;
      out.raw_row = null;
      dbAppend('EventPlans', [out]);
      audit_('add-event', 'EventPlans', out.event_plan_id, null, out);
    }
    return stripRow_(dbIndex('EventPlans')[out.event_plan_id]);
  });
}

function apiDeleteEventPlan(id) {
  return withWriteLock_(function () {
    var cur = dbIndex('EventPlans')[id];
    if (!cur) throw new Error('Unknown event ' + id);
    dbDelete('EventPlans', [id]);
    audit_('delete-event', 'EventPlans', id, stripRow_(cur), null);
    return { removed: id };
  });
}

/** Creates or renames a challenge. */
function apiSaveChallenge(rec) {
  return withWriteLock_(function () {
    var title = String(rec.title || '').trim();
    if (!title) throw new Error('Give the challenge a name.');
    var out = { title: title, period: String(rec.period || '') };
    if (rec.challenge_id) {
      var cur = dbIndex('Challenges')[rec.challenge_id];
      if (!cur) throw new Error('Unknown challenge ' + rec.challenge_id);
      out.challenge_id = rec.challenge_id;
      if (Object.prototype.hasOwnProperty.call(rec, 'active')) out.active = !!rec.active;
      dbUpdate('Challenges', [out]);
      audit_('update-challenge', 'Challenges', out.challenge_id, stripRow_(cur), out);
    } else {
      out.challenge_id = nextId_('Challenges', 'CH', 3);
      out.active = true;
      out.created_at = nowIso_();
      dbAppend('Challenges', [out]);
      audit_('add-challenge', 'Challenges', out.challenge_id, null, out);
    }
    return stripRow_(dbIndex('Challenges')[out.challenge_id]);
  });
}

/** Creates or edits a criterion. required_count defaults to 1, like the old sheet. */
function apiSaveCriterion(rec) {
  return withWriteLock_(function () {
    if (!dbIndex('Challenges')[rec.challenge_id]) throw new Error('Unknown challenge ' + rec.challenge_id);
    var label = String(rec.label || '').trim();
    if (!label) throw new Error('A criterion needs a description.');
    var req = rec.required_count === undefined || rec.required_count === '' || rec.required_count === null ? 1 : Number(rec.required_count);
    if (isNaN(req) || req < 1 || req !== Math.round(req)) throw new Error('Required must be a whole number of at least 1.');
    var out = { challenge_id: rec.challenge_id, label: label, required_count: req, notes: String(rec.notes || '') };
    if (rec.criterion_id) {
      var cur = dbIndex('ChallengeCriteria')[rec.criterion_id];
      if (!cur) throw new Error('Unknown criterion ' + rec.criterion_id);
      out.criterion_id = rec.criterion_id;
      dbUpdate('ChallengeCriteria', [out]);
      audit_('update-criterion', 'ChallengeCriteria', out.criterion_id, stripRow_(cur), out);
    } else {
      out.criterion_id = nextId_('ChallengeCriteria', 'CR', 3);
      out.display_order = dbRead('ChallengeCriteria').filter(function (c) { return c.challenge_id === rec.challenge_id; })
        .reduce(function (m, c) { return Math.max(m, Number(c.display_order) || 0); }, 0) + 1;
      dbAppend('ChallengeCriteria', [out]);
      audit_('add-criterion', 'ChallengeCriteria', out.criterion_id, null, out);
    }
    return stripRow_(dbIndex('ChallengeCriteria')[out.criterion_id]);
  });
}

/** Deletes a criterion and its assignments (the films themselves are untouched). */
function apiDeleteCriterion(criterionId) {
  return withWriteLock_(function () {
    var cur = dbIndex('ChallengeCriteria')[criterionId];
    if (!cur) throw new Error('Unknown criterion ' + criterionId);
    var assigned = dbRead('ChallengeAssignments').filter(function (a) { return a.criterion_id === criterionId; });
    if (assigned.length) dbDelete('ChallengeAssignments', assigned.map(function (a) { return a.assignment_id; }));
    dbDelete('ChallengeCriteria', [criterionId]);
    audit_('delete-criterion', 'ChallengeCriteria', criterionId, { criterion: stripRow_(cur), assignments: assigned.map(stripRow_) }, null);
    return { removed: criterionId, assignments: assigned.length };
  });
}

/** Assigns a film to a criterion. The same film may cover other criteria; the same pair twice is refused. */
function apiAddAssignment(criterionId, filmId, fitNotes) {
  return withWriteLock_(function () {
    if (!dbIndex('ChallengeCriteria')[criterionId]) throw new Error('Unknown criterion ' + criterionId);
    var film = dbIndex('Films')[filmId];
    if (!film) throw new Error('Unknown film ' + filmId);
    var dup = dbRead('ChallengeAssignments').some(function (a) { return a.criterion_id === criterionId && a.film_id === filmId; });
    if (dup) throw new Error(film.display_key + ' already covers that criterion.');
    var rec = { assignment_id: nextId_('ChallengeAssignments', 'AS', 4), criterion_id: criterionId, film_id: filmId,
      fit_notes: String(fitNotes || ''), created_at: nowIso_() };
    dbAppend('ChallengeAssignments', [rec]);
    audit_('add-assignment', 'ChallengeAssignments', rec.assignment_id, null, rec);
    return rec;
  });
}

function apiRemoveAssignment(assignmentId) {
  return withWriteLock_(function () {
    var cur = dbIndex('ChallengeAssignments')[assignmentId];
    if (!cur) throw new Error('Unknown assignment ' + assignmentId);
    dbDelete('ChallengeAssignments', [assignmentId]);
    audit_('remove-assignment', 'ChallengeAssignments', assignmentId, stripRow_(cur), null);
    return { removed: assignmentId };
  });
}
