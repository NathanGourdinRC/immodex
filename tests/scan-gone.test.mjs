// Annonces disparues : le robot ouvre la page d'une annonce qui manque à l'appel (absente une
// fois de la liste, ou sans nouvelle depuis 7 jours) et la retire si la page est introuvable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeRedis } from './helpers/fake-redis.mjs';
import { runScan } from '../api/_lib/scan-run.js';
import { listingsOf, saveListings } from '../api/_lib/scan-store.js';
import { createPoliteFetcher } from '../api/_lib/polite.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const WAMB = { code: '59636', nom: 'Wambrechies', codesPostaux: ['59118'] };
const MARCQ = { code: '59378', nom: 'Marcq-en-Barœul', codesPostaux: ['59700'] };
const A2 = 'https://alpha.test/annonce/a2';

const makeSource = (id, extra = {}) => ({
  id,
  label: id,
  host: `${id}.test`,
  departments: null,
  pageSize: 10,
  listUrls: (c) => [`https://${id}.test/vente/${c.code}`],
  pageUrl: () => null,
  isListing: (u) => u.pathname.startsWith('/annonce/'),
  typeOf: () => 'maison',
  ...extra,
});
const SOURCES = [makeSource('alpha')];
const card = (href, price, city) => `<article><a href="https://alpha.test/annonce/${href}">Maison ${city}</a><div>${price}</div></article>`;
const results = (cards, city = 'Wambrechies') => `<html><body><main>${cards.map(([href, price]) => card(href, price, city)).join('')}</main></body></html>`;
const readListingImpl = () => ({ surface: 100, pieces: 5, chambres: 3, postal: '59118', city: 'Wambrechies', buildingType: 'maison' });

// Faux robot : chaque page coûte 5 s. `gone[url]` : réponse d'une page d'annonce (statut, adresse
// finale après renvoi, refus) ; les autres pages d'annonce existent.
function world(pages, gone = {}) {
  let t = Date.parse('2026-11-03T02:00:00Z');
  const asked = [];
  const fetcher = {
    async get(url, opts = {}) {
      if (opts.deadline != null && t >= opts.deadline) return { ok: false, status: 0, html: '', blocked: false, disallowed: false, late: true };
      asked.push(url);
      t += 5000;
      const g = gone[url];
      if (g && g.blocked) return { ok: false, status: 403, html: '', blocked: true, disallowed: false };
      if (g) return { ok: g.status === 200, status: g.status, url: g.url || url, html: g.status === 200 ? '<html>Annonce</html>' : '', blocked: false, disallowed: false };
      const p = pages[url] ?? (url.includes('/annonce/') ? '<html>Annonce</html>' : null);
      if (p == null || p === 'DOWN') return { ok: false, status: 503, html: '', blocked: false, disallowed: false };
      return { ok: true, status: 200, url, html: p, blocked: false, disallowed: false };
    },
  };
  return { fetcher, asked, gone, pages, now: () => t, advance: (ms) => (t += ms) };
}

async function withSearch(redis, now, communes = [WAMB]) {
  await redis.command(['ZADD', 'imx:spaces', String(now), 'espace1']);
  const zone = { kind: 'zone', key: 'z1', data: { id: 'z1', communes, type: 'maison' }, updated_at: now, deleted: false };
  await redis.command(['HSET', 'imx:espace1:items', 'zone:z1', JSON.stringify(zone)]);
}

const scan = (redis, w, sources = SOURCES) => runScan({ redis, fetcher: w.fetcher, now: w.now, sources, readListingImpl });

// Premier passage avec a1 et a2, puis 47 h plus tard a2 a disparu de la liste (une absence) et
// sa page répond `answer`.
async function missingOnce(answer) {
  const redis = fakeRedis();
  const w = world({ 'https://alpha.test/vente/59636': results([['a1', '300 000 €'], ['a2', '250 000 €']]) });
  await withSearch(redis, w.now());
  await scan(redis, w);
  w.advance(47 * HOUR);
  w.pages['https://alpha.test/vente/59636'] = results([['a1', '300 000 €']]);
  if (answer) w.gone[A2] = answer;
  const summary = await scan(redis, w);
  return { redis, w, summary, listings: await listingsOf(redis, '59636') };
}

test('robot poli : la réponse donne l’adresse finale après un renvoi', async () => {
  let t = 0;
  const clock = { now: () => t, sleep: async (ms) => { t += ms; } };
  const fetchImpl = async (url) => (url.endsWith('robots.txt') ? { ok: false, status: 404, text: async () => '' } : { ok: true, status: 200, url: 'https://a.fr/vente/maison/nord-59/', text: async () => 'liste' });
  const f = createPoliteFetcher({ fetchImpl, ...clock });
  assert.equal((await f.get('https://a.fr/annonce/123456')).url, 'https://a.fr/vente/maison/nord-59/');
  // Réponse sans adresse finale : celle demandée.
  const g = createPoliteFetcher({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => 'x' }), ...clock });
  assert.equal((await g.get('https://b.fr/annonce/1')).url, 'https://b.fr/annonce/1');
});

test('page introuvable (404 ou 410) à la première absence : retirée au même passage', async () => {
  for (const status of [404, 410]) {
    const { w, summary, listings } = await missingOnce({ status });
    assert.ok(listings.get('alpha:/annonce/a2').removedAt > 0, `statut ${status}`);
    assert.equal(listings.get('alpha:/annonce/a1').removedAt, null);
    assert.equal(summary.gone, 1);
    assert.equal(summary.removed, 1);
    // a1, toujours dans la liste, n'est pas vérifiée : sa page n'a été lue qu'à son arrivée.
    assert.equal(w.asked.filter((u) => u === 'https://alpha.test/annonce/a1').length, 1);
  }
});

test('page encore en ligne : rien de conclu, pas redemandée avant 46 h', async () => {
  const { redis, w, listings } = await missingOnce({ status: 200 });
  const a2 = listings.get('alpha:/annonce/a2');
  assert.equal(a2.removedAt, null);
  assert.ok(a2.pageCheckedAt > 0);
  const asked = w.asked.filter((u) => u === A2).length;
  assert.equal(asked, 2); // lecture à l'arrivée, puis une vérification
  w.advance(HOUR);
  await scan(redis, w);
  assert.equal(w.asked.filter((u) => u === A2).length, asked);
});

test('renvoi vers une page qui n’est pas une annonce : retirée ; vers une annonce : en ligne', async () => {
  const toList = await missingOnce({ status: 200, url: 'https://alpha.test/vente/59636' });
  assert.ok(toList.listings.get('alpha:/annonce/a2').removedAt > 0);
  const toListing = await missingOnce({ status: 200, url: 'https://alpha.test/annonce/a2-maison-wambrechies' });
  assert.equal(toListing.listings.get('alpha:/annonce/a2').removedAt, null);
});

// Barnes, 23/11/2026 : /fr/vente/lambersart/87293910 renvoie vers .../ref-87293910.html, la même
// annonce sous sa nouvelle adresse (430 000 €, en ligne). Le numéro de l'annonce est gardé.
test('renvoi vers une adresse qui garde le numéro de l’annonce : déménagée, pas retirée', async () => {
  const redis = fakeRedis();
  const w = world({ 'https://alpha.test/vente/59636': results([['a1', '300 000 €'], ['87293910', '430 000 €']]) });
  await withSearch(redis, w.now());
  await scan(redis, w);
  w.advance(47 * HOUR);
  w.pages['https://alpha.test/vente/59636'] = results([['a1', '300 000 €']]);
  w.gone['https://alpha.test/annonce/87293910'] = { status: 200, url: 'https://alpha.test/vente/lambersart/ref-87293910.html' };
  await scan(redis, w);
  assert.equal((await listingsOf(redis, '59636')).get('alpha:/annonce/87293910').removedAt, null);
});

test('renvoi vers une liste qui ne garde que le code postal : retirée', async () => {
  const { listings } = await missingOnce({ status: 200, url: 'https://alpha.test/vente/maison/lambersart-59130/' });
  assert.ok(listings.get('alpha:/annonce/a2').removedAt > 0);
});

test('annonce retirée par la première règle (renvoi déménagé compris) : remise en ligne et vérifiée de nouveau', async () => {
  const redis = fakeRedis();
  const w = world({ 'https://alpha.test/vente/59636': results([['a1', '300 000 €']]) }, { 'https://alpha.test/annonce/87293910': { status: 200, url: 'https://alpha.test/vente/lambersart/ref-87293910.html' } });
  await withSearch(redis, w.now());
  const t = w.now();
  // Retirée le 23/11 par la règle du 22/11 : retrait et vérification à la même heure, sans `goneRule`.
  await saveListings(redis, '59636', [{ id: 'alpha:/annonce/87293910', source: 'alpha', url: 'https://alpha.test/annonce/87293910', insee: '59636', type: 'maison', price: 430000, prices: [], firstSeen: t - 20 * DAY, lastSeen: t - 10 * DAY, missed: 0, removedAt: t - HOUR, pageCheckedAt: t - HOUR, detail: true, readerVersion: 3 }]);
  await scan(redis, w);
  const l = (await listingsOf(redis, '59636')).get('alpha:/annonce/87293910');
  assert.equal(l.removedAt, null);
  assert.ok(l.pageCheckedAt > t - HOUR);
});

test('refus du site ou erreur sur la page vérifiée : rien de conclu', async () => {
  for (const answer of [{ blocked: true }, { status: 503 }]) {
    const { listings } = await missingOnce(answer);
    const a2 = listings.get('alpha:/annonce/a2');
    assert.equal(a2.removedAt, null);
    assert.equal(a2.missed, 1);
  }
});

test('annonce revenue dans la liste après un retrait par sa page : de nouveau en ligne', async () => {
  const { redis, w } = await missingOnce({ status: 404 });
  w.advance(47 * HOUR);
  w.pages['https://alpha.test/vente/59636'] = results([['a1', '300 000 €'], ['a2', '250 000 €']]);
  await scan(redis, w);
  assert.equal((await listingsOf(redis, '59636')).get('alpha:/annonce/a2').removedAt, null);
});

test('liste illisible depuis plus de 7 jours (aucune absence comptée) : page vérifiée', async () => {
  const redis = fakeRedis();
  const w = world({ 'https://alpha.test/vente/59636': results([['a1', '300 000 €'], ['a2', '250 000 €']]) });
  await withSearch(redis, w.now());
  await scan(redis, w);
  w.pages['https://alpha.test/vente/59636'] = 'DOWN';
  w.gone[A2] = { status: 404 };
  w.advance(8 * DAY);
  await withSearch(redis, w.now());
  await scan(redis, w);
  const l = await listingsOf(redis, '59636');
  assert.equal(l.get('alpha:/annonce/a2').missed, 0);
  assert.ok(l.get('alpha:/annonce/a2').removedAt > 0);
  // a1 aussi est vérifiée (sans nouvelle depuis 8 jours) : sa page existe, elle reste.
  assert.equal(l.get('alpha:/annonce/a1').removedAt, null);
});

test('annonce vue depuis deux communes : sa page vérifiée une fois, les deux copies retirées', async () => {
  const redis = fakeRedis();
  const both = (cards) => ({ 'https://alpha.test/vente/59636': results(cards), 'https://alpha.test/vente/59378': results(cards, 'Marcq-en-Barœul') });
  const w = world(both([['a1', '300 000 €'], ['a2', '250 000 €']]));
  await withSearch(redis, w.now(), [WAMB, MARCQ]);
  await scan(redis, w);
  w.advance(47 * HOUR);
  Object.assign(w.pages, both([['a1', '300 000 €']]));
  w.gone[A2] = { status: 404 };
  await scan(redis, w);
  assert.equal(w.asked.filter((u) => u === A2).length, 2); // lecture à l'arrivée, puis une vérification
  for (const code of ['59636', '59378']) assert.ok((await listingsOf(redis, code)).get('alpha:/annonce/a2').removedAt > 0, code);
});

test('site que le robot ne lit pas (`local`) : page jamais vérifiée', async () => {
  const redis = fakeRedis();
  const local = makeSource('alpha', { local: true, staleAfter: 21 * DAY });
  const w = world({}, { [A2]: { status: 404 } });
  await withSearch(redis, w.now());
  const t = w.now();
  await saveListings(redis, '59636', [{ id: 'alpha:/annonce/a2', source: 'alpha', url: A2, insee: '59636', type: 'maison', price: 250000, prices: [], firstSeen: t - 10 * DAY, lastSeen: t - 10 * DAY, missed: 0, removedAt: null, detail: true, pushed: true }]);
  await scan(redis, w, [local]);
  assert.ok(!w.asked.includes(A2));
  assert.equal((await listingsOf(redis, '59636')).get('alpha:/annonce/a2').removedAt, null);
});

test('temps écoulé : la vérification attend le passage suivant, rien n’est noté', async () => {
  const redis = fakeRedis();
  const w = world({ 'https://alpha.test/vente/59636': results([['a1', '300 000 €'], ['a2', '250 000 €']]) });
  await withSearch(redis, w.now());
  await scan(redis, w);
  w.advance(47 * HOUR);
  w.pages['https://alpha.test/vente/59636'] = results([['a1', '300 000 €']]);
  w.gone[A2] = { status: 404 };
  // Budget de 4 s : la page de résultats passe (le délai n'est vérifié qu'avant la demande), pas la vérification.
  await runScan({ redis, fetcher: w.fetcher, now: w.now, sources: SOURCES, readListingImpl, budgetMs: 4000 });
  const a2 = (await listingsOf(redis, '59636')).get('alpha:/annonce/a2');
  assert.equal(a2.removedAt, null);
  assert.equal(a2.pageCheckedAt, undefined);
});

// Cas réel du 23/11/2026 : 431 pages ParuVendu à relire occupaient chaque passage jusqu'au bout,
// et la vérification, qui attendait la fin de toutes les lectures, ne démarrait jamais.
test('longue file de pages à lire : la vérification se fait quand même, au même passage', async () => {
  const redis = fakeRedis();
  const w = world({ 'https://alpha.test/vente/59636': results([['a1', '300 000 €'], ['a2', '250 000 €']]) });
  await withSearch(redis, w.now());
  await scan(redis, w);
  w.advance(47 * HOUR);
  // 100 nouvelles annonces à lire (500 s à 5 s la page, pour 240 s de passage), a2 a disparu.
  const many = Array.from({ length: 100 }, (_, i) => [`n${i}`, '200 000 €']);
  w.pages['https://alpha.test/vente/59636'] = results([['a1', '300 000 €'], ...many]);
  w.gone[A2] = { status: 404 };
  const summary = await scan(redis, w);
  assert.equal(summary.gone, 1);
  assert.ok((await listingsOf(redis, '59636')).get('alpha:/annonce/a2').removedAt > 0);
  // Les nouvelles annonces sont lues aussi, celles qui restent attendent le passage suivant.
  assert.ok(summary.details > 10);
});
