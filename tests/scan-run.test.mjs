import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRedis } from './helpers/fake-redis.mjs';
import { runScan } from '../api/_lib/scan-run.js';
import { activeCommunes, listingsOf, sourceMetaOf, saveListings } from '../api/_lib/scan-store.js';

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
    async get(url, opts = {}) {
      if (opts.deadline != null && t >= opts.deadline) return { ok: false, status: 0, html: '', blocked: false, disallowed: false, late: true };
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

test('un seul passage par 6 heures, quel que soit l’appelant', async () => {
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

test('adresse probable posée sur l’annonce après lecture de sa page', async () => {
  const redis = fakeRedis();
  const w = world({ 'https://alpha.test/vente/59636': results('alpha', [['a1', '300 000 €']]), 'https://beta.test/vente/59636': results('beta', []) });
  await withSearch(redis, w.now());
  const lookup = async (l) => (l.surface === 100 ? { address: '12 Rue de Quesnoy 59118 Wambrechies', lat: 50.686, lon: 3.048, addressConfidence: 'haute' } : null);
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl, lookup });
  const [a1] = [...(await listingsOf(redis, '59636')).values()];
  assert.equal(a1.address, '12 Rue de Quesnoy 59118 Wambrechies');
  assert.deepEqual([a1.lat, a1.lon], [50.686, 3.048]);
});

// ─── Défauts relevés par la relecture finale ───

const paged = (id, size) => ({ ...makeSource(id), pageSize: size, pageUrl: (url, n) => `${url}?page=${n}` });
const town = (id, href, price, name) => `<article><a href="https://${id}.test/annonce/${href}">Maison ${name}</a><div>${price}</div></article>`;
const listPage = (id, cards) => `<html><body><main>${cards.map(([h, p, name]) => town(id, h, p, name || 'Wambrechies')).join('')}</main></body></html>`;

test('agence : annonce de la commune en page 3, pages 1 et 2 d’autres communes : lue, jamais retirée', async () => {
  const redis = fakeRedis();
  const src = paged('deleu', 2);
  const pages = {
    'https://deleu.test/vente/59636': listPage('deleu', [['r1', '200 000 €', 'Roncq'], ['r2', '210 000 €', 'Roncq']]),
    'https://deleu.test/vente/59636?page=2': listPage('deleu', [['m1', '220 000 €', 'Mouvaux'], ['m2', '230 000 €', 'Mouvaux']]),
    'https://deleu.test/vente/59636?page=3': listPage('deleu', [['w1', '300 000 €']]),
  };
  const w = world(pages);
  await withSearch(redis, w.now());
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: [src], readListingImpl });
  for (let i = 0; i < 2; i++) {
    w.advance(47 * HOUR);
    await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: [src], readListingImpl });
  }
  const [w1] = [...(await listingsOf(redis, '59636')).values()];
  assert.ok(w1 && w1.url.endsWith('/w1'));
  assert.equal(w1.missed, 0);
  assert.equal(w1.removedAt, null);
});

test('paramètre de page ignoré par le site (page 2 = page 1) : liste incomplète, aucune absence comptée', async () => {
  const redis = fakeRedis();
  const src = paged('alpha', 2);
  const one = listPage('alpha', [['a1', '300 000 €'], ['a2', '250 000 €']]);
  const pages = { 'https://alpha.test/vente/59636': one, 'https://alpha.test/vente/59636?page=2': one };
  const w = world(pages);
  await withSearch(redis, w.now());
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: [src], readListingImpl });
  // a2 a glissé en page 2… que le site ne sert pas : il ne doit pas être compté absent.
  const two = listPage('alpha', [['a1', '300 000 €'], ['a3', '260 000 €']]);
  pages['https://alpha.test/vente/59636'] = two;
  pages['https://alpha.test/vente/59636?page=2'] = two;
  for (let i = 0; i < 2; i++) {
    w.advance(47 * HOUR);
    await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: [src], readListingImpl });
  }
  const a2 = [...(await listingsOf(redis, '59636')).values()].find((l) => l.url.endsWith('/a2'));
  assert.equal(a2.missed, 0);
  assert.equal(a2.removedAt, null);
});

test('page servie sans aucune annonce (maintenance) : aucune absence comptée', async () => {
  const redis = fakeRedis();
  const pages = { 'https://alpha.test/vente/59636': results('alpha', [['a1', '300 000 €']]), 'https://beta.test/vente/59636': results('beta', []) };
  const w = world(pages);
  await withSearch(redis, w.now());
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl });
  pages['https://alpha.test/vente/59636'] = '<html><body>Site en maintenance</body></html>';
  for (let i = 0; i < 2; i++) {
    w.advance(47 * HOUR);
    await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl });
  }
  const [a1] = [...(await listingsOf(redis, '59636')).values()];
  assert.equal(a1.removedAt, null);
});

test('au plus 5 pages de résultats par source et par commune, même pour maisons et appartements', async () => {
  const redis = fakeRedis();
  const src = { ...paged('alpha', 1), listUrls: (c, type) => (type ? [type] : ['maison', 'appartement']).map((t) => `https://alpha.test/${t}/${c.code}`) };
  const w = world({});
  // Pages toujours pleines et toujours nouvelles.
  const base = w.fetcher.get;
  let n = 0;
  w.fetcher.get = async (url, opts) => {
    const r = await base(url, opts);
    if (url.includes('/annonce/')) return r;
    n++;
    return { ok: true, status: 200, html: listPage('alpha', [[`p${n}`, '300 000 €']]), blocked: false, disallowed: false };
  };
  await redis.command(['ZADD', 'imx:spaces', String(w.now()), 's']);
  await redis.command(['HSET', 'imx:s:items', 'zone:z', JSON.stringify({ kind: 'zone', key: 'z', data: { communes: [WAMB], type: null }, updated_at: 1 })]);
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: [src], readListingImpl });
  assert.ok(n <= 5, `${n} pages de résultats`);
});

test('deux appels simultanés : un seul passage', async () => {
  const redis = fakeRedis();
  const w = world({ 'https://alpha.test/vente/59636': results('alpha', [['a1', '300 000 €']]), 'https://beta.test/vente/59636': results('beta', []) });
  await withSearch(redis, w.now());
  const both = await Promise.all([1, 2].map(() => runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl })));
  assert.equal(both.filter((r) => r.skipped).length, 1);
  assert.equal(w.asked.filter((u) => u === 'https://alpha.test/vente/59636').length, 1);
});

test('lecteur qui plante sur une page : les autres annonces sont enregistrées', async () => {
  const redis = fakeRedis();
  const w = world({ 'https://alpha.test/vente/59636': results('alpha', [['a1', '300 000 €'], ['a2', '250 000 €']]), 'https://beta.test/vente/59636': results('beta', []) });
  await withSearch(redis, w.now());
  const flaky = (html, url) => {
    if (url.endsWith('/a1')) throw new Error('page étrange');
    return readListingImpl(html, url);
  };
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl: flaky });
  const l = await listingsOf(redis, '59636');
  assert.equal(l.size, 2);
  assert.ok([...l.values()].every((x) => x.detail === true));
  assert.equal([...l.values()].find((x) => x.url.endsWith('/a2')).surface, 100);
});

test('commune plus suivie avec des pages d’annonce en attente sur deux sites : les deux enregistrées', async () => {
  const redis = fakeRedis();
  const w = world({});
  const mk = (src, id) => ({ id: `${src}:/annonce/${id}`, source: src, url: `https://${src}.test/annonce/${id}`, insee: '59636', type: 'maison', price: 1, prices: [], firstSeen: 1, lastSeen: 1, missed: 0, removedAt: null, detail: false });
  await saveListings(redis, '59636', [mk('alpha', 'x1'), mk('beta', 'y1')]);
  await redis.command(['RPUSH', 'imx:scan:queue', JSON.stringify({ insee: '59636', id: 'alpha:/annonce/x1', url: 'https://alpha.test/annonce/x1' }), JSON.stringify({ insee: '59636', id: 'beta:/annonce/y1', url: 'https://beta.test/annonce/y1' })]);
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl });
  const l = await listingsOf(redis, '59636');
  assert.ok([...l.values()].every((x) => x.detail === true && x.surface === 100));
});

test('annonce restée sans page lue et absente de la file : remise en file et lue', async () => {
  const redis = fakeRedis();
  const w = world({ 'https://alpha.test/vente/59636': results('alpha', [['a1', '300 000 €']]), 'https://beta.test/vente/59636': results('beta', []) });
  await withSearch(redis, w.now());
  await saveListings(redis, '59636', [{ id: 'alpha:/annonce/a1', source: 'alpha', url: 'https://alpha.test/annonce/a1', insee: '59636', type: 'maison', price: 300000, prices: [{ at: 1, price: 300000 }], firstSeen: 1, lastSeen: 1, missed: 0, removedAt: null, detail: false }]);
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl });
  const [a1] = [...(await listingsOf(redis, '59636')).values()];
  assert.equal(a1.detail, true);
});

test('espaces suivis : 5 au plus, les plus récents ; les espaces inactifs sont oubliés', async () => {
  const redis = fakeRedis();
  const now = Date.parse('2026-11-03');
  for (let i = 0; i < 8; i++) await withSearch(redis, now - i * HOUR, [{ code: String(59000 + i), nom: `C${i}`, codesPostaux: ['59000'] }], `e${i}`);
  await withSearch(redis, now - 40 * DAY, [WAMB], 'vieux');
  const communes = await activeCommunes(redis, now);
  assert.deepEqual(communes.map((c) => c.code), ['59000', '59001', '59002', '59003', '59004']);
  assert.equal(await redis.command(['ZCARD', 'imx:spaces']), 8);
});

test('espaces récents sans commune (tests, appareils neufs) : ils ne repoussent pas les recherches de Nathan', async () => {
  const redis = fakeRedis();
  const now = Date.parse('2026-11-03');
  await withSearch(redis, now - 3 * DAY);
  for (let i = 0; i < 8; i++) await withSearch(redis, now - i * HOUR, [], `vide${i}`);
  const communes = await activeCommunes(redis, now);
  assert.deepEqual(communes.map((c) => c.code), ['59636']);
});

test('passage sans commune à suivre : il ne garde pas le verrou, le suivant peut tourner', async () => {
  const redis = fakeRedis();
  const w = world({ 'https://alpha.test/vente/59636': results('alpha', [['a1', '300 000 €']]), 'https://beta.test/vente/59636': results('beta', []) });
  const empty = await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl });
  assert.equal(empty.communes, 0);
  await withSearch(redis, w.now());
  w.advance(3600 * 1000);
  const next = await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl });
  assert.equal(next.skipped, undefined);
  assert.equal(next.added, 1);
});

test('annonce lue par un ancien lecteur : relue une seule fois, les valeurs fausses effacées', async () => {
  const redis = fakeRedis();
  const w = world({ 'https://alpha.test/vente/59636': results('alpha', [['a1', '300 000 €']]), 'https://beta.test/vente/59636': results('beta', []) });
  await withSearch(redis, w.now());
  await saveListings(redis, '59636', [{ id: 'alpha:/annonce/a1', source: 'alpha', url: 'https://alpha.test/annonce/a1', insee: '59636', type: 'maison', price: 300000, prices: [{ at: 1, price: 300000 }], firstSeen: 1, lastSeen: 1, missed: 0, removedAt: null, detail: true, terrain: 706, surface: 90 }]);
  const reader = (html, url) => ({ ...readListingImpl(html, url), terrain: null });
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl: reader });
  let [a1] = [...(await listingsOf(redis, '59636')).values()];
  assert.equal(a1.terrain, null);
  assert.equal(a1.surface, 100);
  w.advance(47 * HOUR);
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl: reader });
  assert.equal(w.asked.filter((u) => u.endsWith('/annonce/a1')).length, 1);
});

test('page illisible : marquée lue avec la version du lecteur, jamais remise en file', async () => {
  const redis = fakeRedis();
  const w = world({ 'https://alpha.test/vente/59636': results('alpha', [['a1', '300 000 €']]), 'https://beta.test/vente/59636': results('beta', []) });
  await withSearch(redis, w.now());
  const broken = () => {
    throw new Error('page étrange');
  };
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl: broken });
  w.advance(47 * HOUR);
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl: broken });
  assert.equal(w.asked.filter((u) => u.endsWith('/annonce/a1')).length, 1);
});
