/**
 * Horror HQ database schema.
 *
 * Every table is one tab in the "Horror HQ Database" workbook. Row 1 holds the
 * column names below, data starts on row 2, and every cell is stored as plain
 * text so Sheets never "helpfully" turns "Oct 1" into a date. Types are applied
 * in code by Db.gs when rows are read.
 *
 * Relations always use immutable ids (film_id, collection_id, ...), never the
 * "Title (YYYY)" string or a row number.
 */

var VIEWING_STATUSES = ['Not watched', 'Watched', 'DNF', 'Unsure'];

// Watched > DNF > Unsure > Not watched (same precedence the old Ratings Log used).
var STATUS_PRECEDENCE = { 'Watched': 4, 'DNF': 3, 'Unsure': 2, 'Not watched': 1 };

var DISCOVERY_STATUSES = ['🔎 Candidate', '👀 Maybe', '🚫 Rejected', '👁️ Seen / unlisted', '✅ Approved'];

var EXCAVATOR_DECISIONS = ['⏳ Pending', '✅ Approved', '👁️ Seen / unlisted', '🚫 Rejected', '👀 Maybe', '📚 Already tracked'];

var COLLECTION_FAMILIES = ['Yearly', 'Seasonal', 'Curated', 'Classics', 'Bestiary', 'Alphabet', 'Franchise', 'Bubblegum'];

var BESTIARY_CATEGORIES = [
  { name: 'Aliens', icon: '👽' },
  { name: 'Aquatic / Sirens / Merfolk', icon: '🌊' },
  { name: 'Cryptids & Humanoid Monsters', icon: '👣' },
  { name: 'Cosmic & Eldritch Entities', icon: '🐙' },
  { name: 'Curses & Supernatural Entities', icon: '🧿' },
  { name: 'Demons & Devils', icon: '😈' },
  { name: 'Dolls, Puppets & Possessed Objects', icon: '🪆' },
  { name: 'Folkloric Entities', icon: '🪬' },
  { name: 'Ghosts & Hauntings', icon: '👻' },
  { name: 'Killer Animals & Nature Attacks', icon: '🐾' },
  { name: 'Mutants, Experiments & Monstrous Transformations', icon: '🧬' },
  { name: 'Vampires', icon: '🧛' },
  { name: 'Werewolves', icon: '🐺' },
  { name: 'Witches', icon: '🧙' },
  { name: 'Zombies & Infected', icon: '🧟' }
];

var CLASSIC_STUDIOS = ['Hammer', 'Universal', 'Paramount', 'RKO', 'MGM'];

/**
 * Books (comics and graphic novels included), TV and games. Each kind has its own statuses, in shelf order:
 * want, in progress, done (one or more), gave up. `unit` is what progress counts.
 */
var MEDIA_KINDS = {
  book: { statuses: ['Want to read', 'Reading', 'Read', 'DNF'], active: ['Reading'], done: ['Read'], dropped: ['DNF'],
          formats: ['Novel', 'Novella', 'Short stories', 'Anthology', 'Non-fiction', 'Graphic novel', 'Comic', 'Manga'], unit: 'pages' },
  tv:   { statuses: ['Want to watch', 'Watching', 'Caught up', 'Finished', 'DNF'], active: ['Watching', 'Caught up'], done: ['Finished'], dropped: ['DNF'],
          formats: ['Series', 'Miniseries', 'Anthology', 'Docuseries', 'Animated'], unit: 'episodes' },
  game: { statuses: ['Backlog', 'Playing', 'Beaten', '100%', 'Abandoned'], active: ['Playing'], done: ['Beaten', '100%'], dropped: ['Abandoned'],
          formats: ['PC', 'PlayStation', 'Xbox', 'Switch', 'Mobile', 'VR', 'Retro'], unit: 'hours' }
};

// Tables added after the first release: a workbook that predates them grows the tab on first use.
var LATE_TABLES_ = { MediaItems: true, MediaLists: true, MediaListEntries: true };

/**
 * Column types: s = string (default), n = number or blank, b = TRUE/FALSE,
 * d = ISO date yyyy-MM-dd, t = ISO timestamp, j = JSON.
 */
var SCHEMA = {
  Films: {
    key: 'film_id',
    cols: ['film_id', 'display_key', 'title', 'release_year:n', 'match_key', 'original_title',
           'tmdb_id', 'poster_url', 'import_source', 'created_at:t', 'updated_at:t']
  },
  FilmState: {
    key: 'film_id',
    cols: ['film_id', 'viewing_status', 'rating_10:n', 'reaction', 'raw_rating', 'version:n', 'modified_at:t']
  },
  FilmAliases: {
    key: 'alias_id',
    cols: ['alias_id', 'film_id', 'alias_display_key', 'alias_title', 'alias_year:n', 'match_key',
           'status', 'provenance', 'created_at:t']
  },
  Collections: {
    key: 'collection_id',
    cols: ['collection_id', 'family', 'name', 'icon', 'description', 'sort_order:n', 'active:b',
           'source_tab', 'created_at:t']
  },
  CollectionEntries: {
    key: 'entry_id',
    cols: ['entry_id', 'collection_id', 'film_id', 'slot_label', 'sequence:n', 'source_note',
           'context_note', 'raw_film', 'source_tab', 'source_row:n', 'created_at:t']
  },
  SpecialRatings: {
    key: 'film_id',
    cols: ['film_id', 'cuntometer_5:n', 'serve_note', 'raw_cuntometer', 'modified_at:t']
  },
  Countries: {
    key: 'country_id',
    cols: ['country_id', 'name']
  },
  FilmCountries: {
    key: 'film_country_id',
    cols: ['film_country_id', 'film_id', 'country_id', 'country_order:n', 'source', 'raw_value']
  },
  WatchAgenda: {
    key: 'schedule_id',
    cols: ['schedule_id', 'planned_date:d', 'film_id', 'occasion', 'context_note', 'sort_order:n',
           'raw_film', 'raw_date', 'source_row:n', 'created_at:t']
  },
  EventPlans: {
    key: 'event_plan_id',
    cols: ['event_plan_id', 'name', 'start_date:d', 'end_date:d', 'intended_films', 'planning_note',
           'occasion_key', 'sort_order:n', 'raw_row:j']
  },
  Challenges: {
    key: 'challenge_id',
    cols: ['challenge_id', 'title', 'period', 'active:b', 'created_at:t']
  },
  ChallengeCriteria: {
    key: 'criterion_id',
    cols: ['criterion_id', 'challenge_id', 'label', 'required_count:n', 'display_order:n', 'notes']
  },
  ChallengeAssignments: {
    key: 'assignment_id',
    cols: ['assignment_id', 'criterion_id', 'film_id', 'fit_notes', 'created_at:t']
  },
  ExcavationSearches: {
    key: 'search_id',
    cols: ['search_id', 'search_date:d', 'search_type', 'destination', 'target', 'wanted:n', 'style',
           'known_policy', 'must_include', 'avoid', 'brief', 'state', 'created_at:t']
  },
  ExcavationCandidates: {
    key: 'candidate_id',
    cols: ['candidate_id', 'search_id', 'film_id', 'surfaced_title', 'surfaced_year:n', 'why_it_fits',
           'sources', 'evidence_note', 'known_before', 'original_order:n', 'archive_notes',
           'source_row:n', 'created_at:t']
  },
  DiscoveryDecisions: {
    key: 'decision_id',
    cols: ['decision_id', 'candidate_id', 'decision', 'reason', 'decision_date:d', 'destination_result',
           'actor', 'created_at:t']
  },
  DiscoveryMemory: {
    key: 'film_id',
    cols: ['film_id', 'discovery_status', 'exclusion_reason', 'date_added:d', 'origin', 'memory_notes',
           'research_source', 'raw_viewing_status', 'raw_rating', 'raw_country', 'raw_date_added',
           'source_row:n', 'modified_at:t']
  },
  ManualBurials: {
    key: 'burial_id',
    cols: ['burial_id', 'film_id', 'raw_film', 'context', 'cause_of_death', 'interred_date:d', 'notes',
           'created_at:t']
  },
  Awards: {
    key: 'award_id',
    cols: ['award_id', 'label', 'sort_order:n', 'winner_film_id', 'raw_winner', 'award_rating', 'source_cell',
           'notes', 'modified_at:t']
  },
  TrophyDefinitions: {
    key: 'trophy_id',
    cols: ['trophy_id', 'family', 'metric', 'tier', 'name', 'threshold:n', 'rule_version', 'sort_order:n']
  },
  LegacyRecords: {
    key: 'legacy_id',
    cols: ['legacy_id', 'source_tab', 'source_row:n', 'film_id', 'raw:j', 'note']
  },
  Settings: {
    key: 'key',
    cols: ['key', 'value:j', 'modified_at:t']
  },
  Audit: {
    key: 'audit_id',
    cols: ['audit_id', 'at:t', 'action', 'entity', 'entity_id', 'before:j', 'after:j', 'source']
  },
  MediaItems: {
    key: 'item_id',
    cols: ['item_id', 'kind', 'title', 'year:n', 'creator', 'format', 'series', 'series_no', 'cover_url', 'source', 'source_id',
           'status', 'rating_10:n', 'reaction', 'progress:n', 'progress_total:n', 'started_on:d', 'finished_on:d', 'favourite:b',
           'version:n', 'created_at:t', 'modified_at:t']
  },
  MediaLists: {
    key: 'list_id',
    cols: ['list_id', 'kind', 'name', 'icon', 'description', 'sort_order:n', 'created_at:t']
  },
  MediaListEntries: {
    key: 'entry_id',
    cols: ['entry_id', 'list_id', 'item_id', 'sequence:n', 'note', 'created_at:t']
  },
  MigrationExceptions: {
    key: 'exception_id',
    cols: ['exception_id', 'severity', 'kind', 'source_tab', 'source_ref', 'raw_value', 'detail',
           'resolution', 'resolved:b']
  }
};

/** Column names without their ":type" suffix. */
function schemaColumns_(table) {
  return SCHEMA[table].cols.map(function (c) { return c.split(':')[0]; });
}

/** Map of column name -> type letter. */
function schemaTypes_(table) {
  var out = {};
  SCHEMA[table].cols.forEach(function (c) {
    var p = c.split(':');
    out[p[0]] = p[1] || 's';
  });
  return out;
}
