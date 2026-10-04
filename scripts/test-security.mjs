#!/usr/bin/env node
// Browsertest voor security_migration.sql: de app leest nergens meer een
// beheersleutel (session_token) uit de database, en gebruikt de nieuwe
// functies: tournament_save (organisator bewaart), tournament_submit_score
// (speler of baanlink stuurt een score in) en competition_owner_token (ben
// ik beheerder van deze competitie?). Plus de terugval op een database
// waar de migratie nog niet gedraaid is.
//
// Zelfde opzet als scripts/test-account.mjs. Of de database echt weigert wat
// hij moet weigeren, controleert supabase/tests/security.test.sql.
//
// Draaien: node scripts/test-security.mjs

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE = fs.readFileSync(path.join(root, 'scripts', 'fake-supabase.js'), 'utf8');
const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';

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

// ── Nagebootste server, met de regels van security_migration.sql ──
const db = {
  migrated: true,
  tournaments: new Map(),   // code -> { data, token }
  competitions: new Map([['LADDER', { id: 1, code: 'LADDER', name: 'Dinsdagladder', club_name: null, type: 'ladder', settings: { range: 2 }, aliases: {}, created_at: new Date().toISOString(), session_token: 'mijn-ladder-sleutel-1234' }]]),
  signups: new Map([['SIGN01', { code: 'SIGN01', event_name: 'Vrijdag', event_date: null, location: null, format: 'americano', max_players: 8, signup_open: true, created_at: new Date().toISOString(), session_token: 'inschrijf-sleutel-123456' }]]),
  rpc: [], from: [],
};
const SECRET_TABLES = ['tournaments', 'competitions', 'signup_events'];
function selectOf(calls) { const s = calls.find(c => c[0] === 'select'); return s ? (s[1] ?? '*') : null; }
function eqOf(calls, col) { const e = calls.find(c => c[0] === 'eq' && c[1] === col); return e ? e[2] : undefined; }
const strip = row => { const { session_token, ...rest } = row; return rest; };

async function handle(route) {
  const url = new URL(route.request().url());
  const body = route.request().postData() ? JSON.parse(route.request().postData()) : {};
  const p = url.pathname.replace('/__fake-supabase', '');
  const reply = (status, json) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
  const missing = name => reply(404, { error: { code: 'PGRST202', message: `Could not find the function public.${name}` } });
  if (p === '/from') {
    const { table, calls } = body;
    db.from.push({ table, calls });
    const sel = selectOf(calls);
    // Na de migratie: session_token (en dus ook *) is niet te lezen
    if (db.migrated && SECRET_TABLES.includes(table) && sel !== null && (sel === '*' || /session_token/.test(sel)))
      return reply(401, { error: { code: '42501', message: `permission denied for table ${table}` } });
    if (table === 'tournaments' && sel) {
      const t = db.tournaments.get(eqOf(calls, 'code'));
      if (!t) return reply(406, { error: { code: 'PGRST116', message: 'no rows' } });
      return reply(200, { data: { data: t.data, updated_at: new Date().toISOString(), session_token: t.token } });
    }
    if (table === 'tournaments' && calls.some(c => c[0] === 'upsert')) {
      const row = calls.find(c => c[0] === 'upsert')[1];
      db.tournaments.set(row.code, { data: row.data, token: row.session_token });
      return reply(200, { data: null });
    }
    if (table === 'competitions' && sel) {
      const c = db.competitions.get(eqOf(calls, 'code'));
      return reply(200, { data: c ? (db.migrated ? strip(c) : c) : null });
    }
    if (table === 'signup_events' && sel) {
      const e = db.signups.get(eqOf(calls, 'code'));
      return reply(200, { data: e ? (db.migrated ? strip(e) : e) : null });
    }
    return reply(200, { data: (sel && /ladder|signups|competition_events/.test(table)) ? [] : null });
  }
  if (p.startsWith('/rpc/')) {
    const name = p.slice(5), a = body.params || {};
    db.rpc.push({ name, a });
    if (!db.migrated && ['tournament_save', 'tournament_submit_score', 'competition_owner_token'].includes(name)) return missing(name);
    if (name === 'tournament_save') {
      const t = db.tournaments.get(a.p_code);
      if (t && t.token !== a.p_token) return reply(403, { error: { code: '42501', message: 'not_owner' } });
      db.tournaments.set(a.p_code, { data: a.p_data, token: a.p_token });
      return reply(200, { data: true });
    }
    if (name === 'tournament_submit_score') {
      const t = db.tournaments.get(a.p_code);
      if (!t) return reply(404, { error: { code: 'P0002', message: 'not_found' } });
      const okToken = a.p_court != null && t.data.courtTokens && t.data.courtTokens[String(a.p_court)] === a.p_court_token;
      if (!t.data.playerScoring && !okToken) return reply(403, { error: { code: '42501', message: 'not_allowed' } });
      t.data.courtPending = (t.data.courtPending || []).filter(e => e.matchId !== a.p_match_id)
        .concat([{ matchId: a.p_match_id, court: a.p_court ?? null, sa: a.p_sa, sb: a.p_sb, playerName: a.p_player }]);
      return reply(200, { data: true });
    }
    if (name === 'competition_owner_token') {
      const c = db.competitions.get(a.p_code);
      return reply(200, { data: c && (a.p_tokens || []).includes(c.session_token) ? c.session_token : null });
    }
  }
  return reply(200, { data: null });
}

const browser = await chromium.launch();
const allErrors = [];
async function device(name, init) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.route(SUPABASE_CDN, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE }));
  await ctx.route('**/__fake-supabase/**', handle);
  await ctx.route(/^https:\/\/(?!cdn\.jsdelivr\.net\/npm\/@supabase)/, r => r.abort());
  // De oude manier van insturen schrijft met een directe PATCH naar Supabase
  await ctx.route('https://yaakmxarwdvovvqgtkwb.supabase.co/rest/v1/tournaments**', route => {
    const req = route.request();
    const code = new URL(req.url()).searchParams.get('code').replace('eq.', '');
    const t = db.tournaments.get(code);
    if (db.migrated || !t || req.headers()['x-session-token'] !== t.token)
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    t.data = JSON.parse(req.postData()).data;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ code }]) });
  });
  await ctx.addInitScript(extra => {
    try {
      if (!sessionStorage.getItem('init')) {
        localStorage.setItem('padel-consent', 'denied'); localStorage.setItem('padel-lang', 'nl'); localStorage.setItem('padel-ob-v2', '1');
        localStorage.setItem('padel-acct-asked', '1');
        for (const [k, v] of Object.entries(extra || {})) localStorage.setItem(k, v);
        sessionStorage.setItem('init', '1');
      }
    } catch {}
  }, init || {});
  const page = await ctx.newPage();
  page.on('pageerror', e => allErrors.push(`${name}: ${e.message}`));
  page.on('dialog', d => d.dismiss());
  return { ctx, page };
}

try {
  // ── De organisator deelt en bewaart ──
  console.log('\nDe organisator');
  const O = await device('organisator');
  await O.page.goto(BASE + '/app/?format=americano&names=Anna,Bob,Carla,Dries,Eva,Frank,Gijs,Hans');
  await O.page.waitForFunction(() => typeof startAmericano === 'function');
  await O.page.evaluate(() => { tournamentName = 'Vrijdag'; startAmericano(); });
  await O.page.evaluate(() => shareTournament());
  await O.page.waitForFunction(() => !!shareCode && document.getElementById('share-link-inp').value.includes('?view='));
  const code = await O.page.evaluate(() => shareCode);
  const token = await O.page.evaluate(() => sessionToken);
  const save = db.rpc.find(r => r.name === 'tournament_save');
  ok(save && save.a.p_code === code && save.a.p_token === token, 'delen gaat via tournament_save, met de eigen sleutel');
  ok(!db.from.some(f => f.table === 'tournaments' && f.calls.some(c => c[0] === 'upsert')), 'geen upsert meer (die kan na de migratie niet)');
  ok(db.tournaments.get(code).data.AP.length === 8, 'het toernooi staat in de database');
  await O.page.evaluate(() => setShareMode(true));
  await O.page.waitForFunction(c => true, code);
  await new Promise(r => setTimeout(r, 400));
  ok(db.tournaments.get(code).data.playerScoring === true, '"spelers voeren scores in" komt mee');

  // ── Een speler stuurt een score in ──
  console.log('\nEen speler');
  const V = await device('speler');
  await V.page.goto(BASE + '/app/?view=' + code);
  await V.page.waitForFunction(() => typeof AM !== 'undefined' && AM.length > 0);
  const m = await V.page.evaluate(() => { const m = AM[0][0]; viewerPlayerId = m.a1; return { id: m.id, name: AP[m.a1].name }; });
  db.rpc.length = 0;
  await V.page.evaluate(id => submitViewerScore(id, 21, 11), m.id);
  const sub = db.rpc.find(r => r.name === 'tournament_submit_score');
  ok(sub && sub.a.p_code === code && sub.a.p_match_id === m.id && sub.a.p_sa === 21 && sub.a.p_sb === 11, 'een score gaat via tournament_submit_score');
  ok(sub && sub.a.p_player === m.name, 'met de naam van de speler');
  ok(db.tournaments.get(code).data.courtPending.length === 1, 'en komt bij de inzendingen voor de organisator');
  ok(await V.page.evaluate(id => viewerScores[id] && viewerScores[id].submitted, m.id), 'de speler ziet "ingediend"');
  ok(db.tournaments.get(code).token === token, 'de sleutel van het toernooi is niet aangeraakt');

  // Spelers mogen niet (meer) invoeren: geweigerd, en de app zegt dat
  db.tournaments.get(code).data.playerScoring = false;
  await V.page.evaluate(id => { delete viewerScores[id]; }, m.id);
  await V.page.evaluate(id => submitViewerScore(id, 20, 12), m.id);
  ok(!(await V.page.evaluate(id => viewerScores[id] && viewerScores[id].submitted, m.id)), 'zonder toestemming wordt de score niet als ingediend getoond');
  db.tournaments.get(code).data.playerScoring = true;

  // ── Een baanlink ──
  console.log('\nEen baanlink');
  db.tournaments.get(code).data.courtTokens = { 1: 'baansleutel1' };
  const courtMatch = db.tournaments.get(code).data.AM.flat().find(x => x.court === 1 && !x.done);
  const C = await device('baan');
  await C.page.goto(`${BASE}/app/?score=${code}&court=1&tok=baansleutel1`);
  await C.page.waitForSelector('#cs-submit');
  db.rpc.length = 0;
  await C.page.evaluate(() => { csAdj('a', 20); csAdj('b', 12); });
  await C.page.click('#cs-submit');
  await C.page.waitForSelector('.court-done');
  const cs = db.rpc.find(r => r.name === 'tournament_submit_score');
  ok(cs && cs.a.p_court === 1 && cs.a.p_court_token === 'baansleutel1' && cs.a.p_match_id === courtMatch.id, 'een baanlink stuurt in met de sleutel van de baan');
  ok(db.tournaments.get(code).data.courtPending.some(e => e.court === 1 && e.sa === 20), 'en de score komt aan (vroeger weigerde de database dat stilletjes)');

  // ── Clubcompetitie ──
  console.log('\nClubcompetitie');
  const L = await device('ladderbaas', { 'padel-cc-token': 'andere-sleutel-0000', 'padel-cc-tokens': JSON.stringify(['mijn-ladder-sleutel-1234']) });
  await L.page.goto(BASE + '/app/?comp=LADDER');
  await L.page.waitForFunction(() => ccComp && ccComp.code === 'LADDER');
  ok(await L.page.evaluate(() => ccIsOwner), 'de beheerder wordt herkend via competition_owner_token');
  ok(await L.page.evaluate(() => _ccTokenFor(ccComp)) === 'mijn-ladder-sleutel-1234', 'en schrijft met de sleutel die bij deze competitie hoort');
  const L2 = await device('bezoeker', { 'padel-cc-token': 'helemaal-iets-anders-00' });
  await L2.page.goto(BASE + '/app/?comp=LADDER');
  await L2.page.waitForFunction(() => ccComp && ccComp.code === 'LADDER');
  ok(!(await L2.page.evaluate(() => ccIsOwner)), 'een bezoeker is geen beheerder');
  await L2.ctx.close();

  // ── Inschrijving ──
  const J = await device('inschrijver');
  await J.page.goto(BASE + '/app/?join=SIGN01');
  await J.page.waitForFunction(() => typeof joinEvent !== 'undefined' && joinEvent && joinEvent.code === 'SIGN01');
  ok(true, 'het inschrijfscherm laadt zonder de sleutel te vragen');
  await J.ctx.close();

  // ── Nergens meer om de sleutel gevraagd ──
  const leaks = db.from.filter(f => SECRET_TABLES.includes(f.table) && (() => { const s = selectOf(f.calls); return s !== null && (s === '*' || /session_token/.test(s)); })());
  ok(leaks.length === 0, 'de app vraagt nergens meer session_token of * op' + (leaks.length ? ': ' + JSON.stringify(leaks.map(l => [l.table, selectOf(l.calls)])) : ''));

  // ── Database zonder de migratie: alles werkt zoals vroeger ──
  console.log('\nZonder security_migration.sql');
  db.migrated = false;
  db.rpc.length = 0; db.from.length = 0;
  await O.page.evaluate(() => { AM[0][0].sa = 3; saveState(); return pushToSupabase(); });
  ok(db.from.some(f => f.table === 'tournaments' && f.calls.some(c => c[0] === 'upsert' && c[1].session_token === token)), 'bewaren valt terug op de upsert');
  await V.page.evaluate(id => { delete viewerScores[id]; }, m.id);
  await V.page.evaluate(id => submitViewerScore(id, 19, 13), m.id);
  ok(await V.page.evaluate(id => viewerScores[id] && viewerScores[id].submitted, m.id), 'een speler kan nog insturen (de oude manier)');
  const L3 = await device('ladderbaas-oud', { 'padel-cc-token': 'mijn-ladder-sleutel-1234' });
  await L3.page.goto(BASE + '/app/?comp=LADDER');
  await L3.page.waitForFunction(() => ccComp && ccComp.code === 'LADDER');
  await L3.page.waitForTimeout(300);
  ok(await L3.page.evaluate(() => ccIsOwner), 'de beheerder van een competitie wordt nog herkend');
  db.migrated = true;

  ok(allErrors.length === 0, 'geen JavaScript-fouten' + (allErrors.length ? ': ' + allErrors.join(' | ') : ''));
} catch (e) {
  failed++;
  console.log('  FAIL - test brak af:', e.message.split('\n')[0]);
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${passed} geslaagd, ${failed} gezakt`);
process.exit(failed ? 1 : 0);
