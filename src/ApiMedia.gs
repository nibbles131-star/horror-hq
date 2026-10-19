/**
 * Books (comics and graphic novels too), TV and games: everything that isn't a film.
 * One MediaItems row per thing, with a kind (book | tv | game) whose statuses and formats live in
 * MEDIA_KINDS. Lists are per kind (MediaLists + MediaListEntries), separate from the film Collections.
 *
 * Covers and details come from free sources, no key needed except TV, which prefers the TMDB key
 * the posters already use and falls back to TVmaze without one:
 *   books  Open Library + Google Books      tv  TMDB or TVmaze      games  Wikipedia (video game infoboxes)
 */

var MEDIA_TEXT_MAX_ = 5000;

function mediaKind_(kind) {
  var k = MEDIA_KINDS[kind];
  if (!k) throw new Error('Unknown kind ' + kind);
  return k;
}

/** What apiBootstrap ships for the media sections. */
function mediaBootstrap_() {
  return {
    kinds: MEDIA_KINDS,
    items: dbRead('MediaItems').map(stripRow_),
    lists: dbRead('MediaLists').map(stripRow_),
    entries: dbRead('MediaListEntries').map(stripRow_)
  };
}

function mediaNextId_(table, key, prefix, width) {
  var max = dbRead(table).reduce(function (m, r) { return Math.max(m, Number(String(r[key]).slice(prefix.length)) || 0); }, 0);
  return prefix + pad_(max + 1, width);
}

function mediaToday_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function mediaMatchKey_(title, year) {
  return posterTitleKey_(title) + '|' + (year || '');
}

// ------------------------------------------------------------------ search

function mediaGetJson_(url, headers) {
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: headers || {} });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error(url.split('/')[2] + ' said ' + (code || 'nothing') + '.');
  return JSON.parse(res.getContentText());
}

function mediaYear_(s) {
  var m = String(s || '').match(/(1[89]\d\d|20\d\d)/);
  return m ? Number(m[1]) : null;
}

function httpsImage_(u) {
  return u ? String(u).replace(/^http:\/\//, 'https://') : '';
}

/** Graphic novels and comics get their own format so they shelve and count separately. */
function bookFormatGuess_(subjects, title) {
  var s = (subjects || []).join(' ').toLowerCase() + ' ' + String(title || '').toLowerCase();
  if (/manga/.test(s)) return 'Manga';
  // Searches find collected editions, so "comic" subjects shelve as graphic novels; Comic (single issues) is picked by hand.
  if (/graphic novel|comic/.test(s)) return 'Graphic novel';
  if (/short stor/.test(s)) return 'Short stories';
  if (/antholog/.test(s)) return 'Anthology';
  return 'Novel';
}

function searchOpenLibrary_(q) {
  var url = 'https://openlibrary.org/search.json?limit=12&fields=key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject&q=' +
    encodeURIComponent(q);
  return (mediaGetJson_(url).docs || []).map(function (d) {
    return { source: 'openlibrary', source_id: d.key, title: d.title, year: d.first_publish_year || null,
      creator: (d.author_name || []).slice(0, 2).join(', '), cover: d.cover_i ? 'https://covers.openlibrary.org/b/id/' + d.cover_i + '-L.jpg' : '',
      format: bookFormatGuess_((d.subject || []).slice(0, 30), d.title), total: d.number_of_pages_median || null };
  });
}

function searchGoogleBooks_(q) {
  var url = 'https://www.googleapis.com/books/v1/volumes?maxResults=12&printType=books&q=' + encodeURIComponent(q);
  return (mediaGetJson_(url).items || []).map(function (it) {
    var v = it.volumeInfo || {};
    var img = v.imageLinks || {};
    return { source: 'googlebooks', source_id: it.id, title: v.title + (v.subtitle && v.subtitle.length < 40 ? ': ' + v.subtitle : ''),
      year: mediaYear_(v.publishedDate), creator: (v.authors || []).slice(0, 2).join(', '),
      cover: httpsImage_(img.thumbnail || img.smallThumbnail).replace('&edge=curl', ''),
      format: bookFormatGuess_(v.categories, v.title), total: v.pageCount || null };
  });
}

function searchTv_(q) {
  var key = tmdbKey_();
  if (key) {
    var req = tmdbRequest_(key, '/search/tv?include_adult=false&query=' + encodeURIComponent(q));
    return (mediaGetJson_(req.url, req.headers).results || []).slice(0, 12).map(function (r) {
      return { source: 'tmdb', source_id: String(r.id), title: r.name, year: mediaYear_(r.first_air_date), creator: '',
        cover: r.poster_path ? POSTER_BASE_ + r.poster_path : '', format: (r.genre_ids || []).indexOf(16) >= 0 ? 'Animated' : 'Series',
        total: null };
    });
  }
  return mediaGetJson_('https://api.tvmaze.com/search/shows?q=' + encodeURIComponent(q)).slice(0, 12).map(function (h) {
    var s = h.show || {};
    return { source: 'tvmaze', source_id: String(s.id), title: s.name, year: mediaYear_(s.premiered),
      creator: (s.network || s.webChannel || {}).name || '', cover: httpsImage_((s.image || {}).original || (s.image || {}).medium),
      format: s.type === 'Animation' ? 'Animated' : s.type === 'Documentary' ? 'Docuseries' : 'Series', total: null,
      horror: (s.genres || []).indexOf('Horror') >= 0 };
  });
}

function searchGames_(q) {
  var url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=12' +
    '&prop=pageimages%7Cdescription&piprop=thumbnail&pithumbsize=480&pilicense=any&gsrsearch=' +
    encodeURIComponent(q + ' hastemplate:"Infobox video game"');
  var pages = ((mediaGetJson_(url).query || {}).pages) || {};
  return Object.keys(pages).map(function (k) { return pages[k]; }).sort(function (a, b) { return a.index - b.index; }).map(function (p) {
    return { source: 'wikipedia', source_id: String(p.pageid), title: String(p.title).replace(/\s*\((\d{4} )?video game\)$/i, ''),
      year: mediaYear_(p.description), creator: '', cover: (p.thumbnail || {}).source || '', format: '', total: null,
      note: p.description || '' };
  });
}

/**
 * Finds things to add. mode 'comic' (books only) puts comics and graphic novels first.
 * Returns [{source, source_id, title, year, creator, cover, format, total}], best first.
 */
function apiMediaSearch(kind, query, mode) {
  mediaKind_(kind);
  query = String(query || '').trim();
  if (!query) return [];
  if (kind === 'tv') return searchTv_(query);
  if (kind === 'game') return searchGames_(query);
  var lists = [], errors = [];
  [searchOpenLibrary_, searchGoogleBooks_].forEach(function (fn) {
    try { lists.push(fn(query)); } catch (e) { errors.push(e.message); lists.push([]); }
  });
  if (!lists[0].length && !lists[1].length && errors.length) throw new Error('Book search is not answering right now (' + errors.join(' ') + ')');
  var comic = function (r) { return /Comic|Graphic|Manga/.test(r.format); };
  // Google Books knows collected comics far better; Open Library knows older novels better.
  var order = mode === 'comic' ? [lists[1], lists[0]] : [lists[0], lists[1]];
  var out = [], seen = {};
  for (var i = 0; i < 12; i++) {
    order.forEach(function (l) {
      var r = l[i];
      if (!r || !r.title) return;
      var key = posterTitleKey_(r.title) + '|' + posterTitleKey_(String(r.creator).split(',')[0]);
      if (seen[key]) { if (!seen[key].cover && r.cover) seen[key].cover = r.cover; return; }
      seen[key] = r;
      out.push(r);
    });
  }
  if (mode === 'comic') out.sort(function (a, b) { return (comic(b) ? 1 : 0) - (comic(a) ? 1 : 0); });
  return out.slice(0, 18);
}

/** Extra details worth one more request when a show is added: episode count, network, creators. */
function tvDetails_(source, id) {
  try {
    if (source === 'tmdb' && tmdbKey_()) {
      var req = tmdbRequest_(tmdbKey_(), '/tv/' + encodeURIComponent(id));
      var d = mediaGetJson_(req.url, req.headers);
      return { total: d.number_of_episodes || null, creator: (d.networks || []).map(function (n) { return n.name; }).slice(0, 2).join(', '),
        format: d.type === 'Miniseries' ? 'Miniseries' : d.type === 'Documentary' ? 'Docuseries' : null,
        seasons: d.number_of_seasons || null };
    }
    if (source === 'tvmaze') {
      var eps = mediaGetJson_('https://api.tvmaze.com/shows/' + encodeURIComponent(id) + '/episodes');
      return { total: eps.length || null };
    }
  } catch (e) { /* details are a bonus; the show still gets added */ }
  return {};
}

// ------------------------------------------------------------------ items

function mediaClean_(kind, data, cur) {
  var k = mediaKind_(kind);
  var out = {};
  var str = function (f, max) { if (Object.prototype.hasOwnProperty.call(data, f)) out[f] = String(data[f] === null || data[f] === undefined ? '' : data[f]).trim().slice(0, max || 300); };
  var num = function (f, lo, hi) {
    if (!Object.prototype.hasOwnProperty.call(data, f)) return;
    var v = data[f];
    if (v === null || v === undefined || v === '') { out[f] = null; return; }
    v = Number(v);
    if (isNaN(v) || v < lo || v > hi) throw new Error(f.replace(/_/g, ' ') + ' must be a number from ' + lo + ' to ' + hi + '.');
    out[f] = Math.round(v * 10) / 10;
  };
  var date = function (f) {
    if (!Object.prototype.hasOwnProperty.call(data, f)) return;
    var v = String(data[f] || '');
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Dates look like 2026-10-31.');
    out[f] = v;
  };
  str('title'); str('creator'); str('format', 60); str('series'); str('series_no', 20); str('cover_url', 1000);
  str('reaction', MEDIA_TEXT_MAX_);
  if (Object.prototype.hasOwnProperty.call(out, 'title') && !out.title) throw new Error('Give it a title.');
  if (out.cover_url && !/^https:\/\//.test(out.cover_url)) throw new Error('Cover links start with https://');
  num('year', 1000, 2100);
  if (out.year !== undefined && out.year !== null) out.year = Math.round(out.year);
  num('progress', 0, 1000000); num('progress_total', 0, 1000000);
  date('started_on'); date('finished_on');
  if (Object.prototype.hasOwnProperty.call(data, 'status')) {
    if (k.statuses.indexOf(data.status) < 0) throw new Error('Unknown status ' + data.status);
    out.status = data.status;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'rating_10')) out.rating_10 = validateRating_(data.rating_10);
  if (Object.prototype.hasOwnProperty.call(data, 'favourite')) out.favourite = !!data.favourite;
  // Moving along the shelf stamps the day it happened, unless a date is already there.
  if (out.status && (!cur || cur.status !== out.status)) {
    var today = mediaToday_();
    var started = out.started_on !== undefined ? out.started_on : cur ? cur.started_on : '';
    var finished = out.finished_on !== undefined ? out.finished_on : cur ? cur.finished_on : '';
    if (k.active.indexOf(out.status) >= 0 && !started) out.started_on = today;
    if (k.done.indexOf(out.status) >= 0 && !finished) out.finished_on = today;
    var total = out.progress_total !== undefined ? out.progress_total : cur ? cur.progress_total : null;
    if (k.done.indexOf(out.status) >= 0 && total && out.progress === undefined && kind !== 'game') out.progress = total;
  }
  return out;
}

/**
 * Adds something to a shelf. data = {title, year, creator, format, cover, source, source_id, total, series, series_no}.
 * Returns {created, item}; created is false when it was already there (same source id, or same title and year).
 */
function apiMediaAdd(kind, data, status) {
  var k = mediaKind_(kind);
  data = data || {};
  var extra = kind === 'tv' && data.source_id ? tvDetails_(data.source, data.source_id) : {};
  return withWriteLock_(function () {
    var items = dbRead('MediaItems').filter(function (i) { return i.kind === kind; });
    var dup = items.filter(function (i) {
      return (data.source_id && i.source === data.source && i.source_id === String(data.source_id)) ||
        mediaMatchKey_(i.title, i.year) === mediaMatchKey_(data.title, data.year);
    })[0];
    if (dup) return { created: false, item: stripRow_(dup) };
    var now = nowIso_();
    // Games start without a platform rather than a wrong one; the add screen or the drawer sets it.
    var format = extra.format || data.format || (kind === 'game' ? '' : k.formats[0]);
    var fields = mediaClean_(kind, {
      title: data.title, year: data.year || null, creator: extra.creator || data.creator || '',
      format: format, series: data.series || '', series_no: data.series_no || '',
      cover_url: data.cover || '', progress_total: format === 'Comic' ? null : extra.total || data.total || null, status: status || k.statuses[0]
    }, null);
    var item = { item_id: mediaNextId_('MediaItems', 'item_id', 'M', 5), kind: kind, title: fields.title, year: fields.year,
      creator: fields.creator, format: fields.format, series: fields.series, series_no: fields.series_no, cover_url: fields.cover_url,
      source: String(data.source || 'manual'), source_id: String(data.source_id || ''), status: fields.status, rating_10: null,
      reaction: '', progress: fields.progress || null, progress_total: fields.progress_total, started_on: fields.started_on || '',
      finished_on: fields.finished_on || '', favourite: false, version: 1, created_at: now, modified_at: now };
    dbAppend('MediaItems', [item]);
    audit_('add-media', 'MediaItems', item.item_id, null, item);
    return { created: true, item: item };
  });
}

/** Saves any editable fields on one item; refused (with the current record) when the version is stale. */
function apiMediaSave(itemId, patch, expectedVersion) {
  return withWriteLock_(function () {
    var cur = dbIndex('MediaItems')[itemId];
    if (!cur) throw new Error('Unknown item ' + itemId);
    if (expectedVersion !== undefined && expectedVersion !== null && Number(cur.version) !== Number(expectedVersion)) {
      return { conflict: true, item: stripRow_(cur) };
    }
    var next = mediaClean_(cur.kind, patch || {}, cur);
    next.item_id = itemId;
    if (next.cover_url !== undefined && patch.source) { next.source = String(patch.source); next.source_id = String(patch.source_id || ''); }
    next.version = Number(cur.version || 0) + 1;
    next.modified_at = nowIso_();
    dbUpdate('MediaItems', [next]);
    audit_('save-media', 'MediaItems', itemId, stripRow_(cur), next);
    return { conflict: false, item: stripRow_(dbIndex('MediaItems')[itemId]) };
  });
}

/** Deletes an item and takes it off every list. */
function apiMediaDelete(itemId) {
  return withWriteLock_(function () {
    var cur = dbIndex('MediaItems')[itemId];
    if (!cur) throw new Error('Unknown item ' + itemId);
    var entries = dbRead('MediaListEntries').filter(function (e) { return e.item_id === itemId; });
    if (entries.length) dbDelete('MediaListEntries', entries.map(function (e) { return e.entry_id; }));
    dbDelete('MediaItems', [itemId]);
    audit_('delete-media', 'MediaItems', itemId, { item: stripRow_(cur), entries: entries.map(stripRow_) }, null);
    return { removed: itemId, entries: entries.map(function (e) { return e.entry_id; }) };
  });
}

// ------------------------------------------------------------------ lists

/** Creates a list (listId empty) or renames / re-icons one. */
function apiMediaListSave(listId, kind, name, icon, description) {
  return withWriteLock_(function () {
    name = String(name || '').trim().slice(0, 80);
    if (!name) throw new Error('Give the list a name.');
    var rec = { name: name, icon: String(icon || '').trim().slice(0, 8) || '🕯️', description: String(description || '').trim().slice(0, 300) };
    if (listId) {
      var cur = dbIndex('MediaLists')[listId];
      if (!cur) throw new Error('Unknown list ' + listId);
      rec.list_id = listId;
      dbUpdate('MediaLists', [rec]);
      audit_('save-media-list', 'MediaLists', listId, stripRow_(cur), rec);
      return stripRow_(dbIndex('MediaLists')[listId]);
    }
    mediaKind_(kind);
    var lists = dbRead('MediaLists').filter(function (l) { return l.kind === kind; });
    rec.list_id = mediaNextId_('MediaLists', 'list_id', 'ML', 4);
    rec.kind = kind;
    rec.sort_order = lists.reduce(function (m, l) { return Math.max(m, Number(l.sort_order) || 0); }, 0) + 1;
    rec.created_at = nowIso_();
    dbAppend('MediaLists', [rec]);
    audit_('add-media-list', 'MediaLists', rec.list_id, null, rec);
    return rec;
  });
}

/** Deletes a list; the things on it stay on their shelves. */
function apiMediaListDelete(listId) {
  return withWriteLock_(function () {
    var cur = dbIndex('MediaLists')[listId];
    if (!cur) throw new Error('Unknown list ' + listId);
    var entries = dbRead('MediaListEntries').filter(function (e) { return e.list_id === listId; });
    if (entries.length) dbDelete('MediaListEntries', entries.map(function (e) { return e.entry_id; }));
    dbDelete('MediaLists', [listId]);
    audit_('delete-media-list', 'MediaLists', listId, { list: stripRow_(cur), entries: entries.map(stripRow_) }, null);
    return { removed: listId };
  });
}

function apiMediaListAdd(listId, itemId, note) {
  return withWriteLock_(function () {
    var list = dbIndex('MediaLists')[listId];
    var item = dbIndex('MediaItems')[itemId];
    if (!list) throw new Error('Unknown list ' + listId);
    if (!item) throw new Error('Unknown item ' + itemId);
    if (list.kind !== item.kind) throw new Error('That list is for a different shelf.');
    var mine = dbRead('MediaListEntries').filter(function (e) { return e.list_id === listId; });
    if (mine.some(function (e) { return e.item_id === itemId; })) throw new Error(item.title + ' is already on ' + list.name + '.');
    var rec = { entry_id: mediaNextId_('MediaListEntries', 'entry_id', 'ME', 5), list_id: listId, item_id: itemId,
      sequence: mine.reduce(function (m, e) { return Math.max(m, Number(e.sequence) || 0); }, 0) + 1,
      note: String(note || '').slice(0, 300), created_at: nowIso_() };
    dbAppend('MediaListEntries', [rec]);
    audit_('add-media-entry', 'MediaListEntries', rec.entry_id, null, rec);
    return rec;
  });
}

function apiMediaListRemove(entryId) {
  return withWriteLock_(function () {
    var cur = dbIndex('MediaListEntries')[entryId];
    if (!cur) throw new Error('Unknown list entry ' + entryId);
    dbDelete('MediaListEntries', [entryId]);
    audit_('remove-media-entry', 'MediaListEntries', entryId, stripRow_(cur), null);
    return { removed: entryId };
  });
}

/** Moves an entry within its list and renumbers. Returns the entry ids in their new order. */
function apiMediaListMove(entryId, newIndex) {
  return withWriteLock_(function () {
    var cur = dbIndex('MediaListEntries')[entryId];
    if (!cur) throw new Error('Unknown list entry ' + entryId);
    var list = dbRead('MediaListEntries').filter(function (e) { return e.list_id === cur.list_id; })
      .sort(function (a, b) { return a.sequence - b.sequence; });
    var ids = list.map(function (e) { return e.entry_id; });
    ids.splice(ids.indexOf(entryId), 1);
    ids.splice(Math.max(0, Math.min(newIndex, ids.length)), 0, entryId);
    var changes = [];
    ids.forEach(function (id, i) {
      var e = list.filter(function (x) { return x.entry_id === id; })[0];
      if (Number(e.sequence) !== i + 1) changes.push({ entry_id: id, sequence: i + 1 });
    });
    dbUpdate('MediaListEntries', changes);
    return ids;
  });
}
