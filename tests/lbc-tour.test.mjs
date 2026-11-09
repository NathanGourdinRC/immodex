import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOUR_HOUR, MAX_PAGES, MAX_PAGES_PER_DAY, dayKey, nextRunAt, missedToday, searchUrl, buildQueue, newTour, step, summary } from '../src/common/lbc-tour.js';

const commune = (code, nom, codesPostaux) => ({ code, nom, codesPostaux, centre: null });
const zone = (communes, type = null) => ({ id: 'z', name: 'Z', communes, type });
const MARCQ = commune('59378', 'Marcq-en-Barœul', ['59700']);
const LILLE = commune('59350', 'Lille', ['59000', '59160']);

// Page lue par le contenu de la page : ce que l'extension renvoie au service worker.
const page = (over = {}) => ({ hasData: true, total: 70, maxPages: 2, count: 35, postalCounts: { 59700: 35 }, seen: 35, added: 4, ...over });

test('10 h : prochain passage aujourd’hui si l’heure n’est pas passée, sinon demain', () => {
  const morning = new Date(2026, 10, 9, 8, 30).getTime();
  const afternoon = new Date(2026, 10, 9, 14, 0).getTime();
  assert.equal(nextRunAt(morning), new Date(2026, 10, 9, TOUR_HOUR, 0).getTime());
  assert.equal(nextRunAt(afternoon), new Date(2026, 10, 10, TOUR_HOUR, 0).getTime());
  // Pile à 10 h : le passage de 10 h est déjà en cours, le suivant est demain.
  assert.equal(nextRunAt(new Date(2026, 10, 9, 10, 0).getTime()), new Date(2026, 10, 10, 10, 0).getTime());
});

test('rattrapage : Chrome ouvert après 10 h, tournée pas encore faite aujourd’hui', () => {
  const today = new Date(2026, 10, 9, 14, 0).getTime();
  assert.equal(dayKey(today), '2026-11-09');
  assert.equal(missedToday(today, '2026-11-08'), true);
  assert.equal(missedToday(today, null), true);
  assert.equal(missedToday(today, '2026-11-09'), false);
  assert.equal(missedToday(new Date(2026, 10, 9, 9, 59).getTime(), '2026-11-08'), false);
});

test('adresse de recherche : commune et code postal, maisons et appartements, plus récentes d’abord', () => {
  const s = { nom: 'Marcq-en-Barœul', postal: '59700', types: '1,2' };
  assert.equal(searchUrl(s, 1), 'https://www.leboncoin.fr/recherche?category=9&locations=Marcq-en-Baroeul_59700&real_estate_type=1,2&sort=time&order=desc');
  assert.match(searchUrl(s, 3), /&page=3$/);
  assert.match(searchUrl({ nom: 'La Madeleine', postal: '59110', types: '1' }, 1), /locations=La%20Madeleine_59110&real_estate_type=1&/);
});

test('adresse de recherche : Leboncoin écrit « Baroeul », pas « Barœul »', () => {
  assert.match(searchUrl({ nom: 'Marcq-en-Barœul', postal: '59700', types: '1' }, 1), /locations=Marcq-en-Baroeul_59700&/);
  assert.match(searchUrl({ nom: 'Cœuilly', postal: '94490', types: '1' }, 1), /locations=Coeuilly_94490&/);
});

test('file : une recherche par commune et par code postal, sans doublon entre recherches', () => {
  const q = buildQueue([zone([MARCQ, LILLE]), zone([MARCQ], 'maison')]);
  assert.deepEqual(
    q.map((s) => [s.key, s.types]),
    [
      ['59378|59700', '1,2'],
      ['59350|59000', '1,2'],
      ['59350|59160', '1,2'],
    ]
  );
  assert.deepEqual(q[1].postals, ['59000', '59160']);
});

test('file : le type de la recherche limite la lecture, deux recherches se complètent', () => {
  assert.equal(buildQueue([zone([MARCQ], 'maison')])[0].types, '1');
  assert.equal(buildQueue([zone([MARCQ], 'appartement')])[0].types, '2');
  assert.equal(buildQueue([zone([MARCQ], 'maison'), zone([MARCQ], 'appartement')])[0].types, '1,2');
});

test('file : une commune sans code postal est ignorée, pas de recherche au hasard', () => {
  assert.deepEqual(buildQueue([zone([commune('01001', 'Sans CP', [])])]), []);
  assert.deepEqual(buildQueue([]), []);
  assert.deepEqual(buildQueue(null), []);
});

test('tournée : deux pages puis la commune suivante, puis fin', () => {
  const queue = buildQueue([zone([MARCQ, commune('59368', 'Mons-en-Barœul', ['59370'])])]);
  let t = newTour(queue, 1000);
  assert.equal(t.status, 'running');
  assert.equal(t.page, 1);
  t = step(t, page(), 2000);
  assert.equal(t.status, 'running');
  assert.equal(t.page, 2);
  // Dernière page de la commune (maxPages = 2) : on passe à la suivante, page 1.
  t = step(t, page({ added: 3 }), 3000);
  assert.equal(t.idx, 1);
  assert.equal(t.page, 1);
  t = step(t, page({ postalCounts: { 59370: 20 }, count: 20, maxPages: 1 }), 4000);
  assert.equal(t.status, 'done');
  const s = summary(t);
  assert.equal(s.pages, 3);
  assert.equal(s.added, 4 + 3 + 4);
  assert.equal(s.searches, 2);
});

test('tournée : le rythme entre deux pages est respecté', () => {
  const t = step(newTour(buildQueue([zone([MARCQ])]), 1000), page(), 5000);
  assert.ok(t.nextAt >= 5000 + 30_000);
});

test('tournée : page sans annonce nouvelle (à partir de la 2e) = commune suivante', () => {
  const queue = buildQueue([zone([MARCQ, commune('59368', 'Mons-en-Barœul', ['59370'])])]);
  let t = newTour(queue, 0);
  t = step(t, page({ maxPages: 5, added: 6 }), 1);
  assert.equal(t.page, 2);
  t = step(t, page({ maxPages: 5, added: 0 }), 2);
  assert.equal(t.idx, 1);
});

test('tournée : jamais plus de pages que le plafond par recherche', () => {
  let t = newTour(buildQueue([zone([MARCQ])]), 0);
  for (let i = 1; i < MAX_PAGES; i++) t = step(t, page({ maxPages: 99, added: 5 }), i);
  assert.equal(t.page, MAX_PAGES);
  t = step(t, page({ maxPages: 99, added: 5 }), 100);
  assert.equal(t.status, 'done');
});

test('tournée : aucune annonce dans la commune demandée = recherche non reconnue, on passe', () => {
  const queue = buildQueue([zone([MARCQ, commune('59368', 'Mons-en-Barœul', ['59370'])])]);
  let t = newTour(queue, 0);
  // Leboncoin a répondu avec des annonces d’ailleurs : l’adresse de recherche n’a pas été comprise.
  t = step(t, page({ postalCounts: { 75001: 35 } }), 1);
  assert.equal(t.idx, 1);
  assert.equal(t.status, 'running');
  assert.match(t.results[0].note, /non reconnue/);
});

test('tournée : commune sans annonce = suivante, sans erreur', () => {
  const queue = buildQueue([zone([MARCQ, commune('59368', 'Mons-en-Barœul', ['59370'])])]);
  const t = step(newTour(queue, 0), page({ count: 0, postalCounts: {}, total: 0 }), 1);
  assert.equal(t.idx, 1);
  assert.equal(t.status, 'running');
});

test('tournée : arrêt net au premier refus, la raison est gardée', () => {
  const queue = buildQueue([zone([MARCQ, commune('59368', 'Mons-en-Barœul', ['59370'])])]);
  const t = step(newTour(queue, 0), { hasData: false, count: 0, postalCounts: {} }, 1);
  assert.equal(t.status, 'stopped');
  assert.match(t.reason, /refus|défi|anti-robot/i);
  assert.equal(t.idx, 0);
});

test('tournée : erreur d’envoi (synchro absente, réseau) = arrêt avec le message', () => {
  const t = step(newTour(buildQueue([zone([MARCQ])]), 0), { hasData: true, count: 35, postalCounts: { 59700: 35 }, error: 'synchro non activée' }, 1);
  assert.equal(t.status, 'stopped');
  assert.match(t.reason, /synchro non activée/);
});

test('tournée : plafond de pages par jour', () => {
  const many = Array.from({ length: 60 }, (_, i) => commune(`590${String(i).padStart(2, '0')}`, `Commune ${i}`, [`590${String(i).padStart(2, '0')}`]));
  let t = newTour(buildQueue([zone(many)]), 0);
  let n = 0;
  while (t.status === 'running' && n < 1000) {
    const s = t.queue[t.idx];
    t = step(t, page({ maxPages: 3, added: 5, postalCounts: { [s.postals[0]]: 35 } }), n++);
  }
  assert.equal(t.status, 'done');
  assert.equal(summary(t).pages, MAX_PAGES_PER_DAY);
  assert.match(t.reason, /limite/i);
});

test('file vide : la tournée est terminée avant de commencer', () => {
  const t = newTour([], 0);
  assert.equal(t.status, 'done');
});

// ─── Ligne « Leboncoin » du Fil ───
import { tourText } from '../src/common/lbc-tour.js';

const NOW = new Date(2026, 10, 9, 15, 0).getTime();
const TOMORROW_10 = new Date(2026, 10, 10, 10, 0).getTime();
const tourOf = (over) => ({ day: '2026-11-09', status: 'done', reason: null, startedAt: new Date(2026, 10, 9, 10, 0).getTime(), searches: 3, pages: 9, count: 280, seen: 214, added: 12, current: null, notes: [], ...over });
const status = (over = {}) => ({ enabled: true, nextRunAt: TOMORROW_10, lastDay: '2026-11-09', tour: tourOf(), ...over });

test('ligne Leboncoin : tournée faite aujourd’hui', () => {
  assert.equal(tourText(status(), NOW), 'Leboncoin : lu aujourd’hui à 10 h 00 : 214 annonces de vos communes lues, 12 nouvelles. Prochain passage demain à 10 h 00.');
});

test('ligne Leboncoin : interruption, avec la raison et la reprise', () => {
  const t = tourText(status({ tour: tourOf({ status: 'stopped', pages: 4, reason: 'Leboncoin n’a pas renvoyé la liste (refus ou défi anti-robot)' }) }), NOW);
  assert.match(t, /^Leboncoin : lecture interrompue aujourd’hui après 4 pages \(Leboncoin n’a pas renvoyé la liste/);
  assert.match(t, /Reprise demain à 10 h 00\.$/);
});

test('ligne Leboncoin : en cours, jamais lancée, désactivée, sans recherche', () => {
  assert.match(tourText(status({ tour: tourOf({ status: 'running', current: 'Marcq-en-Barœul 59700', pages: 2 }) }), NOW), /lecture en cours \(Marcq-en-Barœul 59700\), 2 pages lues\./);
  assert.match(tourText(status({ tour: null }), NOW), /chaque jour à 10 h, Chrome ouvert\. Prochain passage demain à 10 h 00\./);
  assert.equal(tourText(status({ enabled: false }), NOW), 'Leboncoin : lecture automatique désactivée.');
  assert.match(tourText(status({ tour: tourOf({ searches: 0, reason: 'aucune commune suivie' }) }), NOW), /rien lu aujourd’hui \(aucune commune suivie\)/);
});

test('ligne Leboncoin : tournée d’un autre jour et passage prévu aujourd’hui', () => {
  const old = tourOf({ day: '2026-11-08', startedAt: new Date(2026, 10, 8, 10, 0).getTime() });
  const t = tourText(status({ tour: old, nextRunAt: new Date(2026, 10, 9, 18, 0).getTime() }), NOW);
  assert.match(t, /^Leboncoin : lu le 8 novembre à 10 h 00/);
  assert.match(t, /Prochain passage aujourd’hui à 18 h 00\.$/);
});
