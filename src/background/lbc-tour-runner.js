// Tournée quotidienne de Leboncoin, côté navigateur : alarme à 10 h, une fenêtre réduite, une page
// toutes les 45 secondes. La logique (quoi ouvrir, quand s'arrêter) est dans src/common/lbc-tour.js.
//
// Un service worker s'éteint après 30 secondes sans activité : l'état de la tournée est donc gardé
// dans chrome.storage.local, et chaque page est une étape réveillée par une alarme.
//
// Garde-fous (décidés avec Nathan le 09/11/2026) : arrêt net au premier refus ou défi anti-robot,
// aucun captcha résolu, aucune connexion à un compte, rythme fixe, une seule fenêtre.
import { PACE_MS, dayKey, nextRunAt, missedToday, searchUrl, buildQueue, newTour, step, summary } from '../common/lbc-tour.js';
import { ZONES_KEY } from '../common/zones.js';

const STATE_KEY = 'immodex.lbc-tour.v1';
const SYNC_STATE_KEY = 'immodex.sync.v1';
const DAILY_ALARM = 'immodex-lbc-daily';
const STEP_ALARM = 'immodex-lbc-step';
// Chrome vient de s'ouvrir après 10 h : la tournée attend que la session soit restaurée.
const STARTUP_DELAY_MS = 3 * 60 * 1000;
const NAVIGATION_TIMEOUT_MS = 30_000;
const SETTLE_MS = 2500;

// L'appli téléphone fait tourner ce même service worker dans une page, sans fenêtres ni onglets :
// la tournée n'y existe pas (et la ligne « Leboncoin » du Fil reste cachée).
const supported = () => !!(chrome.windows && chrome.windows.create && chrome.tabs && chrome.tabs.sendMessage);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let busy = false;

async function load() {
  const stored = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY];
  return { enabled: true, lastDay: null, tour: null, window: null, ...(stored || {}) };
}
const save = (st) => chrome.storage.local.set({ [STATE_KEY]: st });

async function hasSyncKey() {
  const stored = (await chrome.storage.local.get(SYNC_STATE_KEY))[SYNC_STATE_KEY];
  return !!(stored && stored.key);
}

function scheduleDaily() {
  if (!chrome.alarms) return;
  chrome.alarms.create(DAILY_ALARM, { when: nextRunAt(Date.now()) });
}

// Prochaine étape : une alarme (survit à l'arrêt du service worker), doublée d'un minuteur quand
// l'attente est courte. Une étape lancée deux fois ne fait rien la seconde fois (voir runStep).
function scheduleStep(delayMs) {
  const wait = Math.max(0, delayMs);
  if (chrome.alarms) chrome.alarms.create(STEP_ALARM, { when: Date.now() + wait });
  if (wait < 25_000) setTimeout(() => runStep().catch((e) => console.warn('[immodex tournée]', e)), wait);
}

async function closeWindow(st) {
  const id = st.window && st.window.windowId;
  st.window = null;
  if (id != null) await chrome.windows.remove(id).catch(() => {});
}

// Ouvre ou réutilise la fenêtre réduite de la tournée ; renvoie l'onglet.
async function ensureTab(st) {
  if (st.window) {
    const tab = await chrome.tabs.get(st.window.tabId).catch(() => null);
    if (tab) return tab;
    st.window = null; // fermée à la main : on en rouvre une
  }
  let win;
  try {
    win = await chrome.windows.create({ url: 'about:blank', state: 'minimized', focused: false });
  } catch {
    win = await chrome.windows.create({ url: 'about:blank', focused: false });
  }
  const tab = win.tabs[0];
  st.window = { windowId: win.id, tabId: tab.id };
  return tab;
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
    chrome.tabs.update(tabId, { url }).catch(done);
  });
}

const REFUSED = { hasData: false, count: 0, postalCounts: {} };

// Ouvre la page demandée et renvoie ce que list-capture.js y a lu et envoyé au Fil.
async function readPage(st, search, page) {
  const tab = await ensureTab(st);
  await navigate(tab.id, searchUrl(search, page));
  await sleep(SETTLE_MS);
  // Sans permission « tabs », Chrome ne donne pas l'adresse de l'onglet : une redirection vers une page
  // de défi se voit à l'absence du script de lecture, qui ne tourne que sur les listes Leboncoin.
  for (let i = 0; i < 3; i++) {
    try {
      const read = await chrome.tabs.sendMessage(tab.id, { type: 'LBC_TOUR_READ' });
      if (read) return read;
    } catch {
      // le script de la page n'est pas encore là
    }
    await sleep(2000);
  }
  // Aucun script de lecture : la page n'est pas la liste attendue (défi anti-robot, page d'erreur).
  return { ...REFUSED, diag: 'aucun script de lecture sur la page' };
}

async function runStep() {
  if (busy) return;
  busy = true;
  try {
    const st = await load();
    const tour = st.tour;
    if (!tour || tour.status !== 'running') return;
    const now = Date.now();
    if (now < tour.nextAt - 500) {
      // Réveil en double ou trop tôt : on attend l'heure prévue.
      scheduleStep(tour.nextAt - now);
      return;
    }
    if (tour.day !== dayKey(now)) {
      // Tournée d'hier jamais finie (PC éteint en cours de route) : abandonnée, celle du jour la remplace.
      st.tour = { ...tour, status: 'stopped', reason: 'tournée de la veille non terminée' };
      await closeWindow(st);
      await save(st);
      return;
    }
    if (!st.enabled) {
      st.tour = { ...tour, status: 'stopped', reason: 'tournée désactivée' };
      await closeWindow(st);
      await save(st);
      return;
    }
    let read;
    try {
      read = await readPage(st, tour.queue[tour.idx], tour.page);
    } catch (e) {
      read = { hasData: true, count: 0, postalCounts: {}, error: String((e && e.message) || e) };
    }
    const next = step(tour, read, Date.now(), st.paceMs || PACE_MS);
    // Tournée coupée faute de données : la raison dit aussi ce que la page montrait (défi ou autre).
    if (next.status === 'stopped' && read.diag && !read.hasData) next.reason = `${next.reason} · ${read.diag}`;
    st.tour = next;
    if (next.status !== 'running') {
      st.lastDay = next.day;
      await closeWindow(st);
    }
    await save(st);
    if (next.status === 'running') scheduleStep(next.nextAt - Date.now());
  } finally {
    busy = false;
  }
}

// Démarre la tournée du jour (alarme de 10 h, rattrapage à l'ouverture de Chrome, ou à la demande).
async function startTour({ force = false, delayMs = 0 } = {}) {
  const st = await load();
  const now = Date.now();
  if (!force && !st.enabled) return { started: false, reason: 'désactivée' };
  if (!force && st.lastDay === dayKey(now)) return { started: false, reason: 'déjà faite aujourd’hui' };
  if (st.tour && st.tour.status === 'running' && st.tour.day === dayKey(now)) {
    scheduleStep(st.tour.nextAt - now);
    return { started: true, resumed: true };
  }
  if (!(await hasSyncKey())) {
    st.tour = { ...newTour([], now), reason: 'synchro non activée : rien à envoyer au Fil' };
    st.lastDay = dayKey(now);
    await save(st);
    return { started: false, reason: st.tour.reason };
  }
  const zones = (await chrome.storage.local.get(ZONES_KEY))[ZONES_KEY] || [];
  const tour = newTour(buildQueue(zones), now);
  tour.nextAt = now + delayMs;
  st.tour = tour;
  if (tour.status !== 'running') st.lastDay = tour.day;
  await save(st);
  if (tour.status === 'running') scheduleStep(delayMs);
  return { started: tour.status === 'running', reason: tour.reason };
}

async function setEnabled(enabled) {
  const st = await load();
  st.enabled = !!enabled;
  if (!st.enabled && st.tour && st.tour.status === 'running') {
    st.tour = { ...st.tour, status: 'stopped', reason: 'tournée désactivée' };
    await closeWindow(st);
    if (chrome.alarms) chrome.alarms.clear(STEP_ALARM);
  }
  await save(st);
  return st;
}

// Ce que le Fil affiche : état, dernière tournée, prochain passage.
async function status() {
  const st = await load();
  const now = Date.now();
  const t = st.tour;
  return {
    enabled: st.enabled,
    nextRunAt: nextRunAt(now),
    lastDay: st.lastDay,
    tour: t
      ? {
          day: t.day,
          status: t.status,
          reason: t.reason,
          startedAt: t.startedAt,
          searches: t.queue.length,
          current: t.status === 'running' ? t.queue[t.idx] && t.queue[t.idx].label : null,
          ...summary(t),
          notes: t.results.filter((r) => r && r.note).map((r) => `${r.label} : ${r.note}`),
        }
      : null,
  };
}

// Mise en route : alarmes, reprise d'une tournée en cours, rattrapage à l'ouverture de Chrome.
export function initLbcTour() {
  if (!supported()) return;
  scheduleDaily();
  if (chrome.alarms) {
    chrome.alarms.onAlarm.addListener((a) => {
      if (a.name === DAILY_ALARM) {
        scheduleDaily();
        startTour().catch((e) => console.warn('[immodex tournée]', e));
      } else if (a.name === STEP_ALARM) {
        runStep().catch((e) => console.warn('[immodex tournée]', e));
      }
    });
  }
  chrome.runtime.onStartup.addListener(async () => {
    const st = await load();
    const now = Date.now();
    if (st.tour && st.tour.status === 'running' && st.tour.day === dayKey(now)) {
      scheduleStep(Math.max(STARTUP_DELAY_MS, st.tour.nextAt - now));
    } else if (st.enabled && missedToday(now, st.lastDay)) {
      await startTour({ delayMs: STARTUP_DELAY_MS });
    }
  });
  // Le service worker vient de se réveiller au milieu d'une tournée : l'alarme de l'étape suivante existe-t-elle ?
  load()
    .then(async (st) => {
      if (!st.tour || st.tour.status !== 'running' || !chrome.alarms) return;
      if (!(await chrome.alarms.get(STEP_ALARM))) scheduleStep(st.tour.nextAt - Date.now());
    })
    .catch(() => {});
}

// Messages du Fil et du popup : état, activation, lancement immédiat.
export function lbcTourMessage(message) {
  if (!supported()) return null;
  if (message.type === 'LBC_TOUR_STATUS') return status().then((s) => ({ status: s }));
  if (message.type === 'LBC_TOUR_SET') return setEnabled(message.enabled).then(status).then((s) => ({ status: s }));
  if (message.type === 'LBC_TOUR_RUN_NOW') return startTour({ force: true }).then(async (r) => ({ ...r, status: await status() }));
  return null;
}
