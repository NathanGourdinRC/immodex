// Lecture guidée de Leboncoin, côté navigateur. Leboncoin refuse la lecture automatique (défi
// anti-robot) : rien ne tourne seul. À chaque clic sur « Lire la suivante » dans le Fil, l'onglet
// Leboncoin de Nathan s'ouvre sur la recherche suivante, il voit la page (et passe lui-même un
// éventuel test anti-robot), et l'extension lit ce qui est affiché puis l'envoie au Fil.
// La logique (quelle recherche ensuite) est dans src/common/lbc-tour.js.
//
// Garde-fous (décidés avec Nathan le 10/11/2026) : aucune page ouverte sans un clic, aucun captcha
// résolu par l'extension, aucune connexion à un compte, un seul onglet réutilisé, onglet au premier plan.
import { searchUrl, buildQueue, refreshDay, nextTarget, record, skip, summary } from '../common/lbc-tour.js';
import { ZONES_KEY } from '../common/zones.js';

const STATE_KEY = 'immodex.lbc-guided.v1';
const SYNC_STATE_KEY = 'immodex.sync.v1';
// Anciennes clés de la tournée automatique de 10 h (version 0.28.0 à 0.29.2) : nettoyées au démarrage.
const OLD_STATE_KEY = 'immodex.lbc-tour.v1';
const OLD_ALARMS = ['immodex-lbc-daily', 'immodex-lbc-step'];
const NAVIGATION_TIMEOUT_MS = 30_000;
const SETTLE_MS = 2500;

// L'appli téléphone fait tourner ce même service worker dans une page, sans onglets Chrome :
// la lecture guidée n'y existe pas (et la ligne « Leboncoin » du Fil reste cachée).
const supported = () => !!(chrome.windows && chrome.windows.create && chrome.tabs && chrome.tabs.sendMessage);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let busy = false;

async function load() {
  const stored = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY];
  return { day: null, tabId: null, pending: null, error: null, ...(stored || {}) };
}
const save = (st) => chrome.storage.local.set({ [STATE_KEY]: st });

async function hasSyncKey() {
  const stored = (await chrome.storage.local.get(SYNC_STATE_KEY))[SYNC_STATE_KEY];
  return !!(stored && stored.key);
}

// La journée à jour : recréée si le jour a changé, adaptée si les recherches ont changé.
async function freshDay(st) {
  const zones = (await chrome.storage.local.get(ZONES_KEY))[ZONES_KEY] || [];
  st.day = refreshDay(st.day, buildQueue(zones), Date.now());
  return st.day;
}

// Navigue et attend la fin du chargement (ou le délai).
function navigate(tabId, url) {
  return new Promise((resolve) => {
    let loading = false;
    const done = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (id, info) => {
      if (id !== tabId) return;
      if (info.status === 'loading') loading = true;
      if (info.status === 'complete' && loading) done();
    };
    const timer = setTimeout(done, NAVIGATION_TIMEOUT_MS);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId, { url, active: true }).catch(done);
  });
}

// Ouvre la page dans l'onglet de la lecture (créé, ou réutilisé s'il est encore ouvert) et le met au premier plan.
async function openIn(st, url) {
  const known = st.tabId != null ? await chrome.tabs.get(st.tabId).catch(() => null) : null;
  if (known) {
    await navigate(known.id, url);
    await chrome.windows.update(known.windowId, { focused: true }).catch(() => {});
    return known.id;
  }
  const tab = await chrome.tabs.create({ url, active: true });
  st.tabId = tab.id;
  await navigate(tab.id, url);
  return tab.id;
}

// Demande au script de la page ce qu'il a lu (et envoyé au Fil). `tries` : le script peut mettre un moment à arriver.
async function askRead(tabId, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      // fresh : relire la page telle qu'elle est maintenant, pas la lecture gardée d'avant le test anti-robot.
      const read = await chrome.tabs.sendMessage(tabId, { type: 'LBC_TOUR_READ', fresh: true });
      if (read) return read;
    } catch {
      // le script de la page n'est pas encore là
    }
    if (i < tries - 1) await sleep(2000);
  }
  return { hasData: false, count: 0, postalCounts: {}, diag: 'aucun script de lecture sur la page' };
}

// Ce que le Fil affiche : avancement de la journée, prochaine commune, attente d'un test anti-robot.
function statusOf(st, day) {
  const waiting = st.pending && day.queue.find((s) => s.key === st.pending.key);
  return { ...summary(day), waiting: waiting ? waiting.label : null, diag: waiting ? st.pending.diag || null : null, error: st.error };
}

async function status() {
  const st = await load();
  const day = await freshDay(st);
  return statusOf(st, day);
}

// Un clic sur « Lire la suivante » : relit la page en attente d'un test anti-robot, sinon ouvre la suivante.
async function readNext() {
  if (busy) return status();
  busy = true;
  try {
    const st = await load();
    st.error = null;
    let day = await freshDay(st);
    const finish = async () => {
      st.day = day;
      await save(st);
      return statusOf(st, day);
    };
    if (!(await hasSyncKey())) {
      st.error = 'synchro non activée, rien à envoyer au Fil. Active-la dans les réglages d’Immodex+.';
      return finish();
    }

    let target = null;
    let tabId = null;
    let read = null;

    // 1. Une page attendait que Nathan passe le test anti-robot : la liste s'affiche-t-elle maintenant ?
    const waiting = st.pending && day.queue.find((s) => s.key === st.pending.key);
    if (waiting) {
      tabId = st.tabId != null ? ((await chrome.tabs.get(st.tabId).catch(() => null)) || {}).id ?? null : null;
      if (tabId == null) {
        // Onglet fermé sans que la liste s'affiche : cette recherche est laissée, on passe à la suivante.
        day = skip(day, waiting.key, 'non lue (test anti-robot non passé)');
        st.pending = null;
      } else {
        target = { search: waiting, page: st.pending.page };
        read = await askRead(tabId, 2);
      }
    } else {
      st.pending = null;
    }

    // 2. Sinon, ouvrir la recherche suivante dans l'onglet de la lecture, au premier plan.
    if (!target) {
      target = nextTarget(day);
      if (!target) return finish();
      tabId = await openIn(st, searchUrl(target.search, target.page));
      await sleep(SETTLE_MS);
      read = await askRead(tabId);
    }

    // 3. Ce qui s'affiche : rien de lisible, une erreur d'envoi, ou une page lue.
    if (!read.hasData) {
      // Défi anti-robot, page vide ou refus : l'onglet reste ouvert, au premier plan, pour que Nathan le passe lui-même.
      // diag : ce que la page montre (titre, données présentes ou non, défi détecté), affiché dans le Fil.
      st.pending = { key: target.search.key, page: target.page, diag: read.diag || null };
      await chrome.tabs.update(tabId, { active: true }).catch(() => {});
      return finish();
    }
    st.pending = null;
    if (read.error) {
      // La page est lisible mais l'envoi au Fil a échoué : rien n'est noté comme lu, un nouveau clic réessaie.
      st.error = `lecture interrompue : ${read.error}`;
      return finish();
    }
    day = record(day, target, read);
    return finish();
  } finally {
    busy = false;
  }
}

// Mise en route : nettoie la tournée automatique de 10 h des versions 0.28.0 à 0.29.2 (alarmes, état, fenêtre).
export function initLbcTour() {
  if (!supported()) return;
  if (chrome.alarms) for (const name of OLD_ALARMS) chrome.alarms.clear(name).catch(() => {});
  chrome.storage.local
    .get(OLD_STATE_KEY)
    .then(async (items) => {
      const old = items[OLD_STATE_KEY];
      if (!old) return;
      if (old.window && old.window.windowId != null) await chrome.windows.remove(old.window.windowId).catch(() => {});
      await chrome.storage.local.remove(OLD_STATE_KEY);
    })
    .catch(() => {});
}

// Messages du Fil : état de la journée, lecture de la suivante.
export function lbcTourMessage(message) {
  if (!supported()) return null;
  if (message.type === 'LBC_GUIDED_STATUS') return status().then((s) => ({ status: s }));
  if (message.type === 'LBC_GUIDED_NEXT') return readNext().then((s) => ({ status: s }));
  return null;
}
