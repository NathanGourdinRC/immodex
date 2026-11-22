// Rattrapage du Fil depuis l'historique des recherches (src/background/fil-backfill.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backfillFil, cardsFromHistory, STATE_KEY } from '../src/background/fil-backfill.js';

const NOW = Date.parse('2026-11-22T08:00:00Z');
const DATE = { gte: '2026-06-17', lte: '2026-06-17', precision: 'day' };
const entry = (id, o = {}, page = {}) => ({
  kind: 'dpe',
  payload: { kind: 'dpe', surface: 110, postal: '59290', city: 'Wasquehal', energyClass: 'D', gesClass: 'D', buildingType: 'maison', dateRange: DATE, ...o },
  page: { url: `https://www.leboncoin.fr/ad/ventes_immobilieres/${id}`, title: 'Maison 4 pièces 110 m²', ...page },
});
const memory = (init = {}) => {
  const data = { ...init };
  return { data, get: async (k) => ({ [k]: data[k] }), set: async (o) => Object.assign(data, o) };
};

test('cartes du rattrapage : annonces Leboncoin cherchées avec une date ou les chiffres du DPE', () => {
  const cards = cardsFromHistory([
    entry(1),
    entry(2, { dateRange: null }), // ni date ni chiffres : rien de plus que ce que le Fil sait
    entry(3, { dateRange: null, energyConsumption: 180, gesEmission: 30 }),
    entry(4, {}, { url: 'https://www.seloger.com/annonces/achat/maison/4.htm' }),
    entry(5, { buildingType: null }, { title: 'Appartement 3 pièces 60 m²' }),
    entry(6, { kind: 'land' }),
    entry(1, { dateRange: { gte: '2025-01-01', lte: '2025-12-31', precision: 'year' } }), // plus ancienne : ignorée
  ]);
  assert.deepEqual(cards.map((c) => c.url.split('/').pop()), ['1', '3', '5']);
  assert.deepEqual(cards[0].detail.dateRange, DATE);
  assert.equal(cards[0].price, null);
  assert.equal(cards[2].type, 'appartement');
});

test('rattrapage : par paquets de 5, une annonce acceptée n’est plus renvoyée, une inconnue l’est plus tard', async () => {
  const history = { list: async () => Array.from({ length: 7 }, (_, i) => entry(100 + i)) };
  const storage = memory();
  const calls = [];
  const send = async (body) => (calls.push(body), { addressed: 1, skipped: body.cards.some((c) => c.url.endsWith('/106')) ? ['https://www.leboncoin.fr/ad/ventes_immobilieres/106'] : [] });
  const r = await backfillFil({ history, storage, send, now: NOW });
  assert.deepEqual(r, { sent: 7, addressed: 2 });
  assert.deepEqual(calls.map((c) => c.cards.length), [5, 2]);
  assert.ok(calls.every((c) => c.onlyKnown === true && c.source === 'leboncoin'));
  // Moins de 6 heures plus tard : rien.
  assert.deepEqual(await backfillFil({ history, storage, send, now: NOW + 3600 * 1000 }), { skipped: 'recent' });
  // Passage suivant : seule l'annonce inconnue du Fil repart.
  calls.length = 0;
  await backfillFil({ history, storage, send, now: NOW + 7 * 3600 * 1000 });
  assert.deepEqual(calls.flatMap((c) => c.cards.map((x) => x.url.split('/').pop())), ['106']);
});

test('rattrapage : synchro non activée, rien n’est noté et le prochain réveil réessaie', async () => {
  const history = { list: async () => [entry(1)] };
  const storage = memory();
  const send = async () => {
    throw new Error('synchro non activée');
  };
  await assert.rejects(backfillFil({ history, storage, send, now: NOW }), /synchro non activée/);
  assert.equal(storage.data[STATE_KEY], undefined);
});
