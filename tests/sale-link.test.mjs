import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSale } from '../api/_lib/sale-link.js';

const DAY = 24 * 3600 * 1000;
const REMOVED = Date.parse('2027-01-15');
const listing = (o = {}) => ({ insee: '59636', type: 'maison', surface: 110, terrain: 300, removedAt: REMOVED, address: null, ...o });
const sale = (o = {}) => ({ id: 's', date: '2027-04-10', commune: '59636', type: 'Maison', address: '12 RUE DE QUESNOY', price: 455000, surface: 112, terrain: 310, pricePerM2: 4063, ...o });

test('lien sûr : même adresse que l’adresse probable de l’annonce (DPE)', () => {
  const r = matchSale(listing({ address: '12 Rue de Quesnoy 59118 Wambrechies' }), [sale({ surface: 140 })]);
  assert.deepEqual(r, { date: '2027-04-10', price: 455000, pricePerM2: 4063, how: 'sure' });
});

test('lien probable : même type, surface à 5 %, terrain proche, 1 à 12 mois après le retrait', () => {
  assert.equal(matchSale(listing(), [sale()]).how, 'probable');
  assert.equal(matchSale(listing(), [sale({ surface: 120 })]), null);
  assert.equal(matchSale(listing(), [sale({ terrain: 500 })]), null);
  assert.equal(matchSale(listing(), [sale({ type: 'Appartement' })]), null);
  assert.equal(matchSale(listing(), [sale({ commune: '59388' })]), null);
});

test('vente trop tôt ou trop tard : pas de lien', () => {
  assert.equal(matchSale(listing(), [sale({ date: '2027-01-20' })]), null);
  assert.equal(matchSale(listing(), [sale({ date: '2028-02-01' })]), null);
});

test('deux ventes possibles sans adresse : aucune n’est choisie', () => {
  assert.equal(matchSale(listing(), [sale({ id: 'a' }), sale({ id: 'b', date: '2027-05-02', surface: 109 })]), null);
});

test('annonce pas retirée : pas de lien', () => {
  assert.equal(matchSale(listing({ removedAt: null }), [sale()]), null);
});
