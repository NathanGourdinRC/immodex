import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRedis } from './helpers/fake-redis.mjs';
import { runScan } from '../api/_lib/scan-run.js';
import { activeCommunes, listingsOf, sourceMetaOf } from '../api/_lib/scan-store.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const WAMB = { code: '59636', nom: 'Wambrechies', codesPostaux: ['59118'] };

// Deux sources simulées, sur deux sites différents, une page de résultats chacune.
const makeSource = (id) => ({
  id,
  label: id,
  host: `${id}.test`,
  departments: null,
  pageSize: 10,
  listUrls: (c) => [`https://${id}.test/vente/${c.code}`],
  pageUrl: () => null,
  isListing: (u) => u.pathname.startsWith('/annonce/'),
  typeOf: () => 'maison',
});
const SOURCES = [makeSource('alpha'), makeSource('beta')];
const card = (id, href, price) => `<article><a href="https://${id}.test/annonce/${href}">Maison Wambrechies</a><div>${price}</div></article>`;
const results = (id, cards) => `<html><body><main>${cards.map(([href, price]) => card(id, href, price)).join('')}</main></body></html>`;

// Fausse horloge et faux robot : chaque page coûte 5 s, comme le vrai robot poli.
function world(pages) {
  let t = Date.parse('2026-11-03T02:00:00Z');
  const asked = [];
  const fetcher = {
    async get(url) {
      asked.push(url);
      t += 5000;
      // Toute page d'annonce existe, sauf mention contraire.
      const p = pages[url] ?? (url.includes('/annonce/') ? '<html><body>Annonce</body></html>' : null);
      if (p === 'BLOCK') return { ok: false, status: 403, html: '', blocked: true, disallowed: false };
      if (p == null || p === 'DOWN') return { ok: false, status: 503, html: '', blocked: false, disallowed: false };
      return { ok: true, status: 200, html: p, blocked: false, disallowed: false };
    },
  };
  return { fetcher, asked, now: () => t, advance: (ms) => (t += ms), set: (ms) => (t = ms) };
}

const readListingImpl = (html, url) => ({ surface: 100, pieces: 5, chambres: 3, terrain: 200, garage: false, title: `Détail ${url}`, photo: null, postal: '59118', city: 'Wambrechies', buildingType: 'maison', price: 999999 });

async function withSearch(redis, now, communes = [WAMB], space = 'espace1') {
  await redis.command(['ZADD', 'imx:spaces', String(now), space]);
  const zone = { kind: 'zone', key: 'z1', data: { id: 'z1', communes, type: 'maison' }, updated_at: now, deleted: false };
  await redis.command(['HSET', `imx:${space}:items`, 'zone:z1', JSON.stringify(zone), 'track:x', '{}']);
}

test('communes suivies : espaces actifs depuis 21 jours, recherches avec communes, 30 au plus', async () => {
  const redis = fakeRedis();
  const now = Date.parse('2026-11-03');
  await withSearch(redis, now - 2 * DAY);
  await withSearch(redis, now - 40 * DAY, [{ code: '74010', nom: 'Annecy', codesPostaux: ['74000'] }], 'ancien');
  await withSearch(redis, now - DAY, [], 'vide');
  const communes = await activeCommunes(redis, now);
  assert.deepEqual(communes.map((c) => [c.code, [...c.types]]), [['59636', ['maison']]]);
});

test('passages successifs : nouveautés, pages d’annonce, baisse de prix, retrait après deux absences', async () => {
  const redis = fakeRedis();
  const pages = {
    'https://alpha.test/vente/59636': results('alpha', [['a1', '300 000 €'], ['a2', '250 000 €']]),
    'https://beta.test/vente/59636': results('beta', [['b1', '410 000 €']]),
  };
  const w = world(pages);
  await withSearch(redis, w.now());

  const first = await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl });
  assert.equal(first.details, 3);
  let l = await listingsOf(redis, '59636');
  assert.equal(l.size, 3);
  const a1 = [...l.values()].find((x) => x.url.endsWith('/a1'));
  assert.equal(a1.price, 300000); // prix de la carte, pas celui de la page d'annonce
  assert.equal(a1.surface, 100);
  assert.equal(a1.detail, true);

  // 47 h plus tard : a1 baisse, a2 a disparu.
  w.advance(47 * HOUR);
  pages['https://alpha.test/vente/59636'] = results('alpha', [['a1', '285 000 €']]);
  const second = await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl });
  assert.equal(second.details, 0);
  l = await listingsOf(redis, '59636');
  const byUrl = (end) => [...l.values()].find((x) => x.url.endsWith(end));
  assert.deepEqual(byUrl('/a1').prices.map((p) => p.price), [300000, 285000]);
  assert.equal(byUrl('/a2').missed, 1);
  assert.equal(byUrl('/a2').removedAt, null);

  w.advance(47 * HOUR);
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl });
  l = await listingsOf(redis, '59636');
  assert.ok(byUrl('/a2').removedAt > 0);
  assert.equal(byUrl('/b1').removedAt, null);
  // Les pages d'annonce ne sont jamais relues.
  assert.equal(w.asked.filter((u) => u.endsWith('/annonce/a1')).length, 1);
});

test('page de résultats en échec : aucune absence comptée pour cette source', async () => {
  const redis = fakeRedis();
  const pages = { 'https://alpha.test/vente/59636': results('alpha', [['a1', '300 000 €']]), 'https://beta.test/vente/59636': results('beta', []) };
  const w = world(pages);
  await withSearch(redis, w.now());
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl });
  w.advance(47 * HOUR);
  pages['https://alpha.test/vente/59636'] = 'DOWN';
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl });
  const [a1] = [...(await listingsOf(redis, '59636')).values()];
  assert.equal(a1.missed, 0);
});

test('temps écoulé : la file des pages d’annonce reprend au passage suivant, sans relecture', async () => {
  const redis = fakeRedis();
  const many = Array.from({ length: 12 }, (_, i) => [`a${i}`, `${300 + i} 000 €`]);
  const w = world({ 'https://alpha.test/vente/59636': results('alpha', many), 'https://beta.test/vente/59636': results('beta', []) });
  await withSearch(redis, w.now());
  // Budget de 30 s : 2 pages de résultats (10 s) puis 4 pages d'annonce (20 s).
  const first = await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl, budgetMs: 30000 });
  assert.ok(first.details >= 3 && first.details <= 5, `${first.details} pages d'annonce`);
  assert.equal(Number(await redis.command(['LLEN', 'imx:scan:queue'])), 12 - first.details);
  w.advance(21 * HOUR);
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl });
  assert.equal(Number(await redis.command(['LLEN', 'imx:scan:queue'])), 0);
  const read = w.asked.filter((u) => u.includes('/annonce/'));
  assert.equal(read.length, 12);
  assert.equal(new Set(read).size, 12);
});

test('un seul passage par 20 heures, quel que soit l’appelant', async () => {
  const redis = fakeRedis();
  const w = world({ 'https://alpha.test/vente/59636': results('alpha', []), 'https://beta.test/vente/59636': results('beta', []) });
  await withSearch(redis, w.now());
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl });
  const asked = w.asked.length;
  w.advance(5 * HOUR);
  const again = await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl });
  assert.equal(again.skipped, 'recent');
  assert.equal(w.asked.length, asked);
});

test('source bloquée deux passages de suite : mise en pause et signalée', async () => {
  const redis = fakeRedis();
  const w = world({ 'https://alpha.test/vente/59636': 'BLOCK', 'https://beta.test/vente/59636': results('beta', []) });
  await withSearch(redis, w.now());
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl });
  w.advance(47 * HOUR);
  const second = await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl });
  assert.deepEqual(second.paused, ['alpha']);
  const meta = await sourceMetaOf(redis, '59636');
  assert.equal(meta.alpha.paused, true);
  assert.equal(meta.beta.paused, false);
});

test('temps écoulé pendant les pages de résultats : la source est relue au passage suivant', async () => {
  const redis = fakeRedis();
  const w = world({ 'https://alpha.test/vente/59636': results('alpha', [['a1', '300 000 €']]), 'https://beta.test/vente/59636': results('beta', [['b1', '410 000 €']]) });
  await withSearch(redis, w.now());
  // Aucun temps disponible : rien n'est lu, rien n'est marqué comme fait.
  const first = await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl, budgetMs: 0 });
  assert.equal(first.results, 0);
  assert.deepEqual(await sourceMetaOf(redis, '59636'), {});
  w.advance(21 * 3600 * 1000);
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl });
  assert.equal((await listingsOf(redis, '59636')).size, 2);
});
