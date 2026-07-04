// Captures real app UI screenshots for the 3 new feature pages, by seeding
// in-memory app state via page.evaluate (per verified app/index.html internals)
// and capturing native WebP via the Chromium CDP session (no external
// conversion tool needed, no network calls required for any of these).
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const PORT = 8410;
const VIEWPORT = { width: 390, height: 844 };

async function startServer() {
  const proc = spawn('npx', ['--yes', 'http-server', repoRoot, '-p', String(PORT), '-s'], { stdio: 'pipe' });
  await new Promise(r => setTimeout(r, 3000));
  return proc;
}

async function shot(page, name) {
  const cdp = await page.context().newCDPSession(page);
  const res = await cdp.send('Page.captureScreenshot', { format: 'webp', quality: 85 });
  const outPath = path.join(repoRoot, name.endsWith('.webp') ? name : name + '.webp');
  fs.writeFileSync(outPath, Buffer.from(res.data, 'base64'));
  console.log('saved', outPath, fs.statSync(outPath).size, 'bytes');
}

async function newAppPage(browser, { urlParams = '', localStorageSeed = {} } = {}) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  await ctx.addInitScript((seed) => {
    localStorage.setItem('padel-ob-v2', '1'); // skip onboarding
    localStorage.setItem('padel-share-seen', '1'); // skip share nudge
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, localStorageSeed);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('PAGEERROR', e.message));
  await page.goto(`http://localhost:${PORT}/app/${urlParams}`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(400);
  return { ctx, page };
}

async function run() {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    // ---------- 1. Signup: player join screen, open spots ----------
    {
      const { ctx, page } = await newAppPage(browser);
      await page.evaluate(() => {
        joinCode = 'FRIDAY1';
        joinEvent = { code: 'FRIDAY1', event_name: 'Friday Night Padel', event_date: '2026-07-10', location: 'Padel Club Rotterdam', format: 'americano', max_players: 16, signup_open: true };
        joinConfirmedCount = 9;
        joinWaitlistCount = 0;
        document.getElementById('screen-setup').style.display = 'none';
        document.getElementById('screen-join').style.display = 'block';
        _suRenderJoinInfo();
      });
      await page.waitForTimeout(200);
      await shot(page, 'screenshot-signup-join');
      await ctx.close();
    }

    // ---------- 2. Signup: waitlisted state (event full) ----------
    {
      const { ctx, page } = await newAppPage(browser);
      await page.evaluate(() => {
        joinCode = 'FRIDAY1';
        joinEvent = { code: 'FRIDAY1', event_name: 'Friday Night Padel', event_date: '2026-07-10', location: 'Padel Club Rotterdam', format: 'americano', max_players: 12, signup_open: true };
        joinConfirmedCount = 12;
        joinWaitlistCount = 2;
        document.getElementById('screen-setup').style.display = 'none';
        document.getElementById('screen-join').style.display = 'block';
        _suRenderJoinInfo();
        const nameInp = document.getElementById('join-name');
        if (nameInp) nameInp.value = 'Sophie';
      });
      await page.waitForTimeout(200);
      await shot(page, 'screenshot-signup-waitlisted');
      await ctx.close();
    }

    // ---------- 3. Signup: organizer live list (confirmed + waitlist) ----------
    {
      const { ctx, page } = await newAppPage(browser);
      await page.evaluate(() => {
        suCode = 'FRIDAY1';
        suEvent = { code: 'FRIDAY1', event_name: 'Friday Night Padel', event_date: '2026-07-10', max_players: 12, format: 'americano', signup_open: true };
        suConfirmed = ['Anna', 'Bas', 'Carla', 'Dries', 'Eva', 'Finn', 'Gina', 'Hugo', 'Iris', 'Joost', 'Kai', 'Lotte'].map((name, i) => ({ id: i + 1, name, gender: null }));
        suWaitlist = [{ id: 20, name: 'Mila' }, { id: 21, name: 'Noor' }];
        document.getElementById('screen-setup').style.display = 'none';
        document.getElementById('signup-live-modal').classList.remove('hidden');
        _suRenderLive();
      });
      await page.waitForTimeout(200);
      await shot(page, 'screenshot-signup-organizer');
      await ctx.close();
    }

    // ---------- 4. Club competition: ladder standings + challenge form ----------
    {
      const { ctx, page } = await newAppPage(browser);
      await page.evaluate(() => {
        ccViewCode = 'LADDER1';
        ccComp = { code: 'LADDER1', name: 'Tuesday Ladder', type: 'ladder', session_token: 'owner-token', settings: { challengeRange: 3 } };
        ccSessionToken = 'owner-token';
        ccIsOwner = true;
        ccPresMode = false;
        ccLadderPlayers = ['Anna', 'Bas', 'Carla', 'Dries', 'Eva', 'Finn'].map((name, i) => ({ id: i + 1, name, position: i + 1 }));
        ccLadderChallenges = [
          { id: 1, challenger_name: 'Dries', defender_name: 'Carla', status: 'pending', score: null, reported_winner: 'Dries', created_at: new Date().toISOString() }
        ];
        document.getElementById('screen-setup').style.display = 'none';
        document.getElementById('screen-cc-view').style.display = 'block';
        ccRenderLadderView();
      });
      await page.waitForTimeout(200);
      await shot(page, 'screenshot-competition-ladder');
      await ctx.close();
    }

    // ---------- 5. Club competition: ELO rating table (local Competities) ----------
    {
      const groupId = 'g1', compId = 'c1';
      const group = { id: groupId, name: 'Tuesday Regulars', lines: ['Anna', 'Bas', 'Carla', 'Dries', 'Eva', 'Finn'], updatedAt: Date.now() };
      const sessions = [];
      const names = group.lines;
      for (let s = 0; s < 5; s++) {
        const shuffled = [...names].sort(() => Math.random() - 0.5);
        sessions.push({
          date: new Date(2026, 5, 1 + s * 7).toISOString(),
          results: shuffled.map((n, i) => ({ rank: i + 1, playerNames: [n] }))
        });
      }
      const comp = { id: compId, name: 'Tuesday Evening Competition', groupId, sessions };
      const { ctx, page } = await newAppPage(browser, {
        localStorageSeed: {
          padel_groups: JSON.stringify([group]),
          padel_competitions: JSON.stringify([comp])
        }
      });
      await page.evaluate((compId) => {
        showCompetitions();
        openCompDetail(compId);
      }, compId);
      await page.waitForTimeout(200);
      await shot(page, 'screenshot-competition-elo');
      await ctx.close();
    }

    // ---------- 6. Club competition: shareable standings card (real canvas render) ----------
    {
      const { ctx, page } = await newAppPage(browser);
      const dataUrl = await page.evaluate(async () => {
        ccComp = { code: 'SERIES1', name: 'Wednesday Club Series', type: 'series', club_name: 'PC Rotterdam', session_token: 'owner-token' };
        ccEvents = [
          { competition_code: 'SERIES1', results: [{ name: 'Anna', place: 1, points: 30 }, { name: 'Bas', place: 2, points: 24 }, { name: 'Carla', place: 3, points: 20 }], played_at: '2026-06-01' },
          { competition_code: 'SERIES1', results: [{ name: 'Anna', place: 2, points: 24 }, { name: 'Bas', place: 1, points: 30 }, { name: 'Carla', place: 3, points: 20 }], played_at: '2026-06-08' },
          { competition_code: 'SERIES1', results: [{ name: 'Dries', place: 1, points: 30 }, { name: 'Anna', place: 2, points: 24 }, { name: 'Eva', place: 3, points: 20 }], played_at: '2026-06-15' }
        ];
        let capturedDataUrl = null;
        HTMLCanvasElement.prototype.toBlob = function () { capturedDataUrl = this.toDataURL('image/png'); };
        await ccSharePng();
        return capturedDataUrl;
      });
      if (dataUrl) {
        const base64 = dataUrl.split(',')[1];
        fs.writeFileSync(path.join(repoRoot, 'screenshot-competition-share-card.png'), Buffer.from(base64, 'base64'));
        console.log('saved share card png (will convert to webp separately)');
      } else {
        console.error('FAILED to capture share card canvas');
      }
      await ctx.close();
    }

    // ---------- 7. Player experience: personal view, my match highlighted ----------
    const fakeAmericanoState = () => ({
      mode: 'americano',
      tournamentName: 'Summer Cup',
      AP: ['Anna', 'Bas', 'Carla', 'Dries', 'Eva', 'Finn', 'Gina', 'Hugo'].map((name, id) => ({ id, name, pts: [18, 14, 12, 16, 9, 20, 11, 7][id] })),
      AM: [
        [ { id: 'am-0-0', round: 1, a1: 0, a2: 1, b1: 2, b2: 3, sa: 18, sb: 14, done: true, court: 1, targetPts: 32 },
          { id: 'am-0-1', round: 1, a1: 4, a2: 5, b1: 6, b2: 7, sa: 9, sb: 20, done: true, court: 2, targetPts: 32 } ],
        [ { id: 'am-1-0', round: 2, a1: 0, a2: 2, b1: 1, b2: 4, sa: 12, sb: 9, done: false, court: 1, targetPts: 32 },
          { id: 'am-1-1', round: 2, a1: 3, a2: 6, b1: 5, b2: 7, sa: 5, sb: 6, done: false, court: 2, targetPts: 32 } ]
      ],
      R: { gpm: 3, matchPts: 32, courts: 2, timerMins: 10, winBy2: true, scoringMode: 'points' },
      playerScoring: true
    });

    {
      const { ctx, page } = await newAppPage(browser, { urlParams: '?player=Anna' });
      await page.evaluate((state) => {
        viewMode = true;
        _viewCode = 'VIEW1';
        _applyViewState(state);
      }, fakeAmericanoState());
      await page.waitForTimeout(300);
      await shot(page, 'screenshot-player-view');

      // close-up of the highlighted "my match" card with self score entry controls
      const myMatchCard = page.locator('.am-court-card.my-match, .am-match:has(.am-court-my-badge)').first();
      const altLocator = page.locator('.my-match').first();
      const target = (await altLocator.count()) ? altLocator : myMatchCard;
      if (await target.count()) {
        const buf = await target.screenshot({ type: 'png' });
        fs.writeFileSync(path.join(repoRoot, 'screenshot-self-score-entry.png'), buf);
        console.log('saved self-score-entry crop (png, will convert)');
      } else {
        console.error('FAILED to locate my-match card for self-score-entry crop');
      }
      await ctx.close();
    }

    // ---------- 8. Presentation / TV mode ----------
    {
      const presentationPayload = {
        mode: 'americano',
        name: 'Summer Cup',
        standings: [
          { pos: 1, name: 'Finn', pts: 20 }, { pos: 2, name: 'Anna', pts: 18 },
          { pos: 3, name: 'Dries', pts: 16 }, { pos: 4, name: 'Bas', pts: 14 }
        ],
        rounds: [
          { round: 2, matches: [
            { a1: 'Anna', a2: 'Carla', b1: 'Bas', b2: 'Eva', sa: 12, sb: 9, done: false, court: 1 },
            { a1: 'Dries', a2: 'Gina', b1: 'Finn', b2: 'Hugo', sa: 5, sb: 6, done: false, court: 2 }
          ] }
        ],
        bracket: null,
        timer: { round: 2, start: Date.now() - 4 * 60 * 1000, limit: 10 * 60 },
        ts: Date.now()
      };
      const { ctx, page } = await newAppPage(browser, {
        urlParams: '?pres=1',
        localStorageSeed: { 'padel-presentation': JSON.stringify(presentationPayload) }
      });
      await page.waitForTimeout(500);
      await shot(page, 'screenshot-presentation-mode');
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
}

run();
