// Tournée quotidienne de SeLoger, côté navigateur : alarme à 11 h, une fenêtre réduite, une annonce
// toutes les 45 secondes. La logique (quoi ouvrir, quand s'arrêter) est dans src/common/seloger-tour.js ;
// la lecture de la page, dans src/common/seloger-detail.js (script de contenu seloger-detail-capture.js).
//
// But : les adresses. Les cartes de SeLoger n'ont que la lettre du DPE ; la consommation, qui désigne
// le logement dans le registre de l'ADEME, est sur la page de l'annonce, que le serveur ne peut pas lire.
// Chaque annonce lue part au Fil avec sa consommation : le serveur en tire l'adresse tout de suite.
//
// Même construction que la tournée Leboncoin (lbc-tour-runner.js) : un service worker s'éteint après 30
// secondes sans activité, l'état est donc dans chrome.storage.local et chaque page est une étape réveillée
// par une alarme. Garde-fous (décidés avec Nathan le 09/11/2026) : arrêt net au premier refus ou défi
// anti-robot, aucun captcha résolu, aucune connexion à un compte, rythme fixe, une seule fenêtre.
import { PACE_MS, dayKey, nextRunAt, missedToday, buildQueue, newTour, step, summary, pruneTried } from '../common/seloger-tour.js';
import { ZONES_KEY } from '../common/zones.js';
import { sendCards } from './ingest-client.js';

const STATE_KEY = 'immodex.seloger-tour.v1';
const TRIED_KEY = 'immodex.seloger-tour.tried.v1';
const SYNC_STATE_KEY = 'immodex.sync.v1';
const DAILY_ALARM = 'immodex-seloger-daily';
const STEP_ALARM = 'immodex-seloger-step';
const LISTINGS_URL = 'https://immodex.vercel.app/api/listings';
// Chrome vient de s'ouvrir après 11 h : la tournée attend que la session soit restaurée.
const STARTUP_DELAY_MS = 3 * 60 * 1000;
const NAVIGATION_TIMEOUT_MS = 30_000;
const SETTLE_MS = 2500;
const MAX_COMMUNES = 30; // limite de /api/listings

// L'appli téléphone fait tourner ce même service worker dans une page, sans fenêtres ni onglets :
// la tournée n'y existe pas.
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
  if (wait < 25_000) setTimeout(() => runStep().catch((e) => console.warn('[immodex SeLoger]', e)), wait);
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
  // Enregistré tout de suite : la page de l'annonce, en se chargeant, doit trouver cet onglet connu
  // (une visite de Nathan est envoyée par le script de la page, pas celle de la tournée).
  await save(st);
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

// Ouvre l'annonce, la fait lire par seloger-detail-capture.js, l'envoie au Fil, renvoie ce qui a été lu.
async function readPage(st, item) {
  const tab = await ensureTab(st);
  await navigate(tab.id, item.url);
  await sleep(SETTLE_MS);
  let read = null;
  for (let i = 0; i < 3 && !read; i++) {
    try {
      read = await chrome.tabs.sendMessage(tab.id, { type: 'SELOGER_TOUR_READ' });
    } catch {
      // le script de la page n'est pas encore là
    }
    if (!read) await sleep(2000);
  }
  // Aucun script de lecture : ce n'est pas une page d'annonce (annonce retirée, redirection, défi).
  if (!read) return { hasData: false };
  if (!read.hasData) return read;
  try {
    // L'adresse de l'annonce est celle que le Fil connaît (une redirection ne doit pas créer un doublon).
    const res = await sendCards({ source: 'seloger', insee: item.insee, cards: [{ ...read.card, url: item.url }] });
    return { ...read, addressed: res.addressed };
  } catch (e) {
    return { ...read, error: `envoi au Fil : ${String((e && e.message) || e)}` };
  }
}

// Annonces SeLoger suivies, telles que le Fil les connaît (données publiques des sites).
async function fetchListings(zones) {
  const codes = [...new Set(zones.flatMap((z) => (z && z.communes) || []).map((c) => c && c.code).filter(Boolean))].slice(0, MAX_COMMUNES);
  if (!codes.length) return [];
  // `fresh` : l'adresse est mise en cache cinq minutes ; la liste doit être celle de maintenant.
  const res = await fetch(`${LISTINGS_URL}?insee=${codes.join(',')}&fresh=${Date.now()}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `erreur ${res.status}`);
  return data.listings || [];
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
    const item = tour.queue[tour.idx];
    let read;
    try {
      read = await readPage(st, item);
    } catch (e) {
      read = { hasData: true, error: String((e && e.message) || e) };
    }
    const next = step(tour, read, Date.now(), st.paceMs || PACE_MS);
    st.tour = next;
    // Une annonce lue sans consommation, ou introuvable, n'est pas rouverte avant plusieurs jours.
    if (next.last && next.last.outcome !== 'ok' && !read.error) {
      const stored = (await chrome.storage.local.get(TRIED_KEY))[TRIED_KEY] || {};
      const tried = pruneTried(stored, Date.now());
      tried[item.url] = { at: Date.now(), outcome: next.last.outcome };
      await chrome.storage.local.set({ [TRIED_KEY]: tried });
    }
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

// Démarre la tournée du jour (alarme de 11 h, rattrapage à l'ouverture de Chrome, ou à la demande).
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
  let queue = [];
  let failure = null;
  try {
    const zones = (await chrome.storage.local.get(ZONES_KEY))[ZONES_KEY] || [];
    const tried = (await chrome.storage.local.get(TRIED_KEY))[TRIED_KEY] || {};
    queue = buildQueue(await fetchListings(zones), tried, now);
  } catch (e) {
    failure = `liste des annonces injoignable (${String((e && e.message) || e)})`;
  }
  const tour = newTour(queue, now);
  if (failure) {
    tour.status = 'stopped';
    tour.reason = failure;
  }
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
  const t = st.tour;
  return {
    enabled: st.enabled,
    nextRunAt: nextRunAt(Date.now()),
    lastDay: st.lastDay,
    tour: t ? { day: t.day, status: t.status, reason: t.reason, startedAt: t.startedAt, ...summary(t) } : null,
  };
}

// Visite de Nathan sur une annonce SeLoger : sa lecture part au Fil, sauf dans l'onglet de la tournée
// (c'est elle qui envoie, avec l'adresse de l'annonce telle que le Fil la connaît).
async function onDetailSeen(message, sender) {
  const st = await load();
  if (st.window && sender && sender.tab && sender.tab.id === st.window.tabId) return { skipped: true };
  const res = await sendCards({ source: 'seloger', cards: [message.card] });
  return { seen: res.seen, addressed: res.addressed };
}

// Mise en route : alarmes, reprise d'une tournée en cours, rattrapage à l'ouverture de Chrome.
export function initSelogerTour() {
  if (!supported()) return;
  scheduleDaily();
  if (chrome.alarms) {
    chrome.alarms.onAlarm.addListener((a) => {
      if (a.name === DAILY_ALARM) {
        scheduleDaily();
        startTour().catch((e) => console.warn('[immodex SeLoger]', e));
      } else if (a.name === STEP_ALARM) {
        runStep().catch((e) => console.warn('[immodex SeLoger]', e));
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

// Messages du Fil, du popup et des pages d'annonce : état, activation, lancement immédiat, visite.
export function selogerTourMessage(message, sender) {
  if (!supported()) return null;
  if (message.type === 'SELOGER_TOUR_STATUS') return status().then((s) => ({ status: s }));
  if (message.type === 'SELOGER_TOUR_SET') return setEnabled(message.enabled).then(status).then((s) => ({ status: s }));
  if (message.type === 'SELOGER_TOUR_RUN_NOW') return startTour({ force: true }).then(async (r) => ({ ...r, status: await status() }));
  if (message.type === 'SELOGER_DETAIL_SEEN') return onDetailSeen(message, sender);
  return null;
}

