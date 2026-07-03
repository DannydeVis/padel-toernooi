#!/usr/bin/env node
// i18n-consistentiecheck: elke key moet bestaan in elke taal die de app
// aanbiedt (SUPPORTED_LANGS in app/index.html), geen enkele mag ontbreken.
// Controleert ook dat {placeholders} per key in alle talen overeenkomen.
// Draaien: node scripts/test-i18n.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'app', 'index.html'), 'utf8');

const langsMatch = html.match(/const SUPPORTED_LANGS=\[([^\]]+)\]/);
const supported = langsMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''));

function extractObject(marker) {
  const start = html.indexOf(marker);
  if (start === -1) throw new Error(`${marker} niet gevonden`);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return html.slice(html.indexOf('{', start), i + 1); }
  }
  throw new Error(`${marker}: einde niet gevonden`);
}

const I18N = new Function('return ' + extractObject('const I18N='))();
const langs = Object.keys(I18N);

let failed = 0;
const report = [];

const missingLangs = supported.filter(l => !langs.includes(l));
if (missingLangs.length) { failed++; report.push(`SUPPORTED_LANGS zonder I18N-blok: ${missingLangs.join(', ')}`); }
const extraLangs = langs.filter(l => !supported.includes(l));
if (extraLangs.length) { failed++; report.push(`I18N-blok zonder SUPPORTED_LANGS: ${extraLangs.join(', ')}`); }

const allKeys = new Set();
for (const l of langs) Object.keys(I18N[l]).forEach(k => allKeys.add(k));

for (const l of langs) {
  const missing = [...allKeys].filter(k => !(k in I18N[l]));
  if (missing.length) {
    failed++;
    report.push(`${l}: ${missing.length} ontbrekende keys: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '…' : ''}`);
  }
}

// placeholders per key moeten in elke taal overeenkomen (basis: nl)
const ph = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
for (const k of allKeys) {
  const base = I18N.nl && k in I18N.nl ? ph(I18N.nl[k]) : null;
  if (base === null) continue;
  for (const l of langs) {
    if (!(k in I18N[l])) continue;
    if (ph(I18N[l][k]) !== base) {
      failed++;
      report.push(`placeholder-mismatch ${l}.${k}: "${ph(I18N[l][k])}" vs nl "${base}"`);
    }
  }
}

console.log(`talen: ${langs.join(', ')} (${allKeys.size} keys)`);
if (failed) { report.forEach(r => console.log('  FAIL -', r)); process.exit(1); }
console.log('test-i18n: alle keys aanwezig in alle talen, placeholders consistent');
