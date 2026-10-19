/**
 * Data-access layer over the database workbook. One tab per SCHEMA table,
 * header on row 1, all cells stored as text. Everything else in the app goes
 * through these functions so the storage could later move to a real database.
 */

var DB_MEMO_ = {};

function dbSheet_(table, create) {
  if (!SCHEMA[table]) throw new Error('Unknown table ' + table);
  var ss = dbSpreadsheet_();
  var sh = ss.getSheetByName(table);
  if (!sh && (create || LATE_TABLES_[table])) {
    sh = ss.insertSheet(table);
    var cols = schemaColumns_(table);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  if (!sh) throw new Error('Missing table tab ' + table + '. Run setupDatabase() first.');
  return sh;
}

/** Creates any missing table tabs and checks existing headers match the schema. */
function setupDatabase() {
  var ss = dbSpreadsheet_();
  Object.keys(SCHEMA).forEach(function (table) {
    var sh = dbSheet_(table, true);
    var cols = schemaColumns_(table);
    var header = sh.getRange(1, 1, 1, cols.length).getDisplayValues()[0];
    if (header.join('\u0001') !== cols.join('\u0001')) {
      throw new Error('Header mismatch in ' + table + ': ' + header.join(', '));
    }
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
  });
  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
}

function encodeCell_(value, type) {
  if (value === null || value === undefined) return '';
  switch (type) {
    case 'b': return value ? 'TRUE' : 'FALSE';
    case 'j': return value === '' ? '' : JSON.stringify(value);
    case 'n': return value === '' ? '' : String(value);
    default: return String(value);
  }
}

function decodeCell_(value, type) {
  var s = value === null || value === undefined ? '' : String(value);
  switch (type) {
    case 'n': return s === '' ? null : Number(s);
    case 'b': return s === 'TRUE';
    case 'j':
      if (s === '') return null;
      try { return JSON.parse(s); } catch (e) { return s; }
    default: return s;
  }
}

/** Reads a whole table as an array of objects. Memoised for the rest of this execution. */
function dbRead(table) {
  if (DB_MEMO_[table]) return DB_MEMO_[table];
  var sh = dbSheet_(table);
  var cols = schemaColumns_(table);
  var types = schemaTypes_(table);
  var last = sh.getLastRow();
  var rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, cols.length).getValues();
  var out = [];
  rows.forEach(function (r, i) {
    if (r.every(function (v) { return v === ''; })) return;
    var o = { _row: i + 2 };
    cols.forEach(function (c, j) { o[c] = decodeCell_(r[j], types[c]); });
    out.push(o);
  });
  DB_MEMO_[table] = out;
  return out;
}

/** Map of key -> record for a table. */
function dbIndex(table) {
  var key = SCHEMA[table].key;
  var idx = {};
  dbRead(table).forEach(function (r) { idx[r[key]] = r; });
  return idx;
}

function toRow_(table, obj) {
  var types = schemaTypes_(table);
  return schemaColumns_(table).map(function (c) { return encodeCell_(obj[c], types[c]); });
}

/** Replaces every data row in a table. Used by the migration only. */
function dbReplaceAll(table, objects) {
  var sh = dbSheet_(table, true);
  var cols = schemaColumns_(table);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, cols.length).clearContent();
  if (objects.length) {
    var needed = objects.length + 1;
    if (sh.getMaxRows() < needed) sh.insertRowsAfter(sh.getMaxRows(), needed - sh.getMaxRows());
    var range = sh.getRange(2, 1, objects.length, cols.length);
    range.setNumberFormat('@');
    range.setValues(objects.map(function (o) { return toRow_(table, o); }));
  }
  delete DB_MEMO_[table];
}

/** Appends records to a table. */
function dbAppend(table, objects) {
  if (!objects.length) return;
  var sh = dbSheet_(table);
  var cols = schemaColumns_(table);
  var start = sh.getLastRow() + 1;
  var range = sh.getRange(start, 1, objects.length, cols.length);
  range.setNumberFormat('@');
  range.setValues(objects.map(function (o) { return toRow_(table, o); }));
  delete DB_MEMO_[table];
}

/**
 * Updates existing records in place, matched on the table key. Only the rows
 * that change are written. Throws if a key is missing so nothing is silently dropped.
 */
function dbUpdate(table, objects) {
  if (!objects.length) return;
  var sh = dbSheet_(table);
  var cols = schemaColumns_(table);
  var key = SCHEMA[table].key;
  var idx = dbIndex(table);
  objects.forEach(function (o) {
    var existing = idx[o[key]];
    if (!existing) throw new Error(table + ': no record with ' + key + ' = ' + o[key]);
    var merged = {};
    cols.forEach(function (c) { merged[c] = Object.prototype.hasOwnProperty.call(o, c) ? o[c] : existing[c]; });
    sh.getRange(existing._row, 1, 1, cols.length).setValues([toRow_(table, merged)]);
  });
  delete DB_MEMO_[table];
}

function dbDelete(table, keys) {
  var idx = dbIndex(table);
  var sh = dbSheet_(table);
  var rows = keys.map(function (k) {
    if (!idx[k]) throw new Error(table + ': no record ' + k);
    return idx[k]._row;
  }).sort(function (a, b) { return b - a; });
  rows.forEach(function (r) { sh.deleteRow(r); });
  delete DB_MEMO_[table];
}

function dbClearMemo() {
  DB_MEMO_ = {};
}

function getSetting(key, fallback) {
  var rec = dbIndex('Settings')[key];
  return rec ? rec.value : fallback;
}

function setSetting(key, value) {
  var exists = !!dbIndex('Settings')[key];
  var rec = { key: key, value: value, modified_at: nowIso_() };
  if (exists) dbUpdate('Settings', [rec]); else dbAppend('Settings', [rec]);
}
