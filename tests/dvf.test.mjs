import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salesAt, summarize, groupMutations, parseAddress, streetTokens, sameStreet, splitIdu, slimRow } from '../src/common/dvf.js';

// Lignes au format de l'API DVF d'Etalab : une ligne par local, valeurs en texte.
function row(o) {
  return {
    id_mutation: o.id,
    date_mutation: o.date,
    nature_mutation: o.nature || 'Vente',
    valeur_fonciere: o.price == null ? 'nan' : String(o.price),
    adresse_numero: o.numero == null ? 'nan' : String(o.numero) + '.0',
    adresse_suffixe: o.suffixe || 'nan',
    adresse_nom_voie: o.voie || 'RUE RACINE',
    id_parcelle: o.parcelle || '59350000OV0090',
    type_local: o.type || 'None',
    surface_reelle_bati: o.surface == null ? 'nan' : String(o.surface),
    nombre_pieces_principales: o.pieces == null ? 'nan' : String(o.pieces),
    lot1_surface_carrez: o.carrez == null ? 'nan' : String(o.carrez),
    surface_terrain: o.terrain == null ? 'nan' : String(o.terrain),
  };
}

const ROWS = [
  // Appartement vendu avec trois dépendances (caves, parking) : une vente, quatre lignes.
  row({ id: '2024-1', date: '2024-07-08', price: 413350, numero: 30, type: 'Appartement', surface: 87, pieces: 4, carrez: 86.5 }),
  row({ id: '2024-1', date: '2024-07-08', price: 413350, numero: 30, type: 'Dépendance' }),
  row({ id: '2024-1', date: '2024-07-08', price: 413350, numero: 30, type: 'Dépendance' }),
  row({ id: '2024-1', date: '2024-07-08', price: 413350, numero: 30, type: 'Dépendance' }),
  row({ id: '2023-1', date: '2023-07-26', price: 323000, numero: 30, type: 'Appartement', surface: 91, pieces: 5 }),
  // Vente groupée de deux logements : pas de prix au m² (il serait faux).
  row({ id: '2022-1', date: '2022-07-04', price: 820000, numero: 30, type: 'Appartement', surface: 85, pieces: 3, carrez: 83.14 }),
  row({ id: '2022-1', date: '2022-07-04', price: 820000, numero: 30, type: 'Appartement', surface: 90, pieces: 4 }),
  // Même adresse sur une autre parcelle de la copropriété.
  row({ id: '2021-1', date: '2021-05-02', price: 150000, numero: 30, parcelle: '59350000OV0091', type: 'Appartement', surface: 40, pieces: 2 }),
  // 30 bis : autre immeuble, à exclure.
  row({ id: '2021-2', date: '2021-06-02', price: 160000, numero: 30, suffixe: 'B', parcelle: '59350000OV0092', type: 'Appartement', surface: 42, pieces: 2 }),
  // Voisins de la rue et de la section : repères de prix seulement.
  row({ id: '2023-2', date: '2023-02-01', price: 200000, numero: 12, parcelle: '59350000OV0010', type: 'Appartement', surface: 50, pieces: 2 }),
  row({ id: '2023-3', date: '2023-03-01', price: 300000, numero: 4, voie: 'RUE DE PUEBLA', parcelle: '59350000OV0020', type: 'Appartement', surface: 60, pieces: 3 }),
  row({ id: '2023-4', date: '2023-04-01', price: 250000, numero: 9, voie: 'RUE DE PUEBLA', parcelle: '59350000OV0021', type: 'Maison', surface: 100, pieces: 5, terrain: 120 }),
];

test('identifiant de parcelle découpé en commune, préfixe, section et numéro', () => {
  assert.deepEqual(splitIdu('59350000OV0090'), { codeInsee: '59350', prefixe: '000', section: 'OV', numero: '0090' });
  assert.deepEqual(splitIdu('2A004000AB0012'), { codeInsee: '2A004', prefixe: '000', section: 'AB', numero: '0012' });
  assert.equal(splitIdu('n importe quoi'), null);
});

test('valeurs absentes de DVF (« nan », « None ») lues comme vides', () => {
  const r = slimRow(row({ id: 'x', date: '2024-01-01', price: null, type: null }));
  assert.equal(r.price, null);
  assert.equal(r.type, null);
  assert.equal(r.surface, null);
});

test('adresses du registre DPE et de DVF comparées malgré les abréviations', () => {
  assert.deepEqual(parseAddress('7BIS Rue de la Caserne Saint-Ruth 59800 Lille'), { number: 7, suffix: 'B', street: ['CASERNE', 'ST', 'RUTH'] });
  assert.deepEqual(parseAddress('120 Avenue Denis Cordonnier 59000 Lille'), { number: 120, suffix: null, street: ['DENIS', 'CORDONNIER'] });
  assert.equal(parseAddress('Rue Jacquemars Gielée 59800 Lille').number, null);
  assert.deepEqual(parseAddress('30 Rue Racine (Lille) 59000 Lille'), { number: 30, suffix: null, street: ['RACINE'] });
  assert.ok(sameStreet(streetTokens('Avenue Denis Cordonnier'), streetTokens('AV DENIS CORDONNIER')));
  assert.ok(sameStreet(streetTokens('Rue du Général de Gaulle'), streetTokens('RUE DU GAL DE GAULLE')));
  assert.ok(sameStreet(streetTokens('Rue de la Caserne Saint-Ruth'), streetTokens('RUE DE LA CASERNE ST RUTH')));
  assert.ok(!sameStreet(streetTokens('Rue Racine'), streetTokens('RUE NATIONALE')));
});

test('une vente regroupe ses lignes : logement, dépendances, prix au m² si un seul logement', () => {
  const byId = Object.fromEntries(groupMutations(ROWS.map(slimRow)).map((m) => [m.id, m]));
  assert.equal(byId['2024-1'].main.length, 1);
  assert.equal(byId['2024-1'].dependances, 3);
  assert.equal(byId['2024-1'].pricePerM2, Math.round(413350 / 87));
  assert.equal(byId['2024-1'].address, '30 RUE RACINE');
  assert.equal(byId['2022-1'].main.length, 2);
  assert.equal(byId['2022-1'].pricePerM2, null);
});

test('ventes à l’adresse : parcelle exacte ou même numéro et même rue, sans le « bis »', () => {
  const mutations = groupMutations(ROWS.map(slimRow));
  const r = summarize(mutations, { exactIdu: '59350000OV0090', address: '30 Rue Racine 59000 Lille', type: 'appartement' });
  assert.deepEqual(r.sales.map((s) => s.id), ['2024-1', '2023-1', '2022-1', '2021-1']);
  assert.equal(r.type, 'Appartement');
  // Rue Racine : 4 ventes d'un seul appartement (2024-1, 2023-1, 2021-1, le 30 bis 2021-2) et le n° 12.
  assert.equal(r.street.count, 5);
  // Section : les mêmes plus l'appartement de la rue de Puebla ; la maison ne compte pas.
  assert.equal(r.section.count, 6);
  assert.deepEqual(r.period, { from: '2021-05-02', to: '2024-07-08' });
});

test('sans parcelle exacte (point posé sur la rue), l’adresse suffit', () => {
  const mutations = groupMutations(ROWS.map(slimRow));
  const r = summarize(mutations, { exactIdu: null, address: '30 Rue Racine 59000 Lille', type: null });
  assert.equal(r.sales.length, 4);
  const none = summarize(mutations, { exactIdu: null, address: '31 Rue Racine 59000 Lille', type: null });
  assert.equal(none.sales.length, 0);
});

test('recherche complète : point hors parcelle, repli sur les parcelles voisines', async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (String(url).includes('apicarto')) {
      const geom = JSON.parse(decodeURIComponent(String(url).split('geom=')[1]));
      if (geom.type === 'Point') return json({ features: [] });
      return json({ features: [{ properties: { idu: '59350000OV0090' } }, { properties: { idu: '59350000OV0091' } }, { properties: { idu: '59350000OW0001' } }] });
    }
    if (String(url).includes('/mutations3/59350/000OV')) return json({ mutations: ROWS });
    return json({ mutations: [] });
  };
  try {
    const r = await salesAt({ lat: 50.62, lon: 3.06, address: '30 Rue Racine 59000 Lille', type: 'appartement' });
    assert.equal(r.parcel, null);
    assert.deepEqual(r.sections, ['59350/000OV', '59350/000OW']);
    assert.equal(r.sales.length, 4);
    assert.ok(calls.some((u) => u.includes('Polygon')));
  } finally {
    globalThis.fetch = original;
  }
});
