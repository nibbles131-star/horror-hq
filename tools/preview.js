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

// Fake server: every call replays through the real Apps Script code via a tiny RPC table baked into the page.
const fake = `<script>
var RAW = ${JSON.stringify(raw)};
var EXC = ${JSON.stringify(exc)};
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
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
