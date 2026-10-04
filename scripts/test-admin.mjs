#!/usr/bin/env node
// Browsertest voor de beheerpagina (/admin/): inloggen met Google of een
// mailcode in plaats van de service_role key, "geen toegang" voor een gewoon
// account, "nog niet ingericht" zonder admin_migration.sql, en het overzicht
// met de nieuwe accounts.
//
// Zelfde opzet als scripts/test-account.mjs: supabase-js is vervangen door
// scripts/fake-supabase.js, de server staat hieronder. Of de database echt
// alleen de beheerder binnenlaat, controleert supabase/tests/admin.test.sql
// tegen PostgreSQL; hier gaat het om wat de pagina ermee doet.
//
// Draaien: node scripts/test-admin.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE = fs.readFileSync(path.join(root, 'scripts', 'fake-supabase.js'), 'utf8');
const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
const ADMIN = 'devisser.danny@gmail.com';

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ok   -', msg); }
  else { failed++; console.log('  FAIL -', msg); }
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;

// ── Nagebootste server ──
const now = Date.now();
const iso = ms => new Date(ms).toISOString();
const db = {
  users: new Map(), otps: new Map(), codes: new Map(), googleEmail: null,
  notSetUp: false, calls: [],
};
let nextId = 1;
function addUser(email, provider, createdMs) {
  const u = { id: `00000000-0000-0000-0000-${String(nextId++).padStart(12, '0')}`, email, providers: [provider], created_at: iso(createdMs ?? now) };
  db.users.set(u.id, u); return u;
}
const findUser = email => [...db.users.values()].find(u => u.email === email);
addUser(ADMIN, 'google', now - 90 * 864e5);
addUser('nieuw@example.com', 'email', now - 3600e3);
addUser('<img src=x onerror=alert(1)>@x.nl', 'email', now - 2 * 864e5);
addUser('oud@example.com', 'google', now - 20 * 864e5);

function dashboard() {
  const day = ms => new Date(ms).toISOString().slice(0, 10);
  const days = n => Array.from({ length: n }, (_, i) => day(now - (n - 1 - i) * 864e5));
  const accts = [...db.users.values()];
  return {
    starts_total: 120, starts_today: 3, starts_week: 17, shared_total: 40,
    dur_avg_min: 84, dur_real: 60, dur_test: 12,
    recent: [{ mode: 'americano', players: 8, when: iso(now), seconds: 5400 }, { mode: '<b>x</b>', players: null, when: iso(now), seconds: null }],
    modes: { americano: 70, mexicano: 30, team: 20 },
    daily: days(14).map((d, i) => ({ day: d, n: i % 3 })),
    players: { 8: 50, 12: 20 },
    mode_avg: { americano: 9.5, mexicano: 8 },
    accounts_total: accts.length,
    accounts_today: accts.filter(a => day(Date.parse(a.created_at)) === day(now)).length,
    accounts_week: accts.filter(a => Date.parse(a.created_at) > now - 7 * 864e5).length,
    accounts_google: accts.filter(a => a.providers.includes('google')).length,
    accounts_mail: accts.filter(a => a.providers.includes('email')).length,
    accounts_daily: days(30).map(d => ({ day: d, n: accts.filter(a => day(Date.parse(a.created_at)) === d).length })),
  };
}
function accounts() {
  return [...db.users.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(u => ({
    id: u.id, email: u.email, providers: u.providers, created_at: u.created_at, last_sign_in_at: u.created_at,
    groups: u.email === 'nieuw@example.com' ? 2 : 0, comps: 0, has_live: u.email === 'nieuw@example.com', has_cc: false, has_signup: false,
    last_sync: u.email === 'nieuw@example.com' ? iso(now) : null,
  }));
}

async function handle(route) {
  const url = new URL(route.request().url());
  const body = route.request().postData() ? JSON.parse(route.request().postData()) : {};
  const p = url.pathname.replace('/__fake-supabase', '');
  db.calls.push(p);
  const reply = (status, json) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
  const me = body.uid ? db.users.get(body.uid) : null;
  switch (p) {
    case '/otp':
      if (!findUser(body.email) && !body.shouldCreateUser) return reply(400, { error: { message: 'Signups not allowed for otp', code: 'otp_disabled' } });
      db.otps.set(body.email, '123456'); return reply(200, {});
    case '/verify':
      if (db.otps.get(body.email) !== body.token) return reply(400, { error: { message: 'Token has expired or is invalid', code: 'otp_expired' } });
      return reply(200, { user: { ...(findUser(body.email) || addUser(body.email, 'email')) } });
    case '/oauth': {
      db.lastOAuth = body;
      const long = 'goog' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      db.codes.set(long, { email: db.googleEmail, verifier: body.verifier });
      return reply(200, { url: body.redirectTo + '?code=' + long });
    }
    case '/exchange': {
      const c = db.codes.get(body.code);
      if (!c || c.verifier !== body.verifier) return reply(400, { error: { message: 'invalid flow state', code: 'bad_code_verifier' } });
      return reply(200, { user: { ...(findUser(c.email) || addUser(c.email, 'google')) } });
    }
  }
  if (p.startsWith('/rpc/')) {
    if (db.notSetUp) return reply(404, { error: { code: 'PGRST202', message: 'Could not find the function public.' + p.slice(5) + ' without parameters in the schema cache' } });
    if (!me) return reply(401, { error: { code: '42501', message: 'not_signed_in' } });
    const admin = me.email.toLowerCase() === ADMIN;
    if (p === '/rpc/is_admin') return reply(200, { data: admin });
    if (!admin) return reply(403, { error: { code: '42501', message: 'not_admin' } });
    if (p === '/rpc/admin_dashboard') return reply(200, { data: dashboard() });
    if (p === '/rpc/admin_accounts') return reply(200, { data: accounts() });
  }
  if (p === '/from') return reply(200, { data: null });
  return reply(404, { error: { message: 'onbekend pad ' + p } });
}

const browser = await chromium.launch();
async function device(name, { width = 390 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
  await ctx.route(SUPABASE_CDN, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE }));
  await ctx.route('**/__fake-supabase/**', handle);
  await ctx.route(/^https:\/\/(?!cdn\.jsdelivr\.net\/npm\/@supabase)/, r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('dialog', d => { errors.push(`${name}: dialog ${d.message()}`); d.dismiss(); });
  return { ctx, page, errors };
}

const allErrors = [];
try {
  // ── Niet ingelogd ──
  console.log('\nInloggen');
  const A = await device('A');
  allErrors.push(A.errors);
  await A.page.addInitScript(() => { if (!sessionStorage.getItem('gezet')) { localStorage.setItem('padel-admin-key', 'eyJ-oude-service-role-key'); sessionStorage.setItem('gezet', '1'); } });
  await A.page.goto(BASE + '/admin/');
  await A.page.waitForSelector('#g-btn');
  ok(!(await A.page.isVisible('#key-input')), 'geen veld meer om de service_role key in te plakken');
  ok((await A.page.evaluate(() => localStorage.getItem('padel-admin-key'))) === null, 'een achtergebleven service_role key wordt uit de browser gehaald');
  ok(await A.page.locator('#g-btn svg path[fill="#4285F4"], #g-btn svg path[fill="#1976D2"]').count() === 1, 'inloggen met Google, met het echte logo');
  ok(!(await A.page.isVisible('#dashboard')), 'zonder inloggen geen cijfers');

  // Mailcode voor een onbekend adres: geen nieuw account
  await A.page.click('summary');
  await A.page.fill('#mail-in', 'vreemde@example.com');
  await A.page.click('#mail-btn');
  await A.page.waitForSelector('.gate-err:not(:empty)');
  ok(!findUser('vreemde@example.com'), 'een onbekend adres krijgt via het beheer geen account');

  // ── Een gewoon account ──
  console.log('\nEen gewoon account');
  db.googleEmail = 'oud@example.com';
  await Promise.all([A.page.waitForURL(/[?&]code=/), A.page.click('#g-btn')]);
  ok(db.lastOAuth && db.lastOAuth.queryParams && db.lastOAuth.queryParams.prompt === 'select_account', 'Google vraagt altijd welk account');
  ok(db.lastOAuth && /\/admin\/$/.test(db.lastOAuth.redirectTo), 'en stuurt terug naar /admin/, zonder parameters');
  await A.page.waitForSelector('text=Geen toegang');
  ok((await A.page.textContent('#gate')).includes('oud@example.com'), 'een gewoon account: "geen toegang", met het adres erbij');
  ok(!/[?&]code=/.test(A.page.url()), 'de code is uit de adresbalk');
  ok(!db.calls.includes('/rpc/admin_dashboard'), 'de cijfers worden niet eens opgevraagd');

  // ── Het beheeradres ──
  console.log('\nHet beheeradres');
  db.googleEmail = ADMIN;
  await Promise.all([A.page.waitForURL(/[?&]code=/), A.page.click('text=Ander Google-account')]);
  await A.page.waitForSelector('#dashboard:visible');
  ok((await A.page.textContent('#who')) === ADMIN, 'binnen, met het beheeradres bovenin');
  await A.page.waitForFunction(() => document.getElementById('acc-total').textContent !== '—');
  ok((await A.page.textContent('#stat-total')) === '120', 'de toernooicijfers van de oude pagina staan er nog');
  ok((await A.page.textContent('#stat-duration-lbl')).includes('60 echt · 12 test'), 'inclusief echt en test bij de speelduur');
  ok((await A.page.textContent('#acc-total')) === '4', 'accounts: totaal');
  ok((await A.page.textContent('#acc-week')) === '2', 'accounts: nieuw in 7 dagen');
  ok((await A.page.textContent('#acc-google')) === '2' && (await A.page.textContent('#acc-mail')) === '2', 'accounts: via Google en via mailcode');
  const first = await A.page.textContent('#acc-list .acc-row:first-child');
  ok(first.includes('nieuw@example.com') && first.includes('Nieuw'), 'het nieuwste account staat bovenaan, met een label Nieuw');
  ok(first.includes('2 groepen') && first.includes('lopend toernooi'), 'met wat diegene in zijn account bewaart');
  ok((await A.page.textContent('#acc-list')).includes('nog niets bewaard'), 'en wie nog niets bewaart, staat er ook zo');
  ok((await A.page.locator('#acc-list img').count()) === 0 && (await A.page.locator('#recent-list b').count()) === 0, 'mailadressen en formats komen als tekst op het scherm, niet als HTML');
  ok((await A.page.locator('#acc-chart .chart-bar-col').count()) === 30, 'grafiek nieuwe accounts: 30 dagen');
  await A.page.focus('#acc-chart .chart-bar-col:last-child');
  ok(await A.page.isVisible('#acc-chart .chart-bar-col:last-child .chart-tip'), 'met een tooltip, ook met het toetsenbord');
  ok((await A.page.locator('#acc-chart table tr').count()) === 30, 'en een tabel eronder');
  ok((await A.page.locator('#daily-chart .chart-bar-col').count()) === 14, 'de grafiek met toernooien per dag staat er nog');
  ok(await A.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'past op 390 pixels zonder zijwaarts scrollen');
  // SHOTS=map node scripts/test-admin.mjs bewaart een schermafdruk
  if (process.env.SHOTS) {
    await A.page.screenshot({ path: path.join(process.env.SHOTS, 'admin.png'), fullPage: true });
    await A.page.locator('#acc-chart').screenshot({ path: path.join(process.env.SHOTS, 'admin-grafiek.png') });
  }

  // ── Andere toestellen: dezelfde sessie als de app ──
  console.log('\nZelfde sessie als de app');
  ok(!!(await A.page.evaluate(() => localStorage.getItem('padel-auth'))), 'de sessie staat onder dezelfde sleutel als het account in de app (padel-auth)');

  // ── Uitloggen ──
  await Promise.all([A.page.waitForNavigation(), A.page.click('text=Uitloggen')]);
  await A.page.waitForSelector('#g-btn');
  ok(!(await A.page.evaluate(() => localStorage.getItem('padel-auth'))), 'uitloggen haalt de sessie weg');

  // ── Mailcode voor het beheeradres ──
  console.log('\nMet een mailcode');
  await A.page.click('summary');
  await A.page.fill('#mail-in', ADMIN);
  await A.page.click('#mail-btn');
  await A.page.waitForSelector('#code-in');
  await A.page.fill('#code-in', '000000');
  await A.page.click('#code-btn');
  await A.page.waitForSelector('.gate-err:not(:empty)');
  ok((await A.page.textContent('.gate-err')).includes('klopt niet'), 'een verkeerde code: "klopt niet of is verlopen"');
  await A.page.fill('#code-in', '123456');
  await A.page.click('#code-btn');
  await A.page.waitForSelector('#dashboard:visible');
  ok(true, 'met de goede code: binnen');

  // ── Nog niet ingericht ──
  console.log('\nNog niet ingericht');
  db.notSetUp = true;
  await A.page.reload();
  await A.page.waitForSelector('text=Het beheer is nog niet ingericht');
  const links = await A.page.$$eval('#gate a', as => as.map(a => a.href));
  ok(links.some(h => h.includes('supabase/admin_migration.sql')), 'met een link naar admin_migration.sql');
  ok(links.some(h => h.includes('/project/yaakmxarwdvovvqgtkwb/sql')), 'en naar de SQL Editor van precies dit project');
  db.notSetUp = false;
  await A.page.click('text=Opnieuw proberen');
  await A.page.waitForSelector('#dashboard:visible');
  ok(true, 'Opnieuw proberen werkt zodra de migratie gedraaid is');

  // ── Een fout terug van Google ──
  const B = await device('B');
  allErrors.push(B.errors);
  await B.page.goto(BASE + '/admin/?error=access_denied&error_description=User+cancelled');
  await B.page.waitForSelector('.gate-err:not(:empty)');
  ok((await B.page.textContent('.gate-err')).includes('User cancelled'), 'een fout terug van Google staat op het scherm');
  ok(!/error/.test(B.page.url()), 'en verdwijnt uit de adresbalk');
  await B.ctx.close();

  // ── Installeerbaar ──
  const man = JSON.parse(fs.readFileSync(path.join(root, 'admin', 'manifest.json'), 'utf8'));
  ok(man.scope === './' && man.icons.every(i => fs.existsSync(path.join(root, 'admin', i.src))), 'een eigen manifest met bestaande pictogrammen, los te installeren');

  const errs = allErrors.flat();
  ok(errs.length === 0, 'geen JavaScript-fouten' + (errs.length ? ': ' + errs.join(' | ') : ''));
} catch (e) {
  failed++;
  console.log('  FAIL - test brak af:', e.message.split('\n')[0]);
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${passed} geslaagd, ${failed} gezakt`);
process.exit(failed ? 1 : 0);
