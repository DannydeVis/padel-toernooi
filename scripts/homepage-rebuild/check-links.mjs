// Internal link check for the rebuilt homepages. No network calls: resolves
// root-relative hrefs against the filesystem.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['index.html', 'en/index.html', 'de/index.html', 'es/index.html', 'fr/index.html', 'it/index.html', 'pt/index.html', 'sv/index.html'];

function resolveLocal(href) {
  // strip query/hash
  const clean = href.split('#')[0].split('?')[0];
  if (!clean) return true; // pure hash link
  let p = path.join(repoRoot, clean);
  if (clean.endsWith('/')) p = path.join(p, 'index.html');
  if (fs.existsSync(p)) return true;
  if (fs.existsSync(p + '.html')) return true;
  return false;
}

let hasErrors = false;
for (const file of files) {
  const full = path.join(repoRoot, file);
  if (!fs.existsSync(full)) { console.log(`SKIP ${file} (not found)`); continue; }
  const html = fs.readFileSync(full, 'utf8');
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  const broken = [];
  for (const href of hrefs) {
    if (href.startsWith('http') || href.startsWith('mailto:')) continue; // external, skip
    if (href.startsWith('#')) continue;
    if (!href.startsWith('/')) continue; // relative anchors etc, skip
    if (!resolveLocal(href)) broken.push(href);
  }
  if (broken.length) {
    hasErrors = true;
    console.log(`FAIL ${file}: broken local links -> ${[...new Set(broken)].join(', ')}`);
  } else {
    console.log(`OK   ${file} (${hrefs.length} hrefs checked)`);
  }
}
process.exit(hasErrors ? 1 : 0);
