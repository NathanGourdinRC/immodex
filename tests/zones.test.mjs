import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanZone, fpInZone, groupsInZone, trackingKey, createZoneStore, checkCriteria, returnedByPrice } from '../src/common/zones.js';
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

test('adresse choisie à la main : gardée avec le suivi, effacée par null, coordonnées vérifiées', async () => {
  const store = createZoneStore(memoryStorage());
  const url = 'https://www.deleu.fr/vente/1';
  // Seule information du suivi : l'entrée reste.
  await store.setTracking(url, { place: { address: ' 19 Rue Rubens 59118 Wambrechies ', lat: 50.687, lon: 3.04, by: 'piste' } }, 1000);
  assert.deepEqual((await store.tracking())[url], { status: null, note: '', place: { address: '19 Rue Rubens 59118 Wambrechies', lat: 50.687, lon: 3.04, by: 'piste', at: 1000 }, updatedAt: 1000 });
  // Statut et note posés ensuite : l'adresse choisie ne bouge pas.
  await store.setTracking(url, { status: 'favori' }, 2000);
  assert.equal((await store.tracking())[url].place.address, '19 Rue Rubens 59118 Wambrechies');
  await store.setTracking(url, { status: null, place: null }, 3000);
  assert.equal((await store.tracking())[url], undefined);
  // « Je ne le trouve pas » : retenu, sans point.
  await store.setTracking(url, { place: { none: true } }, 4000);
  assert.deepEqual((await store.tracking())[url].place, { none: true, at: 4000 });
  // Coordonnées absentes ou hors de France : rien n'est posé.
  await store.setTracking('https://x.fr/2', { place: { address: 'Quelque part', lat: 'abc', lon: 3 } }, 5000);
  await store.setTracking('https://x.fr/3', { place: { address: 'Ailleurs', lat: 10, lon: 3 } }, 5000);
  const all = await store.tracking();
  assert.equal(all['https://x.fr/2'], undefined);
  assert.equal(all['https://x.fr/3'], undefined);
});

test('annonce ouverte : le clic est gardé avec le suivi, seul ou avec un statut, et par lot', async () => {
  const store = createZoneStore(memoryStorage());
  const url = 'orpi:/annonce-vente-maison-e2e/';
  // Seule information du suivi : l'entrée reste (elle n'est plus jaune sur aucun appareil).
  await store.setTracking(url, { opened: 1000 }, 1000);
  assert.deepEqual((await store.tracking())[url], { status: null, note: '', opened: 1000, updatedAt: 1000 });
  // Gardée puis remise sans statut : le clic reste.
  await store.setTracking(url, { status: 'favori' }, 2000);
  await store.setTracking(url, { status: null }, 3000);
  assert.equal((await store.tracking())[url].opened, 1000);
  // « Tout marquer comme vu » : une écriture, la date du premier clic ne bouge pas, le statut non plus.
  await store.setTracking('deleu:/vente/2', { status: 'ecarte' }, 3500);
  const all = await store.markOpened([url, 'deleu:/vente/2', 'maes:/3'], 4000);
  assert.equal(all[url].opened, 1000);
  assert.deepEqual((({ status, opened }) => ({ status, opened }))(all['deleu:/vente/2']), { status: 'ecarte', opened: 4000 });
  assert.equal(all['maes:/3'].opened, 4000);
  assert.deepEqual(Object.keys(await store.tracking()).sort(), ['deleu:/vente/2', 'maes:/3', url].sort());
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

test('recherche nettoyée : budget, terrain, pièces et chambres', () => {
  const z = cleanZone({ communes: [LILLE], budgetMin: '500000', budgetMax: 300000, terrainMin: '200', piecesMin: '4', chambresMin: '0' }, 1000);
  assert.equal(z.budgetMin, 300000);
  assert.equal(z.budgetMax, 500000);
  assert.equal(z.terrainMin, 200);
  assert.equal(z.terrainMax, null);
  assert.equal(z.piecesMin, 4);
  assert.equal(z.chambresMin, null);
});

test('ancienne zone sans les nouveaux champs : toujours valide', () => {
  const z = cleanZone({ id: 'z1', name: 'Lille', communes: [LILLE], type: 'maison', surfaceMin: 90, createdAt: 5 }, 1000);
  assert.equal(z.id, 'z1');
  assert.equal(z.surfaceMin, 90);
  assert.equal(z.budgetMax, null);
});

test('annonce d’une autre commune (code postal lu sur sa page) : hors de la recherche', () => {
  const s = cleanZone({ communes: [LILLE] });
  // Site qui range à Lille une maison de Marcq-en-Barœul (59700).
  assert.equal(checkCriteria({ price: 300000, postal: '59700' }, s).ok, false);
  assert.equal(checkCriteria({ price: 300000, postal: '59800' }, s).ok, true);
  assert.equal(checkCriteria({ price: 300000, postal: null }, s).ok, true);
});

test('type : un terrain à bâtir n’est jamais un logement, le type de la recherche est respecté', () => {
  // « Indifférent » : maisons et appartements. Un terrain nu (sa surface est celle de la
  // parcelle, ses chambres sont inconnues) passerait sinon une recherche « 3 chambres, 100 m² ».
  const any = cleanZone({ communes: [LILLE], surfaceMin: 100, chambresMin: 3 });
  assert.equal(checkCriteria({ type: 'terrain', price: 575000, surface: 1080 }, any).ok, false);
  assert.equal(checkCriteria({ type: 'appartement', price: 575000, surface: 110, chambres: 3 }, any).ok, true);
  const maison = cleanZone({ communes: [LILLE], type: 'maison' });
  assert.equal(checkCriteria({ type: 'appartement', price: 300000 }, maison).ok, false);
  assert.equal(checkCriteria({ type: 'maison', price: 300000 }, maison).ok, true);
  assert.equal(checkCriteria({ type: null, price: 300000 }, maison).ok, true);
});

test('annonce et critères : budget strict, surface à 3 m², inconnues signalées', () => {
  const s = cleanZone({ communes: [LILLE], budgetMax: 450000, surfaceMin: 100, terrainMin: 150, chambresMin: 3 });
  assert.deepEqual(checkCriteria({ price: 440000, surface: 98, terrain: null, pieces: 5, chambres: null }, s), { ok: true, unknown: ['terrain non précisé', 'chambres non précisées'] });
  assert.equal(checkCriteria({ price: 450001, surface: 120 }, s).ok, false);
  assert.equal(checkCriteria({ price: 400000, surface: 96 }, s).ok, false);
  assert.equal(checkCriteria({ price: 400000, surface: 110, terrain: 100 }, s).ok, false);
  assert.deepEqual(checkCriteria({ price: null, surface: 110, terrain: 200, chambres: 3 }, s), { ok: true, unknown: ['prix non précisé'] });
});

// ─── Refus « trop cher » : le bien revient quand son prix baisse de 2 % ───

test('refus « trop cher » : la raison et le prix du refus sont gardés, effacés si le verdict change', async () => {
  const store = createZoneStore(memoryStorage());
  const url = 'https://www.leboncoin.fr/ad/ventes_immobilieres/1';
  await store.setTracking(url, { status: 'ecarte', reason: 'prix', priceAt: 420000 }, 1000);
  assert.deepEqual((await store.tracking())[url], { status: 'ecarte', note: '', reason: 'prix', priceAt: 420000, updatedAt: 1000 });
  // une note ne change pas le verdict : la raison reste
  await store.setTracking(url, { note: 'jardin trop petit' }, 2000);
  assert.equal((await store.tracking())[url].reason, 'prix');
  assert.equal((await store.tracking())[url].priceAt, 420000);
  // refus « pas pertinent » : plus de raison, le bien ne revient jamais
  await store.setTracking(url, { status: 'ecarte' }, 3000);
  assert.equal((await store.tracking())[url].reason, undefined);
  assert.equal((await store.tracking())[url].priceAt, undefined);
  // gardé ensuite : pas de raison non plus
  await store.setTracking(url, { status: 'ecarte', reason: 'prix', priceAt: 400000 }, 4000);
  await store.setTracking(url, { status: 'favori' }, 5000);
  assert.equal((await store.tracking())[url].reason, undefined);
  // une raison sans prix, ou sans refus, n'est pas gardée
  await store.setTracking(url, { status: 'ecarte', reason: 'prix' }, 6000);
  assert.equal((await store.tracking())[url].reason, undefined);
  await store.setTracking(url, { status: 'favori', reason: 'prix', priceAt: 1 }, 7000);
  assert.equal((await store.tracking())[url].reason, undefined);
});

test('un bien refusé pour son prix revient à 2 % de baisse ; refusé comme non pertinent, jamais', () => {
  const dropped = { status: 'ecarte', reason: 'prix', priceAt: 420000 };
  assert.equal(returnedByPrice(dropped, 420000), null);
  assert.equal(returnedByPrice(dropped, 415000), null, '1,2 % : pas assez');
  assert.equal(returnedByPrice(dropped, 411601), null, 'juste au-dessus de 2 %');
  assert.deepEqual(returnedByPrice(dropped, 411600), { was: 420000, now: 411600, drop: 8400, percent: 2 });
  assert.deepEqual(returnedByPrice(dropped, 395000), { was: 420000, now: 395000, drop: 25000, percent: 6 });
  assert.equal(returnedByPrice(dropped, 450000), null, 'prix en hausse');
  assert.equal(returnedByPrice(dropped, null), null, 'prix inconnu');
  assert.equal(returnedByPrice({ status: 'ecarte' }, 300000), null, 'pas pertinent : jamais');
  assert.equal(returnedByPrice({ status: 'favori' }, 300000), null);
  assert.equal(returnedByPrice(undefined, 300000), null);
});
