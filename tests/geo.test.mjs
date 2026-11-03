import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banSearch } from '../src/common/geo.js';

const answer = (props, coordinates = [3.041466, 50.686429]) => ({ ok: true, json: async () => ({ features: [{ geometry: { coordinates }, properties: props }] }) });

test('adresse saisie : cherchée dans la commune du bien, numéro ou rue retenus', async () => {
  let asked;
  const fetchImpl = async (url) => ((asked = new URL(url)), answer({ label: '17 Rue Victor Hugo 59118 Wambrechies', type: 'housenumber', score: 0.96 }));
  assert.deepEqual(await banSearch('17 rue victor hugo', '59636', { fetchImpl }), { address: '17 Rue Victor Hugo 59118 Wambrechies', lat: 50.686429, lon: 3.041466 });
  assert.equal(asked.searchParams.get('q'), '17 rue victor hugo');
  assert.equal(asked.searchParams.get('citycode'), '59636');
});

test('adresse saisie introuvable : réponse vague (commune seule) ou peu sûre écartée', async () => {
  assert.equal(await banSearch('nulle part', '59636', { fetchImpl: async () => answer({ label: 'Wambrechies', type: 'municipality', score: 0.9 }) }), null);
  assert.equal(await banSearch('xyz', '59636', { fetchImpl: async () => answer({ label: '1 Rue X', type: 'housenumber', score: 0.3 }) }), null);
  assert.equal(await banSearch('  ', '59636', { fetchImpl: async () => assert.fail('aucune demande') }), null);
});

test('service d’adresses injoignable : erreur remontée (message différent d’une adresse introuvable)', async () => {
  await assert.rejects(banSearch('17 rue victor hugo', '59636', { fetchImpl: async () => ({ ok: false, status: 503 }) }));
});

test('saisie trop courte ou ponctuation en tête : pas d’erreur du service, introuvable', async () => {
  let asked = 0;
  const fetchImpl = async (url) => (asked++, assert.equal(new URL(url).searchParams.get('q'), '8 rue haute'), answer({ label: '8 Rue Haute 59118 Wambrechies', type: 'housenumber', score: 0.9 }));
  assert.equal(await banSearch('12', '59636', { fetchImpl }), null);
  assert.equal(asked, 0);
  assert.equal((await banSearch('« 8 rue haute', '59636', { fetchImpl })).address, '8 Rue Haute 59118 Wambrechies');
});

test('lieu-dit : retenu comme une rue', async () => {
  const fetchImpl = async () => answer({ label: 'Les Granges 74410 Saint-Jorioz', type: 'locality', score: 0.8 }, [6.16, 45.83]);
  assert.deepEqual(await banSearch('les granges', '74242', { fetchImpl }), { address: 'Les Granges 74410 Saint-Jorioz', lat: 45.83, lon: 6.16 });
});
