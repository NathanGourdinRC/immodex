import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupListings, statusOf, listingFacts, trackingKeyOf } from '../src/common/listings.js';
import { handleListings } from '../api/listings.js';
import { fakeRedis } from './helpers/fake-redis.mjs';

const DAY = 24 * 3600 * 1000;
const NOW = Date.parse('2026-11-05T08:00:00Z');
const base = (o) => ({ insee: '59636', type: 'maison', price: 300000, prices: [{ at: NOW - 10 * DAY, price: 300000 }], firstSeen: NOW - 10 * DAY, lastSeen: NOW - DAY, missed: 0, removedAt: null, detail: true, ...o });

test('même bien sur deux sources : un seul groupe, deux liens', () => {
  const maes = base({ id: 'maes:/bien-immobilier/x/', source: 'maes', url: 'https://www.maesimmobilier.fr/bien-immobilier/x/', surface: 109, energyConsumption: 224, gesEmission: 32, price: 299000 });
  const lsi = base({ id: 'lesiteimmo:/acheter/maison/1', source: 'lesiteimmo', url: 'https://www.lesiteimmo.com/acheter/maison-5pieces/wambrechies-59118/1', surface: 109.4, energyConsumption: 224, gesEmission: 32, price: 305000 });
  const other = base({ id: 'orpi:/annonce-vente-maison-a/', source: 'orpi', url: 'https://www.orpi.com/annonce-vente-maison-a/', surface: 140, energyConsumption: 150, gesEmission: 20, price: 520000 });
  const groups = groupListings([maes, lsi, other]);
  assert.equal(groups.length, 2);
  const g = groups.find((x) => x.listings.length === 2);
  assert.deepEqual(g.listings.map((l) => l.source).sort(), ['lesiteimmo', 'maes']);
  assert.equal(g.probable, false);
  assert.equal(listingFacts(g).price, 299000);
});

test('sans DPE : même commune, même type, surface à 1 m² et prix à 5 % → même bien probable', () => {
  const a = base({ id: 'paruvendu:/1', source: 'paruvendu', url: 'https://www.paruvendu.fr/immobilier/vente/maison/1', surface: 80, price: 299500 });
  const b = base({ id: 'orpi:/2', source: 'orpi', url: 'https://www.orpi.com/annonce-vente-maison-2/', surface: 80.5, price: 310000 });
  const c = base({ id: 'orpi:/3', source: 'orpi', url: 'https://www.orpi.com/annonce-vente-maison-3/', surface: 80, price: 360000 });
  const groups = groupListings([a, b, c]);
  assert.equal(groups.length, 2);
  assert.equal(groups.find((g) => g.listings.length === 2).probable, true);
});

test('statut : retiré, prix baissé (avec l’écart), nouveau depuis la dernière visite', () => {
  const [removed] = groupListings([base({ id: 'x:/r', source: 'orpi', url: 'https://www.orpi.com/r', removedAt: NOW - DAY })]);
  assert.deepEqual(statusOf(removed, NOW - 3 * DAY, NOW), { status: 'retire' });
  const [drop] = groupListings([base({ id: 'x:/d', source: 'orpi', url: 'https://www.orpi.com/d', price: 280000, prices: [{ at: NOW - 10 * DAY, price: 300000 }, { at: NOW - DAY, price: 280000 }] })]);
  assert.deepEqual(statusOf(drop, NOW - 3 * DAY, NOW), { status: 'baisse', drop: 20000 });
  const [fresh] = groupListings([base({ id: 'x:/n', source: 'orpi', url: 'https://www.orpi.com/n', firstSeen: NOW - DAY })]);
  assert.deepEqual(statusOf(fresh, NOW - 3 * DAY, NOW), { status: 'nouveau' });
  // Première visite : « nouveau » = vu pour la première fois il y a moins de 3 jours.
  assert.deepEqual(statusOf(fresh, null, NOW), { status: 'nouveau' });
  const [old] = groupListings([base({ id: 'x:/o', source: 'orpi', url: 'https://www.orpi.com/o' })]);
  assert.deepEqual(statusOf(old, NOW - 3 * DAY, NOW), { status: null });
});

test('annonces servies par commune avec l’état des sources', async () => {
  const redis = fakeRedis();
  const l = base({ id: 'orpi:/a', source: 'orpi', url: 'https://www.orpi.com/a' });
  await redis.command(['HSET', 'imx:scan:59636:l', l.id, JSON.stringify(l)]);
  await redis.command(['HSET', 'imx:scan:59636:src', 'orpi', JSON.stringify({ lastRun: NOW - DAY, paused: false }), 'deleu', JSON.stringify({ lastRun: NOW - DAY, paused: true })]);
  await redis.command(['SET', 'imx:scan:last', String(NOW - DAY)]);
  const r = await handleListings({ codes: '59636,74010', redis });
  assert.equal(r.listings.length, 1);
  assert.equal(r.sources['59636'].deleu.paused, true);
  assert.equal(r.lastRun, NOW - DAY);
  await assert.rejects(handleListings({ codes: '59636,abc', redis }), (e) => e.status === 400);
});

test('statut d’un bien : retrouvé sous n’importe quelle adresse de ses annonces ou des annonces vues du même bien', () => {
  const a = base({ id: 'maes:/x', source: 'maes', url: 'https://www.maesimmobilier.fr/bien-immobilier/x/', surface: 109, energyConsumption: 224, gesEmission: 32 });
  const b = base({ id: 'lesiteimmo:/1', source: 'lesiteimmo', url: 'https://www.lesiteimmo.com/acheter/maison-5pieces/wambrechies-59118/1', surface: 109, energyConsumption: 224, gesEmission: 32 });
  const [g] = groupListings([a, b]);
  // Gardé autrefois sous l'adresse de la seconde annonce (avant que les deux soient réunies).
  assert.equal(trackingKeyOf(g, { [b.url]: { status: 'favori' } }), b.url);
  // Gardé sous l'adresse d'une annonce vue (Jinka) dont une adresse est celle de l'annonce scannée.
  const seen = new Map([[b.url, 'https://www.jinka.fr/annonce/42']]);
  assert.equal(trackingKeyOf(g, { 'https://www.jinka.fr/annonce/42': { note: 'cave humide' } }, seen), 'https://www.jinka.fr/annonce/42');
  // Rien de connu : la clé du groupe.
  assert.equal(trackingKeyOf(g, {}), g.key);
});
