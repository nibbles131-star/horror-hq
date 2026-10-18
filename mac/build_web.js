/**
 * Builds mac/dist/index.html from the Apps Script app's own files, so the Mac app always shows
 * the same screens: the HTML includes are inlined, and every src/*.gs file is wrapped into one
 * makeServer_(globals) function that shim.js runs against the data file.
 * Usage: node mac/build_web.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const OUT = path.join(__dirname, 'dist');
const GLOBALS = ['SpreadsheetApp', 'PropertiesService', 'LockService', 'Session', 'Logger', 'Utilities', 'UrlFetchApp', 'ScriptApp'];

const gs = fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort();
const code = gs.map(f => `// ---- ${f}\n` + fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
const apis = [...new Set([...code.matchAll(/^function (api\w+)\s*\(/gm)].map(m => m[1]))];
const server = `function makeServer_(g) {\n` +
  `var ${GLOBALS.map(n => `${n} = g.${n}`).join(', ')};\n` +
  code +
  `\nreturn { ${apis.map(n => `${n}: ${n}`).join(', ')},\n` +
  `  __db: { CONFIG: CONFIG, SCHEMA: SCHEMA, schemaColumns_: schemaColumns_, schemaTypes_: schemaTypes_, encodeCell_: encodeCell_ } };\n}\n`;
if (/<\/script/i.test(server)) throw new Error('A .gs file contains </script>, which would break the page');

const read = n => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8');
const head = '<head>\n<style>' + fs.readFileSync(path.join(__dirname, 'mac.css'), 'utf8') + '</style>\n' +
  '<script>\n' + server + '</script>\n<script>\n' + fs.readFileSync(path.join(__dirname, 'shim.js'), 'utf8') + '</script>\n';
const page = read('Index').replace(/<\?!= include\('(\w+)'\) \?>/g, (_, n) => read(n));
if (/<\?/.test(page)) throw new Error('Unexpanded Apps Script template tag left in Index.html');
const html = page.replace('<head>', () => head);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(`Wrote mac/dist/index.html (${gs.length} server files, ${apis.length} server calls, ${Math.round(html.length / 1024)} KB)`);
