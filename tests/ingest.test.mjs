// Annonces reçues de l'extension et du robot local (api/_lib/ingest.js), et sources `local` que le
// robot en ligne ne lit plus lui-même.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleIngest, handleCommunes } from '../api/_lib/ingest.js';
import { runScan } from '../api/_lib/scan-run.js';
import { sourceById } from '../api/_lib/sources.js';
import { listingsOf, keys } from '../api/_lib/scan-store.js';
import { spaceOf, handleSync } from '../api/sync.js';
import { fakeRedis as createFakeRedis } from './helpers/fake-redis.mjs';

const KEY = 'a'.repeat(40);
const NOW = 1_800_000_000_000;

// Un espace connu, avec une recherche sur Marcq-en-Barœul.
async function setup() {
  const redis = createFakeRedis();
  const space = await spaceOf(KEY);
  await redis.command(['ZADD', keys.spaces, String(NOW), space]);
  const zone = { communes: [{ code: '59378', nom: 'Marcq-en-Barœul', codesPostaux: ['59700'] }, { code: '59009', nom: "Villeneuve-d'Ascq", codesPostaux: ['59491', '59493', '59650'] }], type: 'maison' };
  await redis.command(['HSET', `imx:${space}:items`, 'zone:1', JSON.stringify({ data: zone, deleted: false })]);
  return redis;
}

const card = (over = {}) => ({
  url: 'https://www.leboncoin.fr/ad/ventes_immobilieres/3100000001',
  type: 'maison',
  price: 500000,
  title: 'Belle maison',
  detail: { surface: 120, pieces: 5, chambres: 4, terrain: 200, photo: 'https://img.leboncoin.fr/1.jpg', postal: '59700', city: 'Marcq-en-Baroeul', energyClass: 'C' },
  ...over,
});

test('une carte de Leboncoin entre dans sa commune, sans fiche à lire', async () => {
  const redis = await setup();
  const r = await handleIngest({ syncKey: KEY, redis, now: NOW, body: { source: 'leboncoin', cards: [card()] } });
  assert.deepEqual(r, { seen: 1, added: 1, ignored: 0 });
  const [l] = [...(await listingsOf(redis, '59378')).values()];
  assert.equal(l.source, 'leboncoin');
  assert.equal(l.price, 500000);
  assert.equal(l.surface, 120);
  assert.equal(l.city, 'Marcq-en-Baroeul');
  assert.equal(l.detail, true);
  assert.equal(l.pushed, true);
});

test('revue moins chère : prix suivi, pas de doublon', async () => {
  const redis = await setup();
  await handleIngest({ syncKey: KEY, redis, now: NOW, body: { source: 'leboncoin', cards: [card()] } });
  const r = await handleIngest({ syncKey: KEY, redis, now: NOW + 1000, body: { source: 'leboncoin', cards: [card({ price: 480000 })] } });
  assert.deepEqual(r, { seen: 1, added: 0, ignored: 0 });
  const [l] = [...(await listingsOf(redis, '59378')).values()];
  assert.equal(l.price, 480000);
  assert.equal(l.prices.length, 2);
});

test('commune non suivie, autre site, autre sorte de bien : ignorés', async () => {
  const redis = await setup();
  const r = await handleIngest({
    syncKey: KEY,
    redis,
    now: NOW,
    body: {
      source: 'leboncoin',
      cards: [
        card({ detail: { city: 'Lille', postal: '59000' } }),
        card({ url: 'https://evil.example/ad/ventes_immobilieres/1' }),
        card({ url: 'https://www.leboncoin.fr/ad/locations/3100000002' }),
        card({ type: 'parking' }),
        card({ detail: { city: 'Marcq-en-Baroeul', postal: '75001' } }),
      ],
    },
  });
  assert.deepEqual(r, { seen: 0, added: 0, ignored: 5 });
});

test('commune reconnue malgré son écriture, photo non https et lettre fausse écartées', async () => {
  const redis = await setup();
  const r = await handleIngest({
    syncKey: KEY,
    redis,
    now: NOW,
    body: { source: 'bienici', cards: [{ url: 'https://www.bienici.com/annonce/vente/villeneuve-d-ascq/maison/5pieces/ag-1', type: 'maison', price: 3e5, title: 'x', detail: { city: 'Villeneuve-dAscq', postal: '59650', photo: 'http://x/1.jpg', energyClass: 'Z' } }] },
  });
  assert.equal(r.seen, 1);
  const [l] = [...(await listingsOf(redis, '59009')).values()];
  assert.equal(l.photo, null);
  assert.equal(l.energyClass, null);
});

test('robot local : la commune lue est donnée par `insee`', async () => {
  const redis = await setup();
  const url = 'https://www.seloger.com/annonce/achat/maison/marcq-en-baroeul/centre/ABC123';
  const r = await handleIngest({ syncKey: KEY, redis, now: NOW, body: { source: 'seloger', insee: '59378', cards: [{ url, type: 'maison', price: 1, title: 't', detail: {} }] } });
  assert.equal(r.seen, 1);
});

test('source que le robot lit lui-même, clé inconnue ou fausse : refus', async () => {
  const redis = await setup();
  await assert.rejects(handleIngest({ syncKey: KEY, redis, now: NOW, body: { source: 'orpi', cards: [] } }), /bad-source/);
  await assert.rejects(handleIngest({ syncKey: 'b'.repeat(40), redis, now: NOW, body: { source: 'leboncoin', cards: [] } }), /unknown-space/);
  await assert.rejects(handleIngest({ syncKey: 'court', redis, now: NOW, body: { source: 'leboncoin', cards: [] } }), /bad-key/);
  await assert.rejects(handleIngest({ syncKey: KEY, redis, now: NOW, body: { source: 'leboncoin', cards: new Array(201).fill(card()) } }), /bad-cards/);
});

test('les communes suivies sont données au robot local', async () => {
  const redis = await setup();
  const { communes } = await handleCommunes({ syncKey: KEY, redis, now: NOW });
  assert.deepEqual(communes.map((c) => c.code).sort(), ['59009', '59378']);
  assert.deepEqual(communes[0].types, ['maison']);
});

test('un appel de synchro vide fait exister l’espace du robot local', async () => {
  const redis = createFakeRedis();
  const key = 'c'.repeat(40);
  await handleSync({ syncKey: key, body: { since: 0, items: [] }, redis, now: NOW });
  const r = await handleIngest({ syncKey: key, redis, now: NOW, body: { source: 'leboncoin', cards: [] } });
  assert.deepEqual(r, { seen: 0, added: 0, ignored: 0 });
});

test('le robot en ligne ne demande rien aux sources `local` et ne relit pas leurs annonces', async () => {
  const redis = await setup();
  await handleIngest({ syncKey: KEY, redis, now: NOW, body: { source: 'leboncoin', cards: [card()] } });
  const asked = [];
  const fetcher = { get: async (url) => (asked.push(url), { ok: false, status: 404, html: '' }) };
  await runScan({ redis, fetcher, now: () => NOW + 1000, sources: [sourceById('leboncoin'), sourceById('seloger'), sourceById('heron')] });
  assert.deepEqual(asked, []);
  const [l] = [...(await listingsOf(redis, '59378')).values()];
  assert.equal(l.removedAt, null);
});

test('annonce locale non revue depuis 6 semaines : retirée au passage suivant', async () => {
  const redis = await setup();
  await handleIngest({ syncKey: KEY, redis, now: NOW, body: { source: 'leboncoin', cards: [card()] } });
  const later = NOW + 43 * 24 * 3600 * 1000;
  await redis.command(['ZADD', keys.spaces, String(later), await spaceOf(KEY)]);
  await runScan({ redis, fetcher: { get: async () => ({ ok: false, status: 404, html: '' }) }, now: () => later, sources: [sourceById('leboncoin')] });
  const [l] = [...(await listingsOf(redis, '59378')).values()];
  assert.equal(l.removedAt, later);
});
