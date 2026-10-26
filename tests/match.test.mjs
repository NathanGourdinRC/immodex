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
  assert.ok(far.diffs.some((d) => d.startsWith('240 kWh')));
});

test('fiche du registre incohérente (code postal de l’adresse différent) : fortement pénalisée', () => {
  const good = { postal: '59000', address: '3 Rue Nationale 59000 Lille', surface: 75, energyClass: 'D', gesClass: 'D' };
  const bad = { ...good, address: 'Impasse Blériot 62160 Bully-les-Mines' };
  const p = { postal: '59000', surface: 75, energyClass: 'D', gesClass: 'D' };
  const sg = scoreRecord(good, p);
  const sb = scoreRecord(bad, p);
  assert.equal(sg.score - sb.score, 40);
  assert.ok(sb.diffs.some((d) => d.includes('incohérente')));
});

test('consommation nettement différente de l’annonce : la confiance baisse', () => {
  const p = { surface: 80, energyClass: 'C', gesClass: 'C', buildingType: 'maison', energyConsumption: 144, gesEmission: 22 };
  const rec = { surface: 80, energyClass: 'C', gesClass: 'C', buildingType: 'maison', energyConsumption: 114, gesEmission: 21.5 };
  const s = scoreRecord(rec, p).score;
  // surface exacte 30 + classes 30 + type 10 - écart de 30 kWh 25 = 45 : plus « élevée » (≥ 80)
  assert.ok(s < 80, `score ${s}`);
});
