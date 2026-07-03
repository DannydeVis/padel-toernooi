// One-off verification script for the homepage rebuild.
// Usage: NODE_PATH=/opt/node22/lib/node_modules node scripts/homepage-rebuild/verify-homepage.mjs <locale> [locale...]
// Serves the repo root over http-server, screenshots mobile+desktop, and runs the demo functional test.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const screenshotDir = path.join(__dirname, 'screenshots');
const PORT = 8200 + Math.floor(Math.random() * 500);

const LOCALE_PATHS = { nl: '/', en: '/en/', de: '/de/', es: '/es/', fr: '/fr/', it: '/it/', pt: '/pt/', sv: '/sv/' };

async function startServer() {
  const proc = spawn('npx', ['--yes', 'http-server', repoRoot, '-p', String(PORT), '-s'], {
    stdio: 'pipe',
    env: { ...process.env, NODE_PATH: '/opt/node22/lib/node_modules' }
  });
  await new Promise((resolve, reject) => {
    let out = '';
    proc.stdout.on('data', d => { out += d; if (out.includes('Available on')) resolve(); });
    proc.stderr.on('data', d => { out += d; });
    proc.on('exit', code => reject(new Error('http-server exited early: ' + out)));
    setTimeout(resolve, 4000);
  });
  return proc;
}

async function run(locales) {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  try {
    for (const locale of locales) {
      const urlPath = LOCALE_PATHS[locale];
      if (!urlPath) { console.error('Unknown locale', locale); continue; }
      const url = `http://localhost:${PORT}${urlPath}`;
      const r = { locale, url, errors: [] };

      // mobile screenshot
      let ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: locale + '-' + locale.toUpperCase() });
      await ctx.addInitScript((l) => { try { localStorage.setItem('padel-lang', l); } catch (e) {} }, locale);
      let page = await ctx.newPage();
      page.on('pageerror', e => r.errors.push('pageerror: ' + e.message));
      page.on('console', msg => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        // Sandbox network policy blocks analytics/CDN domains outbound; not a real page bug.
        if (/googletagmanager|ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_RESET/.test(text)) return;
        r.errors.push('console: ' + text);
      });
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(screenshotDir, `${locale}-mobile.png`), fullPage: true });
      await ctx.close();

      // desktop screenshot
      ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: locale + '-' + locale.toUpperCase() });
      await ctx.addInitScript((l) => { try { localStorage.setItem('padel-lang', l); } catch (e) {} }, locale);
      page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(screenshotDir, `${locale}-desktop.png`), fullPage: true });

      // functional demo test
      const testNames = ['Anna', 'Bas', 'Carla', 'Dries', 'Eva', 'Finn', 'Gina', 'Hugo'];
      const input = page.locator('[data-demo-input]');
      await input.fill(testNames.join('\n'));
      await page.waitForTimeout(300);
      const courtCount = await page.locator('.demo-court').count();
      r.demoCourtCount = courtCount; // 8 players -> 2 courts in round 1
      const ctaHref = await page.locator('[data-demo-cta]').getAttribute('href');
      r.ctaHref = ctaHref;
      r.ctaHasNames = !!ctaHref && ctaHref.includes('names=') && testNames.every(n => ctaHref.includes(n));

      // follow the link into the app and confirm names load
      if (ctaHref) {
        const appUrl = `http://localhost:${PORT}${ctaHref}`;
        await page.goto(appUrl, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(500);
        const bodyText = await page.locator('body').innerText();
        r.appHasNames = testNames.every(n => bodyText.includes(n));
      }
      await ctx.close();
      results.push(r);
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter(r => r.errors.length || r.demoCourtCount !== 2 || !r.ctaHasNames || r.appHasNames === false);
  if (failed.length) {
    console.error('FAILED locales:', failed.map(f => f.locale).join(', '));
    process.exit(1);
  }
  console.log('All checks passed for:', locales.join(', '));
}

const locales = process.argv.slice(2);
if (!locales.length) { console.error('Usage: node verify-homepage.mjs <locale...>'); process.exit(1); }
run(locales);
