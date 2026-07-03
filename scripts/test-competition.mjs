#!/usr/bin/env node
// Test script for the clubcompetitie (avondencompetitie) + ladder feature.
// Uses the same Supabase URL and anon key as app/index.html, talks directly
// to the PostgREST endpoint (no extra dependencies needed), same style as
// scripts/test-signup.mjs and scripts/test-push.mjs.
//
// Cleans up everything it can: competition_events, ladder_players and
// ladder_challenges rows it inserted are all deletable by their owner.
// The `competitions` row itself has no DELETE policy (same pattern as
// `tournaments`/`signup_events`), so test competitions are left behind
// harmlessly, and `ladder_challenges` also has no DELETE policy by design
// (the history must always be kept), so approved/rejected test challenges
// are left behind too.

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

// ── Pure logic, mirrors app/index.html exactly ──────────────────────
const CC_FIXED_SCHEDULE = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
function ccNormName(s) { return (s || '').trim().toLowerCase().replace(/\s+/g, ' ').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function ccResolveName(comp, rawName) {
  const norm = ccNormName(rawName);
  const aliases = (comp && comp.aliases) || {};
  return aliases[norm] || (rawName || '').trim();
}
function ccPointsLinear(place, n) { return Math.max(1, (n || place) - place + 1); }
function ccPointsFixed(place) { return place <= CC_FIXED_SCHEDULE.length ? CC_FIXED_SCHEDULE[place - 1] : 1; }
function ccPointsForPlace(comp, place, n) {
  const model = (comp.settings && comp.settings.pointModel) || 'linear';
  return model === 'fixed' ? ccPointsFixed(place) : ccPointsLinear(place, n);
}
function ccComputeLeaderboard(comp, events) {
  const byPlayer = {};
  events.forEach(ev => {
    const n = (ev.results || []).length;
    (ev.results || []).forEach(r => {
      const canon = ccResolveName(comp, r.name);
      if (!byPlayer[canon]) byPlayer[canon] = { name: canon, evenings: [], wins: 0 };
      const pts = ccPointsForPlace(comp, r.place, n);
      byPlayer[canon].evenings.push({ points: pts, place: r.place, playedAt: ev.played_at });
      if (r.place === 1) byPlayer[canon].wins++;
    });
  });
  const bestOf = comp.settings && comp.settings.bestOf;
  const rows = Object.values(byPlayer).map(p => {
    const evenings = [...p.evenings].sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt));
    let counted = evenings;
    if (bestOf && bestOf.enabled && bestOf.count > 0 && evenings.length > bestOf.count) {
      counted = [...evenings].sort((a, b) => b.points - a.points).slice(0, bestOf.count);
    }
    const totalPoints = counted.reduce((s, e) => s + e.points, 0);
    const avgPlace = evenings.length ? Math.round(evenings.reduce((s, e) => s + e.place, 0) / evenings.length * 10) / 10 : 0;
    return { name: p.name, totalPoints, played: evenings.length, wins: p.wins, avgPlace };
  });
  rows.sort((a, b) => b.totalPoints - a.totalPoints || b.wins - a.wins || a.avgPlace - b.avgPlace);
  rows.forEach((r, i) => r.rank = i + 1);
  return rows;
}
function ccChallengeAllowed(challengerPos, defenderPos, range) {
  return defenderPos < challengerPos && (challengerPos - defenderPos) <= range;
}

// ── Supabase helpers ─────────────────────────────────────────────
async function createCompetition(type, settings) {
  const code = genCode();
  const token = genToken();
  const r = await req('POST', 'competitions', {
    body: { code, session_token: token, name: 'Test ' + type, type, settings: settings || {}, aliases: {} },
    prefer: 'return=representation'
  });
  if (!r.ok) throw new Error('createCompetition failed: ' + JSON.stringify(r.data));
  return { code, token, row: r.data[0] };
}
async function fetchCompetition(code) {
  const r = await req('GET', `competitions?code=eq.${code}`);
  return (r.data || [])[0];
}
async function insertEvent(code, format, results) {
  return req('POST', 'competition_events', { body: { competition_code: code, format, results }, prefer: 'return=representation' });
}
async function fetchEvents(code) {
  const r = await req('GET', `competition_events?competition_code=eq.${code}`);
  return r.data || [];
}
async function cleanupEvents(code, token) {
  await req('DELETE', `competition_events?competition_code=eq.${code}`, { token });
}
async function joinLadder(code, name) {
  // Mirrors ccJoinLadder() in app/index.html exactly: position is computed
  // client-side and sent along, the ladder_players.position column has no
  // default and is NOT NULL.
  const players = await fetchLadderPlayers(code);
  const nextPos = players.length ? Math.max(...players.map(p => p.position)) + 1 : 1;
  return req('POST', 'ladder_players', { body: { competition_code: code, name, position: nextPos }, prefer: 'return=representation' });
}
async function fetchLadderPlayers(code) {
  const r = await req('GET', `ladder_players?competition_code=eq.${code}&order=position.asc`);
  return r.data || [];
}
async function cleanupLadderPlayers(code, token) {
  await req('DELETE', `ladder_players?competition_code=eq.${code}`, { token });
}
async function submitChallenge(code, challenger, defender, winner) {
  return req('POST', 'ladder_challenges', {
    body: { competition_code: code, challenger_name: challenger, defender_name: defender, score: '6-4,6-3', reported_winner: winner },
    prefer: 'return=representation'
  });
}
async function fetchChallenges(code) {
  const r = await req('GET', `ladder_challenges?competition_code=eq.${code}`);
  return r.data || [];
}
// Mirrors ccApproveChallenge() in app/index.html exactly.
async function approveChallenge(code, token, challenge) {
  const players = await fetchLadderPlayers(code);
  const challengerP = players.find(p => p.name === challenge.challenger_name);
  const defenderP = players.find(p => p.name === challenge.defender_name);
  if (challengerP && defenderP && challenge.reported_winner === challenge.challenger_name && challengerP.position > defenderP.position) {
    const oldChP = challengerP.position, oldDefP = defenderP.position;
    const between = players.filter(p => p.position >= oldDefP && p.position < oldChP && p.id !== challengerP.id);
    for (const p of between) await req('PATCH', `ladder_players?id=eq.${p.id}`, { token, body: { position: p.position + 1 } });
    await req('PATCH', `ladder_players?id=eq.${challengerP.id}`, { token, body: { position: oldDefP } });
  }
  return req('PATCH', `ladder_challenges?id=eq.${challenge.id}`, { token, body: { status: 'approved', approved_at: new Date().toISOString() } });
}

// ── Tests ─────────────────────────────────────────────────────────
async function testLinearPointsAndTiebreakers() {
  console.log('\nTest 1: linear point model, 3 evenings, standings + tiebreakers');
  const { code, token } = await createCompetition('series', { pointModel: 'linear' });
  try {
    await insertEvent(code, 'Americano', [
      { name: 'P1', place: 1, points: 0, wins: 0, losses: 0 }, { name: 'P2', place: 2, points: 0, wins: 0, losses: 0 },
      { name: 'P3', place: 3, points: 0, wins: 0, losses: 0 }, { name: 'P4', place: 4, points: 0, wins: 0, losses: 0 }
    ]);
    await insertEvent(code, 'Americano', [
      { name: 'P2', place: 1, points: 0, wins: 0, losses: 0 }, { name: 'P1', place: 2, points: 0, wins: 0, losses: 0 },
      { name: 'P4', place: 3, points: 0, wins: 0, losses: 0 }, { name: 'P3', place: 4, points: 0, wins: 0, losses: 0 }
    ]);
    await insertEvent(code, 'Americano', [
      { name: 'P1', place: 1, points: 0, wins: 0, losses: 0 }, { name: 'P3', place: 2, points: 0, wins: 0, losses: 0 },
      { name: 'P2', place: 3, points: 0, wins: 0, losses: 0 }
    ]);
    const comp = await fetchCompetition(code);
    const events = await fetchEvents(code);
    assert(events.length === 3, 'all 3 evenings stored');
    const rows = ccComputeLeaderboard(comp, events);
    const byName = Object.fromEntries(rows.map(r => [r.name, r]));
    assert(byName.P1.totalPoints === 10, `P1 total points = 10 (got ${byName.P1.totalPoints})`);
    assert(byName.P2.totalPoints === 8, `P2 total points = 8 (got ${byName.P2.totalPoints})`);
    assert(byName.P3.totalPoints === 5, `P3 total points = 5 (got ${byName.P3.totalPoints})`);
    assert(byName.P4.totalPoints === 3, `P4 total points = 3 (got ${byName.P4.totalPoints})`);
    assert(rows[0].name === 'P1' && rows[1].name === 'P2' && rows[2].name === 'P3' && rows[3].name === 'P4', 'ranking order P1 > P2 > P3 > P4');
    assert(byName.P1.wins === 2, 'P1 has 2 evening wins');
  } finally {
    await cleanupEvents(code, token);
  }
}

async function testFixedSchedule() {
  console.log('\nTest 2: fixed-schedule point model');
  const { code, token } = await createCompetition('series', { pointModel: 'fixed' });
  try {
    await insertEvent(code, 'Mexicano', [
      { name: 'A', place: 1, points: 0, wins: 0, losses: 0 }, { name: 'B', place: 2, points: 0, wins: 0, losses: 0 },
      { name: 'C', place: 3, points: 0, wins: 0, losses: 0 }, { name: 'D', place: 4, points: 0, wins: 0, losses: 0 }
    ]);
    const comp = await fetchCompetition(code);
    const events = await fetchEvents(code);
    const rows = ccComputeLeaderboard(comp, events);
    const byName = Object.fromEntries(rows.map(r => [r.name, r]));
    assert(byName.A.totalPoints === 25, `place 1 gets 25 points (got ${byName.A.totalPoints})`);
    assert(byName.B.totalPoints === 18, `place 2 gets 18 points (got ${byName.B.totalPoints})`);
    assert(byName.C.totalPoints === 15, `place 3 gets 15 points (got ${byName.C.totalPoints})`);
    assert(byName.D.totalPoints === 12, `place 4 gets 12 points (got ${byName.D.totalPoints})`);
  } finally {
    await cleanupEvents(code, token);
  }
}

async function testBestOfY() {
  console.log('\nTest 3: best-X-of-Y evenings counting');
  const { code, token } = await createCompetition('series', { pointModel: 'linear', bestOf: { enabled: true, count: 2 } });
  try {
    await insertEvent(code, 'Americano', [{ name: 'X', place: 1, points: 0, wins: 0, losses: 0 }, { name: 'Y', place: 2, points: 0, wins: 0, losses: 0 }]);
    await insertEvent(code, 'Americano', [{ name: 'Y', place: 1, points: 0, wins: 0, losses: 0 }, { name: 'X', place: 2, points: 0, wins: 0, losses: 0 }]);
    await insertEvent(code, 'Americano', [{ name: 'X', place: 1, points: 0, wins: 0, losses: 0 }, { name: 'Y', place: 2, points: 0, wins: 0, losses: 0 }]);
    const comp = await fetchCompetition(code);
    const events = await fetchEvents(code);
    const rows = ccComputeLeaderboard(comp, events);
    const byName = Object.fromEntries(rows.map(r => [r.name, r]));
    // X: [2,1,2] full=5, best2=2+2=4. Y: [1,2,1] full=4, best2=2+1=3.
    assert(byName.X.totalPoints === 4, `best-2 total for X = 4 (got ${byName.X.totalPoints}, full sum would be 5)`);
    assert(byName.Y.totalPoints === 3, `best-2 total for Y = 3 (got ${byName.Y.totalPoints}, full sum would be 4)`);
    assert(byName.X.played === 3, 'played count still reflects all 3 evenings');
  } finally {
    await cleanupEvents(code, token);
  }
}

async function testAliasMerge() {
  console.log('\nTest 4: alias merge combines points across name variants');
  const { code, token } = await createCompetition('series', { pointModel: 'linear' });
  try {
    await insertEvent(code, 'Americano', [{ name: 'Piet Jansen', place: 1, points: 0, wins: 0, losses: 0 }, { name: 'Klaas', place: 2, points: 0, wins: 0, losses: 0 }]);
    await insertEvent(code, 'Americano', [{ name: 'P. Jansen', place: 1, points: 0, wins: 0, losses: 0 }, { name: 'Klaas', place: 2, points: 0, wins: 0, losses: 0 }]);
    let comp = await fetchCompetition(code);
    let events = await fetchEvents(code);
    let rows = ccComputeLeaderboard(comp, events);
    assert(rows.some(r => r.name === 'Piet Jansen') && rows.some(r => r.name === 'P. Jansen'), 'before merge: two separate player rows exist');

    const aliases = { [ccNormName('P. Jansen')]: 'Piet Jansen' };
    const patch = await req('PATCH', `competitions?code=eq.${code}`, { token, body: { aliases } });
    assert(patch.ok, 'organizer sets alias mapping');

    comp = await fetchCompetition(code);
    events = await fetchEvents(code);
    rows = ccComputeLeaderboard(comp, events);
    const merged = rows.find(r => r.name === 'Piet Jansen');
    assert(!!merged, 'merged player row exists under canonical name');
    assert(merged && merged.totalPoints === 4, `merged totalPoints = 4 (2+2, got ${merged && merged.totalPoints})`);
    assert(!rows.some(r => r.name === 'P. Jansen'), 'the alias name no longer appears as a separate row');
  } finally {
    await cleanupEvents(code, token);
  }
}

async function testChallengeRange() {
  console.log('\nTest 5: ladder challenge-range validation (pure logic)');
  assert(ccChallengeAllowed(4, 2, 3) === true, 'challenging 2 spots above (range 3) is allowed');
  assert(ccChallengeAllowed(4, 1, 3) === true, 'challenging exactly 3 spots above (range 3) is allowed (boundary inclusive)');
  assert(ccChallengeAllowed(5, 1, 3) === false, 'challenging 4 spots above (range 3) is rejected');
  assert(ccChallengeAllowed(2, 4, 3) === false, 'challenging someone ranked below you is rejected');
}

async function testPositionShiftAndPending() {
  console.log('\nTest 6+7: pending challenge changes nothing, approval shifts positions');
  const { code, token } = await createCompetition('ladder', { challengeRange: 3 });
  try {
    await joinLadder(code, 'A');
    await joinLadder(code, 'B');
    await joinLadder(code, 'C');
    await joinLadder(code, 'D');
    let players = await fetchLadderPlayers(code);
    assert(players.length === 4, '4 players joined the ladder');
    const posOf = n => players.find(p => p.name === n).position;
    assert(posOf('A') === 1 && posOf('B') === 2 && posOf('C') === 3 && posOf('D') === 4, 'initial ladder order A,B,C,D');

    // D challenges B (2 spots up, within range 3) and wins (upset).
    const sub = await submitChallenge(code, 'D', 'B', 'D');
    assert(sub.ok, 'challenge D vs B submitted');
    let challenges = await fetchChallenges(code);
    const ch = challenges.find(c => c.challenger_name === 'D' && c.defender_name === 'B');
    assert(ch && ch.status === 'pending', 'challenge starts out pending');

    // Pending: positions must be unchanged.
    players = await fetchLadderPlayers(code);
    const stillA = players.find(p => p.name === 'A').position, stillB = players.find(p => p.name === 'B').position;
    assert(stillA === 1 && stillB === 2, 'pending (unapproved) challenge changes no positions yet');

    // Approve: D (pos 4) beat B (pos 2) -> D takes pos 2, B and C shift down by 1.
    const appr = await approveChallenge(code, token, ch);
    assert(appr.ok, 'organizer approves the challenge');
    players = await fetchLadderPlayers(code);
    const p = n => players.find(x => x.name === n).position;
    assert(p('A') === 1, `A stays at position 1 (got ${p('A')})`);
    assert(p('D') === 2, `D moves up to position 2 (got ${p('D')})`);
    assert(p('B') === 3, `B shifts down to position 3 (got ${p('B')})`);
    assert(p('C') === 4, `C shifts down to position 4 (got ${p('C')})`);

    challenges = await fetchChallenges(code);
    const approved = challenges.find(c => c.id === ch.id);
    assert(approved.status === 'approved', 'challenge status is now approved');
  } finally {
    await cleanupLadderPlayers(code, token);
  }
}

async function testHigherRankedWinsNoChange() {
  console.log('\nTest 8: if the higher-ranked player wins, nothing changes');
  const { code, token } = await createCompetition('ladder', { challengeRange: 3 });
  try {
    await joinLadder(code, 'A');
    await joinLadder(code, 'B');
    let players = await fetchLadderPlayers(code);
    const before = { A: players.find(p => p.name === 'A').position, B: players.find(p => p.name === 'B').position };

    const sub = await submitChallenge(code, 'B', 'A', 'A'); // B challenges A, but A (defender/higher ranked) wins
    assert(sub.ok, 'challenge B vs A submitted');
    const challenges = await fetchChallenges(code);
    const ch = challenges.find(c => c.challenger_name === 'B' && c.defender_name === 'A');
    await approveChallenge(code, token, ch);

    players = await fetchLadderPlayers(code);
    const after = { A: players.find(p => p.name === 'A').position, B: players.find(p => p.name === 'B').position };
    assert(after.A === before.A && after.B === before.B, 'positions unchanged when the defender wins');
  } finally {
    await cleanupLadderPlayers(code, token);
  }
}

async function testAnonCannotMutateBeyondPolicy() {
  console.log('\nTest 9: anon key cannot perform mutations outside RLS policy');
  const { code, token } = await createCompetition('series', { pointModel: 'linear' });
  try {
    // No / wrong x-session-token -> UPDATE must be rejected by RLS.
    const badUpdate = await req('PATCH', `competitions?code=eq.${code}`, { body: { name: 'Hacked' } });
    const badUpdate2 = await req('PATCH', `competitions?code=eq.${code}`, { token: genToken(), body: { name: 'Hacked' } });
    assert((badUpdate.data || []).length === 0, 'UPDATE without session token affects 0 rows');
    assert((badUpdate2.data || []).length === 0, 'UPDATE with wrong session token affects 0 rows');
    const check = await fetchCompetition(code);
    assert(check.name !== 'Hacked', 'competition name was not changed by the unauthorized update');

    // ladder_challenges has no DELETE policy at all -> must be rejected outright.
    const chres = await submitChallenge(code, 'Nobody', 'Nobody2', 'Nobody');
    if (chres.ok && chres.data && chres.data[0]) {
      const delTry = await req('DELETE', `ladder_challenges?id=eq.${chres.data[0].id}`, { token });
      assert((delTry.data || []).length === 0 || !delTry.ok, 'DELETE on ladder_challenges is rejected (no delete policy exists)');
    }

    // Inserting a ladder_players row against a 'series' (non-ladder) competition must be rejected.
    const badJoin = await joinLadder(code, 'Should Not Join');
    assert((badJoin.data || []).length === 0 || !badJoin.ok, 'cannot self-add to the ladder of a series-type competition');
  } finally {
    await cleanupEvents(code, token);
  }
}

async function main() {
  console.log('Running clubcompetitie/ladder Supabase tests against', SUPABASE_URL);
  try {
    await testLinearPointsAndTiebreakers();
    await testFixedSchedule();
    await testBestOfY();
    await testAliasMerge();
    await testChallengeRange();
    await testPositionShiftAndPending();
    await testHigherRankedWinsNoChange();
    await testAnonCannotMutateBeyondPolicy();
  } catch (e) {
    console.error('\nTest run crashed:', e.message || e);
    failed++;
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main();
