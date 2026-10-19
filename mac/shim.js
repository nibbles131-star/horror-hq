/*
 * Horror HQ for Mac, window side. The Apps Script server code runs in a worker (shim-worker.js,
 * bundled by build_web.js into #hq-worker-src); google.script.run here just passes calls to it.
 * This side also owns the data file: it loads it at start, saves whatever the worker hands back
 * after a change, shows the import screen (first run, or Horror HQ > Import a Fresh Copy…), and
 * stands in for the browser where a Mac app differs: downloads go to Downloads, web links open in
 * the default browser, and Admin's Backup tab offers Mac backups and a spreadsheet export.
 */
var HQMac = (function () {
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
      if (m.type === 'snapshot') { var sp = pending[m.id]; delete pending[m.id]; if (sp) sp.ok(m.json); return; }
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
        setTimeout(function () { checkForUpdate(false); }, 4000);
      });
    }).catch(function (e) { showImport({ problem: 'Could not read your data file: ' + e }); });
    var ev = window.__TAURI__ && window.__TAURI__.event;
    if (ev) {
      ev.listen('import-fresh', function () { if (opened && !document.querySelector('.mac-import')) showImport({ fresh: true }); });
      ev.listen('check-updates', function () { checkForUpdate(true); });
    }
  }

  // ------------------------------------------------------------------ updates
  /** Looks for a newer build on GitHub. Quiet at startup; says what it found when asked from the menu. */
  function checkForUpdate(asked) {
    if (!tauri()) return;
    tauri().invoke('check_update').then(function (u) {
      if (u) return offerUpdate(u);
      if (asked) tauri().invoke('app_build').then(function (b) { toast("You're on the newest Horror HQ" + (b ? ' (build ' + b + ')' : '') + '. 💀', 'ok'); });
    }).catch(function (e) { if (asked) toast(String(e), 'bad', 8000); });
  }

  function offerUpdate(u) {
    if (document.querySelector('.mac-update')) return;
    var el = document.createElement('div');
    el.className = 'mac-update';
    el.innerHTML = '<b>A new Horror HQ has risen</b><span>Build ' + Number(u.build) + ' is ready. It takes a few seconds and the app reopens by itself.</span>' +
      '<div><button class="btn primary" data-go>Install &amp; restart</button><button class="btn ghost" data-later>Later</button></div>';
    document.body.appendChild(el);
    el.querySelector('[data-later]').onclick = function () { el.remove(); };
    el.querySelector('[data-go]').onclick = function () {
      el.innerHTML = '<b>Installing…</b><span>Downloading build ' + Number(u.build) + '. Horror HQ will close and reopen by itself.</span>';
      // Let any save in flight finish before the app closes.
      saving.then(function () {
        return tauri().invoke('install_update', { url: u.url, digest: u.digest || null });
      }).catch(function (e) {
        el.remove();
        toast("The update didn't install: " + e, 'bad', 12000);
      });
    };
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

  // ------------------------------------------------------------------ downloads, links, backups
  function snapshot() {
    return ready.then(function () {
      return new Promise(function (ok, bad) {
        var id = nextId++;
        pending[id] = { ok: ok, bad: bad };
        worker.postMessage({ type: 'snapshot', id: id });
      });
    });
  }

  function stamp() {
    var d = new Date();
    return today() + ' ' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  }

  function saved(msg, path) {
    toastAction(msg + ': ' + path.split('/').pop(), 'Show in Finder', function () { reveal(path); });
  }

  function reveal(path) { tauri().invoke('reveal', { path: path }).catch(function (e) { toast(String(e), 'bad'); }); }

  function toastAction(msg, label, fn) {
    var box = document.getElementById('toasts');
    if (!box) return;
    var t = document.createElement('div');
    t.className = 'toast ok';
    t.textContent = msg + ' ';
    var b = document.createElement('button');
    b.className = 'btn';
    b.textContent = label;
    b.onclick = function () { t.remove(); fn(); };
    t.appendChild(b);
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, 9000);
  }

  function base64(buf) {
    var bytes = new Uint8Array(buf), out = '';
    for (var i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(out);
  }

  // <a download> links (the JSON export, the Horror ID card) can't download inside an app window, so save them ourselves.
  function catchDownloads(ev) {
    var link = ev.target.closest && ev.target.closest('a[download]');
    if (!link || !tauri()) return;
    ev.preventDefault();
    ev.stopPropagation();
    var name = link.getAttribute('download') || 'Horror HQ download';
    fetch(link.href).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
      return tauri().invoke('save_download', { name: name, data: base64(buf) });
    }).then(function (path) { saved('Saved to Downloads', path); })
      .catch(function (e) { toast("Couldn't save the download: " + e, 'bad'); });
  }

  // Web links open in the default browser instead of trying (and failing) to open a window here.
  function catchLinks(ev) {
    var link = ev.target.closest && ev.target.closest('a[href]');
    if (!link || link.hasAttribute('download') || !tauri()) return;
    var href = link.getAttribute('href');
    if (!/^https?:\/\//.test(href)) return;
    ev.preventDefault();
    tauri().invoke('open_url', { url: href }).catch(function (e) { toast(String(e), 'bad'); });
  }

  function backupNow(btn) {
    btn.disabled = true;
    snapshot().then(function (json) { return tauri().invoke('backup_now', { json: json, stamp: stamp() }); })
      .then(function (path) { saved('Snapshot saved in Backups', path); })
      .catch(function (e) { toast("Couldn't back up: " + e, 'bad'); })
      .then(function () { btn.disabled = false; });
  }

  function exportXlsx(btn) {
    btn.disabled = true;
    snapshot().then(function (json) { return tauri().invoke('export_xlsx', { json: json, day: today() }); })
      .then(function (path) { saved('Spreadsheet saved to Downloads', path); })
      .catch(function (e) { toast("Couldn't export: " + e, 'bad'); })
      .then(function () { btn.disabled = false; });
  }

  function showData() {
    tauri().invoke('data_path').then(reveal).catch(function (e) { toast(String(e), 'bad'); });
  }

  function onMacClick(ev) {
    var b = ev.target.closest && ev.target.closest('[data-macbackup],[data-macxlsx],[data-macfinder]');
    if (!b) return;
    if (b.hasAttribute('data-macbackup')) backupNow(b);
    else if (b.hasAttribute('data-macxlsx')) exportXlsx(b);
    else showData();
  }

  /** Admin > Backup & export on the Mac (ViewAdmin.html asks for this instead of the Google Drive version). */
  function backupPanel() {
    return '<div class="grid g2"><div class="panel"><h2>Snapshot backup</h2><p class="small muted">Saves a dated copy of everything into ' +
        'Documents › Horror HQ › Backups. Snapshots are never cleared out automatically.</p>' +
        '<button class="btn primary" data-macbackup>Back up now</button></div>' +
      '<div class="panel"><h2>Daily backups</h2><p class="small muted">The first time you change anything each day, the previous copy is ' +
        'tucked into the same Backups folder. The last 14 days are kept. Nothing to switch on.</p>' +
        '<button class="btn ghost" data-macfinder>Show in Finder</button></div></div>' +
      '<div class="panel"><h2>Export</h2><p class="small muted">Every table, for safekeeping or for poking at. Both land in Downloads.</p>' +
        '<div style="display:flex;gap:8px"><button class="btn" data-macxlsx>Export to spreadsheet (.xlsx)</button>' +
        '<button class="btn ghost" data-adexport>Download JSON</button></div></div>';
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.addEventListener('click', catchDownloads, true);
    document.addEventListener('click', catchLinks, true);
    document.addEventListener('click', onMacClick);
    watchPosters();
    coffinOnError();
    boot();
  });

  return { google: google, poster: poster, backupPanel: backupPanel };
})();
var google = HQMac.google;
