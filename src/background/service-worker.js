import { runLookup, runLandLookup } from '../common/match.js';
import { createHistoryStore } from '../common/history.js';
import { createPropertyStore } from '../common/properties.js';

const history = createHistoryStore(chrome.storage.local);
const properties = createPropertyStore(chrome.storage.local);
// Critères envoyés par « Modifier les champs » depuis une annonce, relus par le popup.
const PREFILL_KEY = 'immodex.prefill.v1';
const PREFILL_TTL_MS = 10 * 60 * 1000;

const MAX_CACHE_ENTRIES = 200;
const CACHE_TTL_MS = 60 * 60 * 1000;
const LAND_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'immodex.cache.v1';
const LAND_STORAGE_KEY = 'immodex.cache.land.v1';
const MAX_CONCURRENT = 4;
const MAX_LAND_CONCURRENT = 16;

const memoryCache = new Map();
const landCache = new Map();
let inflight = 0;
let landInflight = 0;
const pending = [];
const landPending = [];

function hashPayload(payload) {
  const kind = payload.kind || 'dpe';
  if (kind === 'land') {
    return [
      'land',
      payload.postal || '',
      payload.city || '',
      payload.surface || '',
      payload.section || '',
    ].join('|');
  }
  const parts = [
    'dpe',
    payload.postal || '',
    // Sans code postal, c'est la ville qui distingue deux recherches.
    payload.postal ? '' : payload.city || '',
    payload.cityHint || '',
    payload.surface || '',
    payload.energyClass || '',
    payload.gesClass || '',
    payload.buildingType || '',
    payload.dateRange ? `${payload.dateRange.gte}_${payload.dateRange.lte}` : '',
    payload.isNewBuild ? 'new' : 'ex',
    payload.energyConsumption ?? '',
    payload.gesEmission ?? '',
  ];
  return parts.join('|');
}

async function loadPersistedCache() {
  try {
    const stored = await chrome.storage.session.get(STORAGE_KEY);
    const data = stored[STORAGE_KEY];
    if (data && typeof data === 'object') {
      const now = Date.now();
      for (const [key, entry] of Object.entries(data)) {
        if (entry && entry.expiresAt > now) {
          memoryCache.set(key, entry);
        }
      }
    }
  } catch (e) {
    // chrome.storage.session unavailable — ignore
  }
}

async function loadLandCache() {
  try {
    const stored = await chrome.storage.local.get(LAND_STORAGE_KEY);
    const data = stored[LAND_STORAGE_KEY];
    if (data && typeof data === 'object') {
      const now = Date.now();
      for (const [key, entry] of Object.entries(data)) {
        if (entry && entry.expiresAt > now) {
          landCache.set(key, entry);
        }
      }
    }
  } catch (e) {
    // ignore
  }
}

async function persistCache() {
  try {
    const obj = {};
    for (const [k, v] of memoryCache.entries()) obj[k] = v;
    await chrome.storage.session.set({ [STORAGE_KEY]: obj });
  } catch (e) {
    // ignore
  }
}

async function persistLandCache() {
  try {
    const obj = {};
    for (const [k, v] of landCache.entries()) obj[k] = v;
    await chrome.storage.local.set({ [LAND_STORAGE_KEY]: obj });
  } catch (e) {
    // ignore
  }
}

function trimMap(map, max) {
  while (map.size > max) {
    const oldestKey = map.keys().next().value;
    map.delete(oldestKey);
  }
}

function getFromMap(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  map.delete(key);
  map.set(key, entry);
  return entry.value;
}

function getFromCache(key) {
  return getFromMap(memoryCache, key);
}

function setCache(key, value) {
  memoryCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  trimMap(memoryCache, MAX_CACHE_ENTRIES);
  persistCache();
}

function getFromLandCache(key) {
  return getFromMap(landCache, key);
}

function setLandCache(key, value) {
  landCache.set(key, { value, expiresAt: Date.now() + LAND_CACHE_TTL_MS });
  trimMap(landCache, MAX_CACHE_ENTRIES);
  persistLandCache();
}

function acquireSlot() {
  return new Promise((resolve) => {
    if (inflight < MAX_CONCURRENT) {
      inflight++;
      resolve();
    } else {
      pending.push(resolve);
    }
  });
}

function releaseSlot() {
  inflight--;
  const next = pending.shift();
  if (next) {
    inflight++;
    next();
  }
}

function acquireLandSlot() {
  return new Promise((resolve) => {
    if (landInflight < MAX_LAND_CONCURRENT) {
      landInflight++;
      resolve();
    } else {
      landPending.push(resolve);
    }
  });
}

function releaseLandSlot() {
  landInflight--;
  const next = landPending.shift();
  if (next) {
    landInflight++;
    next();
  }
}

async function handleLookup(payload) {
  if (payload && payload.kind === 'land') {
    const key = hashPayload(payload);
    const cached = getFromLandCache(key);
    if (cached) return { ...cached, cached: true };

    await acquireLandSlot();
    try {
      const result = await runLandLookup(payload);
      setLandCache(key, result);
      return { ...result, cached: false };
    } finally {
      releaseLandSlot();
    }
  }

  const key = hashPayload(payload);
  const cached = getFromCache(key);
  if (cached) return { ...cached, cached: true };

  await acquireSlot();
  try {
    const result = await runLookup(payload);
    setCache(key, result);
    return { ...result, cached: false };
  } finally {
    releaseSlot();
  }
}

loadPersistedCache();
loadLandCache();

// Page d'origine d'une recherche : fournie par le popup (« Analyser cette page »),
// sinon l'onglet de l'annonce qui a envoyé le message.
function pageOf(message, sender) {
  if (message.page && message.page.url) return message.page;
  if (sender && sender.tab && sender.tab.url) return { url: sender.tab.url, title: sender.tab.title || '' };
  return null;
}

async function recordHistory(message, sender, result) {
  const payload = message.payload || {};
  try {
    return await history.add({ payloadKey: hashPayload(payload), payload, result, page: pageOf(message, sender) });
  } catch (e) {
    console.warn('[immodex] history write failed:', e);
    return null;
  }
}

// Adresse trouvée sans ambiguïté (score ≥ 90, 10 points d'avance) : son numéro de DPE
// devient l'identifiant du bien dans le suivi des annonces, plus sûr que l'empreinte.
async function linkDpe(message, sender, result) {
  const page = pageOf(message, sender);
  const [top, second] = (result && result.candidates) || [];
  if (!page || !top || !top.record || !top.record.id) return;
  if (top.score < 90 || (second && top.score - second.score < 10)) return;
  try {
    await properties.setDpe(page.url, top.record.id, top.record.address || null);
  } catch (e) {
    console.warn('[immodex] property link failed:', e);
  }
}

// Réponse asynchrone commune : `true` garde le canal ouvert jusqu'à sendResponse.
function respond(promise, sendResponse) {
  promise
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  if (message.type === 'LOOKUP') {
    return respond(
      handleLookup(message.payload || {}).then(async (result) => {
        const entry = await recordHistory(message, sender, result);
        await linkDpe(message, sender, result);
        return { result, historyId: entry ? entry.id : null };
      }),
      sendResponse
    );
  }
  if (message.type === 'SIGHTING_RECORD') {
    const page = pageOf(message, sender);
    if (!page) return respond(Promise.resolve({ sighting: null, matches: [] }), sendResponse);
    return respond(
      properties.record({ url: page.url, title: page.title, fp: message.fp || {}, price: message.price || null }).then((r) => r || { sighting: null, matches: [] }),
      sendResponse
    );
  }
  if (message.type === 'SIGHTING_GET') {
    const url = message.url || (sender.tab && sender.tab.url);
    return respond(properties.get(url).then((r) => r || { sighting: null, matches: [] }), sendResponse);
  }
  if (message.type === 'SIGHTINGS_GROUPS') {
    return respond(properties.groups().then((groups) => ({ groups })), sendResponse);
  }
  if (message.type === 'SIGHTINGS_CLEAR') {
    return respond(properties.clear().then(() => ({})), sendResponse);
  }
  if (message.type === 'HISTORY_LIST') {
    return respond(history.list().then((entries) => ({ entries })), sendResponse);
  }
  if (message.type === 'HISTORY_GET') {
    return respond(history.get(message.id).then((entry) => ({ entry })), sendResponse);
  }
  if (message.type === 'HISTORY_GET_FOR_URL') {
    const url = message.url || (sender.tab && sender.tab.url);
    return respond(history.getForUrl(url).then((entry) => ({ entry })), sendResponse);
  }
  if (message.type === 'HISTORY_DELETE') {
    return respond(history.remove(message.id).then(() => ({})), sendResponse);
  }
  if (message.type === 'HISTORY_CLEAR') {
    return respond(history.clear().then(() => ({})), sendResponse);
  }
  if (message.type === 'PREFILL_SET') {
    return respond(
      chrome.storage.session.set({ [PREFILL_KEY]: { payload: message.payload || null, at: Date.now() } }).then(() => ({})),
      sendResponse
    );
  }
  if (message.type === 'PREFILL_GET') {
    // Lecture unique : le pré-remplissage est consommé à la première ouverture du popup.
    return respond(
      chrome.storage.session.get(PREFILL_KEY).then(async (stored) => {
        const data = stored[PREFILL_KEY];
        await chrome.storage.session.remove(PREFILL_KEY);
        const fresh = data && Date.now() - data.at < PREFILL_TTL_MS;
        return { payload: fresh ? data.payload : null };
      }),
      sendResponse
    );
  }
  if (message.type === 'OPEN_POPUP') {
    // chrome.action.openPopup existe pour toutes les extensions depuis Chrome 127 ;
    // en cas de refus, la page affiche une consigne à la place.
    const windowId = sender.tab ? sender.tab.windowId : undefined;
    return respond(
      Promise.resolve()
        .then(() => chrome.action.openPopup(windowId != null ? { windowId } : undefined))
        .then(() => ({ opened: true }))
        .catch(() => ({ opened: false })),
      sendResponse
    );
  }
  if (message.type === 'CACHE_CLEAR') {
    memoryCache.clear();
    landCache.clear();
    persistCache();
    persistLandCache();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
