#!/usr/bin/env node
// Test script for real web push notifications (push-round Edge Function).
// Uses the same Supabase URL and anon key as the app, talks directly to the
// PostgREST endpoint and to the deployed Edge Function (no dependencies).
// Creates its own tournament + subscription rows and cleans up what it can:
// the tournaments row has no DELETE policy (same as the rest of the app),
// same for push_log rows (Edge Function / service role only), so those are
// left behind on purpose, same precedent as scripts/test-signup.mjs.

import { generateKeyPairSync, randomBytes } from 'node:crypto';

const SUPABASE_URL = 'https://yaakmxarwdvovvqgtkwb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Fccf-kWuAejjjBb9lPRkkg_k6ejhu-i';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok   -', msg); }
  else { failed++; console.log('  FAIL -', msg); }
}

async function req(method, path, { body, prefer } = {}) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };
  if (prefer) headers['Prefer'] = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
function genToken() {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
}

// A syntactically valid (but not real) EC public key, so the Edge Function's
// Web Push encryption step succeeds and the request actually reaches the
// (unreachable) fake endpoint, which then 404s.
function genFakeSubscriptionKeys() {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url'), y = Buffer.from(jwk.y, 'base64url');
  const p256dh = b64url(Buffer.concat([Buffer.from([0x04]), x, y]));
  const auth = b64url(randomBytes(16));
  return { p256dh, auth };
}

async function createTestTournament() {
  const code = genCode();
  const token = genToken();
  const r = await req('POST', 'tournaments', {
    body: { code, session_token: token, data: { mode: 'americano', tournamentName: 'push test' }, updated_at: new Date().toISOString() },
    prefer: 'return=representation'
  });
  if (!r.ok) throw new Error('createTestTournament failed: ' + JSON.stringify(r.data));
  return code;
}

async function callPushFunction(body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/push-round`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  console.log('Running push-round tests against', SUPABASE_URL);
  const code = await createTestTournament();
  console.log('  test tournament code:', code);

  const brokenEndpoint = 'https://example.com/definitely-not-a-real-push-endpoint-' + Date.now();
  const keys = genFakeSubscriptionKeys();

  // Test 1: insert a subscription with an unreachable endpoint, call the function.
  const insertRes = await req('POST', 'push_subscriptions', {
    body: {
      tournament_code: code, player_id: 1, endpoint: brokenEndpoint,
      p256dh: keys.p256dh, auth: keys.auth, lang: 'en',
      msg_templates: { playing: 'Court {court}, with {partner}, against {opp1} and {opp2}', resting: 'Resting round {round}', done: 'Finished, rank {rank}' }
    },
    prefer: 'return=representation'
  });
  assert(insertRes.ok, 'insert subscription with unreachable endpoint');

  const callRes = await callPushFunction({
    tournament_code: code, round: 1, kind: 'round',
    statuses: { '1': { name: 'Test Player', status: 'playing', round: 1, court: 1, partner: 'Partner', opponents: ['Opp1', 'Opp2'], rank: null } }
  });
  assert(callRes.ok, 'push-round function call returns ok');

  // Test 2: the broken row should have been removed by the function (404 from example.com).
  const delBroken = await req('DELETE', `push_subscriptions?endpoint=eq.${encodeURIComponent(brokenEndpoint)}`, { prefer: 'return=representation' });
  assert(delBroken.ok && Array.isArray(delBroken.data) && delBroken.data.length === 0, 'broken subscription row was already removed by the function');

  // Test 3 + 4: push_log is filled (indirectly, RLS blocks reading it directly) and a
  // second call for the same (code, round, kind) is skipped as a duplicate.
  const callAgain = await callPushFunction({
    tournament_code: code, round: 1, kind: 'round',
    statuses: { '1': { name: 'Test Player', status: 'playing', round: 1, court: 1, partner: 'Partner', opponents: ['Opp1', 'Opp2'], rank: null } }
  });
  assert(callAgain.ok && callAgain.data && callAgain.data.skipped === 'duplicate', 'second call for the same round is skipped (push_log dedupe)');

  // Test 5: anon can never select push_subscriptions, even for a row that exists.
  const freshEndpoint = 'https://example.com/fresh-test-endpoint-' + Date.now();
  const freshKeys = genFakeSubscriptionKeys();
  const insertFresh = await req('POST', 'push_subscriptions', {
    body: {
      tournament_code: code, player_id: 2, endpoint: freshEndpoint,
      p256dh: freshKeys.p256dh, auth: freshKeys.auth, lang: 'nl',
      msg_templates: { playing: 'test', resting: 'test', done: 'test' }
    },
    prefer: 'return=representation'
  });
  assert(insertFresh.ok, 'insert a fresh subscription for the select/delete checks');

  const selectAttempt = await req('GET', `push_subscriptions?endpoint=eq.${encodeURIComponent(freshEndpoint)}&select=id`);
  assert(selectAttempt.ok && Array.isArray(selectAttempt.data) && selectAttempt.data.length === 0, 'anon select returns nothing, even for a row that exists (RLS blocks it)');

  // Test 6: deleting your own endpoint (exact match) works.
  const delFresh = await req('DELETE', `push_subscriptions?endpoint=eq.${encodeURIComponent(freshEndpoint)}`, { prefer: 'return=representation' });
  assert(delFresh.ok && Array.isArray(delFresh.data) && delFresh.data.length === 1, 'delete by exact own endpoint succeeds and removes the row');

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log('Note: the test tournaments row and the push_log rows created above have no');
  console.log('DELETE policy for anon (same as the rest of the app) and are left behind.');
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('\nTest run crashed:', e.message || e); process.exit(1); });
