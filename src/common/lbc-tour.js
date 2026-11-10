// Lecture guidée de Leboncoin : la logique, sans rien du navigateur (testée sous Node).
//
// Leboncoin refuse la lecture automatique (défi anti-robot DataDome, constaté deux jours de suite
// le 09 et le 10/11/2026). La tournée de 10 h a donc été remplacée par une lecture guidée : à chaque
// clic sur « Lire la suivante » dans le Fil, l'onglet Leboncoin de Nathan s'ouvre sur la recherche
// suivante, il la voit s'afficher (et passe lui-même un éventuel test anti-robot), et l'extension lit
// ce qui est affiché, comme quand il visite la page. Rien ne s'enchaîne sans un clic de sa part.
// Ce module décide seulement quelle recherche vient ensuite ; le service worker
// (src/background/lbc-tour-runner.js) ouvre l'onglet et lit la page.

// Les deux premières fonctions horaires servent encore à la tournée SeLoger (src/common/seloger-tour.js).
export const TOUR_HOUR = 10;
export const MAX_PAGES = 8;

const pad = (n) => String(n).padStart(2, '0');

// Jour local « 2026-11-09 » : sert à savoir ce qui est déjà lu aujourd'hui.
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

// Chrome était fermé à l'heure prévue : la tournée se fait à l'ouverture, une fois dans la journée.
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

// ─── La journée de lecture ───
// { day, queue, done } où done[key] = { label, pages, count, seen, added, finished, note }.

export function newDay(queue, now) {
  return { day: dayKey(now), queue, done: {} };
}

// Même communes qu'avant (les recherches ont pu changer en cours de journée) : on garde ce qui est lu.
export function refreshDay(day, queue, now) {
  if (!day || day.day !== dayKey(now)) return newDay(queue, now);
  const keys = new Set(queue.map((s) => s.key));
  const done = {};
  for (const [k, v] of Object.entries(day.done || {})) if (keys.has(k)) done[k] = v;
  return { ...day, queue, done };
}

// La prochaine page à ouvrir : { idx, search, page } ou null quand tout est lu.
export function nextTarget(day) {
  for (let idx = 0; idx < day.queue.length; idx++) {
    const search = day.queue[idx];
    const d = day.done[search.key];
    if (!d || !d.finished) return { idx, search, page: (d ? d.pages : 0) + 1 };
  }
  return null;
}

// Que faire d'une recherche après une page lue : encore une page, ou passer à la commune suivante ?
// La page 2 n'est proposée que si la page 1 était entièrement nouvelle (les annonces sont triées des
// plus récentes aux plus anciennes : une page déjà connue annonce que la suite l'est aussi).
function isFinished(page, read, search) {
  if (!read.count) return { finished: true };
  if (page === 1) {
    // Des annonces, mais aucune dans la commune demandée : l'adresse de recherche n'a pas été comprise.
    const here = search.postals.reduce((sum, p) => sum + (Number(read.postalCounts && read.postalCounts[p]) || 0), 0);
    if (!here) return { finished: true, note: 'recherche non reconnue par Leboncoin' };
  }
  const last = Math.min(MAX_PAGES, Number(read.maxPages) || MAX_PAGES);
  if (page >= last) return { finished: true };
  const allNew = Number(read.seen) > 0 && Number(read.added) >= Number(read.seen);
  return { finished: !allNew };
}

// Journée après une page lue (nouvel objet, l'ancien n'est pas modifié).
export function record(day, target, read) {
  const { search, page } = target;
  const before = day.done[search.key] || { label: search.label, pages: 0, count: 0, seen: 0, added: 0, finished: false, note: null };
  const verdict = isFinished(page, read, search);
  const done = {
    ...day.done,
    [search.key]: {
      ...before,
      pages: before.pages + 1,
      count: before.count + (read.count || 0),
      seen: before.seen + (read.seen || 0),
      added: before.added + (read.added || 0),
      finished: verdict.finished,
      note: verdict.note || before.note,
    },
  };
  return { ...day, done };
}

// Une recherche qu'on ne peut pas lire (onglet fermé avant la fin d'un défi) : on passe à la suivante.
export function skip(day, key, note = 'non lue') {
  const search = day.queue.find((s) => s.key === key);
  if (!search) return day;
  const before = day.done[key] || { label: search.label, pages: 0, count: 0, seen: 0, added: 0 };
  return { ...day, done: { ...day.done, [key]: { ...before, finished: true, note } } };
}

export function summary(day) {
  const ds = Object.values(day.done);
  const next = nextTarget(day);
  return {
    total: day.queue.length,
    finished: ds.filter((d) => d.finished).length,
    pages: ds.reduce((n, d) => n + d.pages, 0),
    seen: ds.reduce((n, d) => n + d.seen, 0),
    added: ds.reduce((n, d) => n + d.added, 0),
    next: next ? next.search.label + (next.page > 1 ? `, page ${next.page}` : '') : null,
    notes: ds.filter((d) => d.note).map((d) => `${d.label} : ${d.note}`),
  };
}

// ─── Texte de la ligne « Leboncoin » du Fil ───

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// Phrase d'état, à partir de la réponse du service worker (LBC_GUIDED_STATUS) : { total, finished,
// seen, added, next, waiting, error }.
export function guidedText(s) {
  if (s.error) return `Leboncoin : ${s.error}`;
  if (!s.total) return 'Leboncoin : aucune commune suivie, rien à lire.';
  if (s.waiting) {
    const seen = s.diag ? ` Ce que l’extension voit : ${s.diag}.` : '';
    return `Leboncoin : ${s.waiting} attend ta vérification anti-robot dans l’onglet ouvert. Passe-la, attends que la liste s’affiche, puis clique sur « Relire la page ».${seen}`;
  }
  const read = `${plural(s.seen, 'annonce de tes communes lue', 'annonces de tes communes lues')}, ${plural(s.added, 'nouvelle', 'nouvelles')}`;
  if (!s.next) return `Leboncoin : toutes les communes sont lues aujourd’hui (${read}). Prochaine lecture demain.`;
  const head = `${s.finished} commune${s.finished > 1 ? 's' : ''} sur ${s.total} lue${s.finished > 1 ? 's' : ''} aujourd’hui`;
  return `Leboncoin : lecture guidée, ${head}${s.seen ? ` (${read})` : ''}. Suivante : ${s.next}.`;
}
