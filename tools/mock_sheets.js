/**
 * Minimal in-memory stand-ins for SpreadsheetApp, Logger and friends so the
 * server code can be exercised with Node. Only the calls the code uses exist.
 */
'use strict';

function colToNum(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseA1(a1) {
  const m = a1.match(/^([A-Z]+)(\d+)$/);
  return { row: Number(m[2]), col: colToNum(m[1]) };
}

class MockRange {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
  _get(fmt) {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) {
        const v = (this.sheet.cells[this.row - 1 + r] || [])[this.col - 1 + c];
        line.push(v === undefined || v === null ? '' : fmt ? String(v) : v);
      }
      out.push(line);
    }
    return out;
  }
  getValues() { return this._get(false); }
  getDisplayValues() { return this._get(true); }
  getDisplayValue() { return this._get(true)[0][0]; }
  getValue() { return this._get(false)[0][0]; }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some(r => r.length !== this.nc)) {
      throw new Error(`setValues shape ${vals.length}x${vals[0] && vals[0].length} != range ${this.nr}x${this.nc}`);
    }
    vals.forEach((line, r) => line.forEach((v, c) => {
      const rr = this.row - 1 + r;
      this.sheet.cells[rr] = this.sheet.cells[rr] || [];
      this.sheet.cells[rr][this.col - 1 + c] = v;
    }));
    return this;
  }
  clearContent() { this.setValues(Array.from({ length: this.nr }, () => Array(this.nc).fill(''))); return this; }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setFontSize() { return this; }
}

class MockSheet {
  constructor(name, cells) { this.name = name; this.cells = cells || []; this.maxRows = Math.max(1000, this.cells.length); }
  getName() { return this.name; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const p = parseA1(a);
      return new MockRange(this, p.row, p.col, 1, 1);
    }
    return new MockRange(this, a, b, c || 1, d || 1);
  }
  getLastRow() {
    for (let i = this.cells.length - 1; i >= 0; i--) {
      if ((this.cells[i] || []).some(v => v !== '' && v !== undefined && v !== null)) return i + 1;
    }
    return 0;
  }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_after, n) { this.maxRows += n; }
  setFrozenRows() {}
  setColumnWidth() {}
  clear() { this.cells = []; }
  deleteRow(r) { this.cells.splice(r - 1, 1); }
}

class MockSpreadsheet {
  constructor(tabs) {
    this.sheets = Object.entries(tabs || {}).map(([n, cells]) => new MockSheet(n, cells));
  }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new MockSheet(n, []); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
}

function makeGlobals(spreadsheets) {
  const logs = [];
  const props = {};
  return {
    logs,
    SpreadsheetApp: { openById: id => { if (!spreadsheets[id]) throw new Error('No spreadsheet ' + id); return spreadsheets[id]; } },
    Logger: { log: m => logs.push(m) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) }
  };
}

module.exports = { MockSpreadsheet, MockSheet, makeGlobals };
