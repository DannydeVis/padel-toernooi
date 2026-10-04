#!/usr/bin/env node
// Browsertest voor het optionele account: inloggen met een mailcode en met
// Google, synchroniseren tussen twee toestellen, uitloggen en verwijderen.
//
// Draait tegen een nagebootste Supabase, niet tegen de echte: supabase-js
// wordt vervangen door scripts/fake-supabase.js, en de "server" daarachter
// staat in dit bestand onder /__fake-supabase/ (één gedeelde opslag voor alle browsercontexten, zodat
// twee contexten echt twee toestellen van dezelfde persoon zijn).
//
// De server volgt de regels van supabase/account_migration.sql: per rij wint
// de nieuwste, een grafsteen heeft geen inhoud, en je ziet alleen je eigen
// rijen. Die regels zelf worden tegen echte PostgreSQL gecontroleerd door
// supabase/tests/run.sh; hier gaat het om wat de app ermee doet.
//
// Draaien: node scripts/test-account.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE = fs.readFileSync(path.join(root, 'scripts', 'fake-supabase.js'), 'utf8');
const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  ok   -', msg); }
  else { failed++; console.log('  FAIL -', msg); }
}

// ── Statische server voor de repo ──
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.css': 'text/css', '.webp': 'image/webp' };
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

// ── De nagebootste Supabase-server ──
const db = {
  users: new Map(),     // id -> {id,email,identities:[]}
  items: new Map(),     // `${uid}|${kind}|${key}` -> row
  otps: new Map(),      // email -> code
  codes: new Map(),     // lange code -> {email, verifier, provider}
  googleEmail: null,
  calls: [],            // [{path, uid}]
  idTokens: new Map(),  // nep-bewijzen van Google -> {email, nonceHash}
  migrationMissing: false,
};
let nextId = 1;
function userFor(email, provider) {
  for (const u of db.users.values()) if (u.email === email) {
    if (!u.identities.some(i => i.provider === provider)) u.identities.push({ provider, identity_data: { email } });
    return u;
  }
  const u = { id: `00000000-0000-0000-0000-${String(nextId++).padStart(12, '0')}`, email, identities: [{ provider, identity_data: { email } }] };
  db.users.set(u.id, u);
  return u;
}
function rowsOf(uid) { return [...db.items.values()].filter(r => r.user_id === uid); }
function accountSync(uid, items) {
  const latest = new Map();
  for (const i of items || []) {
    if (!i.kind || !i.item_key || i.updated_at == null) continue;
    const k = i.kind + '|' + i.item_key;
    if (!latest.has(k) || latest.get(k).updated_at < i.updated_at) latest.set(k, i);
  }
  for (const [k, i] of latest) {
    const key = uid + '|' + k, cur = db.items.get(key);
    if (cur && !(cur.updated_at < i.updated_at)) continue;
    // Zoals jsonb: sleutels in een andere volgorde dan ze binnenkwamen
    const data = i.deleted ? null : JSON.parse(JSON.stringify(i.data, (kk, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.entries(v).reverse()) : v));
    db.items.set(key, { user_id: uid, kind: i.kind, item_key: i.item_key, data, deleted: !!i.deleted, updated_at: i.updated_at });
  }
  return rowsOf(uid);
}
async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  const body = req.postData() ? JSON.parse(req.postData()) : {};
  const uid = body.uid || null;
  db.calls.push({ path: url.pathname.replace('/__fake-supabase', ''), uid });
  const reply = (status, json) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
  switch (url.pathname.replace('/__fake-supabase', '')) {
    case '/otp': {
      db.otps.set(body.email, '123456');
      const long = 'mail' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      db.codes.set(long, { email: body.email, verifier: body.verifier, provider: 'email' });
      db.lastLink = body.redirectTo + '?code=' + long;
      return reply(200, {});
    }
    case '/verify': {
      if (db.otps.get(body.email) !== body.token) return reply(400, { error: { message: 'Token has expired or is invalid', code: 'otp_expired' } });
      db.otps.delete(body.email);
      return reply(200, { user: userFor(body.email, 'email') });
    }
    case '/oauth': {
      const long = 'goog' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      db.codes.set(long, { email: db.googleEmail, verifier: body.verifier, provider: 'google' });
      return reply(200, { url: body.redirectTo + '?code=' + long });
    }
    case '/exchange': {
      const c = db.codes.get(body.code);
      if (!c || c.verifier !== body.verifier) return reply(400, { error: { message: 'invalid flow state, no valid flow state found', code: 'bad_code_verifier' } });
      db.codes.delete(body.code);
      return reply(200, { user: userFor(c.email, c.provider) });
    }
    case '/rpc/account_sync': {
      if (db.migrationMissing) return reply(404, { error: { code: 'PGRST202', message: 'Could not find the function public.account_sync' } });
      if (!uid || !db.users.has(uid)) return reply(401, { error: { code: '42501', message: 'not_signed_in' } });
      return reply(200, { data: accountSync(uid, body.params && body.params.p_items) });
    }
    case '/gis': {
      // Wat Google doet: een bewijs (ID-token) met de gehashte nonce erin
      const tok = 'idtok-' + Math.random().toString(36).slice(2);
      db.idTokens.set(tok, { email: db.googleEmail, nonceHash: body.nonce });
      return reply(200, { credential: tok });
    }
    case '/idtoken': {
      // Wat Supabase doet: het bewijs moet bestaan en de nonce moet kloppen
      const t = db.idTokens.get(body.token);
      if (!t) return reply(400, { error: { message: 'Bad ID token', code: 'bad_jwt' } });
      if (createHash('sha256').update(String(body.nonce || '')).digest('hex') !== t.nonceHash)
        return reply(400, { error: { message: 'Nonces mismatch', code: 'bad_nonce' } });
      db.idTokens.delete(body.token);
      return reply(200, { user: userFor(t.email, 'google') });
    }
    case '/rpc/competition_owner_token': {
      const pr = body.params || {}, o = db.ccOwner;
      return reply(200, { data: o && o.code === pr.p_code && (pr.p_tokens || []).includes(o.token) ? o.token : null });
    }
    case '/rpc/delete_my_account': {
      if (!uid || !db.users.has(uid)) return reply(401, { error: { code: '42501', message: 'not_signed_in' } });
      db.users.delete(uid);
      for (const k of [...db.items.keys()]) if (k.startsWith(uid + '|')) db.items.delete(k);
      return reply(200, { data: null });
    }
  }
  if (url.pathname.endsWith('/from')) return reply(200, { data: null });
  return reply(404, { error: { message: 'unknown fake path ' + url.pathname } });
}

const browser = await chromium.launch();
// Nagebootste Google Identity Services: renderButton zet een knop neer die,
// net als de echte, het bewijs aan de callback geeft
const FAKE_GIS = `window.google={accounts:{id:{
  initialize(o){ window.__gis=o; },
  renderButton(el,opts){ window.__gisOpts=opts; const b=document.createElement('button'); b.id='gis-btn';
    b.textContent='Doorgaan met Google'; b.onclick=()=>fetch('/__fake-supabase/gis',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({nonce:window.__gis.nonce})}).then(r=>r.json()).then(j=>window.__gis.callback({credential:j.credential})); el.appendChild(b); }
}}};`;
async function device(name, { preview = true, gis = false } = {}) {
  // Zonder service worker: die handelt verzoeken anders zelf af, buiten de
  // nagebootste server om
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route(SUPABASE_CDN, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE }));
  await ctx.route('**/__fake-supabase/**', handle);
  // Alles van buiten (fonts, analytics, QR) is hier niet bereikbaar en niet nodig
  await ctx.route(/^https:\/\/(?!cdn\.jsdelivr\.net\/npm\/@supabase)/, r => r.abort());
  if (gis) await ctx.route('https://accounts.google.com/gsi/client', r => { db.gisLoads = (db.gisLoads || 0) + 1; r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_GIS }); });
  await ctx.addInitScript(preview => {
    try {
      // In het echt staat ACCOUNT_LIVE dan aan; hier doet de preview dat
      if (preview) localStorage.setItem('padel-account-preview', '1');
      if (!localStorage.getItem('padel-consent')) localStorage.setItem('padel-consent', 'denied');
      localStorage.setItem('padel-lang', 'nl');
      localStorage.setItem('padel-ob-v2', '1');
    } catch {}
  }, preview);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('dialog', d => d.dismiss());
  page.errors = errors;
  return { ctx, page, errors };
}
// SHOTS=map node scripts/test-account.mjs bewaart schermafdrukken onderweg
const shot = (page, name) => process.env.SHOTS ? page.screenshot({ path: path.join(process.env.SHOTS, name + '.png') }) : null;
const store = (page, key) => page.evaluate(k => localStorage.getItem(k), key);
const groupsOf = async page => JSON.parse((await store(page, 'padel_groups')) || '[]');
async function openSheet(page) {
  await page.click('#btn-acct');
  await page.waitForSelector('#acct-modal:not(.hidden)');
}

try {
  // ── 0. Zonder de schakelaar: niets te zien en geen verkeer ──
  console.log('\nZonder ?account=preview');
  {
    const { page, ctx } = await device('uit', { preview: false });
    await page.goto(BASE + '/app/');
    await page.waitForTimeout(500);
    ok(await page.isVisible('#btn-acct'), 'ACCOUNT_LIVE staat aan: de accountknop staat er ook zonder ?account=preview');
    ok(db.calls.length === 0, 'een paginaweergave maakt nog steeds geen enkel verzoek naar Supabase-auth');
    await ctx.close();
  }

  // ── 1. Toestel A: lokale gegevens, dan inloggen met de mailcode ──
  console.log('\nToestel A: inloggen met de mailcode');
  const A = await device('A');
  await A.page.goto(BASE + '/app/?account=preview&names=Anna,Bob,Carla,Dries,Eva,Frank,Gijs,Hans&format=americano');
  await A.page.waitForSelector('#btn-acct:visible');
  ok(db.calls.length === 0, 'lui: een paginaweergave maakt geen verbinding met het account');
  await A.page.evaluate(() => {
    _saveGroups([{ id: 'g-dinsdag', name: 'Dinsdagavond', lines: ['Anna', 'Bob', 'Carla', 'Dries'], updatedAt: Date.now() }]);
    ccEnsureToken();
    localStorage.setItem('padel-signup-code', 'SIGN01');
    localStorage.setItem('padel-signup-token', 'signtoken0123456789');
    tournamentName = 'Vrijdagtoernooi';
    startAmericano();
  });
  await A.page.waitForTimeout(300);
  const ccTokenA = await store(A.page, 'padel-cc-token');

  await openSheet(A.page);
  const g = A.page.locator('#acct-google-btn');
  ok(await g.isVisible(), 'de Google-knop staat in het paneel');
  ok(await g.locator('svg path[fill="#1976D2"]').count() === 1, 'met het echte Google-logo, inline');
  ok((await g.evaluate(el => getComputedStyle(el).textTransform)) === 'none', 'in gewone schrijfwijze, niet in kapitalen');
  await shot(A.page, '1-inloggen');
  await A.page.fill('#acct-mail', 'geen-mailadres');
  await A.page.click('#acct-send-btn');
  ok((await A.page.textContent('.acct-err')).includes('geldig mailadres'), 'een ongeldig adres krijgt een gewone melding');
  await A.page.fill('#acct-mail', 'Danny@Example.com');
  await A.page.click('#acct-send-btn');
  await A.page.waitForSelector('#acct-code');
  ok((await A.page.textContent('#acct-card')).includes('danny@example.com'), 'het paneel zegt naar welk adres de mail ging');
  await shot(A.page, '2-code');
  await A.page.fill('#acct-code', '000000');
  await A.page.click('#acct-verify-btn');
  await A.page.waitForSelector('.acct-err:not(:empty)');
  ok((await A.page.textContent('.acct-err')).includes('klopt niet'), 'een verkeerde code: "klopt niet of is verlopen"');
  await A.page.fill('#acct-code', '123456');
  await A.page.click('#acct-verify-btn');
  await A.page.waitForSelector('.acct-who');
  ok((await A.page.textContent('#acct-card')).includes('Ingelogd als danny@example.com'), 'na de goede code: ingelogd');
  ok((await A.page.textContent('#acct-card')).includes('Alles van dit toestel staat nu ook in je account'), 'met een bevestiging wat er gebeurd is');
  await shot(A.page, '3-ingelogd');
  const uid = [...db.users.values()].find(u => u.email === 'danny@example.com').id;
  const kinds = rowsOf(uid).map(r => r.kind).sort().join(',');
  ok(kinds === 'cc,group,live,signup', `alles staat in het account (${kinds})`);
  ok(rowsOf(uid).find(r => r.kind === 'cc').data.token === ccTokenA, 'inclusief de beheersleutel van de clubcompetitie');
  ok(await A.page.isVisible('#btn-acct .acct-avatar'), 'de knop bovenin toont nu een avatar');
  await A.page.click('.dm-close-btn');

  // ── 2. Toestel B: leeg, inloggen met Google ──
  console.log('\nToestel B: inloggen met Google');
  const B = await device('B');
  db.googleEmail = 'danny@example.com';
  await B.page.goto(BASE + '/app/?account=preview');
  await B.page.waitForSelector('#btn-acct:visible');
  ok((await groupsOf(B.page)).length === 0, 'toestel B begint leeg');
  await openSheet(B.page);
  await Promise.all([B.page.waitForURL(/[?&]code=/), B.page.click('#acct-google-btn')]);
  await B.page.waitForSelector('.acct-who');
  ok(!/[?&]code=/.test(B.page.url()), 'de code van Supabase is uit de adresbalk gehaald');
  ok((await B.page.textContent('#acct-card')).includes('Ingelogd als danny@example.com'), 'ingelogd via Google');
  ok((await B.page.textContent('#acct-card')).includes('via Google'), 'en het paneel zegt dat het via Google is');
  ok((await groupsOf(B.page)).some(x => x.name === 'Dinsdagavond'), 'de groep van toestel A staat nu op toestel B');
  ok((await store(B.page, 'padel-cc-token')) === ccTokenA, 'de beheersleutel van de clubcompetitie ook');
  ok((await store(B.page, 'padel-signup-code')) === 'SIGN01', 'en de inschrijving');
  await B.page.click('.dm-close-btn');
  ok(await B.page.isVisible('#sx-groups .sx-group'), 'de groep staat ook op het scherm, zonder herladen');
  await B.page.waitForSelector('#acct-live-banner');
  ok((await B.page.textContent('#acct-live-banner')).includes('Vrijdagtoernooi'), 'het lopende toernooi van A wordt aangeboden, niet stilletjes overgenomen');
  await shot(B.page, '4-aanbod-toernooi');
  await Promise.all([B.page.waitForNavigation(), B.page.click('#acct-live-banner .btn-green')]);
  await B.page.waitForFunction(() => typeof AP !== 'undefined' && AP.length === 8);
  ok(await B.page.evaluate(() => mode === 'americano' && tournamentName === 'Vrijdagtoernooi'), 'na Ophalen loopt het toernooi van A verder op B');

  // ── 3. Verwijderen gaat mee, als grafsteen ──
  console.log('\nVerwijderen op het ene toestel');
  await B.page.evaluate(() => _saveGroups([]));
  await B.page.evaluate(() => acctSync());
  ok(rowsOf(uid).find(r => r.kind === 'group').deleted === true, 'de groep is in het account een grafsteen');
  await A.page.evaluate(() => acctSync());
  ok((await groupsOf(A.page)).length === 0, 'en verdwijnt ook van toestel A, in plaats van terug te komen');

  // ── 4. Twee toestellen, twee nieuwe groepen tegelijk ──
  await A.page.evaluate(() => _saveGroups([{ id: 'g-a', name: 'Van A', lines: ['X'], updatedAt: Date.now() }]));
  await B.page.evaluate(() => _saveGroups([{ id: 'g-b', name: 'Van B', lines: ['Y'], updatedAt: Date.now() }]));
  await A.page.evaluate(() => acctSync());
  await B.page.evaluate(() => acctSync());
  await A.page.evaluate(() => acctSync());
  const na = (await groupsOf(A.page)).map(x => x.name).sort().join(',');
  const nb = (await groupsOf(B.page)).map(x => x.name).sort().join(',');
  ok(na === 'Van A,Van B' && nb === 'Van A,Van B', `groepen van beide toestellen blijven bestaan (A: ${na}, B: ${nb})`);
  const callsBefore = db.calls.length;
  await A.page.evaluate(() => acctSync());
  const pushed = db.calls.slice(callsBefore).length;
  ok(pushed === 1, 'nog een keer synchroniseren is één verzoek');
  ok(rowsOf(uid).filter(r => r.kind === 'group' && !r.deleted).length === 2, 'en verandert in het account niets meer');

  // ── 5. Een clubcompetitie van A is op B te beheren ──
  console.log('\nBeheer van een clubcompetitie');
  await B.page.evaluate(() => { localStorage.removeItem('padel-cc-token'); ccSessionToken = null; ccEnsureToken(); });
  const ccTokenB = await store(B.page, 'padel-cc-token');
  await B.page.evaluate(() => acctSync());
  await A.page.evaluate(() => acctSync());
  const knownA = await A.page.evaluate(() => ccKnownTokens());
  ok(knownA.includes(ccTokenA) && knownA.includes(ccTokenB), 'toestel A kent nu de beheersleutels van beide toestellen');
  // Een competitie die op toestel B is aangemaakt: de database (competition_owner_token)
  // herkent de sleutel van B, die A nu via het account kent
  db.ccOwner = { code: 'CCB001', token: ccTokenB };
  ok(await A.page.evaluate(async t => { ccComp = { code: 'CCB001' }; await ccOwnerToken('CCB001'); return _ccTokenFor(ccComp) === t; }, ccTokenB), 'en schrijft met de sleutel die bij de competitie hoort');

  // ── 6. Een maillink in een andere browser ──
  console.log('\nMaillink in een andere browser');
  const C = await device('C');
  await C.page.goto(BASE + '/app/?account=preview');
  await openSheet(C.page);
  await C.page.fill('#acct-mail', 'danny@example.com');
  await C.page.click('#acct-send-btn');
  await C.page.waitForSelector('#acct-code');
  const D = await device('D');
  await D.page.goto(db.lastLink.replace(/^https?:\/\/[^/]+/, BASE));
  await D.page.waitForSelector('#acct-modal:not(.hidden) .acct-err:not(:empty)');
  ok((await D.page.textContent('.acct-err')).includes('alleen in de browser'), 'de link in een andere browser legt uit dat je de code kunt typen');
  ok(!/[?&]code=/.test(D.page.url()), 'en de mislukte code staat niet meer in de adresbalk');
  await D.ctx.close();
  await C.ctx.close();

  // ── 7. Een fout terug van Google ──
  const E = await device('E');
  await E.page.goto(BASE + '/app/?account=preview&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  await E.page.waitForSelector('#acct-modal:not(.hidden) .acct-err:not(:empty)');
  ok((await E.page.textContent('.acct-err')).includes('klopt niet of is verlopen'), 'een fout in de terugkeer-url wordt in gewone taal uitgelegd');
  ok(!/error/.test(E.page.url()), 'en uit de adresbalk gehaald');
  await E.ctx.close();

  // ── 8. Migratie nog niet gedraaid ──
  const F = await device('F');
  db.migrationMissing = true;
  await F.page.goto(BASE + '/app/?account=preview');
  await openSheet(F.page);
  await F.page.fill('#acct-mail', 'nieuw@example.com');
  await F.page.click('#acct-send-btn');
  await F.page.waitForSelector('#acct-code');
  await F.page.fill('#acct-code', '123456');
  await F.page.click('#acct-verify-btn');
  await F.page.waitForSelector('.acct-err:not(:empty)');
  ok((await F.page.textContent('.acct-err')).includes('ligt niet aan jou'), 'zonder migratie: "dat ligt niet aan jou"');
  db.migrationMissing = false;
  await F.ctx.close();

  // ── 9. Eén keer gevraagd ──
  console.log('\nEén keer gevraagd');
  const G = await device('G');
  await G.page.goto(BASE + '/app/?account=preview');
  await G.page.waitForSelector('#btn-acct:visible');
  await G.page.evaluate(() => acctMaybeAsk('cc'));
  ok(await G.page.isVisible('#acct-modal:not(.hidden)'), 'na een nieuwe clubcompetitie komt de vraag');
  ok((await G.page.textContent('#acct-card')).includes('Bewaar het beheer van je competitie'), 'met een kop die zegt waarom');
  await shot(G.page, '5-een-keer-gevraagd');
  const nn = G.page.locator('.acct-notnow');
  const send = G.page.locator('#acct-send-btn');
  const [hn, hs] = [await nn.evaluate(e => e.offsetHeight), await send.evaluate(e => e.offsetHeight)];
  ok(await nn.isVisible() && hn >= hs, '"Nu niet" is even groot als inloggen');
  await nn.click();
  await G.page.evaluate(() => acctMaybeAsk('done'));
  ok(!(await G.page.isVisible('#acct-modal:not(.hidden)')), 'daarna nooit meer');
  await G.ctx.close();

  // ── 10. Uitloggen ──
  console.log('\nUitloggen en verwijderen');
  await openSheet(B.page);
  await B.page.check('#acct-wipe');
  await B.page.click('#acct-logout-btn');
  ok((await B.page.textContent('#acct-logout-btn')).includes('Zeker weten'), 'uitloggen vraagt eerst een tweede tik');
  await Promise.all([B.page.waitForNavigation(), B.page.click('#acct-logout-btn')]);
  await B.page.waitForSelector('#btn-acct:visible');
  ok((await groupsOf(B.page)).length === 0 && !(await store(B.page, 'padel-state')), 'met het vinkje: de gegevens zijn van toestel B');
  ok(rowsOf(uid).filter(r => r.kind === 'group' && !r.deleted).length === 2, 'maar staan nog in het account');
  ok(!(await store(B.page, 'padel-auth')), 'en de sessie is weg');

  await openSheet(A.page);
  await A.page.click('#acct-logout-btn');
  await A.page.click('#acct-logout-btn');
  await A.page.waitForSelector('#acct-google-btn');
  ok((await groupsOf(A.page)).length === 2, 'zonder het vinkje blijft alles op toestel A staan');
  ok((await A.page.textContent('#acct-card')).includes('Je bent uitgelogd'), 'en het paneel zegt dat');

  // Weer inloggen op A en het account verwijderen
  await A.page.fill('#acct-mail', 'danny@example.com');
  await A.page.click('#acct-send-btn');
  await A.page.waitForSelector('#acct-code');
  await A.page.fill('#acct-code', '123456');
  await A.page.click('#acct-verify-btn');
  await A.page.waitForSelector('#acct-delete-btn');
  await A.page.click('#acct-delete-btn');
  await A.page.click('#acct-delete-btn');
  await A.page.waitForSelector('#acct-google-btn');
  ok(!db.users.has(uid) && rowsOf(uid).length === 0, 'account verwijderen: het account en alles erin is weg');
  ok((await groupsOf(A.page)).length === 2, 'wat op het toestel stond, staat er nog');
  ok((await A.page.textContent('#acct-card')).includes('Je account is verwijderd'), 'en het paneel zegt dat');

  // ── 10b. Google's eigen knop op padel-bracket.com ──
  console.log('\nGoogle-knop op de eigen pagina');
  const K = await device('K', { gis: true });
  db.googleEmail = 'speler@example.com';
  await K.page.goto(BASE + '/app/');
  await K.page.waitForSelector('#btn-acct:visible');
  ok(!db.gisLoads, 'Google\'s script laadt niet bij een gewone paginaweergave');
  await openSheet(K.page);
  await K.page.waitForSelector('#gis-btn');
  ok(db.gisLoads === 1, 'pas als het inlogpaneel opengaat');
  ok(!(await K.page.isVisible('#acct-google-btn')), 'Google\'s eigen knop vervangt de knop met de omweg via supabase.co');
  ok(await K.page.evaluate(() => window.__gisOpts && window.__gisOpts.locale === 'nl'), 'in de taal van de app');
  const sent = await K.page.evaluate(() => ({ hashed: window.__gis.nonce, raw: _gisNonce }));
  ok(sent.hashed && sent.raw && sent.hashed !== sent.raw && sent.hashed.length === 64, 'Google krijgt alleen de hash van de eenmalige code');
  const gisCallsBefore = db.calls.length;
  await K.page.click('#gis-btn');
  await K.page.waitForSelector('.acct-who');
  ok((await K.page.textContent('#acct-card')).includes('Ingelogd als speler@example.com'), 'ingelogd zonder de pagina te verlaten');
  ok(!db.calls.slice(gisCallsBefore).some(c => c.path === '/oauth'), 'zonder omweg via supabase.co');
  ok(K.page.url().startsWith(BASE + '/app/') && !/code=/.test(K.page.url()), 'en de app is nooit weggeweest');
  // Een bewijs met de verkeerde eenmalige code wordt geweigerd
  await K.page.evaluate(async () => { await acctSB().auth.signOut(); acctUser = null; _acctStage = 'start'; acctRender(); });
  await K.page.waitForSelector('#gis-btn');
  await K.page.evaluate(() => { _gisNonce = 'vervalst'; });
  await K.page.click('#gis-btn');
  await K.page.waitForSelector('.acct-err:not(:empty)');
  ok(!(await K.page.isVisible('.acct-who')), 'een bewijs met een verkeerde eenmalige code logt niet in');
  await K.ctx.close();

  // ── 11. Engels, en geen fouten in de console ──
  const H = await device('H');
  await H.page.addInitScript(() => localStorage.setItem('padel-lang', 'en'));
  await H.page.goto(BASE + '/app/?account=preview');
  await openSheet(H.page);
  ok((await H.page.textContent('#acct-google-btn')).includes('Continue with Google'), 'in het Engels: Continue with Google');
  const wide = await H.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  ok(wide, 'het paneel past op 390 pixels zonder zijwaarts scrollen');
  await H.ctx.close();

  const errs = [...A.errors, ...B.errors];
  // Toeschouwers hebben geen account nodig
  const V = await device('V');
  await V.page.goto(BASE + '/app/?view=ABC123');
  await V.page.waitForTimeout(600);
  ok(!(await V.page.isVisible('#btn-acct')), 'geen accountknop voor toeschouwers (?view=)');
  await V.ctx.close();

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
