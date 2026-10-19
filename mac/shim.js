/*
 * Horror HQ for Mac, window side. The Apps Script server code runs in a worker (shim-worker.js,
 * bundled by build_web.js into #hq-worker-src); google.script.run here just passes calls to it.
 * This side also owns the data file: it loads it at start, saves whatever the worker hands back
 * after a change, shows the import screen (first run, or Horror HQ > Import a Fresh Copy…) and
 * locks the sections that haven't moved in yet.
 */
var HQMac = (function () {
  var SECTIONS_OPEN = ['home', 'library', 'collections', 'codex', 'admin'];
  var LATER = { planner: 4, excavator: 4, wall: 3, funhouse: 3, shrine: 3, stats: 3 };
  // Admin tabs that wait for stage 4.
  var ADMIN_LATER = ['merge', 'backup'];

  var worker = null;
  var pending = {};
  var nextId = 1;
  var readyResolve;
  var ready = new Promise(function (r) { readyResolve = r; });
  var opened = false;
  var onOpened = null;
  var saving = Promise.resolve();
  var saveTrouble = false;

  function tauri() { return window.__TAURI__ && window.__TAURI__.core; }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ------------------------------------------------------------------ worker
  function startWorker() {
    var src = document.getElementById('hq-worker-src').textContent;
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = function (ev) {
      var m = ev.data;
      if (m.type === 'save') return save(m.json);
      if (m.type === 'opened') { var cb = onOpened; onOpened = null; if (cb) cb(null, m.films); return; }
      if (m.type === 'failed') { var fb = onOpened; onOpened = null; if (fb) fb(new Error(m.error)); return; }
      if (m.type === 'result') {
        var p = pending[m.id];
        delete pending[m.id];
        if (p) { if (m.ok) p.ok(m.value); else p.bad(new Error(m.error)); }
      }
    };
    worker.onerror = function (e) { console.error('worker', e.message); };
  }

  function openText(text, kind, done) {
    onOpened = done;
    worker.postMessage({ type: kind, text: text });
  }

  /** Saves are queued so two quick edits can't write out of order. */
  function save(json) {
    saving = saving.then(function () {
      return tauri().invoke('save_data', { json: json, day: today() }).then(function () {
        if (saveTrouble) { saveTrouble = false; toast('Saving works again. Everything is on disk. 💾', 'ok'); }
      });
    }).catch(function (e) {
      saveTrouble = true;
      toast("Couldn't save to Documents › Horror HQ: " + e + '. Your change is still on screen; keep the app open and try again.', 'bad', 12000);
    });
  }

  // ------------------------------------------------------------------ google.script.run
  var google = { script: { get run() {
    var ok = function () {}, bad = function (e) { console.error(e); };
    var p = new Proxy({}, { get: function (_, name) {
      if (name === 'withSuccessHandler') return function (f) { ok = f; return p; };
      if (name === 'withFailureHandler') return function (f) { bad = f; return p; };
      if (name === 'withUserObject') return function () { return p; };
      return function () {
        var args = JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments)));
        var handlers = { ok: ok, bad: bad };
        ready.then(function () {
          var id = nextId++;
          pending[id] = handlers;
          worker.postMessage({ type: 'call', id: id, name: name, args: args });
        });
      };
    } });
    return p;
  } } };

  // ------------------------------------------------------------------ start
  function boot() {
    startWorker();
    if (!tauri()) return showImport({ problem: 'Not running inside the Mac app, so there is no data file to open.' });
    tauri().invoke('load_data').then(function (text) {
      if (!text) return showImport({});
      openText(text, 'open', function (err) {
        if (err) return showImport({ problem: 'Your data file could not be opened: ' + err.message });
        opened = true;
        readyResolve();
      });
    }).catch(function (e) { showImport({ problem: 'Could not read your data file: ' + e }); });
    var ev = window.__TAURI__ && window.__TAURI__.event;
    if (ev) ev.listen('import-fresh', function () { if (opened && !document.querySelector('.mac-import')) showImport({ fresh: true }); });
  }

  // ------------------------------------------------------------------ import screen
  function showImport(o) {
    var el = document.createElement('div');
    el.className = 'mac-import';
    el.innerHTML =
      '<div class="mac-card">' +
      '<div class="mac-skull">💀</div>' +
      '<h1>' + (o.fresh ? 'Fresh copy' : 'The crypt is empty') + '</h1>' +
      (o.problem ? '<p class="mac-bad">' + esc(o.problem) + '</p>' : '') +
      (o.fresh
        ? '<p>This swaps everything in the Mac app for a new copy from the Google version. Changes you made only in the Mac app ' +
          'will be replaced. Today\'s copy is kept in Documents › Horror HQ › Backups first, and your TMDB key stays.</p>'
        : '<p>Let\'s bring your films over from the Google version. Nothing there changes, it just gets copied.</p>') +
      '<ol>' +
      '<li>Open Horror HQ in your browser the usual way.</li>' +
      '<li>Go to <b>🧰 Admin</b>, then <b>💾 Backup &amp; export</b>, and press <b>Download JSON</b>. A file called <code>horror-hq-export-…json</code> lands in Downloads.</li>' +
      '<li>Come back here and pick that file.</li>' +
      '</ol>' +
      '<label class="btn mac-pick">Choose the export file<input type="file" accept=".json,application/json" hidden></label>' +
      (o.fresh ? '<button class="btn ghost mac-cancel">Cancel, keep what I have</button>' :
        '<p class="mac-small">Your copy lives in Documents › Horror HQ. Your Mac may ask to let Horror HQ use Documents: say OK.</p>') +
      '</div>';
    document.body.appendChild(el);
    var cancel = el.querySelector('.mac-cancel');
    if (cancel) cancel.onclick = function () { el.remove(); };
    el.querySelector('input').addEventListener('change', function (ev) {
      var file = ev.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        openText(String(reader.result), 'import', function (err, films) {
          if (err) return alarm(el, err.message);
          saving.then(function () {
            if (saveTrouble) return alarm(el, 'The copy was read but could not be saved to Documents › Horror HQ. Check the Mac allowed access, then try again.');
            if (opened) return location.reload();
            el.remove();
            opened = true;
            readyResolve();
            toast('Imported ' + films + ' films. Welcome home. 💀', 'ok');
          });
        });
      };
      reader.readAsText(file);
    });
  }

  function esc(s) { return String(s).replace(/[<&>]/g, function (c) { return { '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c]; }); }

  function alarm(el, msg) {
    var p = el.querySelector('.mac-bad');
    if (!p) { p = document.createElement('p'); p.className = 'mac-bad'; el.querySelector('h1').after(p); }
    p.textContent = msg;
  }

  function toast(msg, kind, ms) {
    var box = document.getElementById('toasts');
    if (!box) return;
    var t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 4000);
  }

  // ------------------------------------------------------------------ posters from the disk cache
  var TMDB = 'https://image.tmdb.org/t/p/';
  /** https://image.tmdb.org/t/p/w342/abc.jpg -> poster://localhost/w342/abc.jpg (served by the app, cached on disk). */
  function poster(url) {
    return url && url.indexOf(TMDB) === 0 ? 'poster://localhost/' + url.slice(TMDB.length) : url;
  }
  // Catches poster URLs that skip HQ.posterUrl (a freshly fetched or swapped poster).
  function watchPosters() {
    new MutationObserver(function (list) {
      list.forEach(function (m) {
        (m.type === 'attributes' ? [m.target] : Array.prototype.slice.call(m.addedNodes)).forEach(function (n) {
          if (n.nodeType !== 1) return;
          (n.tagName === 'IMG' ? [n] : Array.prototype.slice.call(n.querySelectorAll('img'))).forEach(function (img) {
            var src = img.getAttribute('src');
            if (src && src.indexOf(TMDB) === 0) img.setAttribute('src', poster(src));
          });
        });
      });
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  }

  // A poster that can't load (offline and never cached) becomes the usual coffin instead of a broken image.
  function coffinOnError() {
    document.addEventListener('error', function (ev) {
      var img = ev.target;
      if (!img || img.tagName !== 'IMG' || String(img.getAttribute('src')).indexOf('poster://') !== 0) return;
      var span = document.createElement('span');
      span.className = img.className;
      span.textContent = '⚰️';
      img.replaceWith(span);
    }, true);
  }

  // ------------------------------------------------------------------ sections not here yet
  function guardNav() {
    var css = Object.keys(LATER).map(function (k) {
      return '#nav [data-nav="' + k + '"]{opacity:.35}#nav [data-nav="' + k + '"]::after{content:" 🔒";font-size:11px}';
    }).join('') + ADMIN_LATER.map(function (k) { return '[data-adtab="' + k + '"]{display:none!important}'; }).join('');
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

  document.addEventListener('DOMContentLoaded', function () { guardNav(); watchPosters(); coffinOnError(); boot(); });

  return { google: google, poster: poster };
})();
var google = HQMac.google;
