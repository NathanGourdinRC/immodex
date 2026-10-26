import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanZone, fpInZone, groupsInZone, trackingKey, createZoneStore } from '../src/common/zones.js';
import { zoneDpeFilters, isoDaysAgo, marketOf, priceBreaks, priceClass, priceColumns } from '../src/common/zone-data.js';

const LILLE = { code: '59350', nom: 'Lille', codesPostaux: ['59000', '59160', '59260', '59777', '59800'], centre: { type: 'Point', coordinates: [3.047, 50.632] } };
const LAMBERSART = { code: '59328', nom: 'Lambersart', codesPostaux: ['59130'] };

function memoryStorage() {
  const data = {};
  return {
    data,
    async get(key) {
      return key in data ? { [key]: JSON.parse(JSON.stringify(data[key])) } : {};
    },
    async set(obj) {
      Object.assign(data, JSON.parse(JSON.stringify(obj)));
    },
  };
}

test('zone nettoyée : communes valides sans doublon, surfaces remises dans l’ordre, nom par défaut', () => {
  const z = cleanZone({ communes: [LILLE, LILLE, { code: 'abc', nom: 'X' }, LAMBERSART], type: 'studio', surfaceMin: '90', surfaceMax: 50 }, 1000);
  assert.deepEqual(z.communes.map((c) => c.code), ['59350', '59328']);
  assert.equal(z.name, 'Lille, Lambersart');
  assert.equal(z.type, null);
  assert.equal(z.surfaceMin, 50);
  assert.equal(z.surfaceMax, 90);
  assert.equal(cleanZone({ communes: [{ code: '2A004', nom: 'Ajaccio' }] }).communes.length, 1);
});

test('annonce dans la zone : code postal (ou ville), type et surface avec marge', () => {
  const zone = cleanZone({ communes: [LILLE], type: 'appartement', surfaceMin: 50, surfaceMax: 80 });
  assert.ok(fpInZone({ postal: '59800', surface: 65, buildingType: 'appartement' }, zone));
  assert.ok(fpInZone({ city: 'Lille', surface: 48 }, zone));
  assert.ok(!fpInZone({ postal: '59130', surface: 65 }, zone));
  assert.ok(!fpInZone({ postal: '59000', surface: 65, buildingType: 'maison' }, zone));
  assert.ok(!fpInZone({ postal: '59000', surface: 120 }, zone));
  assert.ok(!fpInZone({ kind: 'land', postal: '59000', surface: 65 }, zone));
});

test('biens de la zone et clé de suivi stable (première annonce du bien)', () => {
  const zone = cleanZone({ communes: [LAMBERSART] });
  const groups = [
    { sightings: [{ url: 'https://a.fr/1', fp: { postal: '59130', surface: 90 } }, { url: 'https://b.fr/2', fp: { postal: '59130', surface: 90 } }] },
    { sightings: [{ url: 'https://c.fr/3', fp: { postal: '59000', surface: 90 } }] },
  ];
  const inside = groupsInZone(groups, zone);
  assert.equal(inside.length, 1);
  assert.equal(trackingKey(inside[0]), 'https://a.fr/1');
});

test('stockage : création, modification, visite précédente, suivi effacé quand vide', async () => {
  const store = createZoneStore(memoryStorage());
  const z = await store.save({ communes: [LILLE], type: 'maison' }, 1000);
  assert.equal((await store.list()).length, 1);
  const edited = await store.save({ id: z.id, surfaceMin: 80 }, 2000);
  assert.equal(edited.type, 'maison');
  assert.equal(edited.surfaceMin, 80);
  assert.equal(edited.createdAt, 1000);
  assert.equal(await store.markVisited(z.id, 3000), null);
  assert.equal(await store.markVisited(z.id, 4000), 3000);
  await store.setTracking('https://a.fr/1', { status: 'favori' });
  await store.setTracking('https://a.fr/1', { note: 'Belle lumière' });
  assert.deepEqual((({ status, note }) => ({ status, note }))((await store.tracking())['https://a.fr/1']), { status: 'favori', note: 'Belle lumière' });
  await store.setTracking('https://a.fr/1', { status: null, note: '' });
  assert.equal((await store.tracking())['https://a.fr/1'], undefined);
  assert.equal(await store.swapSeenDpe(z.id, ['D1', 'D2']), null);
  assert.deepEqual(await store.swapSeenDpe(z.id, ['D2', 'D3']), ['D1', 'D2']);
  assert.deepEqual(new Set(await store.swapSeenDpe(z.id, [])), new Set(['D1', 'D2', 'D3']));
  await store.remove(z.id);
  assert.equal((await store.list()).length, 0);
});

test('filtres ADEME de la zone : communes, période, type, surface avec marge', () => {
  const zone = cleanZone({ communes: [LILLE, LAMBERSART], type: 'appartement', surfaceMin: 50, surfaceMax: 80 });
  const f = zoneDpeFilters(zone, '2026-09-26');
  assert.deepEqual(f.in, [['code_insee_ban', '59350,59328']]);
  assert.deepEqual(f.eq, [['type_batiment', 'appartement']]);
  assert.deepEqual(f.gte, [['date_etablissement_dpe', '2026-09-26'], ['surface_habitable_logement', 47]]);
  assert.deepEqual(f.lte, [['surface_habitable_logement', 83]]);
  const any = zoneDpeFilters(cleanZone({ communes: [LILLE] }), '2026-09-26');
  assert.deepEqual(any.in[1], ['type_batiment', 'maison,appartement']);
  assert.equal(isoDaysAgo(30, Date.parse('2026-10-26T12:00:00Z')), '2026-09-26');
});

test('prix du marché : colonnes selon le type, seuils de couleur arrondis', () => {
  assert.equal(priceColumns('maison').median, 'med_prix_m2_whole_maison');
  assert.equal(priceColumns(null).count, 'nb_ventes_whole_apt_maison');
  assert.deepEqual(marketOf({ med_prix_m2_whole_appartement: 3777, nb_ventes_whole_appartement: 13809 }, 'appartement'), { median: 3777, count: 13809 });
  assert.equal(marketOf({ med_prix_m2_whole_maison: null, nb_ventes_whole_maison: null }, 'maison'), null);
  const breaks = priceBreaks([2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500]);
  assert.deepEqual(breaks, [3000, 4000, 5000, 6000]);
  assert.equal(priceClass(2100, breaks), 0);
  assert.equal(priceClass(4000, breaks), 2);
  assert.equal(priceClass(9000, breaks), 4);
});
