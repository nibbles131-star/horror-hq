/**
 * The Adaptation Web and The Oracle.
 *
 * Web: links between your own records, films and books/comics/TV/games alike, saved in WebLinks as
 * from -> to, where "from" is the source or earlier work (the novel, the first film) and "to" the
 * adaptation, sequel or remake. Universe, franchise and "related" links have no direction.
 * Node keys are 'film:F00012' or 'item:M00003'. Suggestions come from Wikidata (free, no key): each
 * record is matched to a Wikidata item once (WebNodes caches it, and you can fix a wrong match), then
 * its "based on", "derivative work", "follows", "inspired by", universe, franchise and series
 * neighbours are offered to add or reject. Covers for suggestions come from Wikipedia.
 *
 * Oracle: "if you liked this" from TMDB recommendations (films and TV, with the poster key), Open Library
 * subjects and authors (books) and Wikipedia's "more like this" (games). Things already in the app and
 * anything rejected (Dismissals) are left out.
 */

var WEB_RELATIONS = {
  // [seen from the "to" side, seen from the "from" side]
  adaptation: ['Adapted from', 'Adapted into'],
  sequel: ['Sequel to', 'Followed by'],
  remake: ['Remake of', 'Remade as'],
  spinoff: ['Spin-off of', 'Spun off into'],
  inspired: ['Inspired by', 'Inspired'],
  universe: ['Shares a universe with', 'Shares a universe with'],
  franchise: ['Same franchise as', 'Same franchise as'],
  related: ['Related to', 'Related to']
};
var WEB_SYMMETRIC_ = { universe: true, franchise: true, related: true };
var WIKIDATA_SPARQL_ = 'https://query.wikidata.org/sparql?format=json&query=';
var WIKIDATA_API_ = 'https://www.wikidata.org/w/api.php?format=json&origin=*&';
var WIKIPEDIA_API_ = 'https://en.wikipedia.org/w/api.php?format=json&origin=*&';
// Wikidata "instance of" classes we know how to shelve.
var WD_KIND_ = {
  Q11424: 'film', Q24869: 'film', Q202866: 'film', Q506240: 'film', Q24862: 'film', Q20650540: 'film', Q229390: 'film', Q17123180: 'film',
  Q5398426: 'tv', Q1259759: 'tv', Q15416: 'tv', Q63952888: 'tv', Q581714: 'tv', Q117467246: 'tv', Q1261214: 'tv',
  Q7889: 'game', Q64170203: 'game',
  Q7725634: 'book', Q8261: 'book', Q571: 'book', Q47461344: 'book', Q49084: 'book', Q149537: 'book', Q747381: 'book',
  Q1004: 'comic', Q725377: 'comic', Q14406742: 'comic', Q21198342: 'comic', Q8274: 'comic', Q1760610: 'comic', Q838795: 'comic'
};

function webBootstrap_() {
  return {
    relations: WEB_RELATIONS,
    links: dbRead('WebLinks').map(stripRow_),
    nodes: dbRead('WebNodes').map(stripRow_),
    dismissed: dbRead('Dismissals').map(function (d) { return d.key; })
  };
}

/** The record behind a node key, or null. */
function webNode_(key) {
  var m = String(key || '').match(/^(film|item):(\w+)$/);
  if (!m) return null;
  if (m[1] === 'film') {
    var f = dbIndex('Films')[m[2]];
    return f ? { key: key, kind: 'film', title: f.title, year: f.release_year, tmdb: /^\d+$/.test(String(f.tmdb_id)) ? String(f.tmdb_id) : '' } : null;
  }
  var i = dbIndex('MediaItems')[m[2]];
  return i ? { key: key, kind: i.kind, title: i.title, year: i.year, creator: i.creator, format: i.format, source: i.source,
    source_id: String(i.source_id || ''), tmdb: i.source === 'tmdb' ? String(i.source_id) : '' } : null;
}

// ------------------------------------------------------------------ links

function apiWebLink(fromKey, toKey, relation, note, source) {
  return withWriteLock_(function () {
    if (!WEB_RELATIONS[relation]) throw new Error('Unknown kind of link: ' + relation);
    if (fromKey === toKey) throw new Error('A record can\'t be linked to itself.');
    var a = webNode_(fromKey), b = webNode_(toKey);
    if (!a || !b) throw new Error('One of those records no longer exists.');
    var dup = dbRead('WebLinks').filter(function (l) {
      return (l.from_key === fromKey && l.to_key === toKey) || (l.from_key === toKey && l.to_key === fromKey);
    })[0];
    if (dup) throw new Error(a.title + ' and ' + b.title + ' are already linked.');
    var rec = { link_id: mediaNextId_('WebLinks', 'link_id', 'WL', 5), from_key: fromKey, to_key: toKey, relation: relation,
      note: String(note || '').slice(0, 300), source: source === 'wikidata' ? 'wikidata' : 'manual', created_at: nowIso_() };
    dbAppend('WebLinks', [rec]);
    audit_('web-link', 'WebLinks', rec.link_id, null, rec);
    return rec;
  });
}

/** Changes a link's kind, and with flip swaps which side is the source. */
function apiWebEditLink(linkId, relation, flip) {
  return withWriteLock_(function () {
    var cur = dbIndex('WebLinks')[linkId];
    if (!cur) throw new Error('That link is already gone.');
    if (!WEB_RELATIONS[relation]) throw new Error('Unknown kind of link: ' + relation);
    var next = { link_id: linkId, relation: relation };
    if (flip) { next.from_key = cur.to_key; next.to_key = cur.from_key; }
    dbUpdate('WebLinks', [next]);
    audit_('web-edit-link', 'WebLinks', linkId, stripRow_(cur), next);
    return stripRow_(dbIndex('WebLinks')[linkId]);
  });
}

function apiWebUnlink(linkId) {
  return withWriteLock_(function () {
    var cur = dbIndex('WebLinks')[linkId];
    if (!cur) throw new Error('That link is already gone.');
    dbDelete('WebLinks', [linkId]);
    audit_('web-unlink', 'WebLinks', linkId, stripRow_(cur), null);
    return { removed: linkId };
  });
}

function webSaveNode_(nodeKey, qid, label) {
  withWriteLock_(function () {
    var rec = { node_key: nodeKey, qid: qid, label: String(label || '').slice(0, 200), checked_at: nowIso_() };
    if (dbIndex('WebNodes')[nodeKey]) dbUpdate('WebNodes', [rec]); else dbAppend('WebNodes', [rec]);
  });
}

function apiDismiss(key, title, context) {
  return withWriteLock_(function () {
    key = String(key || '').slice(0, 200);
    if (!key) throw new Error('Nothing to dismiss.');
    if (!dbIndex('Dismissals')[key]) {
      dbAppend('Dismissals', [{ key: key, title: String(title || '').slice(0, 200), context: String(context || '').slice(0, 200), created_at: nowIso_() }]);
    }
    return { key: key };
  });
}

function apiUndismiss(key) {
  return withWriteLock_(function () {
    if (dbIndex('Dismissals')[key]) dbDelete('Dismissals', [key]);
    return { key: key };
  });
}

// ------------------------------------------------------------------ Wikidata

function wdSparql_(query) {
  return ((mediaGetJson_(WIKIDATA_SPARQL_ + encodeURIComponent(query)).results || {}).bindings) || [];
}
function wdVal_(b, k) { return b[k] ? String(b[k].value) : ''; }
function wdQid_(uri) { return String(uri || '').split('/').pop(); }
function wdSafe_(s) { return /^[\w.-]+$/.test(String(s || '')) ? String(s) : ''; }

/** What a Wikidata item is: film, tv, game, book or comic, or '' for anything else (characters, songs, places). */
function wdKindOf_(classes, ids) {
  for (var i = 0; i < classes.length; i++) if (WD_KIND_[classes[i]]) return WD_KIND_[classes[i]];
  if (ids.tmdb) return 'film';
  if (ids.tmdbtv) return 'tv';
  return '';
}

function wdSearch_(text) {
  var url = WIKIDATA_API_ + 'action=wbsearchentities&type=item&language=en&uselang=en&limit=12&search=' + encodeURIComponent(String(text).slice(0, 200));
  return (mediaGetJson_(url).search || []).map(function (h) { return { qid: h.id, label: h.label || h.id, description: h.description || '' }; });
}

/** Kind and year for a handful of items in one query. */
function wdInfo_(qids) {
  qids = qids.filter(function (q) { return /^Q\d+$/.test(q); });
  if (!qids.length) return {};
  var rows = wdSparql_('SELECT ?item (GROUP_CONCAT(DISTINCT STRAFTER(STR(?c), "entity/"); separator=",") AS ?classes) (MIN(YEAR(?d)) AS ?year) ' +
    '(SAMPLE(?tm) AS ?tmdb) (SAMPLE(?tt) AS ?tmdbtv) WHERE { VALUES ?item { ' + qids.map(function (q) { return 'wd:' + q; }).join(' ') + ' } ' +
    'OPTIONAL { ?item wdt:P31 ?c } OPTIONAL { ?item wdt:P577 ?d } OPTIONAL { ?item wdt:P4947 ?tm } OPTIONAL { ?item wdt:P4983 ?tt } } GROUP BY ?item');
  var out = {};
  rows.forEach(function (b) {
    var ids = { tmdb: wdVal_(b, 'tmdb'), tmdbtv: wdVal_(b, 'tmdbtv') };
    out[wdQid_(wdVal_(b, 'item'))] = { kind: wdKindOf_(wdVal_(b, 'classes').split(','), ids), year: Number(wdVal_(b, 'year')) || null };
  });
  return out;
}

/** Finds the Wikidata item for one of your records: by its TMDB / Open Library / TVmaze id first, then by title, kind and year. */
function wdResolve_(node) {
  var prop = '', id = '';
  if (node.kind === 'film' && node.tmdb) { prop = 'P4947'; id = node.tmdb; }
  else if (node.kind === 'tv' && node.source === 'tmdb') { prop = 'P4983'; id = node.source_id; }
  else if (node.kind === 'tv' && node.source === 'tvmaze') { prop = 'P8600'; id = node.source_id; }
  else if (node.kind === 'book' && node.source === 'openlibrary') { prop = 'P648'; id = String(node.source_id).replace(/^\/works\//, ''); }
  id = wdSafe_(id);
  if (prop && id) {
    var hit = wdSparql_('SELECT ?item ?label WHERE { ?item wdt:' + prop + ' "' + id + '" . OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label) = "en") } } LIMIT 1')[0];
    if (hit) return { qid: wdQid_(wdVal_(hit, 'item')), label: wdVal_(hit, 'label') || node.title };
  }
  var hits = wdSearch_(node.title);
  if (!hits.length) return null;
  var info = wdInfo_(hits.map(function (h) { return h.qid; }));
  var want = node.kind === 'book' ? { book: 1, comic: 1 } : (function () { var o = {}; o[node.kind] = 1; return o; })();
  var best = null, bestScore = -1;
  hits.forEach(function (h, i) {
    var inf = info[h.qid];
    if (!inf || !want[inf.kind]) return;
    var dy = node.year && inf.year ? Math.abs(node.year - inf.year) : null;
    if (dy !== null && dy > 1) return;
    var score = (dy === 0 ? 3 : dy === 1 ? 2 : 1) + (posterTitleKey_(h.label) === posterTitleKey_(node.title) ? 2 : 0) - i * 0.1;
    if (score > bestScore) { best = h; bestScore = score; }
  });
  return best ? { qid: best.qid, label: best.label + (info[best.qid].year ? ' (' + info[best.qid].year + ')' : '') } : null;
}

/** Everything Wikidata says is connected to one item, with the direction from its point of view. */
function webNeighbourQuery_(qid) {
  var q = 'wd:' + qid;
  var branch = function (pattern, rel, dir) { return '{ ' + pattern + ' BIND("' + rel + '" AS ?rel) BIND("' + dir + '" AS ?dir) }'; };
  return 'SELECT ?item ?rel ?dir (SAMPLE(?lab) AS ?label) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?c), "entity/"); separator=",") AS ?classes) ' +
    '(MIN(YEAR(?d)) AS ?year) (SAMPLE(?tm) AS ?tmdb) (SAMPLE(?tt) AS ?tmdbtv) (SAMPLE(?ol) AS ?ol) (SAMPLE(?wp) AS ?wiki) (SAMPLE(?crl) AS ?creator) WHERE { ' + [
      branch(q + ' wdt:P144 ?item .', 'adaptation', 'up'), branch('?item wdt:P144 ' + q + ' .', 'adaptation', 'down'),
      branch(q + ' wdt:P4969 ?item .', 'adaptation', 'down'), branch('?item wdt:P4969 ' + q + ' .', 'adaptation', 'up'),
      branch(q + ' wdt:P155 ?item .', 'sequel', 'up'), branch('?item wdt:P156 ' + q + ' .', 'sequel', 'up'),
      branch(q + ' wdt:P156 ?item .', 'sequel', 'down'), branch('?item wdt:P155 ' + q + ' .', 'sequel', 'down'),
      branch(q + ' wdt:P941 ?item .', 'inspired', 'up'), branch('?item wdt:P941 ' + q + ' .', 'inspired', 'down'),
      branch(q + ' wdt:P1434 ?u . ?item wdt:P1434 ?u .', 'universe', 'side'),
      branch(q + ' wdt:P8345 ?fr . ?item wdt:P8345 ?fr .', 'franchise', 'side'),
      branch(q + ' wdt:P179 ?se . ?item wdt:P179 ?se .', 'franchise', 'side')
    ].join(' UNION ') +
    ' FILTER(?item != ' + q + ') ?item wdt:P31 ?c . ?item rdfs:label ?lab FILTER(LANG(?lab) = "en") ' +
    'OPTIONAL { ?item wdt:P577 ?d } OPTIONAL { ?item wdt:P4947 ?tm } OPTIONAL { ?item wdt:P4983 ?tt } OPTIONAL { ?item wdt:P648 ?ol } ' +
    'OPTIONAL { ?art schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?wp } ' +
    'OPTIONAL { ?item wdt:P50|wdt:P57|wdt:P178 ?cr . ?cr rdfs:label ?crl FILTER(LANG(?crl) = "en") } ' +
    '} GROUP BY ?item ?rel ?dir LIMIT 300';
}

/** Wikipedia lead images for up to 50 article titles at a time: {title: url}. */
function wikiCovers_(titles) {
  var out = {};
  var uniq = titles.filter(function (t, i) { return t && titles.indexOf(t) === i; });
  for (var s = 0; s < uniq.length; s += 50) {
    var chunk = uniq.slice(s, s + 50);
    try {
      var q = mediaGetJson_(WIKIPEDIA_API_ + 'action=query&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=400&pilicense=any&titles=' +
        encodeURIComponent(chunk.join('|'))).query || {};
      var back = {};
      (q.normalized || []).concat(q.redirects || []).forEach(function (n) { back[n.to] = (back[n.from] || []).concat([n.from]); });
      var pages = q.pages || {};
      Object.keys(pages).forEach(function (k) {
        var p = pages[k];
        if (!p.thumbnail) return;
        [p.title].concat(back[p.title] || []).forEach(function (t) {
          out[t] = p.thumbnail.source;
          (back[t] || []).forEach(function (u) { out[u] = p.thumbnail.source; });
        });
      });
    } catch (e) { /* covers are a nicety */ }
  }
  return out;
}

/** Where each of your records sits, so suggestions you already have become "link" instead of "add". */
function webHaveIndex_() {
  var idx = { qid: {}, title: {}, tmdbFilm: {}, tmdbTv: {}, source: {} };
  // Release years differ by country, so a year either side counts too.
  var put = function (kind, title, year, key) {
    var set = function (y) { var k = kind + '|' + mediaMatchKey_(title, y); if (!idx.title[k]) idx.title[k] = key; };
    set(year || '');
    set('');
    if (year) { set(year - 1); set(year + 1); }
  };
  dbRead('Films').forEach(function (f) {
    var key = 'film:' + f.film_id;
    put('film', f.title, f.release_year, key);
    if (/^\d+$/.test(String(f.tmdb_id))) idx.tmdbFilm[String(f.tmdb_id)] = key;
  });
  dbRead('MediaItems').forEach(function (i) {
    var key = 'item:' + i.item_id;
    put(i.kind, i.title, i.year, key);
    if (i.source_id) idx.source[i.source + '|' + i.source_id] = key;
    if (i.source === 'tmdb') idx.tmdbTv[String(i.source_id)] = key;
  });
  dbRead('WebNodes').forEach(function (n) { if (/^Q\d+$/.test(n.qid)) idx.qid[n.qid] = n.node_key; });
  return idx;
}

function webFind_(idx, kind, title, year) {
  return idx.title[kind + '|' + mediaMatchKey_(title, year || '')] || '';
}

/**
 * Wikidata's connections for one of your records. Returns {qid, label, suggestions:[{key, qid, title, year, kind, comic,
 * relation, dir ('up' = it is the source, 'down' = it came from this, 'side'), creator, cover, tmdb, tmdbtv, ol, inApp}]}.
 */
function apiWebSuggest(nodeKey, refresh) {
  dbClearMemo();
  var node = webNode_(nodeKey);
  if (!node) throw new Error('That record no longer exists.');
  var cached = dbIndex('WebNodes')[nodeKey];
  var res = cached && !refresh ? { qid: cached.qid, label: cached.label } : null;
  if (!res) {
    res = wdResolve_(node) || { qid: 'none', label: '' };
    webSaveNode_(nodeKey, res.qid, res.label);
  }
  if (!/^Q\d+$/.test(res.qid)) return { qid: 'none', label: '', suggestions: [] };
  var rows = wdSparql_(webNeighbourQuery_(res.qid));
  var dismissed = dbIndex('Dismissals');
  var linked = {};
  dbRead('WebLinks').forEach(function (l) {
    if (l.from_key === nodeKey) linked[l.to_key] = 1;
    if (l.to_key === nodeKey) linked[l.from_key] = 1;
  });
  var idx = webHaveIndex_();
  var rank = { up: 0, down: 1, side: 2 };
  var byQid = {};
  rows.forEach(function (b) {
    var qid = wdQid_(wdVal_(b, 'item'));
    var ids = { tmdb: wdVal_(b, 'tmdb'), tmdbtv: wdVal_(b, 'tmdbtv') };
    var kind = wdKindOf_(wdVal_(b, 'classes').split(','), ids);
    if (!kind) return;
    var key = 'web:' + nodeKey + ':' + qid;
    if (dismissed[key]) return;
    var rel = wdVal_(b, 'rel'), dir = wdVal_(b, 'dir');
    if (byQid[qid] && rank[byQid[qid].dir] <= rank[dir]) return;
    var title = wdVal_(b, 'label'), year = Number(wdVal_(b, 'year')) || null;
    var shelf = kind === 'comic' ? 'book' : kind;
    var inApp = idx.qid[qid] || (ids.tmdb && idx.tmdbFilm[ids.tmdb]) || (ids.tmdbtv && idx.tmdbTv[ids.tmdbtv]) || webFind_(idx, shelf, title, year);
    if (inApp === nodeKey || linked[inApp]) return;
    byQid[qid] = { key: key, qid: qid, title: title, year: year, kind: shelf, comic: kind === 'comic', relation: rel, dir: dir,
      creator: wdVal_(b, 'creator'), wiki: wdVal_(b, 'wiki'), tmdb: ids.tmdb, tmdbtv: ids.tmdbtv, ol: wdVal_(b, 'ol'), inApp: inApp || '', cover: '' };
  });
  var out = Object.keys(byQid).map(function (q) { return byQid[q]; }).sort(function (a, b) {
    return rank[a.dir] - rank[b.dir] || (a.year || 9999) - (b.year || 9999) || a.title.localeCompare(b.title);
  }).slice(0, 60);
  var covers = wikiCovers_(out.map(function (s) { return s.wiki; }));
  out.forEach(function (s) { s.cover = covers[s.wiki] || ''; delete s.wiki; });
  return { qid: res.qid, label: res.label, suggestions: out };
}

/** "Wrong match?" search: Wikidata items for some text. */
function apiWebFindQid(query) {
  query = String(query || '').trim();
  if (!query) return [];
  var m = query.match(/^(Q\d+)$/i);
  if (m) query = m[1].toUpperCase();
  return wdSearch_(query);
}

/** Pins one of your records to a Wikidata item, or 'none' when it isn't on Wikidata. */
function apiWebSetQid(nodeKey, qid, label) {
  if (!webNode_(nodeKey)) throw new Error('That record no longer exists.');
  qid = String(qid || '').toUpperCase();
  if (qid !== 'NONE' && !/^Q\d+$/.test(qid)) throw new Error('A Wikidata id looks like Q12345.');
  webSaveNode_(nodeKey, qid === 'NONE' ? 'none' : qid, qid === 'NONE' ? '' : label);
  return { node_key: nodeKey, qid: qid === 'NONE' ? 'none' : qid };
}

// ------------------------------------------------------------------ adding a suggestion

/**
 * Adds a suggestion (from the Web or the Oracle) to the right part of the app.
 * sug: {kind, comic, title, year, creator, cover, tmdb, tmdbtv, ol, wp, qid}
 * opts: {status, dest (collection or media list id), link: {from: nodeKey, relation, dir}}
 * Returns {nodeKey, created, linked}.
 */
function apiAdopt(sug, opts) {
  sug = sug || {};
  opts = opts || {};
  var kind = sug.kind;
  if (kind !== 'film' && !MEDIA_KINDS[kind]) throw new Error('Don\'t know where to shelve that.');
  // Network first, outside the lock.
  var poster = null;
  var key = tmdbKey_();
  if (kind === 'film' && /^\d+$/.test(String(sug.tmdb || '')) && key) {
    try {
      var res = UrlFetchApp.fetchAll([tmdbRequest_(key, '/movie/' + sug.tmdb)])[0];
      if (res.getResponseCode() === 200) poster = posterFields_(JSON.parse(res.getContentText()));
    } catch (e) { poster = null; }
  }
  return withWriteLock_(function () {
    var nodeKey, created, note = opts.link ? 'Added from the Adaptation Web' : 'Added from the Oracle';
    if (kind === 'film') {
      var r = apiAddFilm(sug.title, sug.year, false);
      nodeKey = 'film:' + r.film.film_id;
      created = r.created;
      if (created && poster) { var upd = {}; upd[r.film.film_id] = poster; writeFilmPosters_(upd); }
      if (created && opts.status && opts.status !== 'Not watched') {
        if (['Watched', 'DNF', 'Unsure'].indexOf(opts.status) < 0) throw new Error('Unknown status ' + opts.status);
        var stNow = dbIndex('FilmState')[r.film.film_id];
        dbUpdate('FilmState', [{ film_id: r.film.film_id, viewing_status: opts.status, version: (Number(stNow.version) || 1) + 1, modified_at: nowIso_() }]);
      }
      if (opts.dest) {
        var dup = dbRead('CollectionEntries').some(function (e) { return e.collection_id === opts.dest && e.film_id === r.film.film_id; });
        if (!dup) apiAddEntry(opts.dest, r.film.film_id, '', note, false);
      }
    } else {
      var source = 'wikidata', sourceId = sug.qid || '';
      if (kind === 'tv' && sug.tmdbtv) { source = 'tmdb'; sourceId = sug.tmdbtv; }
      else if (kind === 'book' && sug.ol) { source = 'openlibrary'; sourceId = '/works/' + String(sug.ol).replace(/^\/works\//, ''); }
      else if (kind === 'game' && sug.wp) { source = 'wikipedia'; sourceId = sug.wp; }
      var data = { title: sug.title, year: sug.year || null, creator: sug.creator || '', cover: sug.cover || '', source: source, source_id: sourceId };
      if (kind === 'book' && sug.comic) data.format = 'Graphic novel';
      var m = apiMediaAdd(kind, data, opts.status || '');
      nodeKey = 'item:' + m.item.item_id;
      created = m.created;
      if (opts.dest) {
        var on = dbRead('MediaListEntries').some(function (e) { return e.list_id === opts.dest && e.item_id === m.item.item_id; });
        if (!on) apiMediaListAdd(opts.dest, m.item.item_id, note);
      }
    }
    if (sug.qid && /^Q\d+$/.test(sug.qid) && !dbIndex('WebNodes')[nodeKey]) webSaveNode_(nodeKey, sug.qid, sug.title);
    var linked = null;
    if (opts.link && opts.link.from) {
      var up = opts.link.dir === 'up';
      var from = up ? nodeKey : opts.link.from, to = up ? opts.link.from : nodeKey;
      var exists = dbRead('WebLinks').some(function (l) { return (l.from_key === from && l.to_key === to) || (l.from_key === to && l.to_key === from); });
      if (!exists && from !== to) linked = apiWebLink(from, to, WEB_RELATIONS[opts.link.relation] ? opts.link.relation : 'related', '', 'wikidata');
    }
    return { nodeKey: nodeKey, created: created, linked: linked };
  });
}

// ------------------------------------------------------------------ the Oracle

var ORACLE_SUBJECT_ = /horror|ghost|vampire|zombie|haunt|occult|supernatural|monster|demon|witch|werewolf|gothic|terror|serial murder|serial killer|possession|apocalyp|cthulhu|lovecraft/i;

function oracleTmdb_(key, seeds, kind) {
  var out = [];
  if (!key || !seeds.length) return out;
  // Seeds without a TMDB id get one by search first.
  var need = seeds.filter(function (s) { return !s.tmdb; });
  if (need.length) {
    var found = UrlFetchApp.fetchAll(need.map(function (s) {
      return tmdbRequest_(key, (kind === 'film' ? tmdbSearchPath_(s.title, s.year) : '/search/tv?query=' + encodeURIComponent(s.title)));
    }));
    found.forEach(function (res, i) {
      if (res.getResponseCode() !== 200) return;
      var results = JSON.parse(res.getContentText()).results || [];
      var hit = kind === 'film' ? pickTmdbMatch_({ title: need[i].title, release_year: need[i].year }, results, false) : results[0];
      if (hit) need[i].tmdb = String(hit.id);
    });
  }
  var ready = seeds.filter(function (s) { return s.tmdb; });
  var resps = UrlFetchApp.fetchAll(ready.map(function (s) { return tmdbRequest_(key, '/' + (kind === 'film' ? 'movie' : 'tv') + '/' + s.tmdb + '/recommendations'); }));
  resps.forEach(function (res, i) {
    if (res.getResponseCode() !== 200) return;
    (JSON.parse(res.getContentText()).results || []).forEach(function (r, rank) {
      var g = r.genre_ids || [];
      if (kind === 'film' && g.indexOf(27) < 0) return;
      if (kind === 'tv' && (g.indexOf(10762) >= 0 || g.indexOf(10764) >= 0 || g.indexOf(10767) >= 0)) return;
      out.push({ seed: ready[i], rank: rank, rec: { key: 'tmdb:' + (kind === 'film' ? 'movie' : 'tv') + ':' + r.id, kind: kind,
        title: kind === 'film' ? r.title : r.name, year: mediaYear_(kind === 'film' ? r.release_date : r.first_air_date),
        cover: r.poster_path ? POSTER_BASE_ + r.poster_path : '', blurb: String(r.overview || '').slice(0, 280),
        tmdb: kind === 'film' ? String(r.id) : '', tmdbtv: kind === 'tv' ? String(r.id) : '' } });
    });
  });
  return out;
}

function oracleBooks_(seeds) {
  var out = [];
  var fields = '&fields=key,title,author_name,first_publish_year,cover_i,subject&limit=';
  seeds.slice(0, 4).forEach(function (s) {
    try {
      var hit = (mediaGetJson_('https://openlibrary.org/search.json?q=' + encodeURIComponent(s.title + (s.creator ? ' ' + String(s.creator).split(',')[0] : '')) + fields + '1').docs || [])[0];
      if (!hit) return;
      var subjects = (hit.subject || []).filter(function (x) { return ORACLE_SUBJECT_.test(x); }).slice(0, 2);
      var urls = subjects.map(function (x) { return 'https://openlibrary.org/search.json?subject=' + encodeURIComponent(x) + fields + '12'; });
      if (hit.author_name && hit.author_name[0]) urls.push('https://openlibrary.org/search.json?author=' + encodeURIComponent(hit.author_name[0]) + fields + '8');
      urls.forEach(function (u, ui) {
        var docs = [];
        try { docs = mediaGetJson_(u).docs || []; } catch (e) { docs = []; }
        docs.forEach(function (d, rank) {
          if (d.key === hit.key) return;
          out.push({ seed: s, rank: rank + (ui === urls.length - 1 && hit.author_name ? 3 : 0), rec: { key: 'ol:' + String(d.key).replace('/works/', ''), kind: 'book',
            title: d.title, year: d.first_publish_year || null, creator: (d.author_name || []).slice(0, 2).join(', '),
            cover: d.cover_i ? 'https://covers.openlibrary.org/b/id/' + d.cover_i + '-L.jpg' : '', ol: String(d.key).replace('/works/', ''),
            comic: /Graphic|Comic|Manga/.test(bookFormatGuess_((d.subject || []).slice(0, 30), d.title)),
            blurb: d.author_name && d.author_name[0] === (hit.author_name || [])[0] ? 'Same author' : 'Shares: ' + subjects.join(', ') } });
        });
      });
    } catch (e) { /* one seed failing shouldn't sink the rest */ }
  });
  return out;
}

function oracleGames_(seeds) {
  var out = [];
  seeds.slice(0, 5).forEach(function (s) {
    try {
      var url = WIKIPEDIA_API_ + 'action=query&generator=search&gsrlimit=12&prop=pageimages%7Cdescription&piprop=thumbnail&pithumbsize=400&pilicense=any&gsrsearch=' +
        encodeURIComponent('morelike:' + s.title + ' hastemplate:"Infobox video game"');
      var pages = ((mediaGetJson_(url).query || {}).pages) || {};
      Object.keys(pages).map(function (k) { return pages[k]; }).sort(function (a, b) { return a.index - b.index; }).forEach(function (p, rank) {
        var title = String(p.title).replace(/\s*\((\d{4} )?video game\)$/i, '');
        if (posterTitleKey_(title) === posterTitleKey_(s.title)) return;
        out.push({ seed: s, rank: rank, rec: { key: 'wp:' + p.pageid, kind: 'game', title: title, year: mediaYear_(p.description),
          cover: (p.thumbnail || {}).source || '', wp: String(p.pageid), blurb: p.description || '' } });
      });
    } catch (e) { /* skip */ }
  });
  return out;
}

/**
 * "If you liked these, you may like…": seedKeys are node keys (your favourites, or one record).
 * Returns {items:[{key, kind, title, year, creator, cover, blurb, because:[titles], score, ...ids}], notes:[...]}.
 */
function apiOracle(seedKeys) {
  dbClearMemo();
  var seeds = (seedKeys || []).slice(0, 12).map(webNode_).filter(Boolean);
  var key = tmdbKey_();
  var notes = [];
  var by = function (k) { return seeds.filter(function (s) { return s.kind === k; }); };
  if (!key && (by('film').length || by('tv').length)) notes.push('Film and TV picks need the TMDB key from Admin › Posters.');
  var raw = [];
  [function () { return oracleTmdb_(key, by('film'), 'film'); }, function () { return oracleTmdb_(key, by('tv'), 'tv'); },
    function () { return oracleBooks_(by('book')); }, function () { return oracleGames_(by('game')); }].forEach(function (fn) {
    try { raw = raw.concat(fn()); } catch (e) { notes.push(e.message); }
  });
  var dismissed = dbIndex('Dismissals');
  var idx = webHaveIndex_();
  var pool = {};
  raw.forEach(function (x) {
    var r = x.rec;
    if (!r.title || dismissed[r.key]) return;
    var have = (r.tmdb && idx.tmdbFilm[r.tmdb]) || (r.tmdbtv && idx.tmdbTv[r.tmdbtv]) || (r.ol && idx.source['openlibrary|/works/' + r.ol]) ||
      (r.wp && idx.source['wikipedia|' + r.wp]) || webFind_(idx, r.kind, r.title, r.year);
    if (have) return;
    var p = pool[r.key] = pool[r.key] || Object.assign({ because: [], score: 0 }, r);
    if (p.because.indexOf(x.seed.title) < 0) p.because.push(x.seed.title);
    p.score += Math.max(1, 20 - x.rank);
  });
  var items = Object.keys(pool).map(function (k) { return pool[k]; }).sort(function (a, b) {
    return b.because.length - a.because.length || b.score - a.score;
  }).slice(0, 48);
  return { items: items, notes: notes };
}
