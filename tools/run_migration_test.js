/**
 * Runs runMigration() against the fixture workbook with mocked Sheets and
 * checks the outcome. Usage: node tools/run_migration_test.js
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

const legacy = new MockSpreadsheet(tabs);
const db = new MockSpreadsheet({ Sheet1: [] });
const g = makeGlobals({ [LEGACY_ID]: legacy, [DB_ID]: db });
const ctx = vm.createContext(Object.assign({ console }, g));
for (const f of fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort()) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}

const report = vm.runInContext('runMigration()', ctx);
const read = t => vm.runInContext(`dbClearMemo(); dbRead(${JSON.stringify(t)})`, ctx);

const films = read('Films');
const state = read('FilmState');
const entries = read('CollectionEntries');
const ex = read('MigrationExceptions');
const byKey = Object.fromEntries(films.map(f => [f.display_key, f]));
const stateOf = k => state.find(s => s.film_id === byKey[k].film_id);

console.log('Checks:');
report.checks.forEach(c => console.log(` ${c.pass ? 'PASS' : 'DIFF'}  ${c.name}: ${c.legacy} -> ${c.migrated}`));
console.log('\nExceptions:');
ex.forEach(e => console.log(` [${e.severity}] ${e.kind} @ ${e.source_tab} ${e.source_ref}: ${e.detail}`));

// Core invariants.
assert.strictEqual(films.length, 12, 'eleven known films plus Sweetheart from the agenda/list');
assert.strictEqual(new Set(films.map(f => f.film_id)).size, films.length, 'film ids unique');
assert.strictEqual(state.length, films.length, 'one state per film');
assert.strictEqual(stateOf('Evil Dead Burn (2026)').rating_10, 10);
assert.strictEqual(stateOf('Bite (2015)').viewing_status, 'Watched', 'seen/unlisted keeps Watched');
assert.strictEqual(stateOf('[REC] (2007)').rating_10, null, 'watched without a rating stays unrated');
assert.ok(!entries.some(e => e.film_id === byKey['Bite (2015)'].film_id), 'seen/unlisted not forced onto a list');
assert.ok(entries.every(e => e.film_id), 'every entry points at a film');
assert.ok(ex.some(e => e.kind === 'film-not-in-library' && e.raw_value === 'Sweetheart (2019)'));
assert.ok(ex.some(e => e.kind === 'possible-duplicate' && /Fanatic/.test(e.raw_value)), 'alias pair flagged');
assert.ok(ex.some(e => e.kind === 'unsure-outside-franchise'));
assert.ok(ex.some(e => e.kind === 'status-mismatch' && /Fanatic/.test(e.detail)), 'list vs Ratings Log mismatch flagged');
assert.ok(byKey['Die Die Darling! (1965)'] && byKey['Fanatic (1965)'], 'aliases never merged');
const special = read('SpecialRatings');
assert.strictEqual(special[0].cuntometer_5, 4);
const cands = read('ExcavationCandidates');
assert.strictEqual(cands.length, 3);
const searches = read('ExcavationSearches');
assert.strictEqual(searches.find(s => s.search_id === 'EXC-20260912-006').search_date, '2026-09-12');
const agenda = read('WatchAgenda');
assert.strictEqual(agenda[0].planned_date, '2026-09-15');
const awards = read('Awards');
assert.strictEqual(awards.length, 10);
assert.strictEqual(awards[0].winner_film_id, byKey['Evil Dead Burn (2026)'].film_id);
const colls = read('Collections');
assert.strictEqual(colls.filter(c => c.family === 'Bestiary').length, 15, 'all 15 Bestiary categories exist');
const slot = entries.find(e => e.slot_label === 'Oct 1');
assert.ok(slot, '"Oct 1" slot label survives as text');
assert.ok(!ex.some(e => e.kind === 'trophy-definition-mismatch'), 'trophy thresholds unchanged');
assert.ok(report.failed === 0, 'fixture dashboard numbers reconcile');
console.log(`\nOK: ${films.length} films, ${entries.length} entries, ${report.passed} checks passed, ${ex.length} exceptions.`);
