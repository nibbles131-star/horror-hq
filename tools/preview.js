/**
 * Builds dist/preview.html: the real web app pages with google.script.run
 * faked in the browser, fed by the migrated fixture. Then screenshots each
 * section with Playwright so layout breaks show up without deploying.
 * Usage: node tools/preview.js [section ...]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { MockSpreadsheet, makeGlobals } = require('./mock_sheets');
const { tabs } = require('./fixture_legacy');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'dist');
const g = makeGlobals({
  '1K4jvoXbBLMT13XXTlUDAgbo3U_VD-wXZtI-IMCQunQw': new MockSpreadsheet(tabs),
  '1h1sgPL6_5b1womrFQoqF-Gob7rlsFYZyFozaTJyR4Zc': new MockSpreadsheet({ Sheet1: [] })
});
g.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
const ctx = vm.createContext(Object.assign({ console }, g));
for (const f of fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort()) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
vm.runInContext('runMigration()', ctx);
g.Utilities = { formatDate: (d) => d.toISOString().slice(0, 10) };
const raw = JSON.parse(JSON.stringify(vm.runInContext('apiBootstrap()', ctx)));
const exc = JSON.parse(JSON.stringify(vm.runInContext('apiExcavatorData()', ctx)));
ctx.ScriptApp = { getProjectTriggers: () => [] };
const adm = JSON.parse(JSON.stringify(vm.runInContext('apiAdminData()', ctx)));
const mprev = JSON.parse(JSON.stringify(vm.runInContext(`apiMergePreview(${JSON.stringify(raw.films[0][0])}, ${JSON.stringify(raw.films[1][0])})`, ctx)));

// Stand-in posters (TMDB isn't reachable from here): a coloured card per film, leaving every fourth one poster-less.
raw.films.forEach((f, i) => {
  if (i % 4 === 3) return;
  const hue = (i * 47) % 360;
  const words = String(f[2]).toUpperCase().split(' ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},60%,30%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},70%,8%)"/></linearGradient></defs>` +
    `<rect width="200" height="300" fill="url(#g)"/><circle cx="100" cy="120" r="${40 + (i % 3) * 12}" fill="hsla(${hue},80%,60%,.35)"/>` +
    words.map((w, k) => `<text x="100" y="${215 + k * 24}" font-family="Impact,Arial" font-size="22" fill="#fff" text-anchor="middle">${w.replace(/[<&>]/g, '')}</text>`).join('') + `</svg>`;
  f[4] = 'data:image/svg+xml,' + encodeURIComponent(svg);
});
raw.posters = { provider: 'TMDB', enabled: true };
raw.fun = { hall_of_fame: [raw.films[2][0], null, raw.films[5][0], null], bingo_card: null, trophies_seen: null };
adm.poster = { keySet: true, provider: raw.posters };
const pstat = { total: raw.films.length, withPoster: 9, noImage: 1, notFound: 2, todo: 0, keySet: true, missing: [[raw.films[3][0], raw.films[3][1]], [raw.films[7][0], raw.films[7][1]]] };

// Fake server: every call replays through the real Apps Script code via a tiny RPC table baked into the page.
const fake = `<script>
var RAW = ${JSON.stringify(raw)};
var EXC = ${JSON.stringify(exc)};
var ADM = ${JSON.stringify(adm)};
var MPREV = ${JSON.stringify(mprev)};
var PSTAT = ${JSON.stringify(pstat)};
var google = { script: { get run() {
  var ok = function () {}, bad = function () {};
  var p = new Proxy({}, { get: function (_, name) {
    if (name === 'withSuccessHandler') return function (f) { ok = f; return p; };
    if (name === 'withFailureHandler') return function (f) { bad = f; return p; };
    return function () {
      var args = arguments;
      setTimeout(function () {
        if (name === 'apiBootstrap') return ok(RAW);
        if (name === 'apiExcavatorData') return ok(EXC);
        if (name === 'apiAdminData') return ok(ADM);
        if (name === 'apiMergePreview') return ok(MPREV);
        if (name === 'apiPosterStatus' || name === 'apiPosterRun') return ok(PSTAT);
        if (name === 'apiSaveUiSetting') return ok(args[1]);
        if (name === 'apiPosterForFilm') return ok({ poster: '' });
        if (name === 'apiPosterSearch') return ok(RAW.films.slice(0, 6).map(function (f, i) { return { id: i + 1, title: f[2], year: String(f[3]), poster: f[4], horror: i % 2 === 0 }; }));
        if (name === 'apiSaveFilmState') return ok({ conflict: false, state: Object.assign({ film_id: args[0], version: (args[2] || 1) + 1, modified_at: new Date().toISOString() }, args[1]) });
        ok({});
      }, 30);
    };
  } });
  return p;
} } };
</script>`;

const read = n => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8');
const html = read('Index').replace(/<\?!= include\('(\w+)'\) \?>/g, (_, n) => read(n)).replace('<head>', '<head>' + fake);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'preview.html'), html);
console.log('Wrote dist/preview.html');

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { return; }
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const browser = await chromium.launch({ proxy });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(OUT, 'preview.html'));
  await page.waitForSelector('.stats, .panel');
  const sections = process.argv.slice(2).length ? process.argv.slice(2) : await page.$$eval('[data-nav]', b => b.map(x => x.dataset.nav));
  for (const s of sections) {
    await page.click(`[data-nav="${s}"]`);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, `shot-${s}.png`), fullPage: true });
  }
  // Open a film drawer too.
  await page.click('[data-nav="home"]');
  const link = await page.$('[data-film]');
  if (link) { await link.click(); await page.waitForTimeout(150); await page.screenshot({ path: path.join(OUT, 'shot-drawer.png') }); }
  await browser.close();
  console.log('Screens:', sections.join(', '), errors.length ? '\nERRORS:\n' + errors.join('\n') : '(no page errors)');
  if (errors.length) process.exitCode = 1;
})();
