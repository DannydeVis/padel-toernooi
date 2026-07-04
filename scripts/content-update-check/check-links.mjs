// Verifies every local href referenced from the 8 homepages resolves to a real file on disk.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const files = ['index.html', 'en/index.html', 'de/index.html', 'es/index.html', 'fr/index.html', 'it/index.html', 'pt/index.html', 'sv/index.html'];

let ok = true;
for (const rel of files) {
  const html = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
  const hrefs = [...html.matchAll(/href="(\/[^"]*)"/g)].map(m => m[1]).filter(h => !h.startsWith('//'));
  let checked = 0;
  for (const href of hrefs) {
    const clean = href.split('#')[0].split('?')[0];
    if (!clean) continue;
    const target = clean.endsWith('/') ? clean + 'index.html' : clean;
    const full = path.join(repoRoot, target);
    checked++;
    if (!fs.existsSync(full)) {
      ok = false;
      console.error(`BROKEN ${rel} -> ${href}`);
    }
  }
  console.log(`OK   ${rel} (${checked} local hrefs checked)`);
}
process.exit(ok ? 0 : 1);
