import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const PORT = 8321;
const LOCALE_PATHS = { nl: '/', en: '/en/', de: '/de/', es: '/es/', fr: '/fr/', it: '/it/', pt: '/pt/', sv: '/sv/' };

async function startServer() {
  const proc = spawn('npx', ['--yes', 'http-server', repoRoot, '-p', String(PORT), '-s'], { stdio: 'pipe' });
  await new Promise(resolve => setTimeout(resolve, 3000));
  return proc;
}

async function run(locales) {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  try {
    for (const locale of locales) {
      const urlPath = LOCALE_PATHS[locale];
      const url = `http://localhost:${PORT}${urlPath}`;
      const r = { locale, errors: [] };
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: locale + '-' + locale.toUpperCase() });
      await ctx.addInitScript((l) => { try { localStorage.setItem('padel-lang', l); } catch (e) {} }, locale);
      const page = await ctx.newPage();
      page.on('pageerror', e => r.errors.push('pageerror: ' + e.message));
      page.on('console', msg => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (/googletagmanager|ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_RESET|api\.qrserver/.test(text)) return;
        r.errors.push('console: ' + text);
      });
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(400);
      await page.evaluate(() => document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible')));
      await page.screenshot({ path: path.join(__dirname, 'screenshots', `${locale}-mobile.png`), fullPage: true });
      await ctx.close();

      const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: locale + '-' + locale.toUpperCase() });
      await ctx2.addInitScript((l) => { try { localStorage.setItem('padel-lang', l); } catch (e) {} }, locale);
      const page2 = await ctx2.newPage();
      await page2.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page2.waitForTimeout(400);
      await page2.evaluate(() => document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible')));
      await page2.screenshot({ path: path.join(__dirname, 'screenshots', `${locale}-desktop.png`), fullPage: true });
      await ctx2.close();
      results.push(r);
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter(r => r.errors.length);
  if (failed.length) { console.error('ERRORS on:', failed.map(f => f.locale)); process.exit(1); }
  console.log('OK:', locales.join(', '));
}

const locales = process.argv.slice(2);
run(locales.length ? locales : ['nl']);
