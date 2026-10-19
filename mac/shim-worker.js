/*
 * Horror HQ for Mac, worker side: runs the Apps Script server code (src/*.gs, wrapped by build_web.js
 * into makeServer_) off the window's thread. SpreadsheetApp and friends become in-memory tabs filled
 * from the data file; after every call that changes something, the whole database goes back to the
 * window to be saved, in the same format as Admin > Download JSON plus a "mac" block for script
 * properties (the TMDB key).
 *
 * Messages in:  {type:'open', text} | {type:'import', text} | {type:'call', id, name, args} | {type:'snapshot', id}
 * Messages out: {type:'opened', films} | {type:'failed', error} | {type:'result', id, ok, value|error} | {type:'save', json}
 *               | {type:'snapshot', id, json}
 */
var VERSION = '__VERSION__';
// Calls that only read; everything else is followed by a save.
var READS = ['apiBootstrap', 'apiExcavatorData', 'apiAdminData', 'apiMergePreview', 'apiPosterStatus', 'apiExportAll', 'apiPosterSearch', 'apiTestPosterKey', 'apiMediaSearch', 'apiWebFindQid', 'apiOracle'];
var server = null;
var dbBook = null;
var props = {};

// ------------------------------------------------------------------ in-memory spreadsheet
function Range(sheet, row, col, nr, nc) { this.sheet = sheet; this.row = row; this.col = col; this.nr = nr; this.nc = nc; }
Range.prototype._get = function (asText) {
  var out = [];
  for (var r = 0; r < this.nr; r++) {
    var line = [], src = this.sheet.cells[this.row - 1 + r] || [];
    for (var c = 0; c < this.nc; c++) {
      var v = src[this.col - 1 + c];
      line.push(v === undefined || v === null ? '' : asText ? String(v) : v);
    }
    out.push(line);
  }
  return out;
};
Range.prototype.getValues = function () { return this._get(false); };
Range.prototype.getDisplayValues = function () { return this._get(true); };
Range.prototype.getValue = function () { return this._get(false)[0][0]; };
Range.prototype.getDisplayValue = function () { return this._get(true)[0][0]; };
Range.prototype.setValues = function (vals) {
  var self = this;
  vals.forEach(function (line, r) {
    var rr = self.row - 1 + r;
    self.sheet.cells[rr] = self.sheet.cells[rr] || [];
    line.forEach(function (v, c) { self.sheet.cells[rr][self.col - 1 + c] = v; });
  });
  return this;
};
Range.prototype.setValue = function (v) { return this.setValues([[v]]); };
Range.prototype.clearContent = function () {
  var blank = [];
  for (var r = 0; r < this.nr; r++) { blank.push(new Array(this.nc).fill('')); }
  return this.setValues(blank);
};
['setNumberFormat', 'setFontWeight', 'setFontSize', 'setBackground', 'setWrap'].forEach(function (m) {
  Range.prototype[m] = function () { return this; };
});

function Sheet(name, cells) { this.name = name; this.cells = cells || []; this.maxRows = Math.max(1000, this.cells.length); }
Sheet.prototype.getName = function () { return this.name; };
Sheet.prototype.getRange = function (a, b, c, d) {
  if (typeof a === 'string') {
    var m = a.match(/^([A-Z]+)(\d+)$/), col = 0;
    for (var i = 0; i < m[1].length; i++) col = col * 26 + (m[1].charCodeAt(i) - 64);
    return new Range(this, Number(m[2]), col, 1, 1);
  }
  return new Range(this, a, b, c || 1, d || 1);
};
Sheet.prototype.getLastRow = function () {
  for (var i = this.cells.length - 1; i >= 0; i--) {
    if ((this.cells[i] || []).some(function (v) { return v !== '' && v !== undefined && v !== null; })) return i + 1;
  }
  return 0;
};
Sheet.prototype.getMaxRows = function () { return this.maxRows; };
Sheet.prototype.insertRowsAfter = function (_after, n) { this.maxRows += n; };
Sheet.prototype.deleteRow = function (r) { this.cells.splice(r - 1, 1); };
Sheet.prototype.clear = function () { this.cells = []; };
['setFrozenRows', 'setColumnWidth', 'autoResizeColumns', 'hideSheet'].forEach(function (m) { Sheet.prototype[m] = function () { return this; }; });

function Book(sheets) { this.sheets = sheets; }
Book.prototype.getSheetByName = function (n) { return this.sheets.filter(function (s) { return s.name === n; })[0] || null; };
Book.prototype.insertSheet = function (n) { var s = new Sheet(n, []); this.sheets.push(s); return s; };
Book.prototype.getSheets = function () { return this.sheets; };
Book.prototype.deleteSheet = function (s) { this.sheets = this.sheets.filter(function (x) { return x !== s; }); };

/** Turns an export file's tables of records back into tabs of text cells, exactly as the Sheet stores them. */
function bookFromTables(tables) {
  var db = server.__db;
  var sheets = Object.keys(db.SCHEMA).map(function (t) {
    var cols = db.schemaColumns_(t), types = db.schemaTypes_(t);
    var rows = (tables[t] || []).map(function (rec) {
      return cols.map(function (c) { return db.encodeCell_(rec[c], types[c]); });
    });
    return new Sheet(t, [cols].concat(rows));
  });
  return new Book(sheets);
}

function pad(n) { return (n < 10 ? '0' : '') + n; }
var globals = {
  SpreadsheetApp: {
    openById: function (id) {
      if (id === server.__db.CONFIG.DATABASE_SPREADSHEET_ID) return dbBook;
      throw new Error('The old Google sheet is not available in the Mac app.');
    }
  },
  PropertiesService: { getScriptProperties: function () {
    return {
      getProperty: function (k) { return props[k] === undefined ? null : props[k]; },
      setProperty: function (k, v) { props[k] = String(v); },
      deleteProperty: function (k) { delete props[k]; }
    };
  } },
  LockService: { getScriptLock: function () { return { tryLock: function () { return true; }, waitLock: function () {}, releaseLock: function () {} }; } },
  Session: { getScriptTimeZone: function () { return 'Europe/London'; } },
  Logger: { log: function (m) { console.log(m); } },
  Utilities: {
    // Only the patterns the server code uses; Mac local time stands in for Europe/London.
    formatDate: function (d, _tz, fmt) {
      return fmt.replace('yyyy', d.getFullYear()).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate()))
        .replace('HH', pad(d.getHours())).replace('mm', pad(d.getMinutes()));
    }
  },
  // Synchronous like the real thing: fine here because this runs in a worker, not the window.
  UrlFetchApp: {
    fetch: function (url, opts) { return fetchOne(Object.assign({ url: url }, opts || {})); },
    fetchAll: function (requests) { return requests.map(fetchOne); }
  },
  // The Mac app has no time-based triggers; posters for new films are looked up when their drawer opens.
  ScriptApp: {
    getProjectTriggers: function () { return []; },
    newTrigger: function () { var t = { timeBased: function () { return t; }, everyHours: function () { return t; }, create: function () { return t; } }; return t; }
  }
};

function fetchOne(req) {
  var xhr = new XMLHttpRequest();
  try {
    xhr.open(req.method ? String(req.method).toUpperCase() : 'GET', req.url, false);
    Object.keys(req.headers || {}).forEach(function (h) { xhr.setRequestHeader(h, req.headers[h]); });
    xhr.send(req.payload || null);
  } catch (e) {
    if (!req.muteHttpExceptions) throw new Error('No internet connection, or ' + req.url.split('/')[2] + ' is not answering.');
    return response(0, '');
  }
  if (xhr.status >= 400 && !req.muteHttpExceptions) throw new Error('Request failed with code ' + xhr.status);
  return response(xhr.status, xhr.responseText);
}

function response(code, text) {
  return { getResponseCode: function () { return code; }, getContentText: function () { return text; } };
}

function open(text, keepProps) {
  var data = JSON.parse(text);
  if (!data || data.app !== 'Horror HQ' || !data.tables || !data.tables.Films) throw new Error("That file isn't a Horror HQ export.");
  dbBook = bookFromTables(data.tables);
  if (!keepProps) props = Object.assign({}, data.mac && data.mac.props);
  props.INSTALLED_VERSION = VERSION;
  server.__db.dbClearMemo();
  return data.tables.Films.length;
}

function snapshot() {
  var data = server.apiExportAll();
  var keep = {};
  Object.keys(props).forEach(function (k) { if (k !== 'INSTALLED_VERSION') keep[k] = props[k]; });
  data.mac = { props: keep };
  return JSON.stringify(data);
}

function clone(v) { return v === undefined ? null : JSON.parse(JSON.stringify(v)); }

self.onmessage = function (ev) {
  var m = ev.data;
  if (!server) server = makeServer_(globals);
  if (m.type === 'open' || m.type === 'import') {
    try {
      var films = open(m.text, m.type === 'import' && dbBook !== null);
      if (m.type === 'import') self.postMessage({ type: 'save', json: snapshot() });
      self.postMessage({ type: 'opened', films: films });
    } catch (e) {
      self.postMessage({ type: 'failed', error: e.message || String(e) });
    }
    return;
  }
  if (m.type === 'snapshot') return self.postMessage({ type: 'snapshot', id: m.id, json: snapshot() });
  if (m.type === 'call') {
    var value;
    try {
      if (typeof server[m.name] !== 'function') throw new Error('Unknown server call ' + m.name);
      value = clone(server[m.name].apply(null, m.args));
    } catch (e) {
      return self.postMessage({ type: 'result', id: m.id, ok: false, error: e.message || String(e) });
    }
    // Save before answering, so the window never shows a change that isn't on its way to disk.
    if (READS.indexOf(m.name) < 0) self.postMessage({ type: 'save', json: snapshot() });
    self.postMessage({ type: 'result', id: m.id, ok: true, value: value });
  }
};
