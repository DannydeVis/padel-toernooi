// Applies two small, content-neutral fixes found by Lighthouse across all 8 homepages:
// 1) wrap primary content in a <main> landmark
// 2) give the comparison table's row-label cells proper <th scope="row"> headers
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const files = ['index.html', 'en/index.html', 'de/index.html', 'es/index.html', 'fr/index.html', 'it/index.html', 'pt/index.html', 'sv/index.html'];

for (const rel of files) {
  const full = path.join(repoRoot, rel);
  let html = fs.readFileSync(full, 'utf8');
  const before = html;

  // 1) <main> landmark: wrap hero...cta-wrap section (everything before <footer>)
  html = html.replace('<section class="hero">', '<main>\n<section class="hero">');
  html = html.replace(/(<\/section>\s*\n\n<footer>)/, '</section>\n</main>\n\n<footer>');

  // 2) table row headers: first <td> in each compare row -> <th scope="row">
  html = html.replace(
    /<thead>\s*\n\s*<tr><th>&nbsp;<\/th><th>([^<]+)<\/th><th>([^<]+)<\/th><\/tr>/,
    '<thead>\n          <tr><th scope="col">&nbsp;</th><th scope="col">$1</th><th scope="col">$2</th></tr>'
  );
  html = html.replace(/<tr><td>([^<]+)<\/td>/g, '<tr><th scope="row">$1</th>');

  if (html !== before) {
    fs.writeFileSync(full, html);
    console.log('patched', rel);
  } else {
    console.log('NO CHANGE (check patterns)', rel);
  }
}
