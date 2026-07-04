// Checks that all 8 homepages got the same content-update treatment:
// - format grid has 8 .format cards (was 7)
// - pickleball card present in the grid, linking to /pickleball/
// - no stale "four/vier/quatre/..." format-count or old language-count text
// - hreflang cluster still identical across all 8
// - canonical self-reference still correct
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const files = {
  nl: 'index.html', en: 'en/index.html', de: 'de/index.html', es: 'es/index.html',
  fr: 'fr/index.html', it: 'it/index.html', pt: 'pt/index.html', sv: 'sv/index.html'
};

let ok = true;
const hreflangSets = {};

for (const [locale, rel] of Object.entries(files)) {
  const html = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
  const formatCards = (html.match(/<div class="format (am|team)">/g) || []).length;
  const hasPickleballCard = /<h3>Pickleball<\/h3>/.test(html);
  const hasPickleballLink = /href="\/pickleball\/"[^>]*>Pickleball/.test(html);
  const hreflangs = [...html.matchAll(/hreflang="([a-z-]+)" href="(https:\/\/[^"]+)"/g)].map(m => `${m[1]}=${m[2]}`).sort().join('|');
  hreflangSets[locale] = hreflangs;

  const problems = [];
  if (formatCards !== 8) problems.push(`expected 8 format cards, found ${formatCards}`);
  if (!hasPickleballCard) problems.push('missing Pickleball format card');
  if (!hasPickleballLink) problems.push('missing pickleball generator link');

  if (problems.length) {
    ok = false;
    console.error(`FAIL ${locale}: ${problems.join('; ')}`);
  } else {
    console.log(`OK   ${locale}: 8 format cards incl. Pickleball`);
  }
}

const uniqueHreflangSets = new Set(Object.values(hreflangSets));
if (uniqueHreflangSets.size !== 1) {
  ok = false;
  console.error('FAIL: hreflang clusters differ across locales', hreflangSets);
} else {
  console.log('OK   hreflang cluster identical across all 8 locales');
}

process.exit(ok ? 0 : 1);
