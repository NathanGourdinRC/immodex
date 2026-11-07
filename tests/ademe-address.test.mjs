import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_MAP, normalizeRecord, withStreetNumber } from '../src/common/ademe.js';

test('numéro saisi par le diagnostiqueur repris quand l’adresse normalisée s’arrête à la rue', () => {
  assert.equal(withStreetNumber('Rue du Général Leclerc 59118 Wambrechies', '49 F Rue du Général Leclerc'), '49 F Rue du Général Leclerc 59118 Wambrechies');
  assert.equal(withStreetNumber('Rue du Général Leclerc 59118 Wambrechies', '12bis rue du general-leclerc'), '12bis Rue du Général Leclerc 59118 Wambrechies');
  assert.equal(withStreetNumber('Rue de Belfort 11000 Carcassonne', '25 Rue de Belfort\nJARDINS DES REMPARTS I'), '25 Rue de Belfort 11000 Carcassonne');
  // Registre complet : le champ brut est demandé et sert à la fiche normalisée.
  const r = normalizeRecord({ adresse_ban: 'Rue du Général Leclerc 59118 Wambrechies', adresse_brut: '49 F Rue du Général Leclerc' }, FIELD_MAP.existing);
  assert.equal(r.address, '49 F Rue du Général Leclerc 59118 Wambrechies');
});

test('adresse normalisée gardée telle quelle si elle a un numéro ou si la saisie ne correspond pas', () => {
  // Déjà un numéro : rien ne change.
  assert.equal(withStreetNumber('52 Rue du Général Leclerc 59118 Wambrechies', '50 Rue du Général Leclerc'), '52 Rue du Général Leclerc 59118 Wambrechies');
  // Autre rue, ou rue abrégée : pas de numéro inventé.
  assert.equal(withStreetNumber('Rue du Général Leclerc 59118 Wambrechies', '49 Rue de Quesnoy'), 'Rue du Général Leclerc 59118 Wambrechies');
  assert.equal(withStreetNumber('Rue du Général Leclerc 59118 Wambrechies', '49 r du gal Leclerc'), 'Rue du Général Leclerc 59118 Wambrechies');
  // Saisie sans numéro, vide, ou registre ancien sans champ brut.
  assert.equal(withStreetNumber('Rue du Général Leclerc 59118 Wambrechies', 'Rue du Général Leclerc'), 'Rue du Général Leclerc 59118 Wambrechies');
  assert.equal(withStreetNumber('Rue du Général Leclerc 59118 Wambrechies', null), 'Rue du Général Leclerc 59118 Wambrechies');
  assert.equal(normalizeRecord({ geo_adresse: 'Rue X 59000 Lille' }, FIELD_MAP.legacy).address, 'Rue X 59000 Lille');
});
