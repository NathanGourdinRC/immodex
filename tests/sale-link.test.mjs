import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSale } from '../api/_lib/sale-link.js';

const DAY = 24 * 3600 * 1000;
const REMOVED = Date.parse('2027-01-15');
// Adresse probable de l'annonce : celle de son DPE, dans la même rue que la vente mais pas au même numéro.
const listing = (o = {}) => ({ insee: '59636', type: 'maison', surface: 110, terrain: 300, removedAt: REMOVED, address: '20 Rue de Quesnoy 59118 Wambrechies', ...o });
const sale = (o = {}) => ({ id: 's', date: '2027-04-10', commune: '59636', type: 'Maison', address: '12 RUE DE QUESNOY', price: 455000, surface: 112, terrain: 310, pricePerM2: 4063, ...o });

test('lien sûr : même adresse que l’adresse probable de l’annonce (DPE), même type, surface proche', () => {
  const r = matchSale(listing({ address: '12 Rue de Quesnoy 59118 Wambrechies', terrain: 900 }), [sale({ surface: 124 })]);
  assert.deepEqual(r, { id: 's', date: '2027-04-10', price: 455000, pricePerM2: 4063, how: 'sure' });
});

test('même adresse mais un autre logement : pas de lien sûr', () => {
  const at = listing({ address: '12 Rue de Quesnoy 59118 Wambrechies' });
  assert.equal(matchSale(at, [sale({ surface: 140 })]), null);
  assert.equal(matchSale(at, [sale({ type: 'Appartement' })]), null);
  // Deux ventes à l'adresse (immeuble, division) : aucune n'est sûre ni probable.
  assert.equal(matchSale(at, [sale({ id: 'a' }), sale({ id: 'b', date: '2027-05-02', surface: 109 })]), null);
});

test('lien probable : seulement dans la rue de l’annonce, même type, surface à 5 %, terrain proche', () => {
  assert.equal(matchSale(listing(), [sale()]).how, 'probable');
  assert.equal(matchSale(listing({ address: null }), [sale()]), null);
  assert.equal(matchSale(listing(), [sale({ address: '12 RUE DE LILLE' })]), null);
  assert.equal(matchSale(listing(), [sale({ surface: 120 })]), null);
  assert.equal(matchSale(listing(), [sale({ terrain: 500 })]), null);
  assert.equal(matchSale(listing(), [sale({ type: 'Appartement' })]), null);
  assert.equal(matchSale(listing(), [sale({ commune: '59388' })]), null);
});

test('vente trop tôt ou trop tard : pas de lien', () => {
  assert.equal(matchSale(listing(), [sale({ date: '2027-01-20' })]), null);
  assert.equal(matchSale(listing(), [sale({ date: '2028-02-01' })]), null);
});

test('deux ventes possibles dans la rue : aucune n’est choisie', () => {
  assert.equal(matchSale(listing(), [sale({ id: 'a' }), sale({ id: 'b', date: '2027-05-02', address: '14 RUE DE QUESNOY', surface: 109 })]), null);
});

test('annonce pas retirée : pas de lien', () => {
  assert.equal(matchSale(listing({ removedAt: null }), [sale()]), null);
});
