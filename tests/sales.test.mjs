import { test } from 'node:test';
import assert from 'node:assert/strict';
import { communeSales } from '../src/common/sales.js';
import { slimRow } from '../src/common/dvf.js';

// Lignes au format de l'API DVF d'Etalab (une ligne par local), réduites par slimRow comme en vrai.
function row(o) {
  return slimRow({
    id_mutation: o.id,
    date_mutation: o.date,
    nature_mutation: o.nature || 'Vente',
    valeur_fonciere: String(o.price),
    adresse_numero: '12.0',
    adresse_suffixe: 'nan',
    adresse_nom_voie: 'RUE DE QUESNOY',
    id_parcelle: o.parcelle || '596360000B0001',
    type_local: o.type || 'None',
    surface_reelle_bati: o.surface == null ? 'nan' : String(o.surface),
    nombre_pieces_principales: o.pieces == null ? 'nan' : String(o.pieces),
    lot1_surface_carrez: 'nan',
    surface_terrain: o.terrain == null ? 'nan' : String(o.terrain),
    nature_culture: 'sols',
    longitude: o.lon == null ? 'nan' : String(o.lon),
    latitude: o.lat == null ? 'nan' : String(o.lat),
  });
}

const ROWS = {
  '59636/0000A': [
    row({ id: 'a1', date: '2025-12-30', price: 330000, type: 'Maison', surface: 100, pieces: 5, terrain: 200, lon: 3.05, lat: 50.68 }),
    row({ id: 'a2', date: '2024-05-02', price: 250000, type: 'Appartement', surface: 70, pieces: 3, lon: 3.051, lat: 50.681 }),
  ],
  '59636/0000B': [
    // Vente groupée de deux maisons : pas de prix au m², exclue.
    row({ id: 'b1', date: '2023-01-10', price: 600000, type: 'Maison', surface: 90, pieces: 4, lon: 3.06, lat: 50.67 }),
    row({ id: 'b1', date: '2023-01-10', price: 600000, type: 'Maison', surface: 110, pieces: 5, lon: 3.06, lat: 50.67 }),
  ],
};

const sections = (ids) => async () => ({ features: ids.map((id) => ({ properties: { id } })) });
const fetchSections = sections(['596360000A', '596360000B']);
const fetchRows = async (key) => ROWS[key] || [];

test('ventes d’une commune : maisons seules, coordonnées gardées, date la plus récente', async () => {
  const r = await communeSales('59636', { type: 'maison', fetchSections, fetchRows });
  assert.equal(r.sales.length, 1);
  assert.equal(r.sales[0].type, 'Maison');
  assert.equal(r.sales[0].pricePerM2, 3300);
  assert.equal(r.sales[0].terrain, 200);
  assert.equal(r.sales[0].commune, '59636');
  assert.deepEqual([r.sales[0].lon, r.sales[0].lat], [3.05, 50.68]);
  assert.equal(r.lastDate, '2025-12-30');
  assert.equal(r.sections, 2);
  assert.equal(r.loaded, 2);
  assert.equal(r.partial, false);
});

test('type indifférent : maisons et appartements', async () => {
  const r = await communeSales('59636', { type: null, fetchSections, fetchRows });
  assert.deepEqual(r.sales.map((s) => s.type).sort(), ['Appartement', 'Maison']);
});

test('commune sans ventes ou trop grande : liste vide, partielle signalée', async () => {
  const empty = await communeSales('67482', { type: 'maison', fetchSections: sections([]), fetchRows });
  assert.deepEqual(empty.sales, []);
  assert.equal(empty.lastDate, null);
  const ids = Array.from({ length: 70 }, (_, i) => `59350000${String(i).padStart(2, '0')}`);
  let calls = 0;
  const big = await communeSales('59350', { type: null, fetchSections: sections(ids), fetchRows: async () => (calls++, []), maxSections: 60 });
  assert.equal(big.sections, 70);
  assert.equal(big.loaded, 60);
  assert.equal(calls, 60);
  assert.equal(big.partial, true);
});
