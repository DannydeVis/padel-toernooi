#!/usr/bin/env node
// Genereert sitemap.xml op basis van de werkelijk aanwezige index.html
// bestanden in de repo. hreflang-clusters alleen waar vertalingen echt
// bestaan, x-default conform het huidige patroon (homepages naar /en/,
// gidsen/blog naar de Engelse root-versie). lastmod van bestaande entries
// blijft behouden; nieuwe entries krijgen de datum van vandaag.
// Draaien: node scripts/gen-sitemap.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const BASE = 'https://padel-bracket.com';
const today = new Date().toISOString().slice(0, 10);

// bestaande lastmod-waarden behouden
const oldSitemap = existsSync(join(root, 'sitemap.xml')) ? readFileSync(join(root, 'sitemap.xml'), 'utf8') : '';
const oldLastmod = {};
for (const m of oldSitemap.matchAll(/<loc>([^<]+)<\/loc>[\s\S]*?<lastmod>([^<]+)<\/lastmod>/g)) {
  oldLastmod[m[1]] = m[2];
}

const exists = p => existsSync(join(root, p, 'index.html'));

// hreflang-clusters: [lang, pad] paren; alleen paden die echt bestaan komen
// in de cluster. xDefault is het pad van de x-default variant.
const HOME = [['nl', ''], ['en', 'en'], ['fr', 'fr'], ['de', 'de'], ['es', 'es'], ['it', 'it'], ['pt', 'pt'], ['sv', 'sv']];
const GUIDE_LANGS = f => [['en', f], ['es', `es/${f}`], ['it', `it/${f}`], ['pt', `pt/${f}`]];
const BLOG_POSTS = {
  'what-is-padel-americano': { nl: 'wat-is-padel-americano', de: 'was-ist-padel-americano', es: 'que-es-padel-americano', fr: 'qu-est-ce-que-padel-americano', sv: 'vad-ar-padel-americano' },
  'padel-americano-vs-mexicano': { nl: 'americano-vs-mexicano', de: 'americano-vs-mexicano', es: 'americano-vs-mexicano', fr: 'americano-vs-mexicano', sv: 'americano-vs-mexicano' },
  'padel-americano-how-many-players': { nl: 'americano-hoeveel-spelers', de: 'americano-wie-viele-spieler', es: 'americano-cuantos-jugadores', fr: 'americano-combien-de-joueurs', sv: 'americano-hur-manga-spelare' },
  'how-to-organise-padel-tournament': { nl: 'padel-toernooi-organiseren', de: 'padel-turnier-organisieren', es: 'como-organizar-torneo-padel', fr: 'organiser-tournoi-padel', sv: 'organisera-padel-turnering' },
};

const urls = [];
function add(path, { priority, changefreq = 'monthly', cluster = null, xDefault = null, comment = null } = {}) {
  if (!exists(path)) return;
  const loc = `${BASE}/${path ? path + '/' : ''}`;
  const alts = [];
  if (cluster) {
    for (const [lang, p] of cluster) {
      if (!exists(p)) continue;
      alts.push([lang, `${BASE}/${p ? p + '/' : ''}`]);
    }
    if (alts.length < 2) {
      // geen echte vertalingen: terugvallen op en + x-default naar zichzelf
      alts.length = 0;
      alts.push(['en', loc], ['x-default', loc]);
    } else if (xDefault !== null) {
      alts.push(['x-default', `${BASE}/${xDefault ? xDefault + '/' : ''}`]);
    }
  } else if (xDefault !== null) {
    // enkel-taals patroon: en + x-default naar zichzelf (huidige stijl)
    alts.push(['en', loc], ['x-default', loc]);
  }
  urls.push({ loc, alts, lastmod: oldLastmod[loc] || today, changefreq, priority, comment });
}

// taal-homepages
add('', { priority: '1.0', cluster: HOME, xDefault: 'en', comment: 'Dutch (default)' });
add('en', { priority: '1.0', cluster: HOME, xDefault: 'en', comment: 'English (international default)' });
for (const [lang, label] of [['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['it', 'Italian'], ['pt', 'Portuguese'], ['sv', 'Swedish']]) {
  add(lang, { priority: '0.9', cluster: HOME, xDefault: 'en', comment: label });
}

// app
add('app', { priority: '0.8', comment: 'App' });

// formatgidsen (root Engels + vertalingen waar aanwezig)
for (const f of ['americano', 'mexicano', 'knockout', 'round-robin', 'mixicano', 'team-mexicano', 'king-of-the-court']) {
  add(f, { priority: '0.8', cluster: GUIDE_LANGS(f), xDefault: f, comment: `Format guide: ${f}` });
  for (const l of ['es', 'it', 'pt']) {
    add(`${l}/${f}`, { priority: '0.8', cluster: GUIDE_LANGS(f), xDefault: f });
  }
}

// player-count pagina's
for (const n of [4, 6, 8, 10, 12, 16, 20, 24]) add(`americano/${n}-players`, { priority: '0.7' });
for (const n of [8, 12, 16, 20, 24]) add(`mexicano/${n}-players`, { priority: '0.7' });

// pickleball
for (const p of ['pickleball', 'pickleball/americano', 'pickleball/mexicano', 'pickleball/round-robin', 'pickleball/king-of-the-court']) {
  add(p, { priority: '0.8', xDefault: p, comment: p === 'pickleball' ? 'Pickleball' : null });
}

// blog: indexen + posts, clusters waar vertalingen bestaan
const BLOG_HOME = [['en', 'blog'], ['nl', 'blog/nl'], ['de', 'blog/de'], ['es', 'blog/es'], ['fr', 'blog/fr'], ['sv', 'blog/sv']];
add('blog', { priority: '0.6', cluster: BLOG_HOME, xDefault: 'blog', comment: 'Blog' });
for (const [, p] of BLOG_HOME.slice(1)) add(p, { priority: '0.6', cluster: BLOG_HOME, xDefault: 'blog' });
for (const [en, tr] of Object.entries(BLOG_POSTS)) {
  const cluster = [['en', `blog/${en}`], ...Object.entries(tr).map(([lang, slug]) => [lang, `blog/${lang}/${slug}`])];
  add(`blog/${en}`, { priority: '0.6', cluster, xDefault: `blog/${en}` });
  for (const [lang, slug] of Object.entries(tr)) add(`blog/${lang}/${slug}`, { priority: '0.6', cluster, xDefault: `blog/${en}` });
}

// overig
add('en/about', { priority: '0.6', comment: 'About' });
add('en/alternatives', { priority: '0.6', comment: 'Alternatives / comparison' });
add('privacy', { priority: '0.4', changefreq: 'yearly', comment: 'Privacy policy' });

// XML uitschrijven
let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';
for (const u of urls) {
  xml += '\n';
  if (u.comment) xml += `  <!-- ${u.comment} -->\n`;
  xml += '  <url>\n';
  xml += `    <loc>${u.loc}</loc>\n`;
  for (const [lang, href] of u.alts) {
    xml += `    <xhtml:link rel="alternate" hreflang="${lang.padEnd(9)}" href="${href}"/>\n`.replace(`"${lang.padEnd(9)}"`, `"${lang}"${' '.repeat(9 - lang.length)}`);
  }
  xml += `    <lastmod>${u.lastmod}</lastmod>\n`;
  xml += `    <changefreq>${u.changefreq}</changefreq>\n`;
  xml += `    <priority>${u.priority}</priority>\n`;
  xml += '  </url>\n';
}
xml += '\n</urlset>\n';

writeFileSync(join(root, 'sitemap.xml'), xml);
console.log(`sitemap.xml: ${urls.length} URLs geschreven (${urls.filter(u => !oldLastmod[u.loc]).length} nieuw met lastmod ${today})`);
