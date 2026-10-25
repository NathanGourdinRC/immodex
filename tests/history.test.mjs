import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY_KEY,
  HISTORY_MAX,
  HISTORY_TTL_MS,
  normalizePageUrl,
  slimResult,
  pruneEntries,
  upsertEntry,
  createHistoryStore,
} from '../src/common/history.js';

// Faux chrome.storage.local : même interface asynchrone get/set.
function fakeStorage() {
  const data = {};
  return {
    data,
    async get(key) {
      return { [key]: data[key] };
    },
    async set(obj) {
      await new Promise((r) => setTimeout(r, 1));
      Object.assign(data, JSON.parse(JSON.stringify(obj)));
    },
  };
}

const dpePayload = { kind: 'dpe', postal: '59000', surface: 65, energyClass: 'D' };
const dpeResult = {
  candidates: [
    { score: 90, reasons: ['surface exacte'], diffs: [], record: { id: 'X1', address: '1 rue A', raw: { lourd: 'x'.repeat(500) } } },
    { score: 40, reasons: [], diffs: ['GES'], record: { id: 'X2', address: '2 rue B', raw: {} } },
  ],
  dataset: 'dpe03existant',
  tier: 1,
  tried: [{ url: 'https://...' }],
};

test('normalizePageUrl retire le suivi publicitaire et l’ancre', () => {
  assert.equal(
    normalizePageUrl('https://www.leboncoin.fr/ad/ventes_immobilieres/123?utm_source=x&page=2#photos'),
    'https://www.leboncoin.fr/ad/ventes_immobilieres/123?page=2'
  );
  assert.equal(normalizePageUrl('pas une url'), null);
});

test('slimResult enlève la fiche ADEME brute et la géométrie des parcelles', () => {
  const slim = slimResult(dpeResult);
  assert.equal(slim.candidates.length, 2);
  assert.equal(slim.candidates[0].record.raw, undefined);
  assert.equal(slim.candidates[0].record.address, '1 rue A');
  assert.equal(slim.tried, undefined);
  const land = slimResult({ kind: 'land', candidates: [{ score: 70, parcel: { idu: 'P1', geometry: { coordinates: [] }, centroid: [3, 50] } }] });
  assert.equal(land.candidates[0].parcel.geometry, undefined);
  assert.deepEqual(land.candidates[0].parcel.centroid, [3, 50]);
});

test('pruneEntries supprime au-delà de 7 jours et de 50 entrées', () => {
  const now = Date.now();
  const old = { createdAt: now - HISTORY_TTL_MS - 1 };
  const recent = Array.from({ length: 60 }, (_, i) => ({ createdAt: now - i }));
  assert.equal(pruneEntries([old], now).length, 0);
  assert.equal(pruneEntries(recent, now).length, HISTORY_MAX);
});

test('upsertEntry remplace une recherche identique et la remonte en tête', () => {
  const now = Date.now();
  const a = { key: 'k1', createdAt: now - 10, id: 'a' };
  const b = { key: 'k2', createdAt: now - 5, id: 'b' };
  const a2 = { key: 'k1', createdAt: now, id: 'a2' };
  const out = upsertEntry([b, a], a2, now);
  assert.deepEqual(out.map((e) => e.id), ['a2', 'b']);
});

test('le stockage retrouve une recherche par URL d’annonce, la supprime, vide tout', async () => {
  const storage = fakeStorage();
  const store = createHistoryStore(storage);
  const page = { url: 'https://www.seloger.com/annonces/achat/appartement/lille-59/123.htm?utm_campaign=z', title: 'T3 Lille' };
  const entry = await store.add({ payloadKey: 'dpe|59000|65', payload: dpePayload, result: dpeResult, page });
  assert.equal(storage.data[HISTORY_KEY].length, 1);
  assert.equal(storage.data[HISTORY_KEY][0].result.candidates[0].record.raw, undefined);

  const found = await store.getForUrl('https://www.seloger.com/annonces/achat/appartement/lille-59/123.htm#galerie');
  assert.equal(found.id, entry.id);
  assert.equal(found.page.site, 'seloger.com');
  assert.equal(await store.getForUrl('https://www.seloger.com/autre.htm'), null);

  await store.remove(entry.id);
  assert.equal((await store.list()).length, 0);
  await store.add({ payloadKey: 'k', payload: dpePayload, result: dpeResult, page: null });
  await store.clear();
  assert.equal((await store.list()).length, 0);
});

test('deux recherches simultanées sont toutes les deux enregistrées', async () => {
  const store = createHistoryStore(fakeStorage());
  await Promise.all([
    store.add({ payloadKey: 'a', payload: dpePayload, result: dpeResult, page: { url: 'https://a.fr/1' } }),
    store.add({ payloadKey: 'b', payload: dpePayload, result: dpeResult, page: { url: 'https://b.fr/2' } }),
  ]);
  assert.equal((await store.list()).length, 2);
});
