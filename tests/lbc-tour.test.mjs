import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOUR_HOUR, MAX_PAGES, dayKey, nextRunAt, missedToday, searchUrl, buildQueue, newDay, refreshDay, nextTarget, record, skip, summary } from '../src/common/lbc-tour.js';

const commune = (code, nom, codesPostaux) => ({ code, nom, codesPostaux, centre: null });
const zone = (communes, type = null) => ({ id: 'z', name: 'Z', communes, type });
const MARCQ = commune('59378', 'Marcq-en-Barœul', ['59700']);
const LILLE = commune('59350', 'Lille', ['59000', '59160']);

// Page lue par le contenu de la page : ce que l'extension renvoie au service worker.
const page = (over = {}) => ({ hasData: true, total: 70, maxPages: 2, count: 35, postalCounts: { 59700: 35 }, seen: 35, added: 4, ...over });

test('SeLoger s’appuie sur ces horaires : prochain passage aujourd’hui si l’heure n’est pas passée, sinon demain', () => {
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

test('journée : la page 2 n’est proposée que si la page 1 était entièrement nouvelle', () => {
  const queue = buildQueue([zone([MARCQ, commune('59368', 'Mons-en-Barœul', ['59370'])])]);
  let day = newDay(queue, 1000);
  let target = nextTarget(day);
  assert.equal(target.search.key, '59378|59700');
  assert.equal(target.page, 1);
  day = record(day, target, page({ maxPages: 5, seen: 35, added: 35 }));
  target = nextTarget(day);
  assert.equal(target.search.key, '59378|59700');
  assert.equal(target.page, 2);
  // Page 2 avec des annonces déjà connues : la commune est finie, on passe à la suivante.
  day = record(day, target, page({ maxPages: 5, seen: 35, added: 10 }));
  target = nextTarget(day);
  assert.equal(target.search.key, '59368|59370');
  assert.equal(target.page, 1);
});

test('journée : page 1 avec des annonces déjà connues = commune finie tout de suite', () => {
  const day = record(newDay(buildQueue([zone([MARCQ])]), 0), nextTarget(newDay(buildQueue([zone([MARCQ])]), 0)), page({ maxPages: 5, seen: 35, added: 4 }));
  assert.equal(nextTarget(day), null);
});

test('journée : page déjà envoyée par une visite de Nathan (rien de nouveau à compter) = commune finie', () => {
  const q = buildQueue([zone([MARCQ])]);
  const day = record(newDay(q, 0), nextTarget(newDay(q, 0)), { hasData: true, count: 35, postalCounts: { 59700: 35 }, maxPages: 5 });
  assert.equal(nextTarget(day), null);
});

test('journée : jamais plus de pages que le plafond par recherche', () => {
  let day = newDay(buildQueue([zone([MARCQ])]), 0);
  for (let i = 1; i <= MAX_PAGES; i++) {
    const target = nextTarget(day);
    assert.equal(target.page, i);
    day = record(day, target, page({ maxPages: 99, seen: 35, added: 35 }));
  }
  assert.equal(nextTarget(day), null);
  assert.equal(summary(day).pages, MAX_PAGES);
});

test('journée : aucune annonce dans la commune demandée = recherche non reconnue, on passe', () => {
  const queue = buildQueue([zone([MARCQ, commune('59368', 'Mons-en-Barœul', ['59370'])])]);
  let day = newDay(queue, 0);
  // Leboncoin a répondu avec des annonces d’ailleurs : l’adresse de recherche n’a pas été comprise.
  day = record(day, nextTarget(day), page({ postalCounts: { 75001: 35 } }));
  assert.equal(nextTarget(day).search.key, '59368|59370');
  assert.match(summary(day).notes[0], /non reconnue/);
});

test('journée : commune sans annonce = suivante, sans erreur', () => {
  const queue = buildQueue([zone([MARCQ, commune('59368', 'Mons-en-Barœul', ['59370'])])]);
  let day = newDay(queue, 0);
  day = record(day, nextTarget(day), page({ count: 0, postalCounts: {}, total: 0 }));
  assert.equal(nextTarget(day).search.key, '59368|59370');
});

test('journée : tout lu = plus de cible, et le résumé compte les annonces', () => {
  const queue = buildQueue([zone([MARCQ, commune('59368', 'Mons-en-Barœul', ['59370'])])]);
  let day = newDay(queue, 0);
  day = record(day, nextTarget(day), page({ maxPages: 1, seen: 30, added: 5 }));
  day = record(day, nextTarget(day), page({ maxPages: 1, postalCounts: { 59370: 20 }, count: 20, seen: 20, added: 2 }));
  assert.equal(nextTarget(day), null);
  const s = summary(day);
  assert.deepEqual([s.total, s.finished, s.pages, s.seen, s.added, s.next], [2, 2, 2, 50, 7, null]);
});

test('journée : une recherche laissée (test anti-robot non passé) est sautée, les autres continuent', () => {
  const queue = buildQueue([zone([MARCQ, commune('59368', 'Mons-en-Barœul', ['59370'])])]);
  const day = skip(newDay(queue, 0), '59378|59700', 'non lue');
  assert.equal(nextTarget(day).search.key, '59368|59370');
  assert.match(summary(day).notes[0], /non lue/);
});

test('journée : le lendemain repart de zéro, la même journée garde ce qui est lu', () => {
  const queue = buildQueue([zone([MARCQ, LILLE])]);
  const noon = new Date(2026, 10, 10, 12, 0).getTime();
  let day = newDay(queue, noon);
  day = record(day, nextTarget(day), page({ maxPages: 1 }));
  assert.equal(summary(refreshDay(day, queue, noon + 3600_000)).finished, 1);
  assert.equal(summary(refreshDay(day, queue, noon + 24 * 3600_000)).finished, 0);
  // Une recherche retirée en cours de journée n’est plus comptée.
  assert.equal(summary(refreshDay(day, buildQueue([zone([LILLE])]), noon)).total, 2);
  assert.equal(summary(refreshDay(day, buildQueue([zone([LILLE])]), noon)).finished, 0);
});

test('file vide : rien à lire', () => {
  const day = newDay([], 0);
  assert.equal(nextTarget(day), null);
  assert.equal(summary(day).total, 0);
});

// ─── Ligne « Leboncoin » du Fil ───
import { guidedText } from '../src/common/lbc-tour.js';

const state = (over = {}) => ({ total: 12, finished: 0, seen: 0, added: 0, next: 'Marcq-en-Barœul 59700', waiting: null, error: null, ...over });

test('ligne Leboncoin : rien lu encore, avec la prochaine commune', () => {
  assert.equal(guidedText(state()), 'Leboncoin : lecture guidée, 0 commune sur 12 lue aujourd’hui. Suivante : Marcq-en-Barœul 59700.');
});

test('ligne Leboncoin : en cours de journée', () => {
  assert.equal(
    guidedText(state({ finished: 7, seen: 214, added: 12, next: 'Lille 59000, page 2' })),
    'Leboncoin : lecture guidée, 7 communes sur 12 lues aujourd’hui (214 annonces de tes communes lues, 12 nouvelles). Suivante : Lille 59000, page 2.'
  );
});

test('ligne Leboncoin : tout lu', () => {
  assert.equal(
    guidedText(state({ finished: 12, seen: 300, added: 1, next: null })),
    'Leboncoin : toutes les communes sont lues aujourd’hui (300 annonces de tes communes lues, 1 nouvelle). Prochaine lecture demain.'
  );
});

test('ligne Leboncoin : test anti-robot à passer, aucune commune, erreur', () => {
  assert.match(guidedText(state({ waiting: 'Lille 59000' })), /^Leboncoin : Lille 59000 attend ta vérification anti-robot dans l’onglet ouvert\..*« Relire la page »\.$/);
  assert.match(guidedText(state({ waiting: 'Lille 59000', diag: 'page « leboncoin.fr », données dans la page : non' })), /Ce que l’extension voit : page « leboncoin\.fr », données dans la page : non\.$/);
  assert.equal(guidedText(state({ total: 0, next: null })), 'Leboncoin : aucune commune suivie, rien à lire.');
  assert.equal(guidedText(state({ error: 'lecture interrompue : envoi refusé' })), 'Leboncoin : lecture interrompue : envoi refusé');
});
