import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupListings, statusOf, listingFacts, trackingKeyOf, negotiation, negotiationText, saleOf, shortPrice, placeOf, needsPlace, isIncomplete, isUnopened, robotSeenAt, UNOPENED_SINCE } from '../src/common/listings.js';
import { handleListings } from '../api/listings.js';
import { fakeRedis } from './helpers/fake-redis.mjs';

const DAY = 24 * 3600 * 1000;
const NOW = Date.parse('2026-11-05T08:00:00Z');
const base = (o) => ({ insee: '59636', type: 'maison', price: 300000, prices: [{ at: NOW - 10 * DAY, price: 300000 }], firstSeen: NOW - 10 * DAY, lastSeen: NOW - DAY, missed: 0, removedAt: null, detail: true, ...o });

test('même bien sur deux sources : un seul groupe, deux liens', () => {
  const maes = base({ id: 'maes:/bien-immobilier/x/', source: 'maes', url: 'https://www.maesimmobilier.fr/bien-immobilier/x/', surface: 109, energyConsumption: 224, gesEmission: 32, price: 299000 });
  const lsi = base({ id: 'lesiteimmo:/acheter/maison/1', source: 'lesiteimmo', url: 'https://www.lesiteimmo.com/acheter/maison-5pieces/wambrechies-59118/1', surface: 109.4, energyConsumption: 224, gesEmission: 32, price: 305000 });
  const other = base({ id: 'orpi:/annonce-vente-maison-a/', source: 'orpi', url: 'https://www.orpi.com/annonce-vente-maison-a/', surface: 140, energyConsumption: 150, gesEmission: 20, price: 520000 });
  const groups = groupListings([maes, lsi, other]);
  assert.equal(groups.length, 2);
  const g = groups.find((x) => x.listings.length === 2);
  assert.deepEqual(g.listings.map((l) => l.source).sort(), ['lesiteimmo', 'maes']);
  assert.equal(g.probable, false);
  assert.equal(listingFacts(g).price, 299000);
});

test('sans DPE : même commune, même type, surface à 1 m² et prix à 5 % → même bien probable', () => {
  const a = base({ id: 'paruvendu:/1', source: 'paruvendu', url: 'https://www.paruvendu.fr/immobilier/vente/maison/1', surface: 80, price: 299500 });
  const b = base({ id: 'orpi:/2', source: 'orpi', url: 'https://www.orpi.com/annonce-vente-maison-2/', surface: 80.5, price: 310000 });
  const c = base({ id: 'orpi:/3', source: 'orpi', url: 'https://www.orpi.com/annonce-vente-maison-3/', surface: 80, price: 360000 });
  const groups = groupListings([a, b, c]);
  assert.equal(groups.length, 2);
  assert.equal(groups.find((g) => g.listings.length === 2).probable, true);
});

// Cas réel (Marcq-en-Barœul) : deux maisons voisines, chacune sur Deleu, SeLoger et Leboncoin.
// L'annonce Leboncoin sans DPE de A ressemble à B (surface, prix à 5 %) : elle ne doit pas
// ramener tout B dans le groupe de A.
test('deux biens voisins publiés chacun sur trois sources restent deux groupes', () => {
  const A = { surface: 110, price: 420000, pieces: 5, chambres: 4, terrain: 350 };
  const B = { surface: 109, price: 416000, pieces: 4, chambres: 3 };
  const a1 = base({ id: 'deleu:/a', source: 'deleu', url: 'https://deleu.fr/a', ...A, energyConsumption: 147, gesEmission: 30 });
  const a2 = base({ id: 'seloger:/a', source: 'seloger', url: 'https://www.seloger.com/a', ...A, energyConsumption: 147, gesEmission: 30 });
  const a3 = base({ id: 'leboncoin:/a', source: 'leboncoin', url: 'https://www.leboncoin.fr/a', ...A });
  const b1 = base({ id: 'deleu:/b', source: 'deleu', url: 'https://deleu.fr/b', ...B, energyConsumption: 112, gesEmission: 4 });
  const b2 = base({ id: 'seloger:/b', source: 'seloger', url: 'https://www.seloger.com/b', ...B, terrain: 100 });
  const b3 = base({ id: 'leboncoin:/b', source: 'leboncoin', url: 'https://www.leboncoin.fr/b', ...B });
  for (const order of [[a1, a2, a3, b1, b2, b3], [a3, b3, b2, a2, b1, a1], [b1, a3, a1, b3, a2, b2]]) {
    const groups = groupListings(order);
    assert.equal(groups.length, 2);
    for (const g of groups) assert.deepEqual(g.listings.map((l) => l.source).sort(), ['deleu', 'leboncoin', 'seloger']);
    for (const g of groups) assert.equal(new Set(g.listings.map((l) => l.url.slice(-1))).size, 1, 'a et b ne se mélangent pas');
  }
});

// Toutes les façons d'ordonner une liste (la base ne garantit aucun ordre d'arrivée).
const permutations = (list) => (list.length <= 1 ? [list] : list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [x, ...rest])));

// Cas réel (La Madeleine) : deux maisons de 127 m², 5 pièces, 4 chambres, à 1 000 € d'écart, chacune
// sur Leboncoin et SeLoger. Seule la première donne un terrain et un DPE. Selon l'ordre d'arrivée,
// l'annonce Leboncoin pauvre en détails prenait la place de la bonne : chaque carte réunissait
// l'annonce d'une maison et celle de l'autre, et l'annonce déjà écartée revenait avec le mauvais bien.
test('deux maisons jumelles sur Leboncoin et SeLoger : mêmes groupes, quel que soit l’ordre d’arrivée', () => {
  const house = { surface: 127, pieces: 5, chambres: 4 };
  const sl1 = base({ id: 'seloger:/269', source: 'seloger', url: 'https://www.seloger.com/269', ...house, price: 439000, terrain: 147, energyClass: 'C', energyConsumption: 170, gesEmission: 28, firstSeen: NOW - 3 * DAY });
  const lbc1 = base({ id: 'leboncoin:/3245', source: 'leboncoin', url: 'https://www.leboncoin.fr/3245', ...house, price: 439000, terrain: 147, energyClass: 'C', firstSeen: NOW - 2 * DAY });
  const sup = base({ id: 'superimmo:/x', source: 'superimmo', url: 'https://www.superimmo.com/x', surface: 127, price: 439000, firstSeen: NOW - 2 * DAY });
  const lbc2 = base({ id: 'leboncoin:/3301', source: 'leboncoin', url: 'https://www.leboncoin.fr/3301', ...house, price: 440000, firstSeen: NOW - 2 * DAY });
  const sl2 = base({ id: 'seloger:/26TT', source: 'seloger', url: 'https://www.seloger.com/26TT', ...house, price: 440000, firstSeen: NOW - DAY });
  for (const order of permutations([sl1, lbc1, sup, lbc2, sl2])) {
    const groups = groupListings(order);
    assert.equal(groups.length, 2, order.map((l) => l.id).join(' '));
    const urlsOf = (l) => groups.find((g) => g.listings.includes(l)).listings.map((m) => m.url).sort();
    assert.deepEqual(urlsOf(lbc2), [lbc2.url, sl2.url].sort(), 'la maison sans détails : ses deux annonces ensemble');
    assert.ok(urlsOf(lbc1).includes(sl1.url), 'la maison au terrain de 147 m² : ses deux annonces ensemble');
  }
});

// Cas réel (Marcq-en-Barœul) : l'annonce Leboncoin à 460 k€ (classe E) prenait la place de l'annonce
// Leboncoin à 445 k€ (classe C, terrain 260 m²) dans le groupe du SeLoger à 445 k€ : le bon bien
// restait seul, donc « nouveau » alors qu'il avait déjà été écarté sous une autre adresse.
test('une classe énergie différente prouve deux biens, et la bonne annonce rejoint son groupe', () => {
  const sl = base({ id: 'seloger:/267', source: 'seloger', url: 'https://www.seloger.com/267', surface: 100, pieces: 5, chambres: 4, terrain: 260, energyClass: 'C', price: 445000, firstSeen: NOW - 3 * DAY });
  const lbcSame = base({ id: 'leboncoin:/3276', source: 'leboncoin', url: 'https://www.leboncoin.fr/3276', surface: 100, pieces: 5, chambres: 4, terrain: 260, energyClass: 'C', price: 445000, firstSeen: NOW - 2 * DAY });
  const lbcOther = base({ id: 'leboncoin:/3284', source: 'leboncoin', url: 'https://www.leboncoin.fr/3284', surface: 100, pieces: 5, chambres: 4, energyClass: 'E', price: 460000, firstSeen: NOW - 2 * DAY });
  for (const order of permutations([sl, lbcSame, lbcOther])) {
    const groups = groupListings(order);
    assert.equal(groups.length, 2, order.map((l) => l.id).join(' '));
    assert.deepEqual(groups.find((g) => g.listings.includes(sl)).listings.map((l) => l.url).sort(), [lbcSame.url, sl.url].sort());
  }
  // Même sans les autres annonces : deux maisons, classes C et E, ne se réunissent pas.
  const mk = (id, source, energyClass) => base({ id: `${source}:/${id}`, source, url: `https://exemple.fr/${id}`, surface: 100, price: 300000, energyClass });
  assert.equal(groupListings([mk('a', 'orpi', 'C'), mk('b', 'pap', 'E')]).length, 2);
  assert.equal(groupListings([mk('a', 'orpi', 'C'), mk('b', 'pap', 'C')]).length, 1);
  assert.equal(groupListings([mk('a', 'orpi', 'C'), mk('b', 'pap', null)]).length, 1);
});

// Cas réel (Lompret) : un seul bien sur six sites, mais les sources ne s'accordent pas sur le terrain
// (45 m² pour iad et lesiteimmo, 775 m² pour les trois autres). Le DPE réunit déjà un 45 et un 775 :
// le terrain est prouvé peu fiable pour ce bien, il ne doit plus bloquer les autres annonces.
test('terrain lu différemment par les sources : un bien déjà réuni par le DPE n’est pas coupé en trois cartes', () => {
  const house = { insee: '59356', surface: 119, pieces: 3, chambres: 2, price: 399000, energyClass: 'F' };
  const mk = (source, o) => base({ id: `${source}:/lompret`, source, url: `https://${source}.example/lompret`, ...house, ...o });
  const listings = [
    mk('paruvendu', { terrain: 775, energyConsumption: 371, gesEmission: 82 }),
    mk('lesiteimmo', { terrain: 45, energyConsumption: 371, gesEmission: 82 }),
    mk('superimmo', { terrain: null, pieces: null, chambres: null, energyClass: null }),
    mk('iad', { terrain: 45 }),
    mk('seloger', { terrain: 775 }),
    mk('leboncoin', { terrain: 775 }),
  ];
  for (const order of permutations(listings)) {
    const groups = groupListings(order);
    assert.equal(groups.length, 1, order.map((l) => l.source).join(' '));
    assert.equal(groups[0].listings.length, 6);
  }
});

test('terrain : sans désaccord déjà prouvé dans le groupe, un terrain différent reste la preuve de deux biens', () => {
  const house = { surface: 119, pieces: 3, chambres: 2, price: 399000, energyClass: 'F' };
  const mk = (source, terrain, o) => base({ id: `${source}:/x`, source, url: `https://${source}.example/x`, ...house, terrain, ...o });
  // Le groupe du DPE a un terrain cohérent (45 et 45) : une annonce à 775 m² est un autre bien.
  const groups = groupListings([mk('paruvendu', 45, { energyConsumption: 371, gesEmission: 82 }), mk('lesiteimmo', 45, { energyConsumption: 371, gesEmission: 82 }), mk('seloger', 775)]);
  assert.equal(groups.length, 2);
});

test('sans DPE : deux annonces en ligne de la même source ne forment pas un même bien', () => {
  const a = base({ id: 'leboncoin:/1', source: 'leboncoin', url: 'https://www.leboncoin.fr/1', surface: 80, price: 300000 });
  const b = base({ id: 'leboncoin:/2', source: 'leboncoin', url: 'https://www.leboncoin.fr/2', surface: 80, price: 305000 });
  assert.equal(groupListings([a, b]).length, 2);
  // l'ancienne annonce retirée puis republiée par la même source reste reliée
  assert.equal(groupListings([{ ...a, removedAt: NOW - DAY }, b]).length, 1);
});

test('sans DPE : les prix ne s’enchaînent pas (420 k€ → 400 k€ → 389 k€ = trois biens, pas un)', () => {
  const mk = (id, source, price) => base({ id: `${source}:/${id}`, source, url: `https://exemple.fr/${id}`, surface: 110, price });
  const groups = groupListings([mk('a', 'orpi', 420000), mk('b', 'paruvendu', 400000), mk('c', 'pap', 389000)]);
  assert.equal(groups.length, 2);
  assert.ok(groups.every((g) => g.listings.every((l) => g.listings.every((m) => Math.abs(l.price - m.price) <= 0.05 * Math.max(l.price, m.price)))));
});

test('sans DPE : chambres, pièces ou terrain différents → deux biens', () => {
  const mk = (id, o) => base({ id: `orpi:/${id}`, source: id === 'x' ? 'orpi' : 'paruvendu', url: `https://exemple.fr/${id}`, surface: 90, price: 300000, ...o });
  assert.equal(groupListings([mk('x', { chambres: 3 }), mk('y', { chambres: 4 })]).length, 2);
  assert.equal(groupListings([mk('x', { pieces: 4 }), mk('y', { pieces: 5 })]).length, 2);
  assert.equal(groupListings([mk('x', { terrain: 350 }), mk('y', { terrain: 100 })]).length, 2);
  // un champ absent d'un côté ne bloque pas
  assert.equal(groupListings([mk('x', { chambres: 3, terrain: 350 }), mk('y', {})]).length, 1);
});

test('statut : retiré, prix baissé (avec l’écart), nouveau depuis la dernière visite', () => {
  const [removed] = groupListings([base({ id: 'x:/r', source: 'orpi', url: 'https://www.orpi.com/r', removedAt: NOW - DAY })]);
  assert.deepEqual(statusOf(removed, NOW - 3 * DAY, NOW), { status: 'retire' });
  const [drop] = groupListings([base({ id: 'x:/d', source: 'orpi', url: 'https://www.orpi.com/d', price: 280000, prices: [{ at: NOW - 10 * DAY, price: 300000 }, { at: NOW - DAY, price: 280000 }] })]);
  assert.deepEqual(statusOf(drop, NOW - 3 * DAY, NOW), { status: 'baisse', drop: 20000 });
  const [fresh] = groupListings([base({ id: 'x:/n', source: 'orpi', url: 'https://www.orpi.com/n', firstSeen: NOW - DAY })]);
  assert.deepEqual(statusOf(fresh, NOW - 3 * DAY, NOW), { status: 'nouveau' });
  // Première visite : « nouveau » = vu pour la première fois il y a moins de 3 jours.
  assert.deepEqual(statusOf(fresh, null, NOW), { status: 'nouveau' });
  const [old] = groupListings([base({ id: 'x:/o', source: 'orpi', url: 'https://www.orpi.com/o' })]);
  assert.deepEqual(statusOf(old, NOW - 3 * DAY, NOW), { status: null });
});

test('annonce jaune : arrivée par le robot depuis le 4 novembre, jamais ouverte, toujours en ligne', () => {
  const since = Date.parse('2026-11-04T00:00:00Z');
  assert.equal(UNOPENED_SINCE, since);
  const [fresh] = groupListings([base({ id: 'x:/j', source: 'orpi', url: 'https://www.orpi.com/j?ref=1', firstSeen: NOW - 5 * DAY, readAt: NOW - DAY })]);
  // Vue sur la liste le 31 octobre, page lue (arrivée dans le Fil) le 4 novembre : c'est la lecture qui compte.
  assert.equal(robotSeenAt(fresh), NOW - DAY);
  assert.equal(isUnopened(fresh, undefined), true);
  assert.equal(isUnopened(fresh, { status: 'favori' }), true);
  // Un clic suffit, sur n'importe quel appareil (suivi synchronisé).
  assert.equal(isUnopened(fresh, { opened: NOW }), false);
  // Déjà ouverte sur le site de l'agence (annonce vue dans le navigateur) : pas jaune.
  assert.equal(isUnopened(fresh, {}, { seenUrls: new Set(['https://www.orpi.com/j']) }), false);
  // Arrivée avant la date de départ : jamais jaune.
  const [old] = groupListings([base({ id: 'x:/v', source: 'orpi', url: 'https://www.orpi.com/v' })]);
  assert.equal(isUnopened(old, {}), false);
  // Page lue avant l'heure de lecture (readAt absent) : sa première vue tient lieu d'arrivée.
  const [noRead] = groupListings([base({ id: 'x:/w', source: 'orpi', url: 'https://www.orpi.com/w', firstSeen: NOW - DAY })]);
  assert.equal(isUnopened(noRead, {}), true);
  // Annonce retirée de partout : rien à ouvrir.
  const [gone] = groupListings([base({ id: 'x:/g', source: 'orpi', url: 'https://www.orpi.com/g', firstSeen: NOW - DAY, removedAt: NOW })]);
  assert.equal(isUnopened(gone, {}), false);
});

test('annonces servies par commune avec l’état des sources', async () => {
  const redis = fakeRedis();
  const l = base({ id: 'orpi:/a', source: 'orpi', url: 'https://www.orpi.com/a' });
  await redis.command(['HSET', 'imx:scan:59636:l', l.id, JSON.stringify(l)]);
  await redis.command(['HSET', 'imx:scan:59636:src', 'orpi', JSON.stringify({ lastRun: NOW - DAY, paused: false }), 'deleu', JSON.stringify({ lastRun: NOW - DAY, paused: true })]);
  await redis.command(['SET', 'imx:scan:last', String(NOW - DAY)]);
  const r = await handleListings({ codes: '59636,74010', redis });
  assert.equal(r.listings.length, 1);
  assert.equal(r.sources['59636'].deleu.paused, true);
  assert.equal(r.lastRun, NOW - DAY);
  await assert.rejects(handleListings({ codes: '59636,abc', redis }), (e) => e.status === 400);
});

test('les annonces d’une source abandonnée (Les Clefs de Chez Moi) ne sont plus servies', async () => {
  const redis = fakeRedis();
  const kept = base({ id: 'orpi:/annonce-vente-maison-a/', source: 'orpi', url: 'https://www.orpi.com/annonce-vente-maison-a/' });
  const retired = base({ id: 'clefs:/achat-immobilier/nord/lille/maisons/maison-1chambres-45m2-4595518.html', source: 'clefs', url: 'https://www.lesclefsdechezmoi.fr/achat-immobilier/nord/lille/maisons/maison-1chambres-45m2-4595518.html', price: null, prices: [] });
  for (const l of [kept, retired]) await redis.command(['HSET', 'imx:scan:59636:l', l.id, JSON.stringify(l)]);
  await redis.command(['HSET', 'imx:scan:59636:src', 'orpi', JSON.stringify({ lastRun: NOW }), 'clefs', JSON.stringify({ lastRun: NOW })]);
  const r = await handleListings({ codes: '59636', redis });
  assert.deepEqual(r.listings.map((l) => l.source), ['orpi']);
  assert.deepEqual(Object.keys(r.sources['59636']), ['orpi']);
});

test('statut d’un bien : retrouvé sous n’importe quelle adresse de ses annonces ou des annonces vues du même bien', () => {
  const a = base({ id: 'maes:/x', source: 'maes', url: 'https://www.maesimmobilier.fr/bien-immobilier/x/', surface: 109, energyConsumption: 224, gesEmission: 32 });
  const b = base({ id: 'lesiteimmo:/1', source: 'lesiteimmo', url: 'https://www.lesiteimmo.com/acheter/maison-5pieces/wambrechies-59118/1', surface: 109, energyConsumption: 224, gesEmission: 32 });
  const [g] = groupListings([a, b]);
  // Gardé autrefois sous l'adresse de la seconde annonce (avant que les deux soient réunies).
  assert.equal(trackingKeyOf(g, { [b.url]: { status: 'favori' } }), b.url);
  // Gardé sous l'adresse d'une annonce vue (Jinka) dont une adresse est celle de l'annonce scannée.
  const seen = new Map([[b.url, 'https://www.jinka.fr/annonce/42']]);
  assert.equal(trackingKeyOf(g, { 'https://www.jinka.fr/annonce/42': { note: 'cave humide' } }, seen), 'https://www.jinka.fr/annonce/42');
  // Rien de connu : la clé du groupe.
  assert.equal(trackingKeyOf(g, {}), g.key);
});

// Cas réel : un bien écarté sous l'adresse d'une de ses annonces revenait comme non écarté, parce
// qu'une autre de ses annonces portait seulement un « ouvert » (clic sur la carte) et passait d'abord.
test('statut d’un bien : un verdict (écarté, gardé) passe avant un simple « ouvert » ou une note sur une autre annonce', () => {
  const a = base({ id: 'maes:/x', source: 'maes', url: 'https://www.maesimmobilier.fr/bien-immobilier/x/', surface: 109, energyConsumption: 224, gesEmission: 32, firstSeen: NOW - 12 * DAY });
  const b = base({ id: 'lesiteimmo:/1', source: 'lesiteimmo', url: 'https://www.lesiteimmo.com/acheter/maison-5pieces/wambrechies-59118/1', surface: 109, energyConsumption: 224, gesEmission: 32 });
  const [g] = groupListings([a, b]);
  assert.equal(g.key, a.url, 'la clé du groupe est l’annonce la plus ancienne');
  assert.equal(trackingKeyOf(g, { [a.url]: { opened: NOW }, [b.url]: { status: 'ecarte' } }), b.url);
  assert.equal(trackingKeyOf(g, { [a.url]: { note: 'cave humide' }, [b.url]: { status: 'favori' } }), b.url);
  // Un verdict d'une annonce vue du même bien passe aussi avant un « ouvert » de la clé du groupe.
  const seen = new Map([[b.url, 'https://www.jinka.fr/annonce/42']]);
  assert.equal(trackingKeyOf(g, { [a.url]: { opened: NOW }, 'https://www.jinka.fr/annonce/42': { status: 'ecarte' } }, seen), 'https://www.jinka.fr/annonce/42');
  // Sans verdict nulle part : la première annonce suivie, comme avant.
  assert.equal(trackingKeyOf(g, { [b.url]: { opened: NOW } }), b.url);
});

// Deux annonces d'un même bien peuvent porter deux verdicts (l'une gardée, l'autre écartée, cas des
// cartes d'abord séparées puis réunies). Écarté l'emporte, quel que soit l'ordre : un bien refusé
// ne doit pas revenir dans le fil parce qu'une autre de ses annonces avait été gardée.
test('statut d’un bien : « écarté » l’emporte sur « gardé » quand deux annonces du même bien portent chacune un verdict', () => {
  const a = base({ id: 'maes:/x', source: 'maes', url: 'https://www.maesimmobilier.fr/bien-immobilier/x/', surface: 109, energyConsumption: 224, gesEmission: 32, firstSeen: NOW - 12 * DAY });
  const b = base({ id: 'lesiteimmo:/1', source: 'lesiteimmo', url: 'https://www.lesiteimmo.com/acheter/maison-5pieces/wambrechies-59118/1', surface: 109, energyConsumption: 224, gesEmission: 32 });
  const [g] = groupListings([a, b]);
  assert.equal(g.key, a.url);
  // Gardé sur la clé du groupe (trouvée en premier), écarté sur l'autre annonce : écarté gagne.
  assert.equal(trackingKeyOf(g, { [a.url]: { status: 'favori' }, [b.url]: { status: 'ecarte' } }), b.url);
  // Même résultat dans l'autre sens.
  assert.equal(trackingKeyOf(g, { [a.url]: { status: 'ecarte' }, [b.url]: { status: 'favori' } }), a.url);
  // Verdict écarté posé sous l'adresse d'une annonce vue du même bien.
  const seen = new Map([[b.url, 'https://www.jinka.fr/annonce/42']]);
  assert.equal(trackingKeyOf(g, { [a.url]: { status: 'favori' }, 'https://www.jinka.fr/annonce/42': { status: 'ecarte' } }, seen), 'https://www.jinka.fr/annonce/42');
  // Deux « gardé » : le premier trouvé, comme avant.
  assert.equal(trackingKeyOf(g, { [a.url]: { status: 'favori' }, [b.url]: { status: 'favori' } }), a.url);
});

test('marge de négociation : écart entre le premier prix affiché et le prix signé, à partir de 3 ventes reliées', () => {
  const sold = (id, first, signed, how = 'probable') => base({ id, source: 'orpi', url: `https://www.orpi.com/${id}`, price: first, prices: [{ at: 1, price: first }], removedAt: NOW - 90 * DAY, sale: { date: '2027-04-10', price: signed, pricePerM2: 4000, how } });
  const two = groupListings([sold('a', 500000, 465000), sold('b', 300000, 291000)]);
  assert.equal(negotiation(two), null);
  const three = groupListings([sold('a', 500000, 465000, 'sure'), sold('b', 300000, 291000), sold('c', 400000, 380000)]);
  assert.deepEqual(negotiation(three), { count: 3, median: 5, sure: 1 });
  assert.deepEqual(saleOf(three[0]), { date: '2027-04-10', price: 465000, pricePerM2: 4000, how: 'sure', margin: 7 });
});

test('prix court des points de la carte, comme sur Airbnb', () => {
  assert.equal(shortPrice(389000), '389 k€');
  assert.equal(shortPrice(389600), '390 k€');
  assert.equal(shortPrice(95000), '95 k€');
  assert.equal(shortPrice(1250000), '1,25 M€');
  assert.equal(shortPrice(2000000), '2 M€');
  assert.equal(shortPrice(null), null);
});

test('texte de la marge : liens probables comptés à part, honoraires d’agence signalés', () => {
  assert.equal(negotiationText(null), null);
  assert.equal(negotiationText({ count: 3, median: 5, sure: 1 }), 'Écart médian entre le premier prix relevé et le prix signé : 5 % (3 ventes reliées : 1 sûre, 2 probables). Le prix affiché comprend souvent les honoraires d’agence, que le prix de l’acte n’inclut pas.');
  assert.match(negotiationText({ count: 4, median: 6, sure: 0 }), /\(4 ventes reliées, toutes probables\)/);
  assert.match(negotiationText({ count: 3, median: 4, sure: 3 }), /\(3 ventes reliées, toutes sûres\)/);
});

test('bien encore en vente quelque part : aucune vente affichée', () => {
  const sale = { date: '2027-04-10', price: 290000, pricePerM2: 2900, how: 'probable' };
  // Annonce revenue en ligne avec une vente restée posée.
  const [back] = groupListings([base({ id: 'orpi:/b', source: 'orpi', url: 'https://www.orpi.com/b', sale })]);
  assert.equal(saleOf(back), null);
  // Même bien sur deux sites : retiré de l'un, toujours en ligne sur l'autre.
  const gone = base({ id: 'maes:/bien-immobilier/x/', source: 'maes', url: 'https://www.maesimmobilier.fr/bien-immobilier/x/', surface: 109, energyConsumption: 224, gesEmission: 32, removedAt: NOW - 60 * DAY, sale });
  const live = base({ id: 'lesiteimmo:/acheter/maison/1', source: 'lesiteimmo', url: 'https://www.lesiteimmo.com/acheter/maison-5pieces/wambrechies-59118/1', surface: 109.4, energyConsumption: 224, gesEmission: 32 });
  const groups = groupListings([gone, live]);
  assert.equal(groups.length, 1);
  assert.equal(saleOf(groups[0]), null);
});

test('pistes d’adresse d’un bien publié sur deux sites : une par adresse, la meilleure correspondance gardée', () => {
  const lead = (address, score) => ({ address, lat: 50.68, lon: 3.04, score, count: 1 });
  const a = base({ id: 'paruvendu:/1', source: 'paruvendu', url: 'https://www.paruvendu.fr/immobilier/vente/maison/1', surface: 100, energyConsumption: 234, gesEmission: 29, leads: [lead('Rue des Piqurières 59118 Wambrechies', 15)] });
  const b = base({ id: 'lesiteimmo:/2', source: 'lesiteimmo', url: 'https://www.lesiteimmo.com/acheter/maison/2', surface: 100, energyConsumption: 234, gesEmission: 29, leads: [lead('Rue des Piqurieres 59118 Wambrechies', 30), lead('8 Rue Haute 59118 Wambrechies', 20)] });
  const [g] = groupListings([a, b]);
  const f = listingFacts(g);
  assert.deepEqual(f.leads.map((l) => [l.address, l.score]), [['Rue des Piqurieres 59118 Wambrechies', 30], ['8 Rue Haute 59118 Wambrechies', 20]]);
  assert.equal(f.hasDpe, true);
  // Adresse sûre sur l'un des sites : plus de pistes.
  const [placed] = groupListings([a, { ...b, address: '4 Rue des Piqurières 59118 Wambrechies', lat: 50.68, lon: 3.04 }]);
  assert.equal(listingFacts(placed).leads, null);
});

test('point d’un bien : adresse du registre, sinon celle choisie à la main ; à placer sinon', () => {
  const f = { lat: null, lon: null, address: null };
  assert.equal(placeOf(f, {}), null);
  assert.deepEqual(placeOf(f, { place: { address: '19 Rue Rubens', lat: 50.687, lon: 3.04, by: 'piste' } }), { address: '19 Rue Rubens', lat: 50.687, lon: 3.04, by: 'piste' });
  // L'adresse vérifiée par Nathan l'emporte sur celle que le robot trouverait plus tard.
  assert.deepEqual(placeOf({ address: '12 Rue de Quesnoy', lat: 50.686, lon: 3.048 }, {}), { address: '12 Rue de Quesnoy', lat: 50.686, lon: 3.048, by: 'registre' });
  assert.deepEqual(placeOf({ address: '12 Rue de Quesnoy', lat: 50.686, lon: 3.048 }, { place: { address: '19 Rue Rubens', lat: 50.687, lon: 3.04, by: 'piste' } }), { address: '19 Rue Rubens', lat: 50.687, lon: 3.04, by: 'piste' });
  assert.equal(placeOf(f, { place: { none: true } }), null);
  assert.equal(needsPlace(f, {}, { status: null }), true);
  assert.equal(needsPlace(f, { place: { none: true } }, { status: null }), false);
  assert.equal(needsPlace(f, { status: 'ecarte' }, { status: null }), false);
  assert.equal(needsPlace(f, {}, { status: 'retire' }), false);
  assert.equal(needsPlace({ lat: 50.68, lon: 3.04 }, {}, { status: null }), false);
});

test('annonce sans adresse à qui il manque un critère demandé : masquée, sauf si Nathan y a touché', () => {
  const sans = { lat: null, lon: null, address: null };
  const manque = ['terrain non précisé'];
  assert.equal(isIncomplete(sans, {}, manque), true);
  assert.equal(isIncomplete(sans, undefined, manque), true);
  // Rien ne manque, ou la recherche ne demande pas ce qui manque : l'annonce reste.
  assert.equal(isIncomplete(sans, {}, []), false);
  // Adresse du robot ou adresse choisie : la règle ne s'applique qu'aux annonces sans adresse.
  assert.equal(isIncomplete({ lat: 50.68, lon: 3.04, address: '12 Rue de Quesnoy' }, {}, manque), false);
  assert.equal(isIncomplete(sans, { place: { address: '19 Rue Rubens', lat: 50.687, lon: 3.04, by: 'piste' } }, manque), false);
  // Gardée ou annotée : elle ne disparaît pas. Écartée : elle suit le bouton des écartées.
  assert.equal(isIncomplete(sans, { status: 'favori' }, manque), false);
  assert.equal(isIncomplete(sans, { note: 'à visiter' }, manque), false);
  assert.equal(isIncomplete(sans, { status: 'ecarte' }, manque), false);
  // « Introuvable » ne donne pas d'adresse : la règle s'applique toujours.
  assert.equal(isIncomplete(sans, { place: { none: true } }, manque), true);
});

test('page d’annonce pas encore lue par le robot : signalée ; « nouveau » compté depuis sa lecture', () => {
  // Commune ajoutée à une recherche : le robot voit des dizaines d'annonces d'un coup et lit
  // leurs pages sur plusieurs nuits. Sans surface ni chambres, elles passeraient tous les critères.
  const card = base({ id: 'orpi:/u', source: 'orpi', url: 'https://www.orpi.com/u', detail: false });
  const [unread] = groupListings([card]);
  assert.equal(listingFacts(unread).unread, true);
  const read = base({ id: 'paruvendu:/r', source: 'paruvendu', url: 'https://www.paruvendu.fr/r', surface: 110, readAt: NOW - DAY });
  const [both] = groupListings([{ ...card, surface: 110 }, read]);
  assert.equal(listingFacts(both).unread, false);
  // Vue par le robot avant la dernière visite, lue après : elle apparaît dans le Fil comme nouvelle.
  const previousVisit = NOW - 2 * DAY;
  assert.equal(statusOf(groupListings([read])[0], previousVisit, NOW).status, 'nouveau');
  // Lue avant que la date de lecture soit gardée : comptée depuis sa première vue.
  assert.equal(statusOf(groupListings([{ ...read, readAt: undefined }])[0], previousVisit, NOW).status, null);
});

test('pistes pas encore cherchées par le robot (version de la recherche d’adresse) : signalé, pas « aucune piste »', () => {
  const read = { surface: 90, energyConsumption: 211, gesEmission: 40 };
  const [waiting] = groupListings([base({ id: 'deleu:/1', source: 'deleu', url: 'https://www.deleu-immobilier.fr/1', ...read })]);
  assert.equal(listingFacts(waiting).leadsPending, true);
  const [done] = groupListings([base({ id: 'deleu:/1', source: 'deleu', url: 'https://www.deleu-immobilier.fr/1', ...read, lookupVersion: 2, leads: null })]);
  assert.equal(listingFacts(done).leadsPending, false);
  // Sans DPE lu : rien à chercher dans le registre.
  const [noDpe] = groupListings([base({ id: 'maes:/2', source: 'maes', url: 'https://www.maesimmobilier.fr/2', surface: 170 })]);
  assert.equal(listingFacts(noDpe).leadsPending, false);
});
