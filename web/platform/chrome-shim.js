// Appli téléphone : remplace les API de l'extension Chrome (stockage, messages, onglets,
// alarmes) par leurs équivalents web, pour faire tourner ici les mêmes pages que l'extension.
//
// - chrome.storage.local → IndexedDB du navigateur (les données restent sur le téléphone,
//   puis la synchro les échange avec l'extension) ;
// - chrome.storage.session → sessionStorage (oublié à la fermeture de l'onglet) ;
// - chrome.runtime.sendMessage → la logique du service worker de l'extension, chargée
//   dans la page au lieu de tourner à part.
//
// Script classique (pas un module) : il doit être prêt avant les scripts des pages, qui
// appellent `chrome` dès leur chargement.
(function () {
  'use strict';
  document.documentElement.classList.add('imx-web');
  const meta = document.querySelector('meta[name="immodex-version"]');
  const version = meta ? meta.content : '';

  const keysOf = (keys) => (keys == null ? null : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys));
  const defaultsOf = (keys) => (keys && typeof keys === 'object' && !Array.isArray(keys) ? { ...keys } : {});

  const changeListeners = [];
  function emitChanges(keys, area) {
    if (!keys.length) return;
    const changes = Object.fromEntries(keys.map((k) => [k, {}]));
    for (const fn of changeListeners) {
      try {
        fn(changes, area);
      } catch (e) {
        console.error('[immodex]', e);
      }
    }
  }

  // ─── chrome.storage.local : une table clé → valeur dans IndexedDB ───

  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('immodex', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function transaction(mode, run) {
    return db().then(
      (d) =>
        new Promise((resolve, reject) => {
          const tx = d.transaction('kv', mode);
          const out = run(tx.objectStore('kv'));
          tx.oncomplete = () => resolve(out);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        })
    );
  }

  const local = {
    async get(keys) {
      const list = keysOf(keys);
      const result = defaultsOf(keys);
      await transaction('readonly', (store) => {
        if (list) {
          for (const k of list) {
            const r = store.get(k);
            r.onsuccess = () => {
              if (r.result !== undefined) result[k] = r.result;
            };
          }
        } else {
          const r = store.openCursor();
          r.onsuccess = () => {
            const cursor = r.result;
            if (!cursor) return;
            result[cursor.key] = cursor.value;
            cursor.continue();
          };
        }
      });
      return result;
    },
    async set(items) {
      // Copie JSON, comme chrome.storage : pas de référence partagée avec l'appelant.
      const entries = Object.entries(items).filter(([, v]) => v !== undefined);
      await transaction('readwrite', (store) => entries.forEach(([k, v]) => store.put(JSON.parse(JSON.stringify(v)), k)));
      emitChanges(entries.map(([k]) => k), 'local');
    },
    async remove(keys) {
      const list = keysOf(keys) || [];
      await transaction('readwrite', (store) => list.forEach((k) => store.delete(k)));
      emitChanges(list, 'local');
    },
  };

  // ─── chrome.storage.session : sessionStorage, en mémoire s'il est plein ───

  const memory = new Map();
  const PREFIX = 'immodex:';
  const session = {
    async get(keys) {
      const list = keysOf(keys) || [...memory.keys(), ...Object.keys(sessionStorage).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length))];
      const result = defaultsOf(keys);
      for (const k of list) {
        if (memory.has(k)) result[k] = memory.get(k);
        else {
          const raw = sessionStorage.getItem(PREFIX + k);
          if (raw != null) result[k] = JSON.parse(raw);
        }
      }
      return result;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) {
        try {
          sessionStorage.setItem(PREFIX + k, JSON.stringify(v));
          memory.delete(k);
        } catch {
          memory.set(k, JSON.parse(JSON.stringify(v)));
        }
      }
    },
    async remove(keys) {
      for (const k of keysOf(keys) || []) {
        sessionStorage.removeItem(PREFIX + k);
        memory.delete(k);
      }
    },
  };

  // ─── chrome.runtime : messages traités par la logique du service worker ───

  const messageListeners = [];
  let background = null;
  function loadBackground() {
    if (!background) background = import('/src/background/service-worker.js');
    return background;
  }

  async function sendMessage(message) {
    await loadBackground();
    return new Promise((resolve) => {
      let done = false;
      const sendResponse = (response) => {
        if (done) return;
        done = true;
        resolve(response);
      };
      let pending = false;
      for (const fn of messageListeners) if (fn(message, {}, sendResponse) === true) pending = true;
      if (!pending) sendResponse(undefined);
    });
  }

  // ─── Alarmes : un minuteur tant que la page est ouverte ───

  const alarms = new Map();
  const alarmListeners = [];

  const unavailable = () => Promise.reject(new Error("indisponible dans l'appli téléphone"));
  const event = (list) => ({ addListener: (fn) => list.push(fn) });
  const api = {
    storage: { local, session, onChanged: event(changeListeners) },
    runtime: {
      id: 'immodex-web',
      getURL: (path) => new URL(`/${String(path).replace(/^\//, '')}`, location.origin).href,
      getManifest: () => ({ version, content_scripts: [] }),
      sendMessage,
      onMessage: event(messageListeners),
      onStartup: event([]),
      onInstalled: event([]),
    },
    alarms: {
      get: async (name) => (alarms.has(name) ? { name } : undefined),
      async create(name, info) {
        clearInterval(alarms.get(name));
        const period = Math.max(1, (info && info.periodInMinutes) || 1) * 60 * 1000;
        alarms.set(name, setInterval(() => alarmListeners.forEach((fn) => fn({ name })), period));
      },
      onAlarm: event(alarmListeners),
    },
    // Une page de l'extension qui s'ouvre dans un nouvel onglet s'ouvre ici à la place.
    tabs: {
      query: async () => [],
      create: async ({ url }) => {
        location.href = url;
      },
      update: async () => {},
    },
    action: { openPopup: unavailable },
    scripting: { executeScript: unavailable, getRegisteredContentScripts: async () => [], registerContentScripts: unavailable, unregisterContentScripts: async () => {} },
    permissions: { request: async () => false, remove: async () => false, contains: async () => false },
  };
  try {
    window.chrome = api;
  } catch {
    // rien : defineProperty ci-dessous
  }
  if (window.chrome !== api) Object.defineProperty(window, 'chrome', { value: api, configurable: true, writable: true });

  // ─── Appli : installation, appairage, synchro à l'ouverture ───

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  function toast(text, action) {
    const old = document.querySelector('.imx-web-toast');
    if (old) old.remove();
    const box = document.createElement('div');
    box.className = 'imx-web-toast';
    box.setAttribute('role', 'status');
    box.append(text);
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = action.label;
      btn.addEventListener('click', action.run);
      box.append(btn);
    }
    document.body.append(box);
    if (!action) setTimeout(() => box.remove(), 4000);
  }

  const reload = { label: 'Actualiser', run: () => location.reload() };

  async function syncNow(minAgeMs) {
    const res = await sendMessage({ type: 'SYNC_NOW', minAgeMs });
    if (res && res.ok && res.result && res.result.applied) toast("Nouvelles données de l'ordinateur.", reload);
  }

  // Lien d'appairage (QR code de l'extension) : …/#k=<clé>. La clé est rangée puis retirée
  // de l'adresse, pour ne pas rester dans l'historique du navigateur.
  async function pairFromHash() {
    const m = location.hash.match(/(?:^#|&)k=([A-Za-z0-9_-]{32,128})(?:&|$)/);
    if (!m) return false;
    history.replaceState(null, '', location.pathname + location.search);
    toast('Téléphone relié, réception des données…');
    const res = await sendMessage({ type: 'SYNC_ENABLE', key: m[1] });
    if (!res || !res.ok) toast(`Appairage impossible : ${(res && res.error) || 'erreur inconnue'}.`);
    else if (res.result && res.result.ok === false) toast(`Synchro impossible : ${res.result.error}.`);
    else location.reload();
    return true;
  }

  function addBackLink() {
    // Tableau de bord : retour à l'écran de recherche (dans l'extension, il s'ouvre dans un onglet à part).
    const header = document.querySelector('.imx-dash .imx-popup-header');
    if (!header) return;
    const back = document.createElement('a');
    back.className = 'imx-btn imx-btn-sm imx-web-back';
    back.href = '/src/popup/popup.html';
    back.textContent = '‹ Recherche';
    header.prepend(back);
  }

  function start() {
    addBackLink();
    loadBackground()
      .then(() => pairFromHash())
      .then((paired) => paired || syncNow(15 * 1000))
      .catch((e) => console.error('[immodex]', e));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncNow(30 * 1000).catch(() => {});
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
