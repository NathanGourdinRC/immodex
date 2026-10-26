import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchLevel, upsertSighting, matchesFor, groupSightings, pruneSightings, createPropertyStore, SIGHTINGS_TTL_MS } from '../src/common/properties.js';

const base = { kind: 'dpe', transaction: 'vente', postal: '59000', city: 'Lille', surface: 65, energyClass: 'D', gesClass: 'B', energyConsumption: 201, gesEmission: 7, buildingType: 'appartement' };

test('même numéro de DPE : même bien, numéros différents : biens différents', () => {
  assert.equal(matchLevel({ ...base, dpeId: 'X1' }, { ...base, surface: 80, dpeId: 'X1' }), 'same');
  assert.equal(matchLevel({ ...base, dpeId: 'X1' }, { ...base, dpeId: 'X2' }), null);
});

test('empreinte concordante avec les kWh : très probable ; kWh différents : non', () => {
  assert.equal(matchLevel(base, { ...base, surface: 65.4, energyConsumption: 201.6 }), 'probable');
  assert.equal(matchLevel(base, { ...base, energyConsumption: 230 }), null);
  assert.equal(matchLevel(base, { ...base, energyClass: 'E' }), null);
  assert.equal(matchLevel(base, { ...base, postal: '59800' }), null);
  assert.equal(matchLevel(base, { ...base, transaction: 'location' }), null);
});

test('sans kWh : « possible » seulement si surface identique et deux classes connues', () => {
  const a = { ...base, energyConsumption: null, gesEmission: null };
  assert.equal(matchLevel(a, { ...a }), 'possible');
  assert.equal(matchLevel(a, { ...a, surface: 66 }), null);
  assert.equal(matchLevel(a, { ...a, gesClass: null }), null);
});

test('ville sans code postal : comparée au nom de commune', () => {
  assert.equal(matchLevel({ ...base, postal: null, city: 'Marcq-en-Barœul' }, { ...base, postal: null, city: 'marcq en baroeul' }), 'probable');
});

test('même annonce revue : prix ajouté à l’historique seulement s’il change', () => {
  let { list } = upsertSighting([], { url: 'https://a.fr/annonce/1?utm_source=x', title: 'T3', fp: base, price: 299000 }, 1000);
  ({ list } = upsertSighting(list, { url: 'https://a.fr/annonce/1', title: 'T3', fp: base, price: 299000 }, 2000));
  ({ list } = upsertSighting(list, { url: 'https://a.fr/annonce/1', title: 'T3', fp: base, price: 279000 }, 3000));
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].prices.map((p) => p.price), [299000, 279000]);
  assert.equal(list[0].firstSeen, 1000);
  assert.equal(list[0].lastSeen, 3000);
});

test('republication sur un autre site : retrouvée, avec son prix', () => {
  let { list } = upsertSighting([], { url: 'https://www.leboncoin.fr/ad/ventes_immobilieres/1', fp: base, price: 299000 }, 1000);
  let sighting;
  ({ list, sighting } = upsertSighting(list, { url: 'https://www.agence.fr/vente/2', fp: { ...base, surface: 65.2 }, price: 285000 }, 5000));
  const matches = matchesFor(sighting, list);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].site, 'leboncoin.fr');
  assert.equal(matches[0].price, 299000);
  assert.equal(matches[0].level, 'probable');
});

test('regroupement pour l’onglet Biens : un bien, deux annonces, prix du premier au dernier', () => {
  let { list } = upsertSighting([], { url: 'https://a.fr/1', fp: base, price: 299000 }, 1000);
  ({ list } = upsertSighting(list, { url: 'https://b.fr/2', fp: base, price: 279000 }, 2000));
  ({ list } = upsertSighting(list, { url: 'https://c.fr/3', fp: { ...base, surface: 120 }, price: 450000 }, 3000));
  const groups = groupSightings(list);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].firstPrice, 299000);
  assert.equal(groups[0].lastPrice, 279000);
});

test('conservation : au-delà de 12 mois, l’annonce est oubliée', () => {
  const now = Date.now();
  assert.equal(pruneSightings([{ url: 'x', lastSeen: now - SIGHTINGS_TTL_MS - 1 }], now).length, 0);
});

test('stockage : enregistrement, numéro de DPE rattaché, effacement', async () => {
  const data = {};
  const area = { get: async (k) => ({ [k]: data[k] }), set: async (o) => Object.assign(data, JSON.parse(JSON.stringify(o))) };
  const store = createPropertyStore(area);
  await store.record({ url: 'https://a.fr/1', title: 'A', fp: base, price: 299000 });
  const second = await store.record({ url: 'https://b.fr/2', title: 'B', fp: { ...base, energyConsumption: null, gesEmission: null }, price: 289000 });
  assert.equal(second.matches[0].level, 'possible');
  await store.setDpe('https://a.fr/1', 'DPE42', '30 Rue Racine 59000 Lille');
  await store.setDpe('https://b.fr/2', 'DPE42');
  const got = await store.get('https://b.fr/2');
  assert.equal(got.matches[0].level, 'same');
  assert.equal(got.matches[0].address, '30 Rue Racine 59000 Lille');
  await store.clear();
  assert.equal((await store.list()).length, 0);
});
