/* ==========================================================================
   WOW LAYER — shared behavior for the PadelBracket landing page.
   Everything is opt-in via html[data-anim]; if the user prefers reduced
   motion (or JS is off) we never set it, and CSS shows the static layout.
   One IntersectionObserver per concern + one rAF-throttled scroll handler.
   ========================================================================== */
(function () {
  'use strict';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var io = 'IntersectionObserver' in window;
  if (reduce || !io) return;                 // leave the page static
  document.documentElement.setAttribute('data-anim', '');

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();
  var booted = false;

  function init() {
    if (booted) return; booted = true;
    revealOnce('.wow');
    revealOnce('.shot', 0.25);
    initStory();
    initBracket();
    initConfetti();
    initTilt();
  }

  /* ---- generic: add .in the first time an element enters view ---- */
  function revealOnce(sel, threshold) {
    var els = document.querySelectorAll(sel);
    if (!els.length) return;
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); }
      });
    }, { threshold: threshold || 0.15 });
    els.forEach(function (el) { obs.observe(el); });
  }

  /* ---- 2 · scrollytelling: highlight the step in the central band ---- */
  function initStory() {
    var story = document.querySelector('.story');
    if (!story) return;
    var steps = [].slice.call(story.querySelectorAll('.story-step'));
    var screens = [].slice.call(story.querySelectorAll('.scr'));
    var dots = [].slice.call(story.querySelectorAll('.story-dots i'));
    if (!steps.length) return;
    var current = -1;
    function activate(i) {
      if (i === current) return;
      current = i;
      steps.forEach(function (s, k) { s.classList.toggle('active', k === i); });
      screens.forEach(function (s, k) { s.classList.toggle('active', k === i); });
      dots.forEach(function (d, k) { d.classList.toggle('on', k === i); });
    }
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) activate(steps.indexOf(e.target));
      });
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    steps.forEach(function (s) { obs.observe(s); });
    activate(0);
  }

  /* ---- 3 · bracket: fill round-by-round from scroll progress ---- */
  function initBracket() {
    var br = document.querySelector('.bracket');
    if (!br) return;
    setConnectorLengths(br);
    var active = false, ticking = false;
    var gate = new IntersectionObserver(function (es) {
      active = es[0].isIntersecting;
      if (active) onScroll();
    }, { rootMargin: '0px 0px -10% 0px' });
    gate.observe(br);

    function compute() {
      ticking = false;
      var r = br.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight;
      // progress 0 when card top hits 80% of viewport, 1 when its bottom passes 35%
      var start = vh * 0.82, end = vh * 0.30;
      var p = (start - r.top) / (start - end + r.height * 0.15);
      p = Math.max(0, Math.min(1, p));
      var fill = Math.round(p * 4);          // 0..4
      if (String(fill) !== br.getAttribute('data-fill')) br.setAttribute('data-fill', String(fill));
    }
    function onScroll() {
      if (!active || ticking) return;
      ticking = true; requestAnimationFrame(compute);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', function () { setConnectorLengths(br); onScroll(); }, { passive: true });
    compute();
  }
  function setConnectorLengths(br) {
    br.querySelectorAll('.br-svg path').forEach(function (p) {
      var len = p.getTotalLength ? p.getTotalLength() : 120;
      p.style.setProperty('--len', len.toFixed(1));
    });
  }

  /* ---- 4 · champion confetti (built once, plays when screen is active) ---- */
  function initConfetti() {
    var box = document.querySelector('.confetti');
    if (!box) return;
    var colors = ['#C7FF5E', '#fbbf24', '#8b5cf6', '#f9fafb'];
    var html = '';
    for (var i = 0; i < 26; i++) {
      var l = Math.round(Math.random() * 100);
      var c = colors[i % colors.length];
      var delay = (Math.random() * 1.6).toFixed(2);
      var dur = (2 + Math.random() * 1.2).toFixed(2);
      html += '<i style="left:' + l + '%;background:' + c + ';animation-delay:' + delay +
        's;animation-duration:' + dur + 's"></i>';
    }
    box.innerHTML = html;
  }

  /* ---- 5 · magnetic / 3D tilt on [data-tilt] ---- */
  function initTilt() {
    if (!(window.matchMedia && matchMedia('(hover:hover) and (pointer:fine)').matches)) return;
    var MAX = 6;                              // degrees — subtle
    document.querySelectorAll('[data-tilt]').forEach(function (el) {
      var raf = null, rect = null;
      el.addEventListener('pointerenter', function () { rect = el.getBoundingClientRect(); el.classList.add('tilting'); });
      el.addEventListener('pointermove', function (ev) {
        if (!rect) rect = el.getBoundingClientRect();
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = null;
          var x = (ev.clientX - rect.left) / rect.width;
          var y = (ev.clientY - rect.top) / rect.height;
          el.style.setProperty('--ry', ((x - 0.5) * 2 * MAX).toFixed(2) + 'deg');
          el.style.setProperty('--rx', ((0.5 - y) * 2 * MAX).toFixed(2) + 'deg');
          el.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
          el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
        });
      });
      el.addEventListener('pointerleave', function () {
        rect = null; el.classList.remove('tilting');
        el.style.setProperty('--ry', '0deg'); el.style.setProperty('--rx', '0deg');
      });
    });
  }
})();
