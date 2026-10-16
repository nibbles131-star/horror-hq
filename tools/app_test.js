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
g.Utilities = { formatDate: (d) => d.toISOString().slice(0, 10) };
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

// Collections section.
const viewSrc = fs.readFileSync(path.join(SRC, 'ViewCollections.html'), 'utf8');
const collMod = { exports: {} };
new Function('module', 'HQ', viewSrc.match(/<script>([\s\S]*?)<\/script>/)[1])(collMod, HQ);
const CL = collMod.exports;
assert.strictEqual(CL.franchiseState(0, 4, 0), 'Not started');
assert.strictEqual(CL.franchiseState(5, 6, 0), 'Nearly complete', 'Evil Dead 5/6 in the old sheet');
assert.strictEqual(CL.franchiseState(6, 9, 0), 'In progress', 'Alien 6/9 in the old sheet');
assert.strictEqual(CL.franchiseState(4, 4, 0), 'Complete');
assert.strictEqual(CL.franchiseState(1, 4, 1), 'Needs review');
const M2 = HQ.build(run('apiBootstrap()'));
const ham = M2.collList.find(c => c.name === 'Hammer');
const hp = CL.progress(M2, ham.collection_id);
assert.strictEqual(hp.total, 2);
assert.strictEqual(hp.watched, 1);
assert.strictEqual(hp.next.key, 'Die Die Darling! (1965)');
assert.strictEqual(CL.bestiaryTier(M2, 0), null);
assert.strictEqual(CL.bestiaryTier(M2, 5), 'Silver');
assert.strictEqual(CL.bestiaryTier(M2, 12), 'Gold');
const fam = CL.familyProgress(M2, 'Classics');
assert.strictEqual(fam.lists, 5, 'all five studios exist even when empty');
assert.throws(() => vm.runInContext(`apiCreateCollection('Bestiary', 'Robots')`, ctx), /locked/);
assert.throws(() => vm.runInContext(`apiCreateCollection('Classics', 'Warner')`, ctx), /fixed/);
const nc = run(`apiCreateCollection('Curated', 'Folk Horror Faves')`);
assert.strictEqual(nc.family, 'Curated');
assert.throws(() => vm.runInContext(`apiCreateCollection('Curated', 'folk horror faves!')`, ctx), /already/);
assert.strictEqual(run(`apiUpdateCollection(${JSON.stringify(nc.collection_id)}, {name: 'Folk Horror', description: 'Wicker everything'})`).name, 'Folk Horror');
assert.throws(() => vm.runInContext(`apiUpdateCollection(${JSON.stringify(ham.collection_id)}, {name: 'Hammer Films'})`, ctx), /locked/);

// Watch Planner.
const planSrc = fs.readFileSync(path.join(SRC, 'ViewPlanner.html'), 'utf8');
const planMod = { exports: {} };
new Function('module', 'HQ', planSrc.match(/<script>([\s\S]*?)<\/script>/)[1])(planMod, HQ);
const PL = planMod.exports;
assert.strictEqual(PL.occasionIcon('Halloween Countdown 2026'), '🎃');
assert.strictEqual(PL.occasionIcon('Friday the 13th / Unlucky'), '1️⃣3️⃣');
assert.strictEqual(PL.occasionIcon('Black Friday mini-list'), '🛍️');
assert.strictEqual(PL.isBonus({ context_note: 'Bonus • Hooptober bonus film' }), true);
assert.strictEqual(PL.eventStatus({ start_date: '2026-10-01', end_date: '2026-10-31' }, '2026-10-16').label, 'Running: day 16 of 31');
assert.strictEqual(PL.eventStatus({ start_date: '2026-11-03', end_date: '2026-11-05' }, '2026-10-16').label, 'Starts in 18 days');
assert.strictEqual(PL.eventStatus({ start_date: '2026-09-06', end_date: '2026-09-30' }, '2026-10-16').state, 'done');
const M3 = HQ.build(run('apiBootstrap()'));
const months = PL.calendarMonths(M3, '2026-10-16');
assert.strictEqual(months[0].month, 8, 'calendar starts in September');
const oct = months.find(m => m.month === 9);
assert.strictEqual(oct.cells.findIndex(c => c && c.day === 1), 3, '1 Oct 2026 is a Thursday');
assert.ok(oct.cells.find(c => c && c.today), 'today is marked');
const occ = PL.occasionProgress(M3);
assert.ok(occ.length >= 1 && occ.every(o => o.watched <= o.total));
// Planner writes.
const fid0 = M3.films[0].id;
let ag = run(`apiSaveAgenda({ planned_date: '2026-10-31', film_id: ${JSON.stringify(fid0)}, occasion: 'Halloween Countdown 2026', context_note: 'Daily countdown' })`);
assert.ok(/^S\d{5}$/.test(ag.schedule_id));
ag = run(`apiSaveAgenda({ schedule_id: ${JSON.stringify(ag.schedule_id)}, planned_date: '31/10/2026', film_id: ${JSON.stringify(fid0)}, occasion: 'Halloween Countdown 2026' })`);
assert.strictEqual(ag.planned_date, '2026-10-31', 'UK dates accepted');
assert.throws(() => vm.runInContext(`apiSaveAgenda({ planned_date: 'soon', film_id: ${JSON.stringify(fid0)} })`, ctx), /real date/);
run(`apiDeleteAgenda(${JSON.stringify(ag.schedule_id)})`);
assert.throws(() => vm.runInContext(`apiSaveEventPlan({ name: 'Backwards', start_date: '2026-11-05', end_date: '2026-11-03' })`, ctx), /ends before/);
const ep = run(`apiSaveEventPlan({ name: 'Bonfire Night mini-list', start_date: '2026-11-03', end_date: '2026-11-05', intended_films: '3' })`);
assert.ok(ep.event_plan_id);
const ch = run(`apiSaveChallenge({ title: 'Hooptober 2026' })`);
const cr1 = run(`apiSaveCriterion({ challenge_id: ${JSON.stringify(ch.challenge_id)}, label: 'A 1970s film', required_count: 2 })`);
const cr2 = run(`apiSaveCriterion({ challenge_id: ${JSON.stringify(ch.challenge_id)}, label: 'A sequel' })`);
assert.strictEqual(cr2.required_count, 1, 'required defaults to 1');
run(`apiAddAssignment(${JSON.stringify(cr1.criterion_id)}, ${JSON.stringify(fid0)}, '')`);
run(`apiAddAssignment(${JSON.stringify(cr2.criterion_id)}, ${JSON.stringify(fid0)}, '')`);
assert.throws(() => vm.runInContext(`apiAddAssignment(${JSON.stringify(cr1.criterion_id)}, ${JSON.stringify(fid0)}, '')`, ctx), /already covers/);
const M4 = HQ.build(run('apiBootstrap()'));
const board = PL.challengeBoard(M4, ch.challenge_id);
assert.strictEqual(board.criteria, 2);
assert.strictEqual(board.coveredCriteria, 1, 'one film covers the sequel criterion; the 1970s one needs two');
assert.strictEqual(Math.round(board.completion * 100), 67, '(1 + 1) / (2 + 1) like the old sheet formula');
assert.strictEqual(board.assignments, 2);
assert.strictEqual(run(`apiDeleteCriterion(${JSON.stringify(cr1.criterion_id)})`).assignments, 1);

// Horror Excavator.
const excSrc = fs.readFileSync(path.join(SRC, 'ViewExcavator.html'), 'utf8');
const excMod = { exports: {} };
new Function('module', 'HQ', excSrc.match(/<script>([\s\S]*?)<\/script>/)[1])(excMod, HQ);
const EX = excMod.exports;
const draft = { search_type: 'Bestiary Top-Up', destination: 'Horror Bestiary 👹', wanted: 15, style: 'Deep excavation',
  known_policy: 'Fresh only • exclude every known/surfaced film', target: 'Mutants, Experiments & Monstrous Transformations',
  must_include: 'Mutation', avoid: 'Weak technical fits', brief: 'Second MEMT pass.' };
assert.strictEqual(EX.requestLine(draft), 'TYPE: Bestiary Top-Up • DESTINATION: Horror Bestiary 👹 • WANT: 15 • STYLE: Deep excavation • KNOWN POLICY: Fresh only • exclude every known/surfaced film • SLOT/YEAR/CATEGORY: Mutants, Experiments & Monstrous Transformations • MUST INCLUDE: Mutation • AVOID: Weak technical fits • BRIEF: Second MEMT pass.', 'matches the old B7 formula');
assert.strictEqual(EX.requestLine({ search_type: 'Freeform', wanted: '', brief: 'x' }), 'TYPE: Freeform • BRIEF: x', 'blank controls skipped like TEXTJOIN');
const parsed = EX.parseArnold([
  'Here you go:',
  '| Film | Why it fits | Sources | Evidence | Country |',
  '|---|---|---|---|---|',
  '| **The Fly (1986)** | Brundlefly | https://en.wikipedia.org/wiki/The_Fly_(1986_film) | Classic | United States, Canada |',
  '1. Splice (2009) | Genetic experiment gone wrong | IMDb | Mixed | Canada',
  '- Society | 1989 | Body melt party | Letterboxd',
  'Title (YYYY) | Why it fits | Research source(s) | Community / evidence note | Country',
  'Not a candidate line'
].join('\n'));
assert.deepStrictEqual(parsed.map(r => r.title + ' (' + r.year + ')'), ['The Fly (1986)', 'Splice (2009)', 'Society (1989)']);
assert.strictEqual(parsed[0].countries, 'United States, Canada');
assert.strictEqual(parsed[2].why, 'Body melt party', 'Title | Year | ... rows handled');
assert.strictEqual(EX.breaksPolicy('Yes • maybe', 'Fresh only • exclude every known film'), true);
assert.strictEqual(EX.breaksPolicy('Yes • maybe', 'Exclude seen + rejected • allow old maybes/candidates'), false);
assert.strictEqual(EX.breaksPolicy('Yes • seen', 'Only exclude seen • broadest practical search'), true);
assert.strictEqual(EX.breaksPolicy('Yes • tracked', 'Research regardless • show known matches'), false);
const xd0 = run('apiExcavatorData()');
const M5 = HQ.build(run('apiBootstrap()'));
assert.ok(EX.exclusions(M5, xd0, 'Fresh only • exclude every known/surfaced film').includes('Night Tide (1961)'));
assert.ok(!EX.exclusions(M5, xd0, 'Only exclude seen • broadest practical search').includes('Night Tide (1961)'), 'maybes allowed under seen-only');
assert.ok(EX.exclusions(M5, xd0, 'Only exclude seen • broadest practical search').includes('Bite (2015)'), 'seen/unlisted excluded');
assert.strictEqual(EX.exclusions(M5, xd0, 'Research regardless • show known matches').length, 0);
assert.ok(EX.arnoldPrompt(M5, xd0, draft).indexOf('Title (YYYY) | Why it fits') > 0);
const imp = run(`apiImportCandidates(${JSON.stringify(draft)}, ${JSON.stringify(parsed.concat([{ title: 'Night Tide', year: 1961, why: 'again' }, { title: 'The Fly', year: 1986, why: 'dupe' }]))})`);
assert.ok(/^EXC-\d{8}-007$/.test(imp.search.search_id), 'search ids continue the old sequence: ' + imp.search.search_id);
assert.strictEqual(imp.candidates.length, 4, 'same film twice in one run is kept once');
assert.strictEqual(imp.films.length, 3, 'three brand-new films');
assert.strictEqual(imp.memory[0].discovery_status, '🔎 Candidate');
assert.strictEqual(imp.candidates.find(c => c.surfaced_title === 'Night Tide (1961)').known_before, 'Yes • maybe');
assert.strictEqual(imp.filmCountries.filter(fc => fc.film_id === imp.films[0].film_id).length, 2, 'countries seeded');
const fly = imp.candidates.find(c => c.surfaced_title === 'The Fly (1986)');
const splice = imp.candidates.find(c => c.surfaced_title === 'Splice (2009)');
const soc = imp.candidates.find(c => c.surfaced_title === 'Society (1989)');
const memt = run(`dbRead('Collections')`).find(c => c.name === 'Mutants, Experiments & Monstrous Transformations');
let dres = run(`apiDecideCandidate(${JSON.stringify(fly.candidate_id)}, '✅ Approved', 'Perfect fit', { collection_id: ${JSON.stringify(memt.collection_id)} })`);
assert.ok(dres.entry && dres.entry.collection_id === memt.collection_id, 'approved goes onto the list');
assert.strictEqual(dres.memory.discovery_status, '✅ Approved');
assert.ok(/Added to Bestiary/.test(dres.decision.destination_result));
dres = run(`apiDecideCandidate(${JSON.stringify(splice.candidate_id)}, '👁️ Seen / unlisted', '', { rating: 6 })`);
assert.strictEqual(dres.state.viewing_status, 'Watched');
assert.strictEqual(dres.state.rating_10, 6);
assert.ok(!run(`dbRead('CollectionEntries')`).some(e => e.film_id === splice.film_id), 'seen/unlisted never forced onto a list');
dres = run(`apiDecideCandidate(${JSON.stringify(soc.candidate_id)}, '🚫 Rejected', 'Too goopy', {})`);
assert.strictEqual(dres.memory.exclusion_reason, 'Too goopy');
const xd1 = run('apiExcavatorData()');
assert.strictEqual(xd1.candidates.length, xd0.candidates.length + 4, 'archive is append-only');
assert.strictEqual(Object.keys(EX.latestDecisions(xd1)).length, Object.keys(EX.latestDecisions(xd0)).length + 3);
run(`apiSetSearchState(${JSON.stringify(imp.search.search_id)}, 'Archived')`);
assert.strictEqual(run('apiExcavatorData()').searches.find(s => s.search_id === imp.search.search_id).state, 'Archived');

// Funhouse.
const funSrc = fs.readFileSync(path.join(SRC, 'ViewFunhouse.html'), 'utf8');
const funMod = { exports: {} };
new Function('module', 'HQ', funSrc.match(/<script>([\s\S]*?)<\/script>/)[1])(funMod, HQ);
const FUN = funMod.exports;
const MF = HQ.build(run('apiBootstrap()'));
const allPool = FUN.pool(MF, 'all');
assert.ok(allPool.length > 0 && allPool.every(f => f.status === 'Not watched'), 'slot pool is unwatched only');
assert.strictEqual(new Set(allPool.map(f => f.id)).size, allPool.length, 'slot pool is unique');
FUN.POOLS.slice(1).forEach(p => FUN.pool(MF, p[0]).forEach(f => assert.ok(allPool.includes(f), p[0] + ' is inside All Unwatched')));
// A synthetic franchise to pin the double-bill order rule.
const tfr = { collection_id: 'CXF', family: 'Franchise', name: 'Test Franchise', sort_order: 999 };
const ff = ['Part 1 (1980)', 'Part 2 (1981)', 'Part 3 (1982)', 'Jason X (2001)'].map((k, i) =>
  ({ id: 'FX' + i, key: k, title: k, year: 1980 + i, status: i === 0 ? 'Watched' : 'Not watched', countries: [], aliases: [] }));
const MX = { collList: [tfr], coll: { CXF: tfr }, byId: {}, entriesByColl: { CXF: [] }, entriesByFilm: {} };
ff.forEach((f, i) => { MX.byId[f.id] = f; MX.entriesByColl.CXF.push({ id: 'EX' + i, coll: 'CXF', film: f.id, seq: i + 1 }); });
const bill = FUN.movieNight(MX, 'Franchise Double Bill', () => 0.99);
assert.strictEqual(bill.one.key, 'Part 2 (1981)');
assert.strictEqual(bill.two.key, 'Part 3 (1982)', 'next two unwatched in order, never Jason X first');
const sd = FUN.movieNight(MX, 'Same Decade', () => 0);
assert.strictEqual(sd.decade, '1980s');
assert.notStrictEqual(sd.one.id, sd.two.id, 'never the same film twice');
assert.ok(/no Curated list/.test(FUN.movieNight(MX, 'Beauty & Beast').problem), 'missing partner list is reported');
const chaos = FUN.movieNight(MF, 'Chaos Pair');
assert.ok(!chaos.one || !chaos.two || chaos.one.id !== chaos.two.id);

// Stats + Trophies.
const statsSrc = fs.readFileSync(path.join(SRC, 'ViewStats.html'), 'utf8');
const statsMod = { exports: {} };
new Function('module', 'HQ', statsSrc.match(/<script>([\s\S]*?)<\/script>/)[1])(statsMod, HQ);
new Function('App', statsSrc.match(/<script>([\s\S]*?)<\/script>/g)[1].replace(/<\/?script>/g, ''))({ view: () => {} });
const SL = statsMod.exports;
const MS = HQ.build(run('apiBootstrap()'));
const cab = SL.cabinet(MS);
assert.strictEqual(cab.summary.total, 21 + 45 + 1, 'old cabinet total: 21 core + 45 Bestiary + Platinum');
const tierSum = cab.summary.byTier.Bronze + cab.summary.byTier.Silver + cab.summary.byTier.Gold + cab.summary.byTier.Platinum;
assert.strictEqual(cab.summary.unlocked, tierSum);
cab.bestiary.forEach(b => assert.ok(b.listed >= 10 ? b.goldNote === '✅ Gold possible' : b.goldNote === '➕ Add ' + (10 - b.listed) + ' more'));
const dist = SL.distribution(MS);
assert.strictEqual(dist.total, MS.films.filter(f => f.rating !== null && f.rating !== undefined).length, 'one film, one vote');
assert.strictEqual(dist.tiers.reduce((s, x) => s + x.films.length, 0), dist.total);
assert.strictEqual(dist.scores.reduce((s, x) => s + x.films.length, 0), dist.total);
const dna = SL.dna(MS);
assert.ok(dna.rows.every(r => r.rated <= r.tracked && r.watched <= r.tracked));
assert.strictEqual(dna.status, 'EARLY DNA 🧪', 'under 25 rated is early DNA');
assert.ok(!dna.best || dna.best.rated >= 2, 'best list needs 2+ ratings');
const pp = SL.passport(MS);
assert.strictEqual(pp.countries.length, Object.keys(HQ.passport(MS).countries).length, 'passport countries match Logic');
assert.strictEqual(pp.decades.length, Object.keys(HQ.passport(MS).decades).length, 'passport decades match Logic');
const fb = SL.franchiseBoard(MS);
assert.ok(fb.watched <= fb.total);
// Burials stay separate from film status.
const victimFilm = MS.films.find(f => f.status === 'Not watched');
const bur = run(`apiSaveBurial({ film_id: ${JSON.stringify(victimFilm.id)}, cause_of_death: 'Boredom', interred_date: '2026-10-16' })`);
assert.ok(/^B\d{4}$/.test(bur.burial_id));
assert.strictEqual(bur.raw_film, victimFilm.key);
assert.strictEqual(run('apiBootstrap()').state[victimFilm.id][0], 'Not watched', 'burying never changes status');
const bur2 = run(`apiSaveBurial({ burial_id: ${JSON.stringify(bur.burial_id)}, film_id: ${JSON.stringify(victimFilm.id)}, cause_of_death: 'Death by vibes' })`);
assert.strictEqual(bur2.cause_of_death, 'Death by vibes');
const MB = HQ.build(run('apiBootstrap()'));
assert.strictEqual(SL.graveyard(MB).manual.length, (raw.burials || []).length + 1);
run(`apiDeleteBurial(${JSON.stringify(bur.burial_id)})`);
assert.strictEqual(run('apiBootstrap()').burials.length, (raw.burials || []).length);
assert.throws(() => run(`apiSaveBurial({})`), /Pick the film/);
// Awards.
const aw = run('apiBootstrap()').awards;
const winner = key('Evil Dead Burn (2026)');
if (aw.length) {
  const won = run(`apiSaveAward({ award_id: ${JSON.stringify(aw[0].award_id)}, label: ${JSON.stringify(aw[0].label)}, winner_film_id: ${JSON.stringify(winner.id)} })`);
  assert.strictEqual(won.raw_winner, winner.key);
  assert.strictEqual(String(won.award_rating), '10', 'records the rating at the moment it won');
  if (aw.length > 1) assert.throws(() => run(`apiSaveAward({ award_id: ${JSON.stringify(aw[0].award_id)}, label: ${JSON.stringify(aw[1].label)} })`), /already an award/);
}
const newAw = run(`apiSaveAward({ label: 'February favourite' })`);
assert.ok(/^AW\d\d$/.test(newAw.award_id) && newAw.raw_winner === '');
run(`apiDeleteAward(${JSON.stringify(newAw.award_id)})`);
assert.strictEqual(run('apiBootstrap()').awards.length, aw.length);

console.log(`OK: app layer: ${M.films.length} films loaded, headline avg ${h.avg}, ${audit.length} audited writes, bootstrap ${raw.loadMs}ms.`);
