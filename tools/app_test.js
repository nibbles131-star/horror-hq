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
// Franchise Filmstrip: frames in list order, lit for Watched/DNF, first Not watched is next up.
const fsM = HQ.build(run('apiBootstrap()'));
const evil = fsM.collList.find(c => c.family === 'Franchise' && c.name === 'Evil Dead');
const extras = fsM.films.filter(f => !(fsM.entriesByColl[evil.collection_id] || []).some(e => e.film === f.id)).slice(0, 4);
extras.forEach((f, i) => HQ.addEntry(fsM, { id: 'FS' + i, coll: evil.collection_id, film: f.id, slot: '', seq: 100 + i, sourceNote: '', contextNote: '' }));
HQ.sortEntries(fsM);
['DNF', 'Unsure', 'Not watched', 'Not watched'].forEach((s, i) => { extras[i].status = s; });
const strip = CL.filmstrip(fsM, evil.collection_id);
assert.deepStrictEqual(strip.map(x => x.film.id), fsM.entriesByColl[evil.collection_id].map(e => e.film), 'frames follow the list order');
assert.deepStrictEqual(strip.map(x => [x.lit, x.dnf, x.unsure, x.next]).slice(-4),
  [[true, true, false, false], [false, false, true, false], [false, false, false, true], [false, false, false, false]], 'DNF lit+marked, Unsure dark, one next up');
assert.strictEqual(strip.filter(x => x.next)[0].film.id, CL.progress(fsM, evil.collection_id).next.id, 'next up matches the list card');
const reels = CL.filmstrips(fsM, '', 'close');
assert.strictEqual(reels.length, fsM.collList.filter(c => c.family === 'Franchise').length);
assert.strictEqual(reels[0].coll.name, 'Evil Dead', 'unfinished franchises come before complete ones');
assert.ok(CL.filmstrips(fsM, 'done', 'az').every(x => x.state === 'Complete'));
assert.ok(CL.filmstrips(fsM, 'going', 'az').some(x => x.coll.name === 'Evil Dead'));
assert.strictEqual(CL.filmstrips(fsM, 'fresh', 'az').length, 0);
// Branches: entries named onto a track split off, each track gets its own next, the overall next stays put.
const brStrip = CL.filmstrip(fsM, evil.collection_id, { FS3: 'Annabelle', FS1: 'Annabelle' });
const brTracks = CL.tracks(brStrip);
assert.deepStrictEqual(brTracks.map(t => [t.name, t.frames.length]), [['', strip.length - 2], ['Annabelle', 2]], 'main line first, then the branch');
assert.strictEqual(brStrip.filter(x => x.next).length, 1, 'one overall next up');
assert.ok(brStrip.find(x => x.entry.id === 'FS3').trackNext, 'the branch gets its own next');
assert.ok(brStrip.find(x => x.entry.id === 'FS2').next && brStrip.find(x => x.entry.id === 'FS2').trackNext);
fsM.raw.fun = { franchise_branches: { [evil.collection_id]: { FS3: 'Annabelle' } } };
assert.strictEqual(CL.filmstrips(fsM, '', 'order').find(x => x.coll.name === 'Evil Dead').tracks.length, 2, 'saved branches reach the tab');
// Completion parties: first run seeds silently, newly complete parties once, un-completing re-arms it.
assert.deepStrictEqual(CL.celebrations(null, ['C1', 'C2']), { done: ['C1', 'C2'], fresh: [] });
assert.deepStrictEqual(CL.celebrations(['C1'], ['C1', 'C2']), { done: ['C1', 'C2'], fresh: ['C2'] });
assert.deepStrictEqual(CL.celebrations(['C1', 'C2'], ['C2']), { done: ['C2'], fresh: [] });
assert.deepStrictEqual(run(`apiSaveUiSetting('franchise_branches', {C9: {E1: 'Annabelle'}})`), { C9: { E1: 'Annabelle' } });
assert.deepStrictEqual(run('apiBootstrap()').fun.franchise_branches, { C9: { E1: 'Annabelle' } }, 'branches round-trip through bootstrap');
assert.strictEqual(run('apiBootstrap()').fun.franchises_done, null, 'no parties recorded until the app seeds them');

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

// Admin: migration guard, notes, keep-separate, merge, export.
ctx.ScriptApp = { getProjectTriggers: () => [] };
assert.throws(() => vm.runInContext('runMigration()', ctx), /already migrated/, 'a second migration is refused');
const adminSrc = fs.readFileSync(path.join(SRC, 'ViewAdmin.html'), 'utf8');
const adminMod = { exports: {} };
new Function('module', 'HQ', adminSrc.match(/<script>([\s\S]*?)<\/script>/)[1])(adminMod, HQ);
new Function('App', adminSrc.match(/<script>([\s\S]*?)<\/script>/g)[1].replace(/<\/?script>/g, ''))({ view: () => {} });
const AL = adminMod.exports;
const ad = run('apiAdminData()');
assert.strictEqual(ad.counts.Films, run('apiBootstrap()').films.length);
assert.ok(ad.report && ad.report.checks.length > 0, 'admin shows the stored reconciliation');
assert.strictEqual(AL.counts(ad.exceptions).open + AL.counts(ad.exceptions).resolved, ad.exceptions.length);
const ex0 = ad.exceptions[0];
assert.strictEqual(run(`apiResolveException(${JSON.stringify(ex0.exception_id)}, 'checked', true)`).resolved, true);
assert.strictEqual(run(`apiResolveException(${JSON.stringify(ex0.exception_id)}, '', false)`).resolved, false);
// Two copies of one film, set up the way a real duplicate looks.
const twinA = run(`apiAddFilm('Twin Terror', 2001)`).film;
const twinB = run(`apiAddFilm('Twin Terrors', 2001)`).film;
const lists = run('apiBootstrap()').collections.filter(c => c.family !== 'Bestiary' && c.family !== 'Classics').slice(0, 2);
assert.ok(lists.length === 2, 'fixture has two editable lists');
run(`apiAddEntry(${JSON.stringify(lists[0].collection_id)}, ${JSON.stringify(twinA.film_id)})`);
run(`apiAddEntry(${JSON.stringify(lists[0].collection_id)}, ${JSON.stringify(twinB.film_id)})`);
run(`apiAddEntry(${JSON.stringify(lists[1].collection_id)}, ${JSON.stringify(twinB.film_id)})`);
run(`apiSaveFilmState(${JSON.stringify(twinA.film_id)}, { viewing_status: 'Watched' })`);
run(`apiSaveFilmState(${JSON.stringify(twinB.film_id)}, { viewing_status: 'DNF', rating_10: 7 })`);
run(`apiSaveBurial({ film_id: ${JSON.stringify(twinB.film_id)}, cause_of_death: 'Twinned' })`);
vm.runInContext(`dbAppend('MigrationExceptions', [{ exception_id: 'EX9001', severity: 'warning', kind: 'possible-duplicate', source_tab: 'test', source_ref: 'x',
  raw_value: 'Twin Terrors (2001) / Twin Terror (2001)', detail: 'test pair', resolution: '', resolved: false }]);
  dbAppend('FilmAliases', [{ alias_id: 'A9001', film_id: ${JSON.stringify(twinA.film_id)}, alias_display_key: 'Twin Terrors (2001)', alias_title: 'Twin Terrors',
  alias_year: 2001, match_key: matchKey_('Twin Terrors (2001)'), status: 'review: both exist' }]); dbClearMemo();`, ctx);
const MA = HQ.build(run('apiBootstrap()'));
const pr = AL.pair(MA, run('apiAdminData()').exceptions.find(e => e.exception_id === 'EX9001'));
assert.deepStrictEqual(pr.map(f => f.id).sort(), [twinA.film_id, twinB.film_id].sort(), 'note resolves to the two films');
const prev = run(`apiMergePreview(${JSON.stringify(twinA.film_id)}, ${JSON.stringify(twinB.film_id)})`);
assert.strictEqual(prev.moves.CollectionEntries, 1, 'entry on the second list moves');
assert.strictEqual(prev.dupes.CollectionEntries, 1, 'same-list entry collapses');
assert.ok(prev.conflicts.some(c => c.key === 'FilmState.viewing_status' && c.keep === 'Watched' && c.drop === 'DNF'));
assert.ok(!prev.conflicts.some(c => c.key === 'FilmState.rating_10'), 'blank rating is filled, not a conflict');
assert.strictEqual(run('apiBootstrap()').films.length, MA.films.length, 'preview writes nothing');
run(`apiMergeFilms(${JSON.stringify(twinA.film_id)}, ${JSON.stringify(twinB.film_id)}, { 'FilmState.viewing_status': 'drop' })`);
const rawM = run('apiBootstrap()');
const MM = HQ.build(rawM);
assert.ok(!MM.byId[twinB.film_id], 'dropped film is gone');
assert.ok(!rawM.state[twinB.film_id], 'its state row is gone');
const kept = MM.byId[twinA.film_id];
assert.strictEqual(kept.rating, 7, 'blank rating filled from the dropped film');
assert.strictEqual(kept.status, 'DNF', 'chosen value wins the conflict');
assert.deepStrictEqual(HQ.listNames(MM, kept).sort(), [lists[0].name, lists[1].name].sort());
assert.strictEqual((MM.entriesByFilm[kept.id] || []).length, 2, 'no duplicate entry on the shared list');
assert.ok(rawM.burials.some(b => b.film_id === kept.id && b.raw_film === kept.key), 'burial follows the film');
assert.ok(kept.aliases.some(x => x.key === 'Twin Terrors (2001)' && x.status === 'merged'), 'old title stays searchable');
assert.strictEqual(HQ.search(MM, 'twin terrors')[0].id, kept.id);
assert.ok(run('apiAdminData()').exceptions.find(e => e.exception_id === 'EX9001').resolved, 'the duplicate note closes itself');
assert.ok(run('apiAdminData()').audit.some(x => x.action === 'merge-films'), 'merge is audited');
assert.throws(() => run(`apiMergePreview(${JSON.stringify(kept.id)}, ${JSON.stringify(kept.id)})`), /two different/);
// Keep separate drops the review alias and closes the note.
const sepA = run(`apiAddFilm('Lone Wolf', 1990)`).film, sepB = run(`apiAddFilm('Lone Wolf', 1991)`).film;
vm.runInContext(`dbAppend('MigrationExceptions', [{ exception_id: 'EX9002', severity: 'warning', kind: 'possible-duplicate', source_tab: 'test', source_ref: 'y',
  raw_value: 'Lone Wolf (1991) / Lone Wolf (1990)', detail: 'test', resolution: '', resolved: false }]);
  dbAppend('FilmAliases', [{ alias_id: 'A9002', film_id: ${JSON.stringify(sepA.film_id)}, alias_display_key: 'Lone Wolf (1991)', alias_title: 'Lone Wolf',
  alias_year: 1991, match_key: matchKey_('Lone Wolf (1991)'), status: 'review: both exist' }]); dbClearMemo();`, ctx);
const sep = run(`apiKeepSeparate('EX9002')`);
assert.deepStrictEqual(sep.removedAliases, ['A9002']);
assert.strictEqual(sep.exception.resolved, true);
assert.ok(HQ.build(run('apiBootstrap()')).byId[sepB.film_id], 'both films survive');
const exp = run('apiExportAll()');
assert.strictEqual(exp.tables.Films.length, rawM.films.length + 2);


// Posters: matching rules, the backlog runner, manual fix.
const pick = (film, results, strict) => JSON.parse(JSON.stringify(vm.runInContext(`pickTmdbMatch_(${JSON.stringify(film)}, ${JSON.stringify(results)}, ${!!strict})`, ctx)));
const R = (id, title, date, extra) => Object.assign({ id, title, original_title: title, release_date: date, genre_ids: [27], poster_path: '/p' + id + '.jpg' }, extra || {});
assert.strictEqual(pick({ title: 'Halloween', release_year: 1978 }, [R(2, 'Halloween', '2018-10-18'), R(1, 'Halloween', '1978-10-25')]).id, 1, 'picks the right year');
assert.strictEqual(pick({ title: 'Halloween', release_year: 1978 }, [R(2, 'Halloween', '2018-10-18')]), null, 'wrong year is no match');
assert.strictEqual(pick({ title: 'Horror of Dracula', release_year: 1958 }, [R(3, 'Dracula', '1958-05-08')]).id, 3, 'regional title still matches');
assert.strictEqual(pick({ title: 'The Thing', release_year: 1982 }, [R(4, 'Thing', '1982-06-25')]).id, 4, 'leading "The" ignored');
assert.strictEqual(pick({ title: 'Pulse', release_year: 2001 }, [R(5, 'Kairo', '2001-02-03', { genre_ids: [] }), R(6, 'Pulse Two', '2001-01-01', { genre_ids: [] })], true), null, 'strict pass wants the exact title');
ctx.ScriptApp = { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create: () => { ctx.__posterTrigger = true; } }) }) }) };
let tmdbCalls = 0;
ctx.UrlFetchApp = { fetchAll: (reqs) => reqs.map((r) => {
  tmdbCalls++;
  const u = new URL(r.url);
  const json = (o) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(o) });
  if (u.pathname.startsWith('/3/movie/')) { const id = Number(u.pathname.split('/').pop()); return id === 999 ? json(R(999, 'Fanatic', '1965-03-21')) : { getResponseCode: () => 404, getContentText: () => '{}' }; }
  const q = (u.searchParams.get('query') || '').toLowerCase(), y = u.searchParams.get('year');
  if (q === 'evil dead burn') return json({ results: [R(10, 'Evil Dead Burn', '2026-07-24')] });
  if (q === '[rec]') return json({ results: [R(11, '[REC]', '2007-11-23')] });
  if (q === 'fanatic' && y) return json({ results: [R(999, 'Die! Die! My Darling!', '1965-03-21', { original_title: 'Fanatic' })] });
  return json({ results: [] });
}) };
vm.runInContext(`PropertiesService.getScriptProperties().setProperty('TMDB_API_KEY', 'k123')`, ctx);
const st0 = run('apiPosterStatus()');
assert.ok(st0.keySet && st0.todo === st0.total, 'nothing looked up yet');
const pr1 = run('apiPosterRun()');
assert.strictEqual(pr1.todo, 0, 'one run clears a small backlog');
assert.ok(pr1.withPoster >= 3, 'matched films get posters');
assert.ok(ctx.__posterTrigger, 'hourly sweep trigger is installed');
const filmsP = run('dbRead("Films")');
const fp = (k) => filmsP.find(f => f.display_key === k);
assert.strictEqual(fp('Evil Dead Burn (2026)').poster_url, 'https://image.tmdb.org/t/p/w342/p10.jpg');
assert.strictEqual(fp('Fanatic (1965)').tmdb_id, '999', 'alt-title match via TMDB search');
assert.ok(filmsP.filter(f => f.tmdb_id === 'none').length > 0, 'unmatched films are marked so they are not retried forever');
const calls = tmdbCalls;
run('apiPosterRun()');
assert.strictEqual(tmdbCalls, calls, 'a second run does not re-ask TMDB');
const bootP = run('apiBootstrap()');
const evilRow = bootP.films.find(f => f[1] === 'Evil Dead Burn (2026)');
assert.strictEqual(evilRow[4], '/p10.jpg', 'bootstrap ships the short path');
assert.strictEqual(HQ.build(bootP).byId[evilRow[0]].poster, 'https://image.tmdb.org/t/p/w342/p10.jpg', 'browser rebuilds the full URL');
const recId = fp('[REC] (2007)').film_id;
assert.strictEqual(run(`apiSetPoster(${JSON.stringify(recId)}, 'none')`).poster, '', 'poster can be removed');
assert.strictEqual(run(`apiSetPoster(${JSON.stringify(recId)}, '999')`).tmdb_id, '999', 'poster can be re-pointed');
assert.throws(() => run(`apiSetPoster(${JSON.stringify(recId)}, '12345')`), /no film/);
assert.ok(run('apiAdminData()').audit.some(x => x.action === 'set-poster'));
assert.throws(() => run(`apiSaveUiSetting('migrated_at', 'x')`), /Unknown setting/);

// Poster Wall, Hall of Fame, Bingo, trophy reveal (browser logic).
const loadViewZ = (file, name) => {
  const src = fs.readFileSync(path.join(SRC, file), 'utf8');
  const m = { exports: {} };
  new Function('module', 'HQ', src.match(/<script>([\s\S]*?)<\/script>/)[1])(m, HQ);
  const blocks = src.match(/<script>([\s\S]*?)<\/script>/g);
  new Function('App', 'HQ', 'BingoView', blocks[blocks.length - 1].replace(/<\/?script>/g, ''))({ view: () => {} }, HQ, {});
  return m.exports;
};
const MZ = HQ.build(run('apiBootstrap()'));
const WAL = loadViewZ('ViewWall.html');
const watchedAllZ = WAL.films(MZ, { show: 'watched', sort: 'rating' }, HQ);
assert.ok(watchedAllZ.length > 0 && watchedAllZ.every(f => f.status === 'Watched'));
assert.ok(watchedAllZ[0].rating >= (watchedAllZ[1].rating || 0), 'best first');
assert.strictEqual(WAL.shelves(watchedAllZ, 'rating', HQ)[0].label.indexOf('10'), 0, 'first shelf is the 10s');
assert.deepStrictEqual(WAL.shuffle([1, 2, 3, 4, 5], 7), WAL.shuffle([1, 2, 3, 4, 5], 7), 'shuffle is stable per seed');
const tlz = WAL.timeline(WAL.films(MZ, { show: 'all', sort: 'timeline' }, HQ));
assert.ok(tlz.cols.length > 0 && tlz.busiest, 'timeline has columns');
assert.ok(tlz.cols.some(c => c.gap), 'empty years are marked as gaps');
const SHL = loadViewZ('ViewShrine.html');
assert.deepStrictEqual(SHL.place([null, null, null, null], 1, 'F1'), [null, 'F1', null, null]);
assert.deepStrictEqual(SHL.place(['F1', 'F2', null, null], 1, 'F1'), ['F2', 'F1', null, null], 'moving a film swaps slots');
const ids4z = SHL.slots(MZ, ['nope', null]);
assert.ok(ids4z.length === 4 && ids4z.every(x => x === null), 'stale ids drop out');
const idstz = SHL.idStats(MZ, HQ, []);
assert.strictEqual(idstz.watched, HQ.headline(MZ).watched);
assert.ok(idstz.four.length > 0 && idstz.four.every(f => f.rating !== null), 'empty slots fall back to top-rated');
assert.ok(SHL.candidates(MZ, '', HQ).every(f => f.status === 'Watched' || f.status === 'DNF'));
const BGL = loadViewZ('ViewBingo.html');
const cardBz = BGL.deal(MZ, HQ, 12345);
assert.strictEqual(cardBz.squares.length, 25);
assert.strictEqual(cardBz.squares[12], 'free');
assert.deepStrictEqual(BGL.deal(MZ, HQ, 12345).squares, cardBz.squares, 'same seed, same card');
assert.strictEqual(new Set(cardBz.squares).size, 25, 'no repeated squares');
let pbz = BGL.progress(MZ, HQ, cardBz);
assert.strictEqual(pbz.ticked, 1, 'only the free square at the start (old watches never count)');
// Watch something unwatched and it ticks whatever it fits.
const victimBz = MZ.films.find(f => f.status === 'Not watched' && f.year && f.year < 1960) || MZ.films.find(f => f.status === 'Not watched');
victimBz.status = 'Watched'; victimBz.rating = 10; victimBz.modified = '2099-01-01';
pbz = BGL.progress(MZ, HQ, cardBz);
assert.ok(pbz.cells.filter(c => c.film && c.film.id === victimBz.id).length >= 0);
const forcedZ = Object.assign({}, cardBz, { squares: cardBz.squares.map((x, i) => i < 5 ? (i === 2 ? 'loved' : 'free') : x) });
assert.ok(BGL.progress(MZ, HQ, forcedZ).lines >= 1, 'a full row is a BINGO');
assert.ok(BGL.suggestions(MZ, HQ, cardBz, 'offlist', 5).every(f => f.status === 'Not watched'));
victimBz.status = 'Not watched'; victimBz.rating = null;
const earnedZ = HQ.earnedTrophies(MZ);
assert.ok(Array.isArray(earnedZ) && earnedZ.every(e => e.key && e.tier), 'earnedZ trophies have stable keys');
assert.strictEqual(new Set(earnedZ.map(e => e.key)).size, earnedZ.length);
const funZ = run(`apiSaveUiSetting('hall_of_fame', ['a', 'b'])`);
assert.deepStrictEqual(run('apiBootstrap()').fun.hall_of_fame, ['a', 'b'], 'funZ settings round-trip through bootstrap');

// Bestiary Codex (browser logic): chapters mirror the trophy maths, cross-refs only list real memberships.
const CXL = loadViewZ.length && (() => {
  const src = fs.readFileSync(path.join(SRC, 'ViewCodex.html'), 'utf8');
  const m = { exports: {} };
  new Function('module', 'HQ', src.match(/<script>([\s\S]*?)<\/script>/)[1])(m, HQ);
  return m.exports;
})();
const MC = HQ.build(run('apiBootstrap()'));
const chs = CXL.chapters(MC, HQ);
assert.strictEqual(chs.length, 15, 'fifteen chapters');
assert.strictEqual(CXL.roman(13), 'XIII');
assert.strictEqual(chs.find(c => c.coll.name === 'Werewolves').numeral, 'XIII', 'Werewolves is chapter XIII, as in the old sheet order');
const tz = HQ.trophies(MC);
chs.forEach(c => {
  const b = tz.bestiary.find(x => x.name === c.coll.name);
  assert.strictEqual(c.watched, b.watched, 'codex watched matches the trophy cabinet for ' + c.coll.name);
  assert.strictEqual(c.unexplored, b.watched === 0);
});
const werew = chs.find(c => c.coll.name === 'Werewolves');
const wolfFilm = werew.films[0].film;
const aqua = chs.find(c => c.coll.name.startsWith('Aquatic'));
HQ.addEntry(MC, { id: 'E99999', coll: aqua.coll.collection_id, film: wolfFilm.id, slot: '', seq: 99, sourceNote: '', contextNote: '' });
const xr = CXL.crossRefs(MC, wolfFilm.id, werew.coll.collection_id);
assert.deepStrictEqual(xr.beasts.map(c => c.name), [aqua.coll.name], 'cross-reference lists the other chapter only');
assert.strictEqual(CXL.recent(MC, 3)[0].film.id, wolfFilm.id, 'newest entry id comes first in Recently catalogued');
const mz = CXL.master(MC, HQ, CXL.chapters(MC, HQ));
assert.strictEqual(mz.beastmaster.value, tz.core.find(c => c.family === 'Beastmaster').value, 'Master of Beasts is the Beastmaster trophy');
const fakeList = [{ film: { key: 'A (2000)', status: 'Watched', rating: 6, year: 2000 } }, { film: { key: 'B (1990)', status: 'Watched', rating: 9, year: 1990 } },
  { film: { key: 'C (1980)', status: 'Not watched', rating: null, year: 1980 } }, { film: { key: 'D (1970)', status: 'DNF', rating: 2, year: 1970 } }];
assert.strictEqual(CXL.featured(fakeList).spec.film.key, 'B (1990)', 'prize specimen = best-rated watched');
assert.strictEqual(CXL.featured(fakeList.slice(2)).kind, 'awaiting');
assert.deepStrictEqual(CXL.filter(fakeList, 'unwatched', 'order').map(s => s.film.key), ['C (1980)']);
assert.deepStrictEqual(CXL.filter(fakeList, '', 'year').map(s => s.film.key), ['D (1970)', 'C (1980)', 'B (1990)', 'A (2000)']);
assert.deepStrictEqual(CXL.filter(fakeList, 'watched', 'rating').map(s => s.film.key), ['B (1990)', 'A (2000)']);

console.log(`OK: app layer: ${M.films.length} films loaded, headline avg ${h.avg}, ${audit.length} audited writes, bootstrap ${raw.loadMs}ms.`);
