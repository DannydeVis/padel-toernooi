#!/usr/bin/env node
// Node-simulaties voor alle toernooiformats. Extraheert de echte scheduling-
// functies uit app/index.html (geen kopie, dus de test test de productiecode)
// en draait elk format van minimum tot maximum spelers, even en oneven,
// in beide scoringsmodi. Asserts:
//  - geen speler dubbel ingedeeld in een ronde
//  - rustverschil maximaal 1 (per geslacht bij Mixicano)
//  - KOTC: aankomers op een baan splitsen altijd
//  - Mixicano: elk koppel is altijd gemengd
//  - Team Mexicano: geen vermijdbare rematch uit de vorige ronde
//  - puntenwijziging mid-toernooi raakt gespeelde/lopende rondes niet
//  - som-validatie (isMatchComplete) klopt voor padel, pickleball en op tijd
// Draaien: node scripts/test-sims.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'app', 'index.html'), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.log('  FAIL -', msg); }
}

// ── functie-extractie via brace matching ──────
function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} niet gevonden`);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(`function ${name}: einde niet gevonden`);
}

const fns = [
  'buildTASchedule', 'buildTeamMexicanoRound', 'buildAmericanoSchedule',
  'buildMixicanoRound', 'buildMexicanoRound', '_kocShuffle', 'buildKocRound',
  '_matchTarget', 'isMatchComplete', 'updateMatchPtsLive', 'getRestRounds',
  '_rebuildFutureAmRounds', 'getPlayerStatus'
].map(extractFunction).join('\n\n');

// Genereer een module: de geëxtraheerde functies + de globals/stubs die ze
// verwachten, verpakt in een factory zodat elke simulatie vers begint.
const moduleSrc = `
export function makeEngine(){
  const assertFailures=[];
  const console={ assert:(c,...m)=>{ if(!c) assertFailures.push(m.join(' ')); }, log:()=>{} };
  let R={gpm:3,matchPts:32,courts:0,timerMins:0,winBy2:true,scoringMode:'points',kocRounds:10};
  let AP=[],AM=[],KOCP=[],KOCM=[],kocRound=0;
  let TAP=[],TAM=[],TMP=[],TMM=[];
  let mode='americano', sport='padel', viewMode=false;
  function renderAmericano(){} function renderTeamAmericano(){} function saveState(){}
  function _curTeamP(){ return mode==='teammexicano'?TMP:TAP; }
  function _curTeamM(){ return mode==='teammexicano'?TMM:TAM; }
${fns.replace(/^/gm, '  ')}
  return {
    assertFailures,
    get R(){return R}, get AP(){return AP}, get AM(){return AM},
    get KOCP(){return KOCP}, get KOCM(){return KOCM},
    get TAP(){return TAP}, get TAM(){return TAM}, get TMP(){return TMP}, get TMM(){return TMM},
    set(vals){
      if('R' in vals) R=vals.R; if('AP' in vals) AP=vals.AP; if('AM' in vals) AM=vals.AM;
      if('KOCP' in vals) KOCP=vals.KOCP; if('KOCM' in vals) KOCM=vals.KOCM;
      if('kocRound' in vals) kocRound=vals.kocRound;
      if('TAP' in vals) TAP=vals.TAP; if('TAM' in vals) TAM=vals.TAM;
      if('TMP' in vals) TMP=vals.TMP; if('TMM' in vals) TMM=vals.TMM;
      if('mode' in vals) mode=vals.mode; if('sport' in vals) sport=vals.sport;
    },
    buildTASchedule, buildTeamMexicanoRound, buildAmericanoSchedule,
    buildMixicanoRound, buildMexicanoRound, buildKocRound,
    isMatchComplete, _matchTarget, updateMatchPtsLive, getRestRounds,
    _rebuildFutureAmRounds, getPlayerStatus
  };
}
`;

const tmp = mkdtempSync(join(tmpdir(), 'padel-sims-'));
const modPath = join(tmp, 'engine.mjs');
writeFileSync(modPath, moduleSrc);
const { makeEngine } = await import(pathToFileURL(modPath).href);

// ── helpers ───────────────────────────────────
const playersOf = m => 'a1' in m ? [m.a1, m.a2, m.b1, m.b2] : [m.a, m.b];

function checkNoDup(matches, label) {
  const seen = new Set();
  for (const m of matches) for (const id of playersOf(m)) {
    assert(!seen.has(id), `${label}: speler ${id} dubbel ingedeeld in een ronde`);
    seen.add(id);
  }
}

function restSpread(ids, rounds, label, maxDiff = 1) {
  const rests = new Map(ids.map(id => [id, 0]));
  rounds.forEach(ms => {
    const playing = new Set(ms.flatMap(playersOf));
    ids.forEach(id => { if (!playing.has(id)) rests.set(id, rests.get(id) + 1); });
  });
  const vals = [...rests.values()];
  const diff = Math.max(...vals) - Math.min(...vals);
  assert(diff <= maxDiff, `${label}: rustverschil ${diff} > ${maxDiff}`);
}

// willekeurige geldige score voor een match
function playMatch(eng, m, scoringMode) {
  const target = m.targetPts ?? eng.R.matchPts;
  if (scoringMode === 'time') {
    m.sa = Math.floor(Math.random() * 25); m.sb = Math.floor(Math.random() * 25);
  } else {
    m.sa = Math.floor(Math.random() * (target + 1)); m.sb = target - m.sa;
  }
  m.done = true;
}

// bestaat er een perfecte koppeling van teams zonder rematch uit vorige ronde?
function pairingWithoutRematchExists(teamIds, playedLast) {
  if (teamIds.length === 0) return true;
  const [first, ...rest] = teamIds;
  for (let i = 0; i < rest.length; i++) {
    if (playedLast(first, rest[i])) continue;
    const remaining = rest.filter((_, k) => k !== i);
    if (pairingWithoutRematchExists(remaining, playedLast)) return true;
  }
  return false;
}

// ── 1. Americano: volledig schema, 4..24 spelers ──
for (let n = 4; n <= 24; n++) {
  const eng = makeEngine();
  const ids = Array.from({ length: n }, (_, i) => i);
  const rounds = eng.buildAmericanoSchedule(ids, 0, 0);
  assert(rounds.length === n - 1, `americano n=${n}: ${rounds.length} rondes, verwacht ${n - 1}`);
  rounds.forEach((ms, ri) => checkNoDup(ms, `americano n=${n} ronde ${ri + 1}`));
  restSpread(ids, rounds, `americano n=${n}`);
  if (n % 4 === 0) {
    // circle-methode: unieke partners
    const partners = new Set();
    for (const m of rounds.flat()) for (const [x, y] of [[m.a1, m.a2], [m.b1, m.b2]]) {
      const key = Math.min(x, y) + '-' + Math.max(x, y);
      assert(!partners.has(key), `americano n=${n}: partnerherhaling ${key}`);
      partners.add(key);
    }
  }
  // beperkt aantal banen: rustverschil blijft max 1
  if (n >= 8) {
    const eng2 = makeEngine();
    const rounds2 = eng2.buildAmericanoSchedule(ids, 0, 1);
    rounds2.forEach((ms, ri) => checkNoDup(ms, `americano n=${n} 1 baan ronde ${ri + 1}`));
    restSpread(ids, rounds2, `americano n=${n} 1 baan`);
  }
}

// ── 2. Mexicano: rondegewijs simuleren, 4..24 spelers, beide scoringsmodi ──
for (const scoringMode of ['points', 'time']) {
  for (let n = 4; n <= 24; n++) {
    const eng = makeEngine();
    eng.R.scoringMode = scoringMode;
    const AP = Array.from({ length: n }, (_, id) => ({ id, name: 'p' + id, pts: 0 }));
    eng.set({ AP, AM: [], mode: 'mexicano' });
    const AM = eng.AM;
    AM.push(eng.buildMexicanoRound(AP, AM, 1, 0));
    const totalRounds = n - 1;
    for (let r = 1; r <= totalRounds; r++) {
      const ms = AM[r - 1];
      checkNoDup(ms, `mexicano n=${n} ${scoringMode} ronde ${r}`);
      ms.forEach(m => {
        playMatch(eng, m, scoringMode);
        for (const id of [m.a1, m.a2]) AP[id].pts += m.sa;
        for (const id of [m.b1, m.b2]) AP[id].pts += m.sb;
      });
      if (r < totalRounds) AM.push(eng.buildMexicanoRound(AP, AM, r + 1, 0));
    }
    restSpread(AP.map(p => p.id), AM, `mexicano n=${n} ${scoringMode}`);
  }
}

// ── 3. Mixicano: 2..10 mannen x 2..10 vrouwen, altijd gemengd ──
for (const scoringMode of ['points', 'time']) {
  for (let m = 2; m <= 10; m++) for (let w = 2; w <= 10; w++) {
    const eng = makeEngine();
    eng.R.scoringMode = scoringMode;
    const AP = [];
    for (let i = 0; i < m; i++) AP.push({ id: AP.length, name: 'm' + i, pts: 0, gender: 'M' });
    for (let i = 0; i < w; i++) AP.push({ id: AP.length, name: 'w' + i, pts: 0, gender: 'W' });
    eng.set({ AP, AM: [], mode: 'mixicano' });
    const AM = eng.AM;
    const gender = id => AP[id].gender;
    const totalRounds = Math.min(m + w - 1, 12);
    AM.push(eng.buildMixicanoRound(AP, AM, 1, 0));
    for (let r = 1; r <= totalRounds; r++) {
      const ms = AM[r - 1];
      checkNoDup(ms, `mixicano ${m}M/${w}V ${scoringMode} ronde ${r}`);
      for (const match of ms) {
        const teams = [[match.a1, match.a2], [match.b1, match.b2]];
        for (const [x, y] of teams) {
          assert(new Set([gender(x), gender(y)]).size === 2,
            `mixicano ${m}M/${w}V ronde ${r}: koppel ${x}/${y} niet gemengd`);
        }
      }
      ms.forEach(match => {
        playMatch(eng, match, scoringMode);
        for (const id of [match.a1, match.a2]) AP[id].pts += match.sa;
        for (const id of [match.b1, match.b2]) AP[id].pts += match.sb;
      });
      if (r < totalRounds) AM.push(eng.buildMixicanoRound(AP, AM, r + 1, 0));
    }
    // rustverschil per geslacht max 1
    restSpread(AP.filter(p => p.gender === 'M').map(p => p.id), AM, `mixicano ${m}M/${w}V mannen`);
    restSpread(AP.filter(p => p.gender === 'W').map(p => p.id), AM, `mixicano ${m}M/${w}V vrouwen`);
    assert(eng.assertFailures.length === 0, `mixicano ${m}M/${w}V: console.assert faalde: ${eng.assertFailures[0] || ''}`);
  }
}

// ── 4. King of the Court: 8..24 spelers, aankomers splitsen altijd ──
for (let n = 8; n <= 24; n++) {
  const eng = makeEngine();
  const KOCP = Array.from({ length: n }, (_, id) => ({ id, name: 'p' + id, pts: 0, kingRounds: 0, court: null, lastRest: -1, arrow: null }));
  eng.set({ KOCP, KOCM: [], kocRound: 1, mode: 'kingofcourt' });
  eng.R.courts = Math.floor(n / 4);
  eng.R.kocRounds = 12;
  const KOCM = eng.KOCM;
  KOCM.push(eng.buildKocRound(1));
  for (let r = 1; r <= 12; r++) {
    const ms = KOCM[r - 1];
    checkNoDup(ms, `kotc n=${n} ronde ${r}`);
    if (r > 1) {
      // aankomers per baan reconstrueren: winnaars/verliezers van vorige ronde
      const prev = KOCM[r - 2];
      const incoming = {}; // court -> [pair, pair]
      prev.forEach(m => {
        const wA = m.gp === 'A' ? true : m.gp === 'B' ? false : m.sa > m.sb;
        const winners = wA ? [m.a1, m.a2] : [m.b1, m.b2];
        const losers = wA ? [m.b1, m.b2] : [m.a1, m.a2];
        const N = eng.R.courts;
        const wc = m.kocCourt === 1 ? 1 : m.kocCourt - 1;
        const lc = m.kocCourt === N ? N : m.kocCourt + 1;
        (incoming[wc] = incoming[wc] || []).push(winners);
        (incoming[lc] = incoming[lc] || []).push(losers);
      });
      ms.forEach(m => {
        for (const pair of incoming[m.kocCourt] || []) {
          const sameTeamA = pair.includes(m.a1) && pair.includes(m.a2);
          const sameTeamB = pair.includes(m.b1) && pair.includes(m.b2);
          assert(!sameTeamA && !sameTeamB,
            `kotc n=${n} ronde ${r} baan ${m.kocCourt}: aankomers ${pair} niet gesplitst`);
        }
      });
    }
    ms.forEach(m => {
      const target = eng.R.matchPts;
      let sa = Math.floor(Math.random() * (target + 1)), sb = target - sa;
      if (sa === sb) sa++; // geen gouden punt in de simulatie
      m.sa = sa; m.sb = Math.min(sb, target); m.done = true;
      KOCP.forEach(p => {
        if (p.id === m.a1 || p.id === m.a2) p.pts += m.sa;
        if (p.id === m.b1 || p.id === m.b2) p.pts += m.sb;
      });
    });
    if (r < 12) KOCM.push(eng.buildKocRound(r + 1));
  }
  restSpread(KOCP.map(p => p.id), KOCM, `kotc n=${n}`);
  assert(eng.assertFailures.length === 0, `kotc n=${n}: console.assert faalde: ${eng.assertFailures[0] || ''}`);
}

// ── 5. Team Americano: 3..12 koppels, iedereen tegen iedereen ──
for (let n = 3; n <= 12; n++) {
  const eng = makeEngine();
  eng.set({ mode: 'teamamericano' });
  const rounds = eng.buildTASchedule(n);
  const met = new Set();
  rounds.forEach((ms, ri) => {
    checkNoDup(ms, `team-americano n=${n} ronde ${ri + 1}`);
    ms.forEach(m => {
      const key = Math.min(m.a, m.b) + '-' + Math.max(m.a, m.b);
      assert(!met.has(key), `team-americano n=${n}: dubbele ontmoeting ${key}`);
      met.add(key);
    });
  });
  assert(met.size === n * (n - 1) / 2, `team-americano n=${n}: ${met.size} ontmoetingen, verwacht ${n * (n - 1) / 2}`);
  restSpread(Array.from({ length: n }, (_, i) => i), rounds, `team-americano n=${n}`);
}

// ── 6. Team Mexicano: 3..12 koppels, geen vermijdbare rematch ──
for (const scoringMode of ['points', 'time']) {
  for (let n = 3; n <= 12; n++) {
    const eng = makeEngine();
    eng.R.scoringMode = scoringMode;
    const TMP = Array.from({ length: n }, (_, id) => ({ id, n1: 'a' + id, n2: 'b' + id, pts: 0 }));
    eng.set({ TMP, TMM: [], mode: 'teammexicano' });
    const TMM = eng.TMM;
    TMM.push(eng.buildTeamMexicanoRound(TMP, TMM, 1, 0));
    const totalRounds = 14;
    for (let r = 1; r <= totalRounds; r++) {
      const ms = TMM[r - 1];
      checkNoDup(ms, `team-mexicano n=${n} ${scoringMode} ronde ${r}`);
      if (r > 1) {
        const prev = TMM[r - 2];
        const playedLast = (a, b) => prev.some(m => (m.a === a && m.b === b) || (m.a === b && m.b === a));
        const hasRematch = ms.some(m => playedLast(m.a, m.b));
        if (hasRematch) {
          const playing = ms.flatMap(m => [m.a, m.b]);
          assert(!pairingWithoutRematchExists(playing, playedLast),
            `team-mexicano n=${n} ${scoringMode} ronde ${r}: vermijdbare rematch`);
        }
      }
      ms.forEach(m => {
        playMatch(eng, m, scoringMode);
        TMP[m.a].pts += m.sa; TMP[m.b].pts += m.sb;
      });
      if (r < totalRounds) TMM.push(eng.buildTeamMexicanoRound(TMP, TMM, r + 1, 0));
    }
    restSpread(TMP.map(p => p.id), TMM, `team-mexicano n=${n} ${scoringMode}`);
  }
}

// ── 7. Puntenwijziging mid-toernooi: gespeelde/lopende rondes onaangetast ──
{
  const eng = makeEngine();
  const AP = Array.from({ length: 8 }, (_, id) => ({ id, name: 'p' + id, pts: 0 }));
  eng.set({ AP, AM: [], mode: 'americano' });
  const AM = eng.AM;
  eng.buildAmericanoSchedule(AP.map(p => p.id), 0, 0).forEach(r => AM.push(r));
  // ronde 1 gespeeld, ronde 2 lopend (een score ingevoerd), rest onaangeroerd
  AM[0].forEach(m => { m.sa = 20; m.sb = 12; m.done = true; });
  AM[1][0].sa = 5;
  eng.updateMatchPtsLive(24);
  assert(eng.R.matchPts === 24, 'puntenwijziging: R.matchPts bijgewerkt');
  assert(AM[0].every(m => m.targetPts === 32), 'puntenwijziging: gespeelde ronde behoudt 32');
  assert(AM[1].every(m => m.targetPts === 32), 'puntenwijziging: lopende ronde behoudt 32');
  for (let i = 2; i < AM.length; i++) {
    assert(AM[i].every(m => m.targetPts === 24), `puntenwijziging: toekomstige ronde ${i + 1} naar 24`);
  }
  // som-validatie volgt targetPts van de match, niet de nieuwe R.matchPts
  assert(eng.isMatchComplete(20, 12, eng._matchTarget(AM[1][0])), 'puntenwijziging: lopende match valideert op 32');
  assert(eng.isMatchComplete(14, 10, eng._matchTarget(AM[2][0])), 'puntenwijziging: nieuwe match valideert op 24');
}

// ── 8. Som-validatie (isMatchComplete) ────────
{
  const eng = makeEngine();
  // padel, vast aantal punten: som moet exact matchPts zijn
  assert(eng.isMatchComplete(20, 12, 32) === true, 'som: 20+12=32 geldig');
  assert(eng.isMatchComplete(20, 11, 32) === false, 'som: 20+11=31 ongeldig');
  assert(eng.isMatchComplete(33, 0, 32) === false, 'som: 33+0 ongeldig');
  assert(eng.isMatchComplete(0, 32, 32) === true, 'som: 0+32 geldig');
  // op tijd: elke uitslag geldig
  eng.R.scoringMode = 'time';
  assert(eng.isMatchComplete(7, 3, 32) === true, 'som op tijd: 7-3 geldig');
  eng.R.scoringMode = 'points';
  // pickleball: winnen met 2 verschil (winBy2)
  eng.set({ sport: 'pickleball' });
  assert(eng.isMatchComplete(11, 9, 11) === true, 'pickleball: 11-9 geldig');
  assert(eng.isMatchComplete(11, 10, 11) === false, 'pickleball: 11-10 ongeldig (winBy2)');
  assert(eng.isMatchComplete(12, 10, 11) === true, 'pickleball: 12-10 geldig');
  eng.R.winBy2 = false;
  assert(eng.isMatchComplete(11, 10, 11) === true, 'pickleball zonder winBy2: 11-10 geldig');
}

// ── 9. Uitvaller + laatkomer via herbouw van toekomstige rondes ──
{
  const eng = makeEngine();
  const AP = Array.from({ length: 9 }, (_, id) => ({ id, name: 'p' + id, pts: 0 }));
  eng.set({ AP, AM: [], mode: 'americano' });
  const AM = eng.AM;
  eng.buildAmericanoSchedule(AP.map(p => p.id), 0, 0).forEach(r => AM.push(r));
  AM[0].forEach(m => { m.sa = 16; m.sb = 16; m.done = true; });
  // speler 3 valt uit na ronde 1 (ronde 2 is actief)
  AP[3].paused = true; AP[3].pausedAtRound = 2;
  eng._rebuildFutureAmRounds();
  const AM2 = eng.AM;
  for (let ri = 2; ri < AM2.length; ri++) {
    assert(!AM2[ri].some(m => playersOf(m).includes(3)),
      `uitvaller: speler 3 nog ingedeeld in ronde ${ri + 1}`);
  }
  // laatkomer: speler 9 sluit aan vanaf ronde 3
  const AP2 = eng.AP;
  AP2.push({ id: 9, name: 'laat', pts: 0, joinedRound: 3 });
  eng._rebuildFutureAmRounds();
  const AM3 = eng.AM;
  assert(!AM3[1].some(m => playersOf(m).includes(9)), 'laatkomer: speelt niet in lopende ronde 2');
  const playsLater = AM3.slice(2).some(ms => ms.some(m => playersOf(m).includes(9)));
  assert(playsLater, 'laatkomer: ingedeeld in latere rondes');
  // rustteller telt alleen vanaf joinedRound
  assert(eng.getRestRounds(AP2[9]) === 0, 'rustteller laatkomer telt niet voor toetreden');
}

rmSync(tmp, { recursive: true, force: true });
console.log(`\ntest-sims: ${passed} ok, ${failed} gefaald`);
if (failed) { console.log('Eerste failures:', failures.slice(0, 10)); process.exit(1); }
