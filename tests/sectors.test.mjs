import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSectors, nearestSales, isComparable, HEX_RADIUS_M, MIN_SALES, LEVEL_GAP, NEAREST } from '../src/common/sectors.js';
import { cleanZone } from '../src/common/zones.js';

const WAMB = { code: '59636', nom: 'Wambrechies', codesPostaux: ['59118'] };

let n = 0;
const sale = (lat, lon, pricePerM2, commune = '59636') => ({
  id: `v${n++}`, date: '2024-01-01', commune, address: null, price: pricePerM2 * 100, type: 'Maison',
  surface: 100, pieces: 5, terrain: 150, dependances: 0, pricePerM2, lon, lat,
});

// Grappe A (~2 900 €/m²), grappe B à 1 km à l'est (~3 700 €/m²), 3 ventes isolées, 1 sans position.
const A = { lat: 50.68, lon: 3.05 };
const B = { lat: 50.68, lon: 3.0642 };
const sales = [
  ...Array.from({ length: 12 }, (_, i) => sale(A.lat, A.lon, 2850 + i * 10)),
  ...Array.from({ length: 12 }, (_, i) => sale(B.lat, B.lon, 3650 + i * 10)),
  sale(50.69, 3.04, 3300),
  sale(50.67, 3.075, 3300),
  sale(50.695, 3.07, 3300),
  sale(null, null, 3300),
];
// Point D loin des autres : 8 ventes à Wambrechies, 4 à Marquette.
const mixedCommunesAtC = [
  ...Array.from({ length: 8 }, () => sale(50.7, 3.05, 3300, '59636')),
  ...Array.from({ length: 4 }, () => sale(50.7, 3.05, 3300, '59388')),
];

test('valeurs fixées par la conception', () => {
  assert.deepEqual([HEX_RADIUS_M, MIN_SALES, LEVEL_GAP, NEAREST], [220, 10, 0.1, 15]);
});

test('secteurs : nombre de ventes, niveau par rapport à la commune, peu de ventes sans niveau', () => {
  const { sectors, communeMedians } = buildSectors(sales);
  const a = sectors.find((s) => s.count === 12 && s.median < 3200);
  const b = sectors.find((s) => s.count === 12 && s.median > 3400);
  assert.equal(a.level, 'moins');
  assert.equal(b.level, 'plus');
  assert.ok(sectors.filter((s) => s.count < 10).every((s) => s.level === null && s.median === null));
  assert.equal(sectors.reduce((total, s) => total + s.count, 0), 27);
  assert.ok(communeMedians['59636'] > 3200 && communeMedians['59636'] < 3400);
  assert.equal(a.polygon.length, 6);
  assert.equal(a.commune, '59636');
});

test('secteur à cheval sur deux communes : comparé à la commune majoritaire', () => {
  const { sectors } = buildSectors([...sales, ...mixedCommunesAtC]);
  const c = sectors.find((s) => s.sales.some((v) => v.commune === '59388'));
  assert.equal(c.commune, '59636');
  assert.equal(c.count, 12);
  assert.equal(c.level, 'moyenne');
});

test('type indifférent : maisons et appartements mélangés sans erreur', () => {
  const mixed = sales.map((v, i) => ({ ...v, type: i % 2 ? 'Appartement' : 'Maison' }));
  const { sectors } = buildSectors(mixed);
  assert.equal(sectors.reduce((total, s) => total + s.count, 0), mixed.filter((v) => v.lat != null).length);
});

test('aucune vente : aucun secteur', () => {
  assert.deepEqual(buildSectors([]), { sectors: [], communeMedians: {} });
});

test('15 ventes les plus proches : fourchette et rayon', () => {
  const near = nearestSales(sales, { lat: A.lat, lon: A.lon });
  assert.equal(near.sales.length, 15);
  assert.ok(near.p25 <= near.median && near.median <= near.p75);
  assert.ok(near.radius > 0);
  assert.equal(nearestSales(sales.slice(0, 3), { lat: A.lat, lon: A.lon }), null);
});

test('vente comparable aux critères de la recherche', () => {
  const s = cleanZone({ communes: [WAMB], surfaceMin: 90, surfaceMax: 140, piecesMin: 4, terrainMin: 100 });
  assert.ok(isComparable({ surface: 88, pieces: 4, terrain: 150 }, s));
  assert.ok(!isComparable({ surface: 120, pieces: 3, terrain: 150 }, s));
  assert.ok(!isComparable({ surface: 120, pieces: 5, terrain: 50 }, s));
  assert.ok(isComparable({ surface: 300, pieces: 1, terrain: null }, cleanZone({ communes: [WAMB] })));
});
