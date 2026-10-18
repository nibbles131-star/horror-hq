/*
 * Horror HQ for Mac: runs the Apps Script server code (src/*.gs, wrapped by build_web.js into
 * makeServer_) right inside the app window. SpreadsheetApp and friends become in-memory tabs
 * filled from the data file in Documents/Horror HQ, and google.script.run calls those
 * functions directly instead of going to Google.
 *
 * Stage 1 is a read-only copy: the Google version stays the one you edit until moving day,
 * so any call that would change data is refused with a friendly message.
 */
var HQMac = (function () {
  var VERSION = 'mac-0.1.0';
  var READS = ['apiBootstrap', 'apiExcavatorData', 'apiAdminData', 'apiMergePreview', 'apiPosterStatus', 'apiExportAll'];
  // UI bookkeeping (trophies seen, bingo card...) is kept for this session only, never saved.
  var SESSION_ONLY = ['apiSaveUiSetting'];
  var SECTIONS_OPEN = ['home', 'library', 'collections', 'codex'];
  var READ_ONLY_MSG = 'This copy is read-only for now. Make changes in the Google version until moving day.';

  var server = null;
  var dbBook = null;
  var props = { INSTALLED_VERSION: VERSION };
  var readyResolve;
  var ready = new Promise(function (r) { readyResolve = r; });

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
      return { getProperty: function (k) { return props[k] === undefined ? null : props[k]; }, setProperty: function (k, v) { props[k] = String(v); } };
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
    UrlFetchApp: { fetchAll: function () { throw new Error('Fetching posters arrives in stage 2.'); } },
    ScriptApp: { getProjectTriggers: function () { return []; } }
  };

  // ------------------------------------------------------------------ google.script.run
  function clone(v) { return v === undefined ? null : JSON.parse(JSON.stringify(v)); }

  function runServer(name, args) {
    if (READS.indexOf(name) < 0 && SESSION_ONLY.indexOf(name) < 0) throw new Error(READ_ONLY_MSG);
    if (typeof server[name] !== 'function') throw new Error('Unknown server call ' + name);
    return clone(server[name].apply(null, clone(Array.prototype.slice.call(args))));
  }

  var google = { script: { get run() {
    var ok = function () {}, bad = function (e) { console.error(e); };
    var p = new Proxy({}, { get: function (_, name) {
      if (name === 'withSuccessHandler') return function (f) { ok = f; return p; };
      if (name === 'withFailureHandler') return function (f) { bad = f; return p; };
      if (name === 'withUserObject') return function () { return p; };
      return function () {
        var args = arguments;
        ready.then(function () {
          var res;
          try { res = runServer(name, args); } catch (e) { return bad(e instanceof Error ? e : new Error(String(e))); }
          ok(res);
        });
      };
    } });
    return p;
  } } };

  // ------------------------------------------------------------------ data file
  function tauri() { return window.__TAURI__ && window.__TAURI__.core; }

  function open(text) {
    var data = JSON.parse(text);
    if (!data || data.app !== 'Horror HQ' || !data.tables || !data.tables.Films) {
      throw new Error("That file isn't a Horror HQ export.");
    }
    dbBook = bookFromTables(data.tables);
    props.INSTALLED_VERSION = VERSION;
    return data;
  }

  function boot() {
    server = makeServer_(globals);
    if (!tauri()) return showImport('Not running inside the Mac app, so there is no data file to open.');
    tauri().invoke('load_data').then(function (text) {
      if (!text) return showImport();
      try { open(text); } catch (e) { return showImport('Your data file could not be opened: ' + e.message); }
      readyResolve();
    }).catch(function (e) { showImport('Could not read your data file: ' + e); });
  }

  // ------------------------------------------------------------------ first-run import screen
  function showImport(problem) {
    var el = document.createElement('div');
    el.className = 'mac-import';
    el.innerHTML =
      '<div class="mac-card">' +
      '<div class="mac-skull">💀</div>' +
      '<h1>The crypt is empty</h1>' +
      (problem ? '<p class="mac-bad">' + problem.replace(/[<&>]/g, '') + '</p>' : '') +
      '<p>Let\'s bring your films over from the Google version. Nothing there changes, it just gets copied.</p>' +
      '<ol>' +
      '<li>Open Horror HQ in your browser the usual way.</li>' +
      '<li>Go to <b>🧰 Admin</b>, then <b>💾 Backup &amp; export</b>, and press <b>Download JSON</b>. A file called <code>horror-hq-export-…json</code> lands in Downloads.</li>' +
      '<li>Come back here and pick that file.</li>' +
      '</ol>' +
      '<label class="btn mac-pick">Choose the export file<input type="file" accept=".json,application/json" hidden></label>' +
      '<p class="mac-small">Your copy lives in Documents › Horror HQ. Your Mac may ask to let Horror HQ use Documents: say OK.</p>' +
      '</div>';
    document.body.appendChild(el);
    el.querySelector('input').addEventListener('change', function (ev) {
      var file = ev.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var data;
        try { data = open(String(reader.result)); } catch (e) { return alarm(el, e.message); }
        tauri().invoke('save_data', { json: JSON.stringify(data) }).then(function () {
          el.remove();
          readyResolve();
          toast('Imported ' + data.tables.Films.length + ' films. Welcome home. 💀', 'ok');
        }).catch(function (e) { alarm(el, 'Could not save your copy: ' + e); });
      };
      reader.readAsText(file);
    });
  }

  function alarm(el, msg) {
    var p = el.querySelector('.mac-bad');
    if (!p) { p = document.createElement('p'); p.className = 'mac-bad'; el.querySelector('h1').after(p); }
    p.textContent = msg;
  }

  function toast(msg, kind) {
    var box = document.getElementById('toasts');
    if (!box) return;
    var t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, 4000);
  }

  // ------------------------------------------------------------------ sections not here yet
  var LATER = { planner: 4, excavator: 4, admin: 4, wall: 3, funhouse: 3, shrine: 3, stats: 3 };
  function guardNav() {
    var css = Object.keys(LATER).filter(function (k) { return SECTIONS_OPEN.indexOf(k) < 0; }).map(function (k) {
      return '#nav [data-nav="' + k + '"]{opacity:.35}#nav [data-nav="' + k + '"]::after{content:" 🔒";font-size:11px}';
    }).join('');
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest && ev.target.closest('[data-nav]');
      if (!t || SECTIONS_OPEN.indexOf(t.dataset.nav) >= 0) return;
      ev.stopPropagation();
      ev.preventDefault();
      toast('That section moves in at stage ' + (LATER[t.dataset.nav] || 'later') + '. Use the Google version for now.', 'bad');
    }, true);
  }

  document.addEventListener('DOMContentLoaded', function () { guardNav(); boot(); });

  return { google: google, version: VERSION };
})();
var google = HQMac.google;
