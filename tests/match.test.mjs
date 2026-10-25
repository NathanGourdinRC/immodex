import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFilters, scoreRecord } from '../src/common/match.js';
import { DATASETS, buildAdemeUrl } from '../src/common/ademe.js';

const base = { kind: 'dpe', postal: '59000', surface: 65, energyClass: 'D', gesClass: 'B', energyConsumption: 212, gesEmission: 8 };

test('niveau 0 : filtre sur la consommation et les émissions, sans les classes', () => {
  const f = buildFilters(base, DATASETS.existing, 0);
  assert.deepEqual(f.gte, [['surface_habitable_logement', 62], ['conso_5_usages_par_m2_ep', 211], ['emission_ges_5_usages_par_m2', 7]]);
  assert.deepEqual(f.lte, [['surface_habitable_logement', 68], ['conso_5_usages_par_m2_ep', 213], ['emission_ges_5_usages_par_m2', 9]]);
  assert.deepEqual(f.eq, [['code_postal_ban', '59000']]);
});

test('niveau 0 sur l’ancienne base DPE : noms de champs de la base historique', () => {
  const f = buildFilters(base, DATASETS.legacy, 0);
  assert.ok(f.gte.some(([k]) => k === 'consommation_energie'));
  assert.ok(f.gte.some(([k]) => k === 'estimation_ges'));
});

test('ville à plusieurs codes postaux : filtre « dans la liste »', () => {
  const p = { ...base, postal: null, postals: ['59000', '59160', '59800'] };
  const f = buildFilters(p, DATASETS.existing, 1);
  assert.deepEqual(f.in, [['code_postal_ban', '59000,59160,59800']]);
  const { url } = buildAdemeUrl({ dataset: DATASETS.existing, filters: f });
  assert.match(url, /code_postal_ban_in=59000%2C59160%2C59800/);
});

test('consommation identique : gros bonus de score', () => {
  const rec = { surface: 65, energyClass: 'D', gesClass: 'B', energyConsumption: 212, gesEmission: 8 };
  const withValues = scoreRecord(rec, base);
  const without = scoreRecord(rec, { ...base, energyConsumption: null, gesEmission: null });
  assert.equal(withValues.score - without.score, 35);
  assert.ok(withValues.reasons.includes('consommation identique'));
  const far = scoreRecord({ ...rec, energyConsumption: 240 }, base);
  assert.ok(far.diffs.some((d) => d.startsWith('conso 240')));
});
