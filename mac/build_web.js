/**
 * Builds mac/dist/index.html from the Apps Script app's own files, so the Mac app always shows
 * the same screens: the HTML includes are inlined, and every src/*.gs file is wrapped into one
 * makeServer_(globals) function that shim-worker.js runs in a worker against the data file.
 * The one change to the web app's code: HQ.posterUrl hands TMDB images to the app's poster cache.
 * Usage: node mac/build_web.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const OUT = path.join(__dirname, 'dist');
const VERSION = 'mac-' + require('./package.json').version;
const GLOBALS = ['SpreadsheetApp', 'PropertiesService', 'LockService', 'Session', 'Logger', 'Utilities', 'UrlFetchApp', 'ScriptApp'];

const gs = fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort();
const code = gs.map(f => `// ---- ${f}\n` + fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
const apis = [...new Set([...code.matchAll(/^function (api\w+)\s*\(/gm)].map(m => m[1]))];
const server = `function makeServer_(g) {\n` +
  `var ${GLOBALS.map(n => `${n} = g.${n}`).join(', ')};\n` +
  code +
  `\nreturn { ${apis.map(n => `${n}: ${n}`).join(', ')},\n` +
  `  __db: { CONFIG: CONFIG, SCHEMA: SCHEMA, schemaColumns_: schemaColumns_, schemaTypes_: schemaTypes_, encodeCell_: encodeCell_, dbClearMemo: dbClearMemo } };\n}\n`;
if (/<\/script/i.test(server)) throw new Error('A .gs file contains </script>, which would break the page');

const local = n => fs.readFileSync(path.join(__dirname, n), 'utf8');
const workerSrc = server + local('shim-worker.js').replace('__VERSION__', VERSION);
if (/<\/script/i.test(workerSrc)) throw new Error('Worker code contains </script>, which would break the page');

const POSTER_FROM = "return p.charAt(0) === '/' ? 'https://image.tmdb.org/t/p/w342' + p : p;";
const POSTER_TO = "return HQMac.poster(p.charAt(0) === '/' ? 'https://image.tmdb.org/t/p/w342' + p : p);";
const read = n => {
  const text = fs.readFileSync(path.join(SRC, n + '.html'), 'utf8');
  if (n !== 'Logic') return text;
  if (!text.includes(POSTER_FROM)) throw new Error('HQ.posterUrl changed in Logic.html; update POSTER_FROM in build_web.js');
  return text.replace(POSTER_FROM, () => POSTER_TO);
};
const head = '<head>\n<style>' + local('mac.css') + '</style>\n' +
  '<script type="text/plain" id="hq-worker-src">\n' + workerSrc + '</script>\n' +
  '<script>\n' + local('shim.js') + '</script>\n';
const page = read('Index').replace(/<\?!= include\('(\w+)'\) \?>/g, (_, n) => read(n));
if (/<\?/.test(page)) throw new Error('Unexpanded Apps Script template tag left in Index.html');
const html = page.replace('<head>', () => head);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(`Wrote mac/dist/index.html, ${VERSION} (${gs.length} server files, ${apis.length} server calls, ${Math.round(html.length / 1024)} KB)`);
