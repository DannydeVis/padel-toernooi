// i18n structural parity check across the 8 homepage files:
// hreflang cluster, canonical correctness, JSON-LD @type set, footer href set,
// section ids, unique HTML ids, valid JSON-LD.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const LOCALES = {
  nl: 'index.html', en: 'en/index.html', de: 'de/index.html', es: 'es/index.html',
  fr: 'fr/index.html', it: 'it/index.html', pt: 'pt/index.html', sv: 'sv/index.html'
};
const EXPECTED_CANONICAL = {
  nl: 'https://padel-bracket.com/', en: 'https://padel-bracket.com/en/', de: 'https://padel-bracket.com/de/',
  es: 'https://padel-bracket.com/es/', fr: 'https://padel-bracket.com/fr/', it: 'https://padel-bracket.com/it/',
  pt: 'https://padel-bracket.com/pt/', sv: 'https://padel-bracket.com/sv/'
};
function extractLdBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => {
    try { return JSON.parse(m[1]); } catch (e) { return { __parseError: e.message }; }
  });
}

function originalJsonLd(rel) {
  try {
    const raw = execFileSync('git', ['show', `origin/main:${rel}`], { cwd: repoRoot, encoding: 'utf8' });
    return extractLdBlocks(raw);
  } catch (e) {
    return null; // file didn't exist on origin/main (shouldn't happen for these 8)
  }
}

const expectedHreflang = new Set([
  'nl:https://padel-bracket.com/', 'en:https://padel-bracket.com/en/', 'fr:https://padel-bracket.com/fr/',
  'de:https://padel-bracket.com/de/', 'es:https://padel-bracket.com/es/', 'it:https://padel-bracket.com/it/',
  'pt:https://padel-bracket.com/pt/', 'sv:https://padel-bracket.com/sv/', 'x-default:https://padel-bracket.com/en/'
]);

const EXPECTED_FOOTER_HREFS = new Set([
  '/app/', '/americano/', '/mexicano/', '/knockout/', '/round-robin/', '/king-of-the-court/',
  '/mixicano/', '/team-mexicano/', '/pickleball/', '/privacy/'
]);

const requested = process.argv.slice(2);
const locales = requested.length ? requested : Object.keys(LOCALES);

let hasErrors = false;
function fail(locale, msg) { hasErrors = true; console.log(`FAIL [${locale}] ${msg}`); }

for (const locale of locales) {
  const rel = LOCALES[locale];
  const full = path.join(repoRoot, rel);
  if (!fs.existsSync(full)) { console.log(`SKIP [${locale}] (${rel} not found)`); continue; }
  const html = fs.readFileSync(full, 'utf8');

  // canonical
  const canMatch = html.match(/<link rel="canonical" href="([^"]+)">/);
  if (!canMatch) fail(locale, 'missing canonical link');
  else if (canMatch[1] !== EXPECTED_CANONICAL[locale]) fail(locale, `canonical mismatch: ${canMatch[1]}`);

  // hreflang cluster
  const hreflangMatches = [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)];
  const found = new Set(hreflangMatches.map(m => `${m[1]}:${m[2]}`));
  if (found.size !== expectedHreflang.size || [...expectedHreflang].some(e => !found.has(e))) {
    fail(locale, `hreflang cluster mismatch (found ${found.size}/${expectedHreflang.size} expected entries)`);
  }

  // JSON-LD blocks: parse, then diff byte-for-byte (as parsed objects) against origin/main's original.
  const newBlocks = extractLdBlocks(html);
  for (const b of newBlocks) {
    if (b.__parseError) fail(locale, `JSON-LD block failed to parse: ${b.__parseError}`);
  }
  const origBlocks = originalJsonLd(rel);
  if (origBlocks) {
    const norm = (blocks) => blocks.map(b => JSON.stringify(b)).sort();
    const a = norm(origBlocks), b = norm(newBlocks);
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
      fail(locale, `JSON-LD content diverged from origin/main original (${origBlocks.length} blocks expected, ${newBlocks.length} found)`);
    }
  }

  // FAQPage: HTML .faq-item count should be >= visible check
  const faqItemCount = (html.match(/class="faq-item"/g) || []).length;
  if (faqItemCount < 1) fail(locale, 'no .faq-item elements found');
  // speakable selector: only required if the original file had it
  const origHadSpeakable = origBlocks && origBlocks.some(b => JSON.stringify(b).includes('.faq-item p'));
  if (origHadSpeakable && !html.includes('.faq-item p')) {
    fail(locale, 'speakable.cssSelector referencing .faq-item p was dropped');
  }

  // Footer hrefs
  const footerMatch = html.match(/<footer>([\s\S]*?)<\/footer>/);
  if (!footerMatch) { fail(locale, 'no <footer> found'); }
  else {
    const footerHrefs = new Set([...footerMatch[1].matchAll(/href="([^"]+)"/g)].map(m => m[1]).filter(h => !h.startsWith('http')));
    const missing = [...EXPECTED_FOOTER_HREFS].filter(h => !footerHrefs.has(h));
    if (missing.length) fail(locale, `footer missing expected hrefs: ${missing.join(', ')}`);
  }

  // Unique ids
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) {
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    fail(locale, `duplicate HTML ids: ${[...new Set(dupes)].join(', ')}`);
  }

  // Section ids present (new structure)
  for (const sectionId of ['formats', 'faq']) {
    if (!html.includes(`id="${sectionId}"`)) fail(locale, `missing section id="${sectionId}"`);
  }

  // Demo mount contract
  for (const attr of ['data-padel-demo', 'data-demo-input', 'data-demo-cta', 'data-demo-courts']) {
    if (!html.includes(attr)) fail(locale, `missing demo attribute ${attr}`);
  }

  if (!hasErrors || true) console.log(`checked [${locale}]`);
}

if (hasErrors) { console.log('\nPARITY CHECK FAILED'); process.exit(1); }
console.log('\nAll parity checks passed for:', locales.join(', '));
