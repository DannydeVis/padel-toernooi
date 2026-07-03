// Runs mobile Lighthouse against all 8 rebuilt homepages via a local static server.
// Usage: node scripts/homepage-rebuild/run-lighthouse.mjs
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const PORT = 8600 + Math.floor(Math.random() * 300);
const outDir = path.join(__dirname, 'lighthouse');
fs.mkdirSync(outDir, { recursive: true });

const LOCALE_PATHS = { nl: '/', en: '/en/', de: '/de/', es: '/es/', fr: '/fr/', it: '/it/', pt: '/pt/', sv: '/sv/' };

async function startServer() {
  const proc = spawn('npx', ['--yes', 'http-server', repoRoot, '-p', String(PORT), '-s'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 3500));
  return proc;
}

async function run() {
  const server = await startServer();
  const results = [];
  try {
    for (const [locale, urlPath] of Object.entries(LOCALE_PATHS)) {
      const url = `http://localhost:${PORT}${urlPath}`;
      const outFile = path.join(outDir, `${locale}.json`);
      const args = [
        '--yes', 'lighthouse', url,
        '--output=json', `--output-path=${outFile}`,
        '--chrome-flags=--headless=new --no-sandbox',
        '--preset=perf',
        '--form-factor=mobile',
        '--screenEmulation.mobile',
        '--throttling-method=simulate',
        '--only-categories=performance,accessibility,best-practices,seo',
        '--quiet'
      ];
      const r = spawnSync('npx', args, {
        env: { ...process.env, CHROME_PATH: '/opt/pw-browsers/chromium' },
        stdio: ['ignore', 'ignore', 'pipe']
      });
      if (r.status !== 0) {
        console.error(`Lighthouse failed for ${locale}:`, r.stderr?.toString().slice(-2000));
        results.push({ locale, error: true });
        continue;
      }
      const report = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      const cats = report.categories;
      results.push({
        locale,
        performance: Math.round(cats.performance.score * 100),
        accessibility: Math.round(cats.accessibility.score * 100),
        bestPractices: Math.round(cats['best-practices'].score * 100),
        seo: Math.round(cats.seo.score * 100)
      });
    }
  } finally {
    server.kill();
  }
  console.log('\nLighthouse mobile scores:');
  console.table(results);
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(results, null, 2));
}

run();
