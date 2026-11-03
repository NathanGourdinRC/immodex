import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classLine } from '../src/common/energy-text.js';

const num = (n) => String(n);

test('repère de classe : médiane et moitié centrale des ventes de la classe', () => {
  const energy = { 59636: { byClass: { D: { count: 82, median: 3379, p25: 3050, p75: 3700 } } } };
  assert.equal(classLine('D', '59636', energy, 'Wambrechies', num), 'Classe D à Wambrechies : 3379 €/m² médian, la moitié des ventes entre 3050 et 3700 €/m² (82 ventes)');
  assert.equal(classLine('G', '59636', energy, 'Wambrechies', num), null);
  assert.equal(classLine('D', '59636', { 59636: { byClass: {} } }, 'Wambrechies', num), null);
});
