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
