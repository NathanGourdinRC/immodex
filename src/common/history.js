// Historique des recherches : chaque recherche réussie est gardée 7 jours dans
// chrome.storage.local, pour retrouver la liste des adresses candidates après
// avoir fermé le popup, changé d'onglet ou rechargé l'annonce.

const HISTORY_KEY = 'immodex.history.v1';
const HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_MAX = 50;

// Paramètres de suivi publicitaire : ils changent d'une visite à l'autre sans
// changer l'annonce, on les retire pour reconnaître la même page.
const TRACKING_PARAMS = /^(utm_|gclid$|fbclid$|msclkid$|xtor$|at_|mc_)/i;

function normalizePageUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function siteLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// On ne garde que ce qui sert à réafficher les candidats : la fiche ADEME
// complète (`raw`) et la géométrie des parcelles pèsent lourd et ne sont pas affichées.
function slimCandidate(candidate) {
  const out = { score: candidate.score, reasons: candidate.reasons || [], diffs: candidate.diffs || [] };
  if (candidate.record) {
    const { raw, ...record } = candidate.record;
    out.record = record;
  }
  if (candidate.parcel) {
    const { geometry, ...parcel } = candidate.parcel;
    out.parcel = parcel;
  }
  return out;
}

function slimResult(result) {
  if (!result || typeof result !== 'object') return null;
  return {
    kind: result.kind || 'dpe',
    candidates: Array.isArray(result.candidates) ? result.candidates.map(slimCandidate) : [],
    dataset: result.dataset ?? null,
    tier: result.tier ?? null,
    total: result.total ?? null,
    highConfidence: !!result.highConfidence,
  };
}

function pruneEntries(entries, now = Date.now()) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e) => e && typeof e.createdAt === 'number' && now - e.createdAt < HISTORY_TTL_MS)
    .slice(0, HISTORY_MAX);
}

// Une même annonce cherchée avec les mêmes critères remplace l'entrée précédente
// (remontée en tête) au lieu de créer un doublon.
function upsertEntry(entries, entry, now = Date.now()) {
  const rest = (entries || []).filter((e) => e && e.key !== entry.key);
  return pruneEntries([entry, ...rest], now);
}

function makeId(now) {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildEntry({ payloadKey, payload, result, page }, now = Date.now()) {
  const url = normalizePageUrl(page && page.url);
  return {
    id: makeId(now),
    key: `${url || 'manuel'}#${payloadKey}`,
    createdAt: now,
    kind: payload.kind === 'land' ? 'land' : 'dpe',
    payload,
    result: slimResult(result),
    page: url ? { url, title: (page.title || '').slice(0, 200), site: siteLabel(url) } : null,
  };
}

function createHistoryStore(storageArea) {
  // Les écritures sont mises en file : deux recherches qui finissent en même
  // temps ne doivent pas s'écraser l'une l'autre.
  let queue = Promise.resolve();

  async function read() {
    try {
      const stored = await storageArea.get(HISTORY_KEY);
      return pruneEntries(stored[HISTORY_KEY]);
    } catch {
      return [];
    }
  }

  function write(mutator) {
    const run = queue.then(async () => {
      const next = mutator(await read());
      await storageArea.set({ [HISTORY_KEY]: next });
      return next;
    });
    queue = run.catch(() => {});
    return run;
  }

  return {
    list: read,
    async get(id) {
      return (await read()).find((e) => e.id === id) || null;
    },
    async getForUrl(url) {
      const target = normalizePageUrl(url);
      if (!target) return null;
      return (await read()).find((e) => e.page && e.page.url === target) || null;
    },
    async add(input, now = Date.now()) {
      const entry = buildEntry(input, now);
      await write((entries) => upsertEntry(entries, entry, now));
      return entry;
    },
    remove(id) {
      return write((entries) => entries.filter((e) => e.id !== id));
    },
    clear() {
      return write(() => []);
    },
  };
}

export {
  HISTORY_KEY,
  HISTORY_TTL_MS,
  HISTORY_MAX,
  normalizePageUrl,
  slimResult,
  pruneEntries,
  upsertEntry,
  buildEntry,
  createHistoryStore,
};
