/*
 * PadelBracket homepage hero demo.
 * Self-mounting, dependency-free, zero hardcoded language strings — every
 * piece of copy is read from data-* attributes on the mount element, so this
 * file is identical on all 8 homepages.
 *
 * buildAmericanoSchedule() below is kept in sync by hand with the real
 * scheduler in app/index.html (search for "function buildAmericanoSchedule").
 * If that algorithm changes, update both copies.
 */
(function () {
  'use strict';
  if (window.PadelDemo) return;

  // ── Americano scheduler (verbatim copy of app/index.html's buildAmericanoSchedule) ──
  function buildAmericanoSchedule(playerIds, roundOffset, courtsWanted, targetPts) {
    roundOffset = roundOffset || 0;
    courtsWanted = courtsWanted || 0;
    targetPts = targetPts || 32;
    const n = playerIds.length;
    if (n < 4) return [];
    const maxCourts = Math.floor(n / 4);
    const activeCourts = courtsWanted > 0 ? Math.min(maxCourts, courtsWanted) : maxCourts;
    const playPerRound = activeCourts * 4;
    const b = n - playPerRound;
    const numRounds = n - 1;

    if (b === 0) {
      let circle = playerIds.slice(1);
      const rounds = [];
      for (let r = 0; r < numRounds; r++) {
        const arr = [playerIds[0], ...circle];
        const pairs = [];
        for (let i = 0; i < Math.floor(n / 2); i++) pairs.push([arr[i], arr[n - 1 - i]]);
        const matches = [];
        for (let i = 0; i < activeCourts; i++) {
          matches.push({
            id: 'am-' + (roundOffset + r) + '-' + i, round: roundOffset + r + 1,
            a1: pairs[i][0], a2: pairs[i][1],
            b1: pairs[pairs.length - 1 - i][0], b2: pairs[pairs.length - 1 - i][1],
            sa: 0, sb: 0, done: false, court: i + 1, targetPts: targetPts
          });
        }
        rounds.push(matches);
        circle = [circle[circle.length - 1], ...circle.slice(0, -1)];
      }
      return rounds;
    }

    let byeQueue = playerIds.slice();
    const partnerCount = {};
    const pc = (x, y) => (partnerCount[x] && partnerCount[x][y]) || 0;
    const addP = (x, y) => { (partnerCount[x] = partnerCount[x] || {})[y] = pc(x, y) + 1; (partnerCount[y] = partnerCount[y] || {})[x] = pc(y, x) + 1; };
    const oppCount = {};
    const oc = (x, y) => (oppCount[x] && oppCount[x][y]) || 0;
    const addO = (x, y) => { (oppCount[x] = oppCount[x] || {})[y] = oc(x, y) + 1; (oppCount[y] = oppCount[y] || {})[x] = oc(y, x) + 1; };
    const rotate = (arr, r) => { const k = arr.length ? r % arr.length : 0; return [...arr.slice(k), ...arr.slice(0, k)]; };
    const rounds = [];
    for (let r = 0; r < numRounds; r++) {
      const byes = byeQueue.slice(0, b);
      const byeSet = new Set(byes);
      let pool = playerIds.filter(p => !byeSet.has(p));

      const teams = [];
      let poolCand = rotate(pool, r);
      while (poolCand.length) {
        let bi = 0, bj = 1, bc = Infinity;
        for (let i = 0; i < poolCand.length; i++) for (let j = i + 1; j < poolCand.length; j++) {
          const cost = pc(poolCand[i], poolCand[j]); if (cost < bc) { bc = cost; bi = i; bj = j; }
        }
        const x = poolCand[bi], y = poolCand[bj]; addP(x, y); teams.push([x, y]);
        poolCand = poolCand.filter((_, k) => k !== bi && k !== bj);
      }

      const matches = [];
      let teamCand = rotate(teams, r);
      let court = 0;
      while (teamCand.length >= 2) {
        let bi = 0, bj = 1, bc = Infinity;
        for (let i = 0; i < teamCand.length; i++) for (let j = i + 1; j < teamCand.length; j++) {
          const a = teamCand[i], bt = teamCand[j];
          const cost = oc(a[0], bt[0]) + oc(a[0], bt[1]) + oc(a[1], bt[0]) + oc(a[1], bt[1]);
          if (cost < bc) { bc = cost; bi = i; bj = j; }
        }
        const tA = teamCand[bi], tB = teamCand[bj];
        addO(tA[0], tB[0]); addO(tA[0], tB[1]); addO(tA[1], tB[0]); addO(tA[1], tB[1]);
        matches.push({
          id: 'am-' + (roundOffset + r) + '-' + court, round: roundOffset + r + 1,
          a1: tA[0], a2: tA[1], b1: tB[0], b2: tB[1], sa: 0, sb: 0, done: false,
          court: court + 1, targetPts: targetPts
        });
        court++;
        teamCand = teamCand.filter((_, k) => k !== bi && k !== bj);
      }

      rounds.push(matches);
      byeQueue = byeQueue.slice(b).concat(byes);
    }
    return rounds;
  }

  function parseNames(raw) {
    return (raw || '')
      .split(/[\n,;]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function renderCourts(container, names, byeLabel, vsLabel, courtLabel) {
    clear(container);
    const ids = names.map((_, i) => i);
    const rounds = buildAmericanoSchedule(ids, 0, 0, 32);
    const round1 = rounds[0] || [];
    const used = new Set();
    round1.forEach(m => { used.add(m.a1); used.add(m.a2); used.add(m.b1); used.add(m.b2); });
    const byes = ids.filter(id => !used.has(id));

    round1.forEach(m => {
      const card = document.createElement('div');
      card.className = 'demo-court';
      const label = document.createElement('span');
      label.className = 'demo-court-label';
      label.textContent = (courtLabel || 'Court') + ' ' + m.court;
      const teamA = document.createElement('div');
      teamA.className = 'demo-team';
      teamA.textContent = names[m.a1] + ' & ' + names[m.a2];
      const vs = document.createElement('div');
      vs.className = 'demo-vs';
      vs.textContent = vsLabel || 'vs';
      const teamB = document.createElement('div');
      teamB.className = 'demo-team';
      teamB.textContent = names[m.b1] + ' & ' + names[m.b2];
      card.appendChild(label);
      card.appendChild(teamA);
      card.appendChild(vs);
      card.appendChild(teamB);
      container.appendChild(card);
    });

    if (byes.length && byeLabel) {
      const byeEl = document.createElement('p');
      byeEl.className = 'demo-bye';
      byeEl.textContent = byeLabel + ' ' + byes.map(id => names[id]).join(', ');
      container.appendChild(byeEl);
    }
  }

  function mount(root) {
    if (!root || root.__padelDemoMounted) return;
    root.__padelDemoMounted = true;

    const input = root.querySelector('[data-demo-input]');
    const exampleBtn = root.querySelector('[data-demo-example]');
    const errorEl = root.querySelector('[data-demo-error]');
    const courtsEl = root.querySelector('[data-demo-courts]');
    const cta = root.querySelector('[data-demo-cta]');
    if (!input || !courtsEl) return;

    const exampleNames = (root.dataset.exampleNames || '').split(',').map(s => s.trim()).filter(Boolean);
    const errorMin = root.dataset.errorMin || '';
    const placeholder = root.dataset.placeholder || '';
    const byeLabel = root.dataset.byeLabel || '';
    const vsLabel = root.dataset.vsLabel || 'vs';
    const courtLabel = root.dataset.courtLabel || 'Court';
    const ctaUrl = root.dataset.ctaUrl || '/app/';
    const ctaBase = ctaUrl + (ctaUrl.indexOf('?') >= 0 ? '&' : '?') + 'format=americano';

    function showPlaceholder(text) {
      clear(courtsEl);
      if (!text) return;
      const p = document.createElement('p');
      p.className = 'demo-placeholder';
      p.textContent = text;
      courtsEl.appendChild(p);
    }

    function update() {
      const names = parseNames(input.value);
      if (cta) cta.href = ctaBase;
      if (!names.length) {
        showPlaceholder(placeholder);
        if (errorEl) errorEl.hidden = true;
        return;
      }
      if (names.length < 4) {
        clear(courtsEl);
        if (errorEl) { errorEl.hidden = false; errorEl.textContent = errorMin; }
        return;
      }
      if (errorEl) errorEl.hidden = true;
      renderCourts(courtsEl, names, byeLabel, vsLabel, courtLabel);
      if (cta) {
        const namesParam = names.map(n => encodeURIComponent(n)).join(',');
        cta.href = ctaBase + '&names=' + namesParam;
      }
    }

    let debounce = null;
    input.addEventListener('input', function () {
      clearTimeout(debounce);
      debounce = setTimeout(update, 150);
    });

    if (exampleBtn) {
      exampleBtn.addEventListener('click', function () {
        input.value = exampleNames.join('\n');
        update();
      });
    }

    update();
  }

  function mountAll() {
    document.querySelectorAll('[data-padel-demo]').forEach(mount);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  } else {
    mountAll();
  }

  window.PadelDemo = { mount: mount, buildAmericanoSchedule: buildAmericanoSchedule, parseNames: parseNames };
})();
