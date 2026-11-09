// Tournée quotidienne de Leboncoin : la logique, sans rien du navigateur (testée sous Node).
//
// Chaque jour à 10 h, l'extension ouvre les recherches Leboncoin des communes suivies, une page
// toutes les 45 secondes, dans une fenêtre réduite. Les annonces sont lues par le même code que
// lorsque Nathan visite lui-même la page (list-capture.js). Ce module décide seulement quoi ouvrir
// ensuite et quand s'arrêter ; le service worker (src/background/lbc-tour-runner.js) fait le reste.
//
// Règles de politesse : une page à la fois, jamais plus de MAX_PAGES par recherche, jamais plus de
// MAX_PAGES_PER_DAY par jour, et arrêt net au premier refus ou défi anti-robot (jamais contourné).

export const TOUR_HOUR = 10;
export const PACE_MS = 45_000;
export const MAX_PAGES = 8;
export const MAX_PAGES_PER_DAY = 120;

const pad = (n) => String(n).padStart(2, '0');

// Jour local « 2026-11-09 » : sert à savoir si la tournée du jour est faite.
export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Prochain passage de l'heure donnée, strictement après `now` (heure locale du PC).
export function nextRunAt(now, hour = TOUR_HOUR) {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// Chrome était fermé à 10 h : la tournée se fait à l'ouverture, une fois dans la journée.
export function missedToday(now, lastDay, hour = TOUR_HOUR) {
  return new Date(now).getHours() >= hour && lastDay !== dayKey(now);
}

// Adresse de recherche Leboncoin (catégorie 9 = ventes immobilières ; type 1 = maison,
// 2 = appartement), les plus récentes d'abord.
export function searchUrl(search, page = 1) {
  // Leboncoin écrit « Marcq-en-Baroeul » : les ligatures de l'état civil (œ, æ) ne sont pas reconnues.
  const name = search.nom.replace(/œ/g, 'oe').replace(/Œ/g, 'Oe').replace(/æ/g, 'ae').replace(/Æ/g, 'Ae');
  const where = encodeURIComponent(`${name}_${search.postal}`);
  return `https://www.leboncoin.fr/recherche?category=9&locations=${where}&real_estate_type=${search.types}&sort=time&order=desc${page > 1 ? `&page=${page}` : ''}`;
}

// Une recherche par commune et par code postal parmi toutes les recherches de Nathan. Deux
// recherches sur la même commune (une maison, une appartement) se fondent en une seule.
export function buildQueue(zones) {
  const byCommune = new Map();
  for (const z of Array.isArray(zones) ? zones : []) {
    const type = z && z.type === 'maison' ? '1' : z && z.type === 'appartement' ? '2' : '1,2';
    for (const c of (z && z.communes) || []) {
      if (!c || !c.code) continue;
      const postals = (c.codesPostaux || []).map(String).filter((p) => /^\d{5}$/.test(p));
      if (!postals.length) continue;
      const known = byCommune.get(c.code) || { nom: c.nom || c.code, postals, types: new Set() };
      for (const t of type.split(',')) known.types.add(t);
      byCommune.set(c.code, known);
    }
  }
  const queue = [];
  for (const [code, c] of byCommune) {
    const types = [...c.types].sort().join(',');
    for (const postal of c.postals) {
      queue.push({ key: `${code}|${postal}`, code, nom: c.nom, postal, postals: c.postals, types, label: `${c.nom} ${postal}` });
    }
  }
  return queue;
}

export function newTour(queue, now) {
  return {
    day: dayKey(now),
    queue,
    idx: 0,
    page: 1,
    pagesDone: 0,
    results: [],
    startedAt: now,
    nextAt: now,
    status: queue.length ? 'running' : 'done',
    reason: queue.length ? null : 'aucune commune suivie',
  };
}

// Que faire après une page lue : { action: 'next-page' | 'next-search' | 'stop', note?, reason? }.
function decide(tour, read) {
  const search = tour.queue[tour.idx];
  if (read.error) return { action: 'stop', reason: `lecture interrompue : ${read.error}` };
  if (!read.hasData) return { action: 'stop', reason: "Leboncoin n'a pas renvoyé la liste (refus ou défi anti-robot)" };
  if (!read.count) return { action: 'next-search' };
  if (tour.page === 1) {
    // Des annonces, mais aucune dans la commune demandée : l'adresse de recherche n'a pas été comprise.
    const here = search.postals.reduce((sum, p) => sum + (Number(read.postalCounts && read.postalCounts[p]) || 0), 0);
    if (!here) return { action: 'next-search', note: 'recherche non reconnue par Leboncoin' };
  }
  const last = Math.min(MAX_PAGES, Number(read.maxPages) || MAX_PAGES);
  if (tour.page >= last) return { action: 'next-search' };
  // Plus récentes d'abord : une page sans aucune annonce nouvelle annonce que le reste est déjà connu.
  if (tour.page >= 2 && read.added === 0) return { action: 'next-search' };
  return { action: 'next-page' };
}

// Tournée après une page lue (nouvel objet, l'ancien n'est pas modifié).
export function step(tour, read, now, paceMs = PACE_MS) {
  const search = tour.queue[tour.idx];
  const decision = decide(tour, read);
  const results = tour.results.slice();
  const before = results[tour.idx] || { key: search.key, label: search.label, pages: 0, count: 0, seen: 0, added: 0, note: null };
  results[tour.idx] = {
    ...before,
    pages: before.pages + 1,
    count: before.count + (read.count || 0),
    seen: before.seen + (read.seen || 0),
    added: before.added + (read.added || 0),
    note: decision.note || before.note,
  };
  const next = { ...tour, results, pagesDone: tour.pagesDone + 1, nextAt: now + paceMs };
  if (decision.action === 'stop') return { ...next, status: 'stopped', reason: decision.reason };
  if (decision.action === 'next-page') next.page = tour.page + 1;
  else {
    next.idx = tour.idx + 1;
    next.page = 1;
  }
  if (next.idx >= tour.queue.length) return { ...next, status: 'done', reason: null };
  if (next.pagesDone >= MAX_PAGES_PER_DAY) return { ...next, status: 'done', reason: `limite de ${MAX_PAGES_PER_DAY} pages par jour atteinte` };
  return next;
}

export function summary(tour) {
  const rs = tour.results.filter(Boolean);
  return {
    searches: rs.length,
    pages: rs.reduce((n, r) => n + r.pages, 0),
    count: rs.reduce((n, r) => n + r.count, 0),
    seen: rs.reduce((n, r) => n + r.seen, 0),
    added: rs.reduce((n, r) => n + r.added, 0),
  };
}

// ─── Texte de la ligne « Leboncoin » du Fil ───

const hour = (ts) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ');
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

const dateText = (ts) => new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

// Phrase d'état, à partir de la réponse du service worker (LBC_TOUR_STATUS).
export function tourText(s, now = Date.now()) {
  if (!s.enabled) return 'Leboncoin : lecture automatique désactivée.';
  const when = dayKey(s.nextRunAt) === dayKey(now) ? `aujourd’hui à ${hour(s.nextRunAt)}` : `demain à ${hour(s.nextRunAt)}`;
  const t = s.tour;
  if (!t) return `Leboncoin : lecture automatique chaque jour à ${TOUR_HOUR} h, Chrome ouvert. Prochain passage ${when}.`;
  const day = t.day === dayKey(now) ? 'aujourd’hui' : `le ${dateText(t.startedAt)}`;
  if (t.status === 'running') return `Leboncoin : lecture en cours${t.current ? ` (${t.current})` : ''}, ${plural(t.pages, 'page lue', 'pages lues')}.`;
  if (t.status === 'stopped') return `Leboncoin : lecture interrompue ${day} après ${plural(t.pages, 'page', 'pages')} (${t.reason}). Reprise ${when}.`;
  if (!t.searches) return `Leboncoin : rien lu ${day} (${t.reason || 'aucune recherche'}). Prochain passage ${when}.`;
  const read = `${plural(t.seen, 'annonce de vos communes lue', 'annonces de vos communes lues')}, ${plural(t.added, 'nouvelle', 'nouvelles')}`;
  const notes = t.notes && t.notes.length ? ` ${t.notes.join(' ; ')}.` : '';
  return `Leboncoin : lu ${day} à ${hour(t.startedAt)} : ${read}.${t.reason ? ` ${t.reason}.` : ''}${notes} Prochain passage ${when}.`;
}
