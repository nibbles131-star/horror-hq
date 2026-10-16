/** Small pure helpers shared by the server code. Kept free of Sheets calls so they are easy to test. */

var MONTHS_ = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function nowIso_() {
  return new Date().toISOString();
}

function pad_(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

function isoDate_(y, m, d) {
  return y + '-' + pad_(m + 1, 2) + '-' + pad_(d, 2);
}

/**
 * Parses the date shapes the old workbook uses into yyyy-MM-dd:
 * "09 Sep 2026", "2026-09-09", Sheets serial numbers (46277), Date objects.
 * Returns '' when the value is blank or unrecognisable (callers log the raw value).
 */
function parseDate_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return isoDate_(value.getFullYear(), value.getMonth(), value.getDate());
  }
  var s = String(value).trim();
  var m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (m && MONTHS_[m[2].toLowerCase()] !== undefined) {
    return isoDate_(Number(m[3]), MONTHS_[m[2].toLowerCase()], Number(m[1]));
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // UK style dd/mm/yyyy
  if (m) return isoDate_(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    var serial = Math.floor(Number(s));
    if (serial > 20000 && serial < 80000) {
      var ms = Date.UTC(1899, 11, 30) + serial * 86400000;
      var d = new Date(ms);
      return isoDate_(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
  }
  return '';
}

/** "Title (YYYY)" -> {title, year}. Year is null when the key has no clean trailing (YYYY). */
function parseFilmKey_(key) {
  var s = String(key || '').trim();
  var m = s.match(/^(.*\S)\s*\((\d{4})\)\s*$/);
  if (!m) return { title: s, year: null };
  return { title: m[1], year: Number(m[2]) };
}

/**
 * Normalised matching key, compatible with the old workbook's alias keys
 * ("[REC] (2007)" -> "rec2007", "Hashtag Horror (2015)" -> "hashtaghorror2015").
 */
function matchKey_(key) {
  return String(key || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Leading number of a rating cell ("7", "7/10", "5.") or null. */
function parseRating_(value) {
  if (value === null || value === undefined) return null;
  var m = String(value).trim().match(/^(\d+(?:\.\d+)?)/);
  if (!m) return null;
  var n = Number(m[1]);
  return isNaN(n) ? null : n;
}

/** Verdict band for a /10 rating, identical to the old Ratings Log formula. */
function verdictFor_(rating) {
  if (rating === null || rating === undefined || rating === '') return '';
  var n = Number(rating);
  if (isNaN(n)) return '';
  if (n >= 10) return '👑 Obsession-tier';
  if (n >= 9) return '🖤 Loved';
  if (n >= 7) return '🔥 Great';
  if (n >= 5) return '👍 Good';
  if (n >= 3) return '😬 Meh';
  return '💀 Nope';
}

function decadeOf_(year) {
  if (!year) return '';
  return (Math.floor(Number(year) / 10) * 10) + 's';
}

/** Splits "United States | Germany" into trimmed parts. */
function splitPipes_(value) {
  return String(value || '').split('|').map(function (x) { return x.trim(); }).filter(String);
}

/** Sequential id generator: makeIdGen_('F', 5)() -> F00001, F00002... */
function makeIdGen_(prefix, width, start) {
  var n = start || 0;
  return function () {
    n += 1;
    return prefix + pad_(n, width);
  };
}

function slug_(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function isBlank_(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

// Exported for the Node test harness; harmless in Apps Script.
if (typeof module !== 'undefined') {
  module.exports = { parseDate_: parseDate_, parseFilmKey_: parseFilmKey_, matchKey_: matchKey_,
    parseRating_: parseRating_, verdictFor_: verdictFor_, decadeOf_: decadeOf_, splitPipes_: splitPipes_,
    makeIdGen_: makeIdGen_, slug_: slug_ };
}
