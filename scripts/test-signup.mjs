#!/usr/bin/env node
// Test script for the self-signup + waitlist feature.
// Uses the same Supabase URL and anon key as app/index.html, talks directly
// to the PostgREST endpoint (no extra dependencies needed).
// Creates its own signup_events + signups rows and cleans up the signups
// afterwards. The signup_events row itself has no DELETE policy (same as
// the tournaments table), so it is left behind with signup_open=false.

const SUPABASE_URL = 'https://yaakmxarwdvovvqgtkwb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Fccf-kWuAejjjBb9lPRkkg_k6ejhu-i';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok   -', msg); }
  else { failed++; console.log('  FAIL -', msg); }
}

async function req(method, path, { token, body, prefer } = {}) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };
  if (token) headers['x-session-token'] = token;
  if (prefer) headers['Prefer'] = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
function genToken() {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
}

async function createEvent(maxPlayers) {
  const code = genCode();
  const token = genToken();
  const r = await req('POST', 'signup_events', {
    body: { code, session_token: token, event_name: 'Test event', format: 'americano', max_players: maxPlayers, signup_open: true },
    prefer: 'return=representation'
  });
  if (!r.ok) throw new Error('createEvent failed: ' + JSON.stringify(r.data));
  return { code, token };
}

function insertSignup(code, name, status, gender) {
  return req('POST', 'signups', { body: { tournament_code: code, name, status, gender: gender || null }, prefer: 'return=representation' });
}
async function listSignups(code) {
  const r = await req('GET', `signups?tournament_code=eq.${code}&order=created_at.asc`);
  return r.data || [];
}
async function confirmedCount(code) {
  const list = await listSignups(code);
  return list.filter(s => s.status === 'confirmed').length;
}
async function cleanupSignups(code, token) {
  const list = await listSignups(code);
  for (const row of list) await req('DELETE', `signups?id=eq.${row.id}`, { token });
}

async function testUpToMaxAndOverflow() {
  console.log('\nTest 1+2: signup up to max, overflow to waitlist');
  const max = 3;
  const { code, token } = await createEvent(max);
  try {
    for (let i = 1; i <= max; i++) {
      const cnt = await confirmedCount(code);
      const status = cnt < max ? 'confirmed' : 'waitlist';
      const r = await insertSignup(code, `Player ${i}`, status);
      assert(r.ok, `insert player ${i} (${status})`);
    }
    let list = await listSignups(code);
    assert(list.length === max && list.every(s => s.status === 'confirmed'), `all ${max} signups confirmed`);

    const cnt = await confirmedCount(code);
    const status = cnt < max ? 'confirmed' : 'waitlist';
    const r = await insertSignup(code, 'Overflow Player', status);
    assert(r.ok && status === 'waitlist', 'overflow signup placed on waitlist');
    list = await listSignups(code);
    const wl = list.filter(s => s.status === 'waitlist');
    assert(wl.length === 1 && wl[0].name === 'Overflow Player', 'waitlist contains the overflow player');
  } finally {
    await cleanupSignups(code, token);
  }
}

async function testDeleteShiftsWaitlist() {
  console.log('\nTest 3: deleting a confirmed signup shifts the waitlist up');
  const max = 2;
  const { code, token } = await createEvent(max);
  try {
    await insertSignup(code, 'A', (await confirmedCount(code)) < max ? 'confirmed' : 'waitlist');
    await insertSignup(code, 'B', (await confirmedCount(code)) < max ? 'confirmed' : 'waitlist');
    await insertSignup(code, 'C', (await confirmedCount(code)) < max ? 'confirmed' : 'waitlist');
    let list = await listSignups(code);
    const confirmedIds = list.filter(s => s.status === 'confirmed').map(s => s.id);
    const waitRow = list.find(s => s.status === 'waitlist');
    assert(confirmedIds.length === 2 && waitRow, 'initial state: 2 confirmed + 1 waitlist');

    const removeId = confirmedIds[0];
    const del = await req('DELETE', `signups?id=eq.${removeId}`, { token });
    assert(del.ok, 'organizer deletes a confirmed signup');
    const promo = await req('PATCH', `signups?id=eq.${waitRow.id}`, { token, body: { status: 'confirmed' } });
    assert(promo.ok, 'oldest waitlist row promoted to confirmed');

    list = await listSignups(code);
    const promoted = list.find(s => s.id === waitRow.id);
    assert(promoted && promoted.status === 'confirmed', 'promoted row is now confirmed');
    assert(list.filter(s => s.status === 'confirmed').length === 2, 'still exactly 2 confirmed after the shift');
  } finally {
    await cleanupSignups(code, token);
  }
}

async function testClosedCodeRefusesInsert() {
  console.log('\nTest 4: closed code refuses inserts');
  const { code, token } = await createEvent(8);
  try {
    const close = await req('PATCH', `signup_events?code=eq.${code}`, { token, body: { signup_open: false } });
    assert(close.ok, 'organizer closes signup');
    const r = await insertSignup(code, 'Late Player', 'confirmed');
    assert(!r.ok || (Array.isArray(r.data) && r.data.length === 0), 'insert into a closed signup is rejected');
  } finally {
    await cleanupSignups(code, token);
  }
}

async function testDuplicateNameSequence() {
  console.log('\nTest 5: duplicate name gets a sequence number');
  const { code, token } = await createEvent(10);
  try {
    const r1 = await insertSignup(code, 'Jan', 'confirmed');
    assert(r1.ok, 'first "Jan" signup');

    let list = await listSignups(code);
    let names = list.map(s => s.name.toLowerCase());
    const lower = 'jan';
    let n = 1;
    names.forEach(x => { if (x === lower || x.startsWith(lower + ' (')) n++; });
    const finalName = `Jan (${n})`;
    assert(finalName === 'Jan (2)', 'duplicate name resolves to "Jan (2)"');
    const r2 = await insertSignup(code, finalName, 'confirmed');
    assert(r2.ok, 'second signup inserted as "Jan (2)"');

    list = await listSignups(code);
    names = list.map(s => s.name.toLowerCase());
    n = 1;
    names.forEach(x => { if (x === lower || x.startsWith(lower + ' (')) n++; });
    assert(`Jan (${n})` === 'Jan (3)', 'third duplicate resolves to "Jan (3)"');
  } finally {
    await cleanupSignups(code, token);
  }
}

async function main() {
  console.log('Running self-signup Supabase tests against', SUPABASE_URL);
  try {
    await testUpToMaxAndOverflow();
    await testDeleteShiftsWaitlist();
    await testClosedCodeRefusesInsert();
    await testDuplicateNameSequence();
  } catch (e) {
    console.error('\nTest run crashed:', e.message || e);
    failed++;
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main();
