/**
 * End-to-end check of the app layer: migrate the fixture, call apiBootstrap(),
 * push the result through JSON (as google.script.run does), build the browser
 * model with Logic.html, then exercise the write API.
 * Usage: node tools/app_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { MockSpreadsheet, makeGlobals } = require('./mock_sheets');
const { tabs } = require('./fixture_legacy');

const SRC = path.join(__dirname, '..', 'src');
const LEGACY_ID = '1K4jvoXbBLMT13XXTlUDAgbo3U_VD-wXZtI-IMCQunQw';
const DB_ID = '1h1sgPL6_5b1womrFQoqF-Gob7rlsFYZyFozaTJyR4Zc';

const g = makeGlobals({ [LEGACY_ID]: new MockSpreadsheet(tabs), [DB_ID]: new MockSpreadsheet({ Sheet1: [] }) });
g.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
const ctx = vm.createContext(Object.assign({ console }, g));
for (const f of fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort()) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const run = (expr) => JSON.parse(JSON.stringify(vm.runInContext(expr, ctx)));

// Before migration the app must say so rather than crash.
vm.runInContext('setupDatabase()', ctx);
assert.strictEqual(run('apiBootstrap()').needsMigration, true, 'empty database asks for the migration');

vm.runInContext('runMigration()', ctx);
// The fixture has no alias rows, so add the real one the live sheet produces.
vm.runInContext(`dbAppend('FilmAliases', [{ alias_id: 'A90001', film_id: dbRead('Films').filter(function (f) { return f.display_key === 'Fanatic (1965)'; })[0].film_id,
  alias_display_key: 'Dracula Lives (1958)', alias_title: 'Dracula Lives', alias_year: 1958, match_key: matchKey_('Dracula Lives (1958)'), status: 'alternate title' }]); dbClearMemo();`, ctx);

// Load the browser logic exactly as shipped, minus the <script> tags.
const logicSrc = fs.readFileSync(path.join(SRC, 'Logic.html'), 'utf8').replace(/<\/?script>/g, '');
const mod = { exports: {} };
new Function('module', logicSrc)(mod);
const HQ = mod.exports;

// The app script must at least parse.
const appSrc = fs.readFileSync(path.join(SRC, 'App.html'), 'utf8').replace(/<\/?script>/g, '');
new Function(appSrc);

const raw = run('apiBootstrap()');
assert.ok(!raw.needsMigration);
const M = HQ.build(raw);
const key = k => M.films.find(f => f.key === k);

assert.strictEqual(M.films.length, 12);
assert.strictEqual(key('Evil Dead Burn (2026)').rating, 10);
assert.strictEqual(HQ.verdict(10).key, 'obsession');
assert.strictEqual(HQ.verdict(9).key, 'loved');
assert.strictEqual(HQ.verdict(8).key, 'great');
assert.strictEqual(HQ.verdict(6).key, 'good');
assert.strictEqual(HQ.verdict(4).key, 'meh');
assert.strictEqual(HQ.verdict(2).key, 'nope');
assert.strictEqual(HQ.verdict(null), null);

const h = HQ.headline(M);
assert.strictEqual(h.rated, 2);
assert.strictEqual(h.avg, 6.5, 'matches the old "Average rating 6.5/10"');
assert.strictEqual(h.lovedPlus, 1);
assert.strictEqual(h.dnf, 0);

assert.ok(HQ.rateNext(M).some(f => f.key === '[REC] (2007)'), 'watched-but-unrated shows in Rate these next');
assert.ok(!HQ.rateNext(M).some(f => f.rating !== null), 'rated films never in Rate these next');

const fr = HQ.franchises(M);
assert.ok(fr.length > 0 && fr.every(x => x.total >= x.watched));

const t = HQ.trophies(M);
assert.strictEqual(t.core.length, 7, 'seven core trophy families');
assert.strictEqual(t.bestiary.length, 15, 'fifteen Bestiary categories');
assert.strictEqual(t.platinum.earned, false);
const devotee = t.core.find(c => c.family === 'Horror Devotee');
assert.deepStrictEqual(devotee.ladder.map(d => d.threshold), [25, 100, 250], 'frozen thresholds');
assert.strictEqual(devotee.next.tier, 'Bronze');

assert.strictEqual(HQ.search(M, 'evil dead')[0].key, 'Evil Dead Burn (2026)');
assert.strictEqual(HQ.search(M, 'rec')[0].key, '[REC] (2007)', 'punctuation-insensitive');
assert.ok(HQ.search(M, 'dracula lives')[0].key === 'Fanatic (1965)', 'aliases are searchable');

// Writes.
const rec = key('[REC] (2007)');
let res = run(`apiSaveFilmState(${JSON.stringify(rec.id)}, {rating_10: 8}, ${rec.version})`);
assert.strictEqual(res.conflict, false);
assert.strictEqual(res.state.rating_10, 8);
assert.strictEqual(res.state.version, rec.version + 1);
res = run(`apiSaveFilmState(${JSON.stringify(rec.id)}, {rating_10: 9}, ${rec.version})`);
assert.strictEqual(res.conflict, true, 'stale tab cannot overwrite');
assert.strictEqual(res.state.rating_10, 8);
assert.throws(() => vm.runInContext(`apiSaveFilmState(${JSON.stringify(rec.id)}, {rating_10: 11})`, ctx), /1 to 10/);
assert.throws(() => vm.runInContext(`apiSaveFilmState(${JSON.stringify(rec.id)}, {rating_10: 7.5})`, ctx), /whole numbers/);
const fanatic = key('Fanatic (1965)');
assert.throws(() => vm.runInContext(`apiSaveFilmState(${JSON.stringify(fanatic.id)}, {viewing_status: 'Unsure'})`, ctx), /franchise/);
const fri = key('Friday the 13th Part 2 (1981)');
res = run(`apiSaveFilmState(${JSON.stringify(fri.id)}, {viewing_status: 'Unsure'})`);
assert.strictEqual(res.state.viewing_status, 'Unsure', 'franchise entries may be Unsure');
assert.strictEqual(res.state.rating_10, 3, 'changing status keeps the rating');

assert.throws(() => vm.runInContext(`apiSaveCuntometer(${JSON.stringify(rec.id)}, 6)`, ctx), /1 to 5/);
res = run(`apiSaveCuntometer(${JSON.stringify(rec.id)}, 5, 'serve')`);
assert.strictEqual(res.cuntometer_5, 5);
assert.strictEqual(run(`dbClearMemo(); dbIndex('FilmState')[${JSON.stringify(rec.id)}].rating_10`), 8, 'Cuntometer never touches the /10');

res = run(`apiAddFilm('Evil Dead Burn', 2026)`);
assert.strictEqual(res.created, false);
assert.strictEqual(res.via, 'exact');
res = run(`apiAddFilm('REC', 2007)`);
assert.strictEqual(res.created, false, 'punctuation variants caught');
res = run(`apiAddFilm('Dracula Lives', 1958)`);
assert.strictEqual(res.created, false, 'alias caught');
assert.strictEqual(res.film.display_key, 'Fanatic (1965)');
res = run(`apiAddFilm('Brand New Nightmare', 2026)`);
assert.strictEqual(res.created, true);
assert.strictEqual(res.film.film_id, 'F00013');
const newId = res.film.film_id;

const coll = M.collList.find(c => c.family === 'Bestiary');
const e1 = run(`apiAddEntry(${JSON.stringify(coll.collection_id)}, ${JSON.stringify(newId)}, '', 'test')`);
assert.throws(() => vm.runInContext(`apiAddEntry(${JSON.stringify(coll.collection_id)}, ${JSON.stringify(newId)})`, ctx), /already on this list/);
const e2 = run(`apiAddEntry(${JSON.stringify(coll.collection_id)}, ${JSON.stringify(rec.id)})`);
assert.deepStrictEqual(run(`apiMoveEntry(${JSON.stringify(e2.entry_id)}, 0)`).slice(0, 2), [e2.entry_id, e1.entry_id]);
run(`apiRemoveEntry(${JSON.stringify(e1.entry_id)})`);
assert.ok(run(`dbClearMemo(); dbIndex('Films')[${JSON.stringify(newId)}]`), 'removing from a list keeps the film');

const audit = run(`dbClearMemo(); dbRead('Audit')`);
assert.ok(audit.length >= 8, 'every write is audited');

const again = HQ.build(run('apiBootstrap()'));
assert.strictEqual(again.films.length, 13);
assert.strictEqual(again.byId[rec.id].rating, 8);

console.log(`OK: app layer: ${M.films.length} films loaded, headline avg ${h.avg}, ${audit.length} audited writes, bootstrap ${raw.loadMs}ms.`);
