import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressLookup } from '../api/_lib/address.js';

const LISTING = { postal: '59118', city: 'Wambrechies', surface: 109, energyClass: 'D', gesClass: 'D', energyConsumption: 224, gesEmission: 32, type: 'maison' };
const record = { id: '2259E0123456X', address: '12 Rue de Quesnoy 59118 Wambrechies', lat: 50.686, lon: 3.048 };

test('adresse posée seulement si le DPE désigne un logement avec une confiance haute', async () => {
  const sure = await addressLookup(LISTING, { run: async (p) => (assert.equal(p.energyConsumption, 224), { highConfidence: true, candidates: [{ record, score: 95 }] }) });
  assert.deepEqual(sure, { address: record.address, lat: 50.686, lon: 3.048, dpeId: record.id, addressConfidence: 'haute', leads: null });
});

const flat = (n, surface) => ({ id: `dpe${n}`, address: '151 Allée du Petit Paradis 59118 Wambrechies', lat: 50.68, lon: 3.05, surface, date: '2024-05-27' });

test('logements candidats tous dans le même immeuble : l’adresse est sûre même si le logement ne l’est pas', async () => {
  const candidates = [100, 97, 97, 97].map((score, i) => ({ record: flat(i, 70 + i / 10), score, diffs: [] }));
  const r = await addressLookup({ ...LISTING, type: 'appartement' }, { run: async () => ({ highConfidence: false, candidates }) });
  assert.equal(r.address, '151 Allée du Petit Paradis 59118 Wambrechies');
  assert.equal(r.addressConfidence, 'immeuble');
  assert.equal(r.dpeId, null);
  assert.equal(r.leads, null);
});

test('adresses hésitantes : une piste par adresse, la meilleure correspondance d’abord, sans adresse posée', async () => {
  const at = (address, score, extra = {}) => ({ record: { id: `d${score}`, address, lat: 50.68, lon: 3.04, surface: 90, date: '2026-09-23', ...extra }, score, diffs: ['surface 88.5 m² (annonce : 90)', 'b', 'c', 'd'] });
  const candidates = [at('17 Rue Victor Hugo 59118 Wambrechies', 85), at('19 Rue Rubens 59118 Wambrechies', 85), at('17 rue victor  hugo 59118 Wambrechies', 80), at('Rue des Violettes 59118 Wambrechies', 40), at('3 Rue Sans Point 59118 Wambrechies', 30, { lat: null, lon: null })];
  const r = await addressLookup(LISTING, { run: async () => ({ highConfidence: false, candidates }) });
  assert.equal(r.address, undefined);
  assert.deepEqual(
    r.leads.map((l) => [l.address, l.score, l.count]),
    [
      ['17 Rue Victor Hugo 59118 Wambrechies', 85, 2],
      ['19 Rue Rubens 59118 Wambrechies', 85, 1],
      ['Rue des Violettes 59118 Wambrechies', 40, 1],
    ]
  );
  assert.deepEqual(r.leads[0], { address: '17 Rue Victor Hugo 59118 Wambrechies', lat: 50.68, lon: 3.04, score: 85, count: 2, surface: 90, date: '2026-09-23', dpeId: 'd85', diffs: ['surface 88.5 m² (annonce : 90)', 'b', 'c'] });
});

test('aucun logement dans le registre : ni adresse ni piste', async () => {
  assert.deepEqual(await addressLookup(LISTING, { run: async () => ({ highConfidence: false, candidates: [] }) }), { leads: null });
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
  // Réponse définitive (rien à chercher) : le robot ne recommence pas à chaque passage.
  assert.deepEqual(await addressLookup({ postal: '59118', surface: 80 }, { run }), { leads: null });
  assert.deepEqual(await addressLookup({ ...LISTING, postal: null, city: null }, { run }), { leads: null });
  assert.equal(calls, 0);
});

test('registre ADEME injoignable : pas d’adresse, pas d’erreur', async () => {
  assert.equal(await addressLookup(LISTING, { run: async () => { throw new Error('ADEME 503'); } }), null);
});

test('registre injoignable pendant la recherche (erreurs avalées) : pas de réponse, nouvel essai plus tard', async () => {
  const down = { highConfidence: false, candidates: [], tried: [{ dataset: 'dpe03existant', tier: 0, error: 'ADEME 503' }, { dataset: 'dpe03existant', tier: 1, error: 'fetch failed' }] };
  assert.equal(await addressLookup(LISTING, { run: async () => down }), null);
  // Code postal non retrouvé (service des communes en panne) : même chose.
  assert.equal(await addressLookup({ ...LISTING, postal: null }, { run: async () => ({ highConfidence: false, candidates: [], tried: [], note: 'code postal introuvable' }) }), null);
});

test('règle de l’immeuble : seulement une adresse avec numéro, et seulement si une autre adresse a pu être vue', async () => {
  const at = (address, score, i = 0) => ({ record: { id: `r${score}${i}`, address, lat: 50.68, lon: 3.04, surface: 90 }, score, diffs: [] });
  // Plusieurs maisons de la même rue, sans numéro dans le registre : ce n'est pas un immeuble.
  const street = await addressLookup(LISTING, { run: async () => ({ highConfidence: false, candidates: [at('Rue des Violettes 59118 Wambrechies', 90, 1), at('Rue des Violettes 59118 Wambrechies', 88, 2)] }) });
  assert.equal(street.address, undefined);
  assert.equal(street.leads[0].count, 2);
  // Cinq logements du même immeuble occupent toute la liste lue : un sixième ailleurs pourrait valoir autant.
  const full = await addressLookup(LISTING, { run: async () => ({ highConfidence: false, candidates: [100, 97, 97, 97, 97].map((sc, i) => at('151 Allée du Petit Paradis 59118 Wambrechies', sc, i)) }) });
  assert.equal(full.address, undefined);
  assert.deepEqual(full.leads.map((l) => [l.address, l.count]), [['151 Allée du Petit Paradis 59118 Wambrechies', 5]]);
  // Une autre adresse visible plus bas : l'avance se mesure, l'immeuble est sûr.
  const seen = await addressLookup(LISTING, { run: async () => ({ highConfidence: false, candidates: [...[100, 97, 97, 97].map((sc, i) => at('151 Allée du Petit Paradis 59118 Wambrechies', sc, i)), at('3 Rue Haute 59118 Wambrechies', 60)] }) });
  assert.equal(seen.addressConfidence, 'immeuble');
});
