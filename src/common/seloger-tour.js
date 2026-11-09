// Tournée quotidienne de SeLoger : la logique, sans rien du navigateur (testée sous Node).
//
// Les cartes des pages de résultats SeLoger ne donnent que la lettre du DPE ; la consommation et les
// émissions, qui désignent le logement dans le registre de l'ADEME, ne sont que sur la page de
// l'annonce, que le robot du serveur n'a pas le droit de lire (anti-robot). Chaque jour à 11 h,
// l'extension ouvre donc, dans le Chrome de Nathan, les pages des annonces suivies dont l'adresse
// manque encore, une toutes les 45 secondes, dans une fenêtre réduite. Les pages d'annonce
// (`/annonce/…`) ne sont pas interdites par le robots.txt de SeLoger. La page est lue par
// src/common/seloger-detail.js ; ce module décide seulement quoi ouvrir ensuite et quand s'arrêter.
// Le service worker (src/background/seloger-tour-runner.js) fait le reste.
//
// Règles de politesse (décidées avec Nathan le 09/11/2026, comme la tournée Leboncoin) : une page à
// la fois, 45 secondes entre deux pages, 120 pages par jour au plus, aucun compte connecté, et arrêt
// net au premier refus ou défi anti-robot (jamais contourné, aucun captcha résolu).

import { dayKey, nextRunAt as lbcNextRunAt, missedToday as lbcMissedToday } from './lbc-tour.js';

export const TOUR_HOUR = 11;
// Mêmes règles de jour et d'heure que la tournée Leboncoin, à l'heure de celle-ci (11 h : après elle).
export { dayKey };
export const nextRunAt = (now, hour = TOUR_HOUR) => lbcNextRunAt(now, hour);
export const missedToday = (now, lastDay, hour = TOUR_HOUR) => lbcMissedToday(now, lastDay, hour);
export const PACE_MS = 45_000;
export const MAX_PAGES_PER_DAY = 120;
// Deux pages de suite sans bloc de données : refus probable (une annonce retirée seule est normale).
export const MAX_EMPTY_IN_A_ROW = 2;

const DAY = 24 * 3600 * 1000;
// Quand rouvrir une annonce déjà essayée : une page lue sans consommation (DPE absent ou ancien) change
// rarement ; une page sans données est souvent une annonce retirée.
const RETRY_AFTER_MS = { nodata: 14 * DAY, gone: 7 * DAY };
export const FORGET_AFTER_MS = 30 * DAY;

const DETAIL_URL = /^https:\/\/www\.seloger\.com\/annonce\/achat\/[A-Za-z0-9/_-]+$/;

// Annonces à ouvrir, les plus récentes d'abord : SeLoger, encore en ligne, dont la consommation du
// diagnostic et l'adresse manquent. `tried` : { url: { at, outcome } } des essais passés.
export function buildQueue(listings, tried = {}, now = Date.now()) {
  const out = [];
  for (const l of Array.isArray(listings) ? listings : []) {
    if (!l || l.source !== 'seloger' || l.removedAt || l.type === 'terrain') continue;
    if (!DETAIL_URL.test(String(l.url || ''))) continue;
    if (l.energyConsumption != null) continue;
    if (l.address && /^\d/.test(l.address)) continue;
    const t = tried[l.url];
    if (t && RETRY_AFTER_MS[t.outcome] && now - t.at < RETRY_AFTER_MS[t.outcome]) continue;
    out.push({ url: l.url, id: l.id, insee: l.insee, label: l.title || l.url, firstSeen: l.firstSeen || 0 });
  }
  return out.sort((a, b) => b.firstSeen - a.firstSeen);
}

// Ce que la lecture d'une page a donné : 'ok' (consommation lue), 'nodata' (page lue, sans
// consommation), 'gone' (aucun bloc de données).
export function outcomeOf(read) {
  if (!read || !read.hasData) return 'gone';
  return read.card && read.card.detail && read.card.detail.energyConsumption != null ? 'ok' : 'nodata';
}

// Essais gardés : ceux de moins de 30 jours.
export function pruneTried(tried, now) {
  return Object.fromEntries(Object.entries(tried || {}).filter(([, t]) => t && now - t.at < FORGET_AFTER_MS));
}

export function newTour(queue, now) {
  return {
    day: dayKey(now),
    queue,
    idx: 0,
    pagesDone: 0,
    empty: 0,
    results: { pages: 0, ok: 0, nodata: 0, gone: 0, addressed: 0 },
    last: null,
    startedAt: now,
    nextAt: now,
    status: queue.length ? 'running' : 'done',
    reason: queue.length ? null : 'aucune annonce SeLoger sans adresse à lire',
  };
}


// Tournée après une page lue (nouvel objet, l'ancien n'est pas modifié). `read` :
// { hasData, card?, challenge?, addressed?, error? }.
export function step(tour, read, now, paceMs = PACE_MS) {
  const item = tour.queue[tour.idx];
  const outcome = outcomeOf(read);
  const results = { ...tour.results, pages: tour.results.pages + 1 };
  results[outcome]++;
  results.addressed += Number(read.addressed) || 0;
  const next = { ...tour, results, pagesDone: tour.pagesDone + 1, nextAt: now + paceMs, last: { url: item.url, outcome }, idx: tour.idx + 1 };
  if (read.error) return { ...next, status: 'stopped', reason: `lecture interrompue : ${read.error}` };
  if (read.challenge) return { ...next, status: 'stopped', reason: 'SeLoger a demandé une vérification anti-robot' };
  next.empty = read.hasData ? 0 : tour.empty + 1;
  if (next.empty >= MAX_EMPTY_IN_A_ROW) return { ...next, status: 'stopped', reason: 'SeLoger n’a pas renvoyé deux pages de suite (refus probable)' };
  if (next.idx >= tour.queue.length) return { ...next, status: 'done', reason: null };
  if (next.pagesDone >= MAX_PAGES_PER_DAY) return { ...next, status: 'done', reason: `limite de ${MAX_PAGES_PER_DAY} pages par jour atteinte, la suite demain` };
  return next;
}

export function summary(tour) {
  return { ...tour.results, waiting: Math.max(0, tour.queue.length - tour.idx) };
}

// ─── Texte de la ligne « SeLoger » du Fil ───

const hour = (ts) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const dateText = (ts) => new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

// Phrase d'état, à partir de la réponse du service worker (SELOGER_TOUR_STATUS).
export function tourText(s, now = Date.now()) {
  if (!s.enabled) return 'SeLoger : lecture automatique des adresses désactivée.';
  const when = dayKey(s.nextRunAt) === dayKey(now) ? `aujourd’hui à ${hour(s.nextRunAt)}` : `demain à ${hour(s.nextRunAt)}`;
  const t = s.tour;
  if (!t) return `SeLoger : lecture automatique des annonces sans adresse chaque jour à ${TOUR_HOUR} h, Chrome ouvert. Prochain passage ${when}.`;
  const day = t.day === dayKey(now) ? 'aujourd’hui' : `le ${dateText(t.startedAt)}`;
  if (t.status === 'running') return `SeLoger : lecture en cours, ${plural(t.pages, 'annonce lue', 'annonces lues')}, ${plural(t.waiting, 'restante', 'restantes')}.`;
  const read = `${plural(t.pages, 'annonce lue', 'annonces lues')}, ${plural(t.addressed, 'adresse trouvée', 'adresses trouvées')}`;
  if (t.status === 'stopped') return `SeLoger : lecture interrompue ${day} (${t.reason}) après ${read}. Reprise ${when}.`;
  if (!t.pages) return `SeLoger : rien lu ${day} (${t.reason || 'aucune annonce'}). Prochain passage ${when}.`;
  const rest = t.waiting ? ` ${plural(t.waiting, 'annonce reste', 'annonces restent')} à lire.` : '';
  return `SeLoger : lu ${day} à ${hour(t.startedAt)} : ${read}.${t.reason ? ` ${t.reason}.` : ''}${rest} Prochain passage ${when}.`;
}
