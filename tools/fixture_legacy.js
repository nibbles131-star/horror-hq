/**
 * A tiny copy of the old workbook, built from real rows read on 16 Oct 2026.
 * Positions (row/column) match the live tabs so the migration's ranges are exercised.
 */
'use strict';

const blank = n => Array.from({ length: n }, () => []);

const ratingsLog = [
  ['HORROR RATINGS DASHBOARD', '', '', '', '', '', '', 'HORROR AWARDS'],
  ['Listed films watched', '4', 'Listed films rated', '2', 'DNFs', '0', '', 'Award', 'Winner', 'Rating'],
  ['Halloween progress', '0/2', 'Winter progress', '0/0', 'Tracked films', '8', '', 'September favourite', 'Evil Dead Burn (2026)', '10'],
  ['Average rating', '6.5/10', '', '', '', '', '', 'October favourite'],
  ['Rating key', '', '', '', '', '', '', 'November favourite'],
  ['', '', '', '', '', '', '', 'December favourite'],
  ['Enter Rating...', '', '', '', '', '', '', 'January favourite'],
  ['✅ All list films logged', '', '', '', '', '', '', 'Halloween winner'],
  ['Film', 'List / context', 'Rating', 'Verdict', 'Status', 'Notes / reaction', '', 'Winter winner'],
  ['[REC] (2007)', 'REC', '', '', 'Watched', '', '', 'Yearly List winner'],
  ['#Horror (2015)', 'Bubblegum & Cunt', '', '', 'Not watched', '', '', 'Biggest surprise 👀'],
  ['Evil Dead Burn (2026)', 'Evil Dead', '10', '👑 Obsession-tier', 'Watched', 'Peak', '', 'Biggest disappointment 💀'],
  ['Friday the 13th Part 2 (1981)', 'Friday the 13th', '3', '😬 Meh', 'Watched', ''],
  ['The Hallow (2015)', 'Halloween 2026', '', '', 'Not watched', ''],
  ['Werewolf Thing (2012)', 'Werewolves', '', '', 'Unsure', ''],
  ['Die Die Darling! (1965)', 'Hammer', '', '', 'Not watched', ''],
  ['Fanatic (1965)', 'Hammer', '', '', 'Watched', '']
];

const filmLibrary = [
  ['🎞️ FILM LIBRARY'], ['desc'],
  ['KNOWN FILMS', '', 'ON LISTS', 'SEEN', '', '', 'MAYBES', '', 'COUNTRY DATA'],
  ['11', '', '10', '5', '', '', '1', '', '10/11'],
  ['AUTO LIBRARY'],
  ['Film', 'Year', 'Viewing status', 'Lists / context', 'Rating', 'Library status', 'Exclusion reason', 'Country / countries', 'Known via', 'Notes / memory', '',
    'Film', 'Viewing status', 'Rating', 'Discovery status', 'Exclusion reason', 'Date added', 'Origin', 'Notes', 'Country (from Film Metadata)', 'Research source'],
  ['', '', '', '', '', '', '', '', '', '', '', 'Creature from the Black Lagoon (1954)', 'Not watched', '', '✅ Approved', '', '09 Sep 2026', 'Horror Excavator', 'EXC-20260909-001 • Bestiary Top-Up', 'United States', 'https://en.wikipedia.org/wiki/Creature_from_the_Black_Lagoon'],
  ['', '', '', '', '', '', '', '', '', '', '', 'Night Tide (1961)', 'Not watched', '', '👀 Maybe', '', '09 Sep 2026', 'Horror Excavator', 'perhaps better for yearly list 2?', 'United States', 'https://www.imdb.com/title/tt0055230/'],
  ['', '', '', '', '', '', '', '', '', '', '', 'Bite (2015)', 'Watched', '', '👁️ Seen / unlisted', '', '12 Sep 2026', 'Horror Excavator', 'EXC-20260912-006', 'Canada', '']
];

const metadata = [
  ['🌐 FILM METADATA', '', '', '', '', 'COUNTRY REGISTER • edit F:G', '', '', 'KNOWN ALIASES'],
  ['desc'],
  ['COUNTRY COVERAGE', '10/11', 'MISSING', '1'],
  ['Film', 'Year', 'Country / countries', 'Lookup status', 'Source', 'Film — edit register', 'Country / countries — edit here', '', 'Alternate title (include year)', 'Existing film title (include year)', 'Alias key'],
  ['', '', '', '', '', '[REC] (2007)', 'Spain', '', 'Hashtag Horror (2015)', '#Horror (2015)', 'hashtaghorror2015'],
  ['', '', '', '', '', '#Horror (2015)', 'United States', '', 'Fanatic (1965)', 'Die Die Darling! (1965)', 'fanatic1965'],
  ['', '', '', '', '', 'Evil Dead Burn (2026)', 'United States | New Zealand'],
  ['', '', '', '', '', 'Friday the 13th Part 2 (1981)', 'United States'],
  ['', '', '', '', '', 'The Hallow (2015)', 'Ireland | United Kingdom'],
  ['', '', '', '', '', 'Die Die Darling! (1965)', 'United Kingdom'],
  ['', '', '', '', '', 'Fanatic (1965)', 'United Kingdom'],
  ['', '', '', '', '', 'Creature from the Black Lagoon (1954)', 'United States'],
  ['', '', '', '', '', 'Night Tide (1961)', 'United States'],
  ['', '', '', '', '', 'Bite (2015)', 'Canada']
];

const agenda = [
  ['Date', 'Film', 'List / occasion', 'Context / note', 'Status'],
  ['15 Sep 2026', 'Friday the 13th Part 2 (1981)', 'Hooptober 2026 • September Extras', 'Hooptober criterion • Non-Halloween Hooptober film', 'Watched'],
  ['01 Oct 2026', 'The Hallow (2015)', 'Halloween Countdown 2026', 'Daily countdown', 'Not watched'],
  ['02 Oct 2026', 'Sweetheart (2019)', 'Halloween Countdown 2026', 'Daily countdown', 'Not watched']
];

const listIndex = [
  ['Season / event', 'Start watching', 'Anchor / end', 'Films', 'Planning note'],
  ['Halloween Countdown', '01 Oct 2026', '31 Oct 2026', '31', 'Daily, all month.'],
  ['Winter Horror Countdown', '01 Dec 2026', '01 Jan 2027', '32', 'Daily from 1 Dec through New Year\'s Day.']
];

const archiveHead = [['🗄️ DISCOVERY ARCHIVE'], ['desc'], ['CANDIDATES LOGGED', '', 'SEARCH BATCHES', '', '', 'PENDING', '', 'APPROVED', '', '', 'SEEN / UNLISTED', '', '', 'REJECTED'],
  ['3', '', '2', '', '', '0', '', '1', '', '', '1', '', '', '0'], ['APPEND-ONLY'],
  ['Search ID', 'Search date', 'Hunt / target', 'Slot / category / year', 'Search brief', 'Film', 'Why it fit', 'Research source(s)', 'Community / evidence note', 'Known before?', 'Decision', 'Decision reason', 'Decision date', 'Destination / result', 'Notes', 'Current state']];
const archive = archiveHead.concat([
  ['EXC-20260909-001', '09 Sep 2026', 'Bestiary Top-Up', 'Aquatic / Sirens / Merfolk', 'Fresh-only', 'Creature from the Black Lagoon (1954)', 'Gill-man', 'wiki', 'classic', 'No', '✅ Approved', '', '10 Sep 2026', 'Added to Aquatic', 'First run', '✅ Approved'],
  ['EXC-20260909-001', '09 Sep 2026', 'Bestiary Top-Up', 'Aquatic / Sirens / Merfolk', 'Fresh-only', 'Night Tide (1961)', 'Siren', 'imdb', 'moody', 'No', '👀 Maybe', 'perhaps better for yearly list 2?', '10 Sep 2026', 'Held', 'First run', '👀 Maybe'],
  ['EXC-20260912-006', '12 Sep 2026', 'Bestiary Top-Up', 'Mutants, Experiments & Monstrous Transformations', 'Second MEMT pass', 'Bite (2015)', 'Bite mutation', 'wiki', 'body horror', 'No', '👁️ Seen / unlisted', '', '12 Sep 2026', 'Seen / unlisted • Film Library', '', '👁️ Seen / unlisted']
]);

const excavator = [
  ['🔎 HORROR EXCAVATOR'], ['desc'], ['⛏️ BUILD THE HUNT'],
  ['Search type', 'Bestiary Top-Up', '', '', 'Destination', 'Horror Bestiary 👹', '', '', 'Wanted', '15', 'Search style', 'Deep excavation', '', '', 'Known-film policy', 'Fresh only • exclude every known/surfaced film'],
  ['Slot / year / category', 'Mutants, Experiments & Monstrous Transformations', '', '', '', '', '', '', 'Must include', 'Mutation', '', '', '', '', 'Avoid', 'Weak fits'],
  ['Brief', 'Second MEMT pass.'],
  ['ARNOLD REQUEST', 'TYPE: ...'],
  ['OPEN'], ['ACTIVE SEARCH'],
  ['EXC-20260912-006', '', '', '', '12 Sep 2026', '', '', '', '1', '', '', '', '0', '', '', '', '1'],
  ['APPROVAL VIEW'],
  ['Candidate #', 'Film', 'Year', 'Why it fits', 'Research source(s)', 'Community / evidence note', 'Known before?', 'Existing state', 'Decision', 'Decision reason', 'Destination / result', 'Library state now', 'Viewing state now', 'Lists / context now', 'Sync', 'Search ID', 'Search date', 'Hunt / target', 'Slot / category / year', 'Search brief'],
  ['1', 'Bite (2015)', '2015', 'Bite mutation', 'wiki', 'body horror', 'No', 'Not in library', '👁️ Seen / unlisted', '', 'Seen / unlisted • Film Library', '👁️ Seen / unlisted', 'Watched', '', '✅ Synced', 'EXC-20260912-006', '46277', 'Bestiary Top-Up', 'Mutants', 'Second MEMT pass']
];

const std = (title, rows) => [[title], ['desc'], ['List', 'Slot', 'Film', 'Status', 'Rating', 'Notes / reaction', 'Source note']].concat(rows);

const tabs = {
  'Ratings Log ⭐': ratingsLog,
  'Film Library 🎞️': filmLibrary,
  'Film Metadata 🌐': metadata,
  'Watch Agenda 🎬': agenda,
  'List Index 🗂️': listIndex,
  'Discovery Archive 🗄️': archive,
  'Horror Excavator 🔎': excavator,
  'Graveyard 🪦': [['🪦 THE GRAVEYARD'], ['desc'], [], ['AUTO', '', '', '', '', 'MANUAL'], ['Film', 'List / context', 'Rating', 'Cause of death', '', 'Film', 'Context', 'Cause of death', 'Date interred', 'Notes'], ['No corpses yet']],
  'Challenge Builder 🎃': [['🎃 CHALLENGE BUILDER'], ['desc'], ['CHALLENGE NAME', 'New Challenge'], ['desc'], [], ['Criterion', 'Required', 'Covered', 'Status', '', 'Criterion', 'Film', 'Film status', 'Notes / fit', 'Check'], ['', '1'], ['', '1']],
  'Ratings Archive 🗃️': [['Film', 'List / context', 'Rating', 'Status', 'Notes / reaction'], ['Evil Dead Burn (2026)', 'Evil Dead', '9/10', 'Watched', 'old note']],
  'List Legacy 🧾': [['Group', 'List', 'Slot', 'Film', 'Status', 'Rating', 'Notes / reaction', 'Source note', 'Key'], ['Yearly', 'Yearly Main', '1960', 'Psycho (1960)', 'Watched', '5', '', 'Marked seen', 'Yearly Main♦1960♦Psycho (1960)']],
  'Achievements 🏆': blank(8).concat([
    ['Horror Devotee', 'Films watched', '6', 'Fresh Meat • 25', '', 'Genre Addict • 100', '', 'Horror Devotee • 250'],
    ['The Critic', 'Films rated', '2', 'First Review • 10', '', 'Opinionated • 50', '', 'Everybody\'s A Critic • 100'],
    ['Taste Maker', '🖤 / 👑 verdicts', '1', 'Love at First Fright • 1', '', 'Sicko Certified • 10', '', 'Personal Pantheon • 25'],
    ['Passport Control', 'Countries watched', '4', 'First Stamp • 5', '', 'Frequent Flyer • 15', '', 'Passport Control • 30'],
    ['Time Traveller', 'Decades watched', '4', 'Decade Hopper • 3', '', 'Time Traveller • 6', '', 'Century of Screams • 10'],
    ['Franchise Fiend', 'Franchise entries watched', '2', 'Sequel Curious • 10', '', 'Franchise Fiend • 50', '', 'Completionist Brain • 100'],
    ['Beastmaster', 'Unique Bestiary films watched', '0', 'First Contact • 5', '', 'Creature Collector • 25', '', 'Beastmaster • 50']
  ]).concat(blank(6)).concat([
    ['Aliens', '0', '0'], ['Aquatic / Sirens / Merfolk', '0', '1'], ['Cosmic & Eldritch Entities', '0', '0'], ['Cryptids & Humanoid Monsters', '0', '0'],
    ['Curses & Supernatural Entities', '0', '0'], ['Demons & Devils', '0', '0'], ['Dolls, Puppets & Possessed Objects', '0', '0'], ['Folkloric Entities', '0', '0'],
    ['Ghosts & Hauntings', '0', '0'], ['Killer Animals & Nature Attacks', '0', '0'], ['Mutants, Experiments & Monstrous Transformations', '0', '0'],
    ['Vampires', '0', '0'], ['Werewolves', '0', '1'], ['Witches', '0', '0'], ['Zombies & Infected', '0', '0']
  ]),
  'Horror HQ 🏠': blank(24).concat([['💀 Nope', '', '', '0', '', '', '', '36%', '', '', '3 / 3', '', '2']]),
  'Horror Passport 🌍': [['🌍'], ['desc'], ['WATCHED FILMS', '5', 'YEAR STAMPS', '', '5', 'DECADES VISITED', '5', 'COUNTRIES LOGGED', '5']],
  'Yearly List 📆': std('📅 YEARLY LIST', []),
  'Seasonal & Countdowns 🎃': std('🎃', [['Halloween 2026', 'Oct 1', 'The Hallow (2015)', 'Not watched'], ['Halloween 2026', 'Oct 2', 'Sweetheart (2019)', 'Not watched']]),
  'Curated Lists 🩸': std('🩸', []),
  'Classic Studios 🦇': std('🦇', [['Hammer', '1', 'Die Die Darling! (1965)', 'Not watched'], ['Hammer', '2', 'Fanatic (1965)', 'Not watched']]),
  'Horror Bestiary 👹': std('👹', [['Werewolves', '1', 'Werewolf Thing (2012)', 'Unsure'], ['Aquatic / Sirens / Merfolk', '1', 'Creature from the Black Lagoon (1954)', 'Not watched']]),
  'Franchise Tracker 🔪': std('🔪', [['Evil Dead', '6', 'Evil Dead Burn (2026)', 'Watched', '10'], ['Friday the 13th', '2', 'Friday the 13th Part 2 (1981)', 'Watched', '3'], ['REC', '1', '[REC] (2007)', 'Watched']]),
  'Alphabet List 🔤': [[], [], ['Letter', 'Film', 'Status', 'Rating', 'Notes / reaction', 'Source note']],
  'Bubblegum & Cunt 🫧': [[], [], ['Slot', 'Film', 'Status', 'Rating', 'Notes', 'Cuntometer'], ['1', '#Horror (2015)', 'Not watched', '', '', '4']]
};

module.exports = { tabs };
