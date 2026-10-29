// Synchronisation entre l'extension Chrome et l'appli téléphone (immodex.vercel.app).
//
// Données synchronisées : zones de recherche, suivi des biens (statut, note), annonces vues
// et recherches récentes. Le reste (caches, badges « nouveau », réglages) reste propre à
// chaque appareil.
//
// Chaque appareil garde une « ombre » : l'empreinte de chaque élément tel qu'il a été
// échangé la dernière fois avec le serveur. Un élément qui diffère de son ombre est envoyé ;
// un élément de l'ombre qui a disparu localement est envoyé comme supprimé. Le serveur garde
// la version la plus récente de chaque élément (voir api/sync.js).
import { SIGHTINGS_KEY, pruneSightings } from './properties.js';
import { ZONES_KEY, TRACKING_KEY, MAX_ZONES } from './zones.js';
import { HISTORY_KEY, pruneEntries } from './history.js';

const SYNC_STATE_KEY = 'immodex.sync.v1';
const SYNC_ORIGIN = 'https://immodex.vercel.app';
const SYNC_ENDPOINT = `${SYNC_ORIGIN}/api/sync`;
const KEY_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const PUSH_BATCH = 150;
// Au-delà, le serveur refuserait l'élément : il reste sur cet appareil.
const MAX_ITEM_CHARS = 90_000;

// JSON aux clés triées : deux copies d'un même objet donnent la même empreinte.
function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stableJson(x))).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

// Empreinte courte (cyrb53, 53 bits) : sert seulement à voir qu'un élément a changé.
function hashOf(data) {
  const str = stableJson(data);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Même annonce vue sur deux appareils : on additionne au lieu de choisir. Historique des
// prix réuni, première et dernière visite extrêmes, empreinte complétée. Le résultat ne
// dépend pas de l'ordre des deux versions, pour que les appareils finissent identiques.
function mergeSighting(a, b) {
  const la = a.lastSeen || 0;
  const lb = b.lastSeen || 0;
  const [newer, older] = la > lb || (la === lb && stableJson(a) >= stableJson(b)) ? [a, b] : [b, a];
  const fp = { ...(older.fp || {}) };
  for (const [k, v] of Object.entries(newer.fp || {})) if (v != null && v !== '') fp[k] = v;
  const seen = new Set();
  const prices = [...(a.prices || []), ...(b.prices || [])]
    .filter((p) => p && p.price != null && !seen.has(`${p.at}|${p.price}`) && seen.add(`${p.at}|${p.price}`))
    .sort((x, y) => (x.at || 0) - (y.at || 0) || x.price - y.price)
    .filter((p, i, list) => i === 0 || p.price !== list[i - 1].price);
  const firsts = [a.firstSeen, b.firstSeen].filter((v) => typeof v === 'number');
  const out = { ...older, ...newer, fp, prices, lastSeen: Math.max(la, lb) };
  if (firsts.length) out.firstSeen = Math.min(...firsts);
  for (const k of ['dpeId', 'address']) {
    const v = newer[k] || older[k];
    if (v) out[k] = v;
  }
  return out;
}

const byNewest = (field) => (a, b) => (b[field] || 0) - (a[field] || 0);
const asArray = (v) => (Array.isArray(v) ? v : []);

// Une collection = une clé de chrome.storage.local, vue comme des éléments « clé → données ».
// `stamp` donne la date de modification locale d'un élément, pour arbitrer un conflit avec
// une version reçue ; `merge` remplace l'arbitrage quand les deux versions s'additionnent.
const COLLECTIONS = {
  zone: {
    storageKey: ZONES_KEY,
    // La dernière visite (badges « nouveau ») reste propre à chaque appareil.
    entries: (stored) => asArray(stored).filter((z) => z && z.id).map(({ lastVisit, ...z }) => [z.id, z]),
    build(map, stored) {
      const visits = new Map(asArray(stored).filter(Boolean).map((z) => [z.id, z.lastVisit || null]));
      return [...map.values()]
        .map((z) => ({ ...z, lastVisit: visits.get(z.id) || null }))
        .sort(byNewest('updatedAt'))
        .slice(0, MAX_ZONES);
    },
    stamp: (z) => z.updatedAt || z.createdAt || 0,
  },
  track: {
    storageKey: TRACKING_KEY,
    entries: (stored) => (stored && typeof stored === 'object' && !Array.isArray(stored) ? Object.entries(stored) : []),
    build: (map) => Object.fromEntries(map),
    stamp: (t) => t.updatedAt || 0,
  },
  sight: {
    storageKey: SIGHTINGS_KEY,
    entries: (stored) => pruneSightings(stored).map((s) => [s.url, s]),
    build: (map) => pruneSightings([...map.values()]),
    stamp: (s) => s.lastSeen || 0,
    merge: mergeSighting,
  },
  search: {
    storageKey: HISTORY_KEY,
    entries: (stored) => pruneEntries(stored).filter((e) => e.key).map((e) => [e.key, e]),
    build: (map) => pruneEntries([...map.values()].sort(byNewest('createdAt'))),
    stamp: (e) => e.createdAt || 0,
  },
};
const SYNCED_STORAGE_KEYS = Object.values(COLLECTIONS).map((c) => c.storageKey);

// Date envoyée avec un élément : celle de sa modification (une note prise hors connexion
// garde l'heure où elle a été écrite), sauf pour les éléments fusionnés, datés de l'envoi.
function pushStamp(item, sentAt) {
  const c = COLLECTIONS[item.kind];
  return c.merge ? sentAt : c.stamp(item.data) || sentAt;
}

function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Lien d'appairage : la clé est après « # », que le navigateur n'envoie jamais au serveur.
const pairUrl = (key) => `${SYNC_ORIGIN}/#k=${key}`;

function keyFromHash(hash) {
  const m = String(hash || '').match(/(?:^#|&)k=([A-Za-z0-9_-]{32,128})(?:&|$)/);
  return m ? m[1] : null;
}

const ERRORS = {
  'bad-key': 'clé de synchro refusée',
  'not-configured': 'serveur pas encore configuré',
  'space-full': 'trop de données à synchroniser',
  'item-too-large': 'élément trop volumineux',
};

function createSync({ storage, endpoint = SYNC_ENDPOINT, fetchImpl = (...args) => fetch(...args), now = () => Date.now() }) {
  let running = null;
  let again = false;

  async function readState() {
    try {
      const state = (await storage.get(SYNC_STATE_KEY))[SYNC_STATE_KEY];
      return state && typeof state === 'object' ? state : {};
    } catch {
      return {};
    }
  }

  async function writeState(patch) {
    const state = { ...(await readState()), ...patch };
    await storage.set({ [SYNC_STATE_KEY]: state });
    return state;
  }

  async function call(key, body) {
    let res;
    try {
      res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('pas de connexion au serveur');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok !== true) throw new Error(ERRORS[data && data.error] || `erreur du serveur (${res.status})`);
    return data;
  }

  async function localItems() {
    const stored = await storage.get(SYNCED_STORAGE_KEYS);
    const items = new Map();
    for (const [kind, c] of Object.entries(COLLECTIONS)) {
      for (const [key, data] of c.entries(stored[c.storageKey])) items.set(`${kind}:${key}`, { kind, key, data });
    }
    return items;
  }

  // Éléments à envoyer : ceux qui diffèrent de l'ombre, plus ceux supprimés depuis.
  function pending(items, shadow) {
    const out = [];
    for (const [id, item] of items) {
      const h = hashOf(item.data);
      if (shadow[id] !== h && stableJson(item.data).length <= MAX_ITEM_CHARS) out.push({ id, h, ...item });
    }
    for (const id of Object.keys(shadow)) {
      if (items.has(id)) continue;
      const cut = id.indexOf(':');
      out.push({ id, kind: id.slice(0, cut), key: id.slice(cut + 1), deleted: true });
    }
    return out;
  }

  // Applique les éléments reçus. L'ombre prend l'empreinte de la version du serveur : si la
  // version locale l'emporte (modifiée ici après l'autre) ou résulte d'une fusion, elle
  // diffère de l'ombre et part au prochain envoi. Renvoie le nombre d'éléments modifiés ici.
  async function applyRemote(remote, shadow) {
    const touched = remote.filter((r) => r && COLLECTIONS[r.kind] && typeof r.key === 'string');
    if (!touched.length) return 0;
    const stored = await storage.get(SYNCED_STORAGE_KEYS);
    const maps = new Map();
    let changed = 0;
    for (const r of touched) {
      const c = COLLECTIONS[r.kind];
      if (!maps.has(r.kind)) maps.set(r.kind, new Map(c.entries(stored[c.storageKey])));
      const map = maps.get(r.kind);
      const id = `${r.kind}:${r.key}`;
      const local = map.get(r.key);
      const unsent = local !== undefined && hashOf(local) !== shadow[id];
      const localWins = unsent && c.stamp(local) > (r.updated_at || 0);
      if (r.deleted) {
        delete shadow[id];
        if (local !== undefined && !localWins) {
          map.delete(r.key);
          changed++;
        }
        continue;
      }
      shadow[id] = hashOf(r.data);
      let next = r.data;
      if (local !== undefined && c.merge) next = c.merge(local, r.data);
      else if (localWins) next = local;
      if (local === undefined || hashOf(next) !== hashOf(local)) {
        map.set(r.key, next);
        changed++;
      }
    }
    if (changed) {
      const patch = {};
      for (const [kind, map] of maps) patch[COLLECTIONS[kind].storageKey] = COLLECTIONS[kind].build(map, stored[COLLECTIONS[kind].storageKey]);
      await storage.set(patch);
    }
    return changed;
  }

  async function run({ minAgeMs = 0, ifLocalChanges = false } = {}) {
    const state = await readState();
    if (!state.key) return { ok: false, paired: false };
    if (minAgeMs && state.lastSync && now() - state.lastSync < minAgeMs) return { ok: true, paired: true, skipped: true, applied: 0, sent: 0 };
    let cursor = state.cursor || 0;
    const shadow = { ...(state.shadow || {}) };
    if (ifLocalChanges && !pending(await localItems(), shadow).length) return { ok: true, paired: true, skipped: true, applied: 0, sent: 0 };
    let applied = 0;
    let sent = 0;

    // Reçoit les pages de changements jusqu'à la dernière. Un serveur dont la révision est
    // derrière la nôtre a été vidé : on repart de zéro et tout sera renvoyé.
    const pullFrom = async (first) => {
      let res = first;
      for (let guard = 0; guard < 200; guard++) {
        if (!res) res = await call(state.key, { since: cursor, items: [] });
        if (res.head < cursor) {
          cursor = 0;
          for (const id of Object.keys(shadow)) delete shadow[id];
          res = null;
          continue;
        }
        applied += await applyRemote(res.items || [], shadow);
        cursor = res.rev;
        await writeState({ cursor, shadow });
        if (!res.more) return;
        res = null;
      }
    };

    try {
      // 1. D'abord recevoir : un appareil qui arrive récupère les données des autres avant d'envoyer les siennes.
      await pullFrom(null);
      // 2. Puis envoyer ce qui a changé ici, par lots.
      const changes = pending(await localItems(), shadow);
      for (let i = 0; i < changes.length; i += PUSH_BATCH) {
        const batch = changes.slice(i, i + PUSH_BATCH);
        const stamp = now();
        const items = batch.map((c) => (c.deleted ? { kind: c.kind, key: c.key, deleted: true, updated_at: stamp } : { kind: c.kind, key: c.key, data: c.data, updated_at: pushStamp(c, stamp) }));
        const res = await call(state.key, { since: cursor, items });
        for (const c of batch) {
          if (c.deleted) delete shadow[c.id];
          else shadow[c.id] = c.h;
        }
        sent += batch.length;
        await pullFrom(res);
      }
      await writeState({ lastSync: now(), lastError: null });
      return { ok: true, paired: true, applied, sent };
    } catch (err) {
      const message = String((err && err.message) || err);
      await writeState({ cursor, shadow, lastError: message, lastErrorAt: now() }).catch(() => {});
      return { ok: false, paired: true, applied, sent, error: message };
    }
  }

  // Une seule synchro à la fois ; une demande arrivée pendant ce temps en relance une à la fin.
  function sync(options) {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      let result = await run(options);
      while (again) {
        again = false;
        result = await run();
      }
      return result;
    })().finally(() => {
      running = null;
    });
    return running;
  }

  async function status() {
    const s = await readState();
    return { paired: !!s.key, lastSync: s.lastSync || null, lastError: s.lastError || null, pairUrl: s.key ? pairUrl(s.key) : null };
  }

  // Sans clé : nouvel espace (l'extension). Avec une clé : rejoindre l'espace (le téléphone).
  async function enable(key = newKey()) {
    if (!KEY_PATTERN.test(key)) throw new Error('clé de synchro invalide');
    const state = await readState();
    if (state.key !== key) await storage.set({ [SYNC_STATE_KEY]: { key, cursor: 0, shadow: {}, pairedAt: now(), lastSync: null, lastError: null } });
    return status();
  }

  // Arrête la synchro sur cet appareil ; ses données locales restent.
  async function disable() {
    await storage.set({ [SYNC_STATE_KEY]: {} });
    return status();
  }

  return { sync, status, enable, disable };
}

export {
  SYNC_STATE_KEY,
  SYNC_ORIGIN,
  SYNC_ENDPOINT,
  SYNCED_STORAGE_KEYS,
  COLLECTIONS,
  stableJson,
  hashOf,
  mergeSighting,
  newKey,
  pairUrl,
  keyFromHash,
  createSync,
};
