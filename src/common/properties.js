// Suivi des biens : chaque annonce ouverte laisse une « empreinte » du bien (ville,
// surface, DPE, prix…). En comparant les empreintes, Immodex+ repère un même bien
// republié (autre site, autre agence, nouvelle annonce) et l'évolution de son prix.
// Tout reste dans chrome.storage.local, 12 mois au plus.
import { normalizePageUrl } from './history.js';

const SIGHTINGS_KEY = 'immodex.sightings.v1';
const SIGHTINGS_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const SIGHTINGS_MAX = 3000;

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

function sameLocation(a, b) {
  if (a.postal && b.postal) return a.postal === b.postal;
  const x = norm(a.city);
  const y = norm(b.city);
  return !!x && !!y && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `));
}

// Niveau de correspondance entre deux empreintes :
//   'same'     même numéro de DPE ADEME (adresse trouvée avec une confiance élevée) ;
//   'probable' même ville, surface à 1 m² près, mêmes classes et mêmes kWh/kg ;
//   'possible' sans les kWh : surface identique et mêmes classes (à confirmer à l'œil) ;
//   null       biens différents ou trop peu d'informations.
function matchLevel(a, b) {
  if (a.dpeId && b.dpeId) return a.dpeId === b.dpeId ? 'same' : null;
  if ((a.kind || 'dpe') !== (b.kind || 'dpe')) return null;
  if ((a.transaction || 'vente') !== (b.transaction || 'vente')) return null;
  if (!sameLocation(a, b)) return null;
  if (a.surface == null || b.surface == null || Math.abs(a.surface - b.surface) > 1) return null;
  if (a.buildingType && b.buildingType && a.buildingType !== b.buildingType) return null;
  if (a.kind === 'land') return Math.abs(a.surface - b.surface) < 0.5 ? 'possible' : null;
  if (a.energyClass && b.energyClass && a.energyClass !== b.energyClass) return null;
  if (a.gesClass && b.gesClass && a.gesClass !== b.gesClass) return null;
  if (a.energyConsumption != null && b.energyConsumption != null) {
    if (Math.abs(a.energyConsumption - b.energyConsumption) > 1.5) return null;
    if (a.gesEmission != null && b.gesEmission != null && Math.abs(a.gesEmission - b.gesEmission) > 1.5) return null;
    return 'probable';
  }
  if (a.energyClass && b.energyClass && a.gesClass && b.gesClass && Math.abs(a.surface - b.surface) < 0.5) return 'possible';
  return null;
}

const LEVEL_RANK = { same: 0, probable: 1, possible: 2 };

const fingerprintOf = (s) => ({ ...s.fp, dpeId: s.dpeId || null });
const lastPrice = (s) => (s.prices && s.prices.length ? s.prices[s.prices.length - 1].price : null);

function siteLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function pruneSightings(list, now = Date.now()) {
  return (Array.isArray(list) ? list : [])
    .filter((s) => s && typeof s.lastSeen === 'number' && now - s.lastSeen < SIGHTINGS_TTL_MS)
    .sort((x, y) => y.lastSeen - x.lastSeen)
    .slice(0, SIGHTINGS_MAX);
}

// Autres annonces du même bien, de la plus ancienne à la plus récente.
function matchesFor(sighting, all) {
  const fp = fingerprintOf(sighting);
  return all
    .filter((o) => o.url !== sighting.url)
    .map((o) => ({ o, level: matchLevel(fp, fingerprintOf(o)) }))
    .filter((x) => x.level)
    .sort((x, y) => LEVEL_RANK[x.level] - LEVEL_RANK[y.level] || x.o.firstSeen - y.o.firstSeen)
    .map(({ o, level }) => ({
      level,
      url: o.url,
      site: o.site,
      title: o.title,
      firstSeen: o.firstSeen,
      lastSeen: o.lastSeen,
      price: lastPrice(o),
      prices: o.prices || [],
      address: o.address || null,
    }));
}

// Met à jour (ou crée) l'annonce vue à cette adresse : empreinte complétée, date
// de dernière visite, et nouveau prix ajouté à l'historique s'il a changé.
function upsertSighting(list, { url, title, fp, price }, now = Date.now()) {
  const key = normalizePageUrl(url);
  if (!key) return { list, sighting: null };
  const existing = list.find((s) => s.url === key);
  let sighting;
  if (existing) {
    sighting = { ...existing, title: title || existing.title, lastSeen: now, fp: { ...existing.fp } };
    for (const [k, v] of Object.entries(fp || {})) if (v != null && v !== '') sighting.fp[k] = v;
    const prices = [...(existing.prices || [])];
    if (price && price !== lastPrice(existing)) prices.push({ price, at: now });
    sighting.prices = prices;
  } else {
    sighting = { url: key, site: siteLabel(key), title: (title || '').slice(0, 200), fp: { ...fp }, firstSeen: now, lastSeen: now, prices: price ? [{ price, at: now }] : [] };
  }
  const rest = list.filter((s) => s.url !== key);
  return { list: pruneSightings([sighting, ...rest], now), sighting };
}

// Regroupe les annonces d'un même bien (même DPE ou correspondance probable),
// pour l'onglet « Biens » du popup. Comparaison limitée aux annonces d'une même
// ville ou d'un même code postal.
function groupSightings(list) {
  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const buckets = new Map();
  list.forEach((s, i) => {
    const k = `${s.fp.kind || 'dpe'}|${s.fp.transaction || 'vente'}|${s.fp.postal || norm(s.fp.city).split(' ')[0]}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(i);
  });
  const byDpe = new Map();
  list.forEach((s, i) => {
    if (!s.dpeId) return;
    if (byDpe.has(s.dpeId)) parent[find(i)] = find(byDpe.get(s.dpeId));
    else byDpe.set(s.dpeId, i);
  });
  for (const idx of buckets.values()) {
    for (let a = 0; a < idx.length; a++) {
      for (let b = a + 1; b < idx.length; b++) {
        const level = matchLevel(fingerprintOf(list[idx[a]]), fingerprintOf(list[idx[b]]));
        if (level === 'same' || level === 'probable') parent[find(idx[a])] = find(idx[b]);
      }
    }
  }
  const groups = new Map();
  list.forEach((s, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(s);
  });
  return [...groups.values()]
    .map((sightings) => {
      sightings.sort((x, y) => x.firstSeen - y.firstSeen);
      const prices = sightings.flatMap((s) => (s.prices || []).map((p) => ({ ...p, site: s.site }))).sort((x, y) => x.at - y.at);
      return {
        sightings,
        count: sightings.length,
        firstSeen: sightings[0].firstSeen,
        lastSeen: Math.max(...sightings.map((s) => s.lastSeen)),
        firstPrice: prices.length ? prices[0].price : null,
        lastPrice: prices.length ? prices[prices.length - 1].price : null,
        address: (sightings.find((s) => s.address) || {}).address || null,
        fp: sightings[sightings.length - 1].fp,
      };
    })
    .sort((x, y) => y.count - x.count || y.lastSeen - x.lastSeen);
}

function createPropertyStore(storageArea) {
  let queue = Promise.resolve();

  async function read() {
    try {
      const stored = await storageArea.get(SIGHTINGS_KEY);
      return pruneSightings(stored[SIGHTINGS_KEY]);
    } catch {
      return [];
    }
  }

  function write(mutator) {
    const run = queue.then(async () => {
      const { list, value } = mutator(await read());
      await storageArea.set({ [SIGHTINGS_KEY]: list });
      return value;
    });
    queue = run.catch(() => {});
    return run;
  }

  return {
    list: read,
    async groups() {
      return groupSightings(await read());
    },
    record(input, now = Date.now()) {
      return write((list) => {
        const { list: next, sighting } = upsertSighting(list, input, now);
        return { list: next, value: sighting ? { sighting, matches: matchesFor(sighting, next) } : null };
      });
    },
    async get(url) {
      const key = normalizePageUrl(url);
      const list = await read();
      const sighting = list.find((s) => s.url === key);
      return sighting ? { sighting, matches: matchesFor(sighting, list) } : null;
    },
    // Adresse trouvée avec une confiance élevée : le numéro de DPE devient l'identifiant du bien.
    setDpe(url, dpeId, address) {
      const key = normalizePageUrl(url);
      return write((list) => ({
        list: list.map((s) => (s.url === key ? { ...s, dpeId, address: address || s.address || null } : s)),
        value: null,
      }));
    },
    clear() {
      return write(() => ({ list: [], value: null }));
    },
  };
}

export { SIGHTINGS_KEY, SIGHTINGS_TTL_MS, matchLevel, matchesFor, upsertSighting, groupSightings, pruneSightings, createPropertyStore };
