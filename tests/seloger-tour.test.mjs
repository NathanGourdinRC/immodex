// Tournée quotidienne de SeLoger (src/common/seloger-tour.js) : quoi ouvrir, quand s'arrêter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOUR_HOUR, PACE_MS, MAX_PAGES_PER_DAY, MAX_EMPTY_IN_A_ROW, dayKey, nextRunAt, missedToday, buildQueue, outcomeOf, pruneTried, newTour, step, summary, tourText } from '../src/common/seloger-tour.js';

const NOW = new Date(2026, 10, 9, 11, 0, 0).getTime(); // 9 novembre 2026, 11 h (heure locale)
const DAY = 24 * 3600 * 1000;
const url = (n) => `https://www.seloger.com/annonce/achat/hauts-de-france/nord-59/villeneuve-d-ascq-59491/26FM4ZXVB${String(n).padStart(3, '0')}`;
const listing = (n, over = {}) => ({ id: `seloger:${new URL(url(n)).pathname}`, source: 'seloger', url: url(n), insee: '59009', type: 'maison', title: `Maison ${n}`, firstSeen: NOW - n * 1000, removedAt: null, energyClass: 'D', ...over });

test('11 h, après la tournée Leboncoin de 10 h', () => {
  assert.equal(TOUR_HOUR, 11);
  assert.equal(new Date(nextRunAt(NOW - 3600_000)).getHours(), 11);
  assert.equal(dayKey(nextRunAt(NOW)), dayKey(NOW + DAY));
  assert.equal(missedToday(NOW + 1000, null), true);
  assert.equal(missedToday(NOW - 3600_000, null), false);
  assert.equal(missedToday(NOW + 1000, dayKey(NOW)), false);
});

test('file : annonces SeLoger sans consommation ni adresse, les plus récentes d’abord', () => {
  const queue = buildQueue([listing(3), listing(1), listing(2)], {}, NOW);
  assert.deepEqual(queue.map((q) => q.url), [url(1), url(2), url(3)]);
  assert.deepEqual(Object.keys(queue[0]).sort(), ['firstSeen', 'id', 'insee', 'label', 'url']);
  assert.equal(queue[0].insee, '59009');
});

test('file : consommation déjà connue, adresse déjà trouvée, retirée, terrain, autre site : pas rouvertes', () => {
  const queue = buildQueue(
    [
      listing(1, { energyConsumption: 226 }),
      listing(2, { address: '13 Allee de la Colline 59650 Villeneuve-d’Ascq' }),
      listing(3, { removedAt: NOW - 1000 }),
      listing(4, { type: 'terrain' }),
      listing(5, { source: 'leboncoin' }),
      listing(6),
    ],
    {},
    NOW
  );
  assert.deepEqual(queue.map((q) => q.url), [url(6)]);
});

test('file : une adresse sans numéro (rue seule) ne dispense pas de lire la page', () => {
  assert.equal(buildQueue([listing(1, { address: 'Allee de la Colline 59650 Villeneuve-d’Ascq' })], {}, NOW).length, 1);
});

test('file : seules les pages d’annonce de SeLoger sont ouvertes', () => {
  const queue = buildQueue(
    [
      listing(1, { url: 'https://www.seloger.com/recherche/achat/maison/villeneuve-d-ascq' }),
      listing(2, { url: 'https://evil.example/annonce/achat/a/b/c/D' }),
      listing(3, { url: `${url(3)}?x=1` }),
      listing(4, { url: null }),
      listing(5),
    ],
    {},
    NOW
  );
  assert.deepEqual(queue.map((q) => q.url), [url(5)]);
});

test('file : page déjà lue sans consommation ou introuvable, pas rouverte avant le délai', () => {
  const tried = { [url(1)]: { at: NOW - 3 * DAY, outcome: 'nodata' }, [url(2)]: { at: NOW - 3 * DAY, outcome: 'gone' }, [url(3)]: { at: NOW - 10 * DAY, outcome: 'gone' }, [url(4)]: { at: NOW - 20 * DAY, outcome: 'nodata' } };
  const queue = buildQueue([1, 2, 3, 4].map((n) => listing(n)), tried, NOW);
  assert.deepEqual(queue.map((q) => q.url), [url(3), url(4)]);
});

test('essais anciens oubliés après 30 jours', () => {
  const kept = pruneTried({ a: { at: NOW - 5 * DAY, outcome: 'gone' }, b: { at: NOW - 40 * DAY, outcome: 'gone' }, c: null }, NOW);
  assert.deepEqual(Object.keys(kept), ['a']);
});

const okRead = { hasData: true, card: { detail: { energyConsumption: 226 } }, addressed: 1 };
const noDpe = { hasData: true, card: { detail: { energyConsumption: null } } };
const empty = { hasData: false };

test('issue d’une lecture', () => {
  assert.equal(outcomeOf(okRead), 'ok');
  assert.equal(outcomeOf(noDpe), 'nodata');
  assert.equal(outcomeOf(empty), 'gone');
  assert.equal(outcomeOf(null), 'gone');
});

const tourOf = (n) => newTour(Array.from({ length: n }, (_, i) => ({ url: url(i), id: `i${i}`, insee: '59009', label: `Maison ${i}`, firstSeen: 0 })), NOW);

test('tournée vide : terminée sans rien ouvrir', () => {
  const t = newTour([], NOW);
  assert.equal(t.status, 'done');
  assert.match(t.reason, /aucune annonce/);
});

test('une page par étape, 45 secondes entre deux, adresses comptées', () => {
  let t = tourOf(3);
  assert.equal(t.status, 'running');
  t = step(t, okRead, NOW, PACE_MS);
  assert.equal(t.idx, 1);
  assert.equal(t.nextAt, NOW + 45_000);
  assert.deepEqual(t.last, { url: url(0), outcome: 'ok' });
  t = step(t, noDpe, NOW + 45_000);
  t = step(t, okRead, NOW + 90_000);
  assert.equal(t.status, 'done');
  assert.deepEqual(summary(t), { pages: 3, ok: 2, nodata: 1, gone: 0, addressed: 2, waiting: 0 });
});

test('l’étape ne modifie pas la tournée reçue', () => {
  const t = tourOf(2);
  const before = JSON.stringify(t);
  step(t, okRead, NOW);
  assert.equal(JSON.stringify(t), before);
});

test('défi anti-robot : arrêt net, la suite attend demain', () => {
  const t = step(tourOf(5), { hasData: false, challenge: true }, NOW);
  assert.equal(t.status, 'stopped');
  assert.match(t.reason, /anti-robot/);
  assert.equal(summary(t).waiting, 4);
});

test('deux pages de suite sans données : refus probable, arrêt', () => {
  assert.equal(MAX_EMPTY_IN_A_ROW, 2);
  let t = step(tourOf(5), empty, NOW);
  assert.equal(t.status, 'running');
  t = step(t, empty, NOW + 45_000);
  assert.equal(t.status, 'stopped');
  assert.match(t.reason, /deux pages de suite/);
});

test('une annonce retirée isolée ne coupe pas la tournée', () => {
  let t = step(tourOf(5), empty, NOW);
  t = step(t, okRead, NOW + 45_000);
  assert.equal(t.empty, 0);
  t = step(t, empty, NOW + 90_000);
  assert.equal(t.status, 'running');
});

test('erreur de lecture ou d’envoi : arrêt avec la raison', () => {
  const t = step(tourOf(3), { hasData: true, error: 'envoi au Fil : erreur 500' }, NOW);
  assert.equal(t.status, 'stopped');
  assert.match(t.reason, /erreur 500/);
});

test('120 pages par jour au plus', () => {
  let t = tourOf(300);
  for (let i = 0; i < MAX_PAGES_PER_DAY; i++) {
    assert.equal(t.status, 'running');
    t = step(t, okRead, NOW + i * PACE_MS);
  }
  assert.equal(t.status, 'done');
  assert.equal(t.pagesDone, 120);
  assert.match(t.reason, /120 pages/);
  assert.equal(summary(t).waiting, 180);
});

test('texte de la ligne du Fil', () => {
  const s = (over) => ({ enabled: true, nextRunAt: NOW + DAY, lastDay: null, tour: null, ...over });
  assert.match(tourText(s({ enabled: false }), NOW), /désactivée/);
  assert.match(tourText(s(), NOW), /chaque jour à 11 h/);
  const base = { day: dayKey(NOW), startedAt: NOW, status: 'done', reason: null, pages: 12, ok: 10, nodata: 1, gone: 1, addressed: 8, waiting: 0 };
  assert.match(tourText(s({ tour: base }), NOW), /12 annonces lues, 8 adresses trouvées/);
  assert.match(tourText(s({ tour: { ...base, status: 'running', waiting: 30 } }), NOW), /en cours, 12 annonces lues, 30 restantes/);
  assert.match(tourText(s({ tour: { ...base, status: 'stopped', reason: 'SeLoger a demandé une vérification anti-robot' } }), NOW), /interrompue aujourd’hui \(SeLoger a demandé une vérification anti-robot\) après 12 annonces lues, 8 adresses trouvées\. Reprise demain/);
  assert.match(tourText(s({ tour: { ...base, pages: 0, addressed: 0, reason: 'aucune annonce SeLoger sans adresse à lire' } }), NOW), /rien lu aujourd’hui/);
  assert.match(tourText(s({ tour: { ...base, waiting: 180, reason: 'limite de 120 pages par jour atteinte, la suite demain' } }), NOW), /180 annonces restent à lire/);
});
