import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressLookup } from '../api/_lib/address.js';

const LISTING = { postal: '59118', city: 'Wambrechies', surface: 109, energyClass: 'D', gesClass: 'D', energyConsumption: 224, gesEmission: 32, type: 'maison' };
const record = { id: '2259E0123456X', address: '12 Rue de Quesnoy 59118 Wambrechies', lat: 50.686, lon: 3.048 };

test('adresse posée seulement si le DPE désigne un logement avec une confiance haute', async () => {
  const sure = await addressLookup(LISTING, { run: async (p) => (assert.equal(p.energyConsumption, 224), { highConfidence: true, candidates: [{ record, score: 95 }] }) });
  assert.deepEqual(sure, { address: record.address, lat: 50.686, lon: 3.048, dpeId: record.id, addressConfidence: 'haute' });
  const unsure = await addressLookup(LISTING, { run: async () => ({ highConfidence: false, candidates: [{ record }, { record }] }) });
  assert.equal(unsure, null);
});

test('date du DPE lue sur l’annonce : transmise à la recherche', async () => {
  const dateRange = { gte: '2026-09-10', lte: '2026-09-10', precision: 'day' };
  let seen;
  await addressLookup({ ...LISTING, dateRange }, { run: async (p) => ((seen = p), { highConfidence: false, candidates: [] }) });
  assert.deepEqual(seen.dateRange, dateRange);
});

test('sans valeurs de DPE ni code postal : aucune recherche lancée', async () => {
  let calls = 0;
  const run = async () => (calls++, { highConfidence: true, candidates: [{ record }] });
  assert.equal(await addressLookup({ postal: '59118', surface: 80 }, { run }), null);
  assert.equal(await addressLookup({ ...LISTING, postal: null, city: null }, { run }), null);
  assert.equal(calls, 0);
});

test('registre ADEME injoignable : pas d’adresse, pas d’erreur', async () => {
  assert.equal(await addressLookup(LISTING, { run: async () => { throw new Error('ADEME 503'); } }), null);
});
