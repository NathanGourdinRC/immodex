// Zones de recherche du tableau de bord (communes et critères) et suivi personnel des
// annonces vues (statut, note). Tout reste dans chrome.storage.local, sans serveur.

const ZONES_KEY = 'immodex.zones.v1';
const TRACKING_KEY = 'immodex.tracking.v1';
const SEEN_KEY = 'immodex.zone-seen.v1';
const MAX_SEEN = 3000;
const MAX_ZONES = 20;
const MAX_COMMUNES = 30;

const STATUSES = {
  'a-voir': 'À voir',
  favori: 'Favori',
  visite: 'Visité',
  ecarte: 'Écarté',
};

const INSEE = /^(\d{5}|2[AB]\d{3})$/;

function numberOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : null;
}

function newId(now) {
  return `z${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// Zone propre : communes valides et sans doublon, critères numériques, nom par défaut.
function cleanZone(input, now = Date.now()) {
  const seen = new Set();
  const communes = [];
  for (const c of (input && input.communes) || []) {
    if (!c || !INSEE.test(String(c.code)) || seen.has(c.code)) continue;
    seen.add(c.code);
    communes.push({
      code: String(c.code),
      nom: String(c.nom || c.code),
      codesPostaux: Array.isArray(c.codesPostaux) ? c.codesPostaux.map(String) : [],
      centre: c.centre && Array.isArray(c.centre.coordinates) ? { type: 'Point', coordinates: c.centre.coordinates.slice(0, 2).map(Number) } : null,
    });
  }
  let surfaceMin = numberOrNull(input.surfaceMin);
  let surfaceMax = numberOrNull(input.surfaceMax);
  if (surfaceMin && surfaceMax && surfaceMin > surfaceMax) [surfaceMin, surfaceMax] = [surfaceMax, surfaceMin];
  const name = String(input.name || '').trim() || communes.map((c) => c.nom).join(', ') || 'Ma zone';
  return {
    id: input.id || newId(now),
    name: name.slice(0, 80),
    communes: communes.slice(0, MAX_COMMUNES),
    type: input.type === 'maison' || input.type === 'appartement' ? input.type : null,
    surfaceMin,
    surfaceMax,
    createdAt: input.createdAt || now,
    updatedAt: now,
    lastVisit: input.lastVisit || null,
  };
}

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Une annonce vue (empreinte du suivi des biens) est-elle dans la zone et dans ses critères ?
// La surface garde 3 m² de marge : les annonces arrondissent souvent.
function fpInZone(fp, zone) {
  if (!fp || !zone || (fp.kind || 'dpe') !== 'dpe') return false;
  const postals = new Set(zone.communes.flatMap((c) => c.codesPostaux));
  const names = new Set(zone.communes.map((c) => norm(c.nom)));
  const placeOk = fp.postal ? postals.has(String(fp.postal)) : names.has(norm(fp.city));
  if (!placeOk) return false;
  if (zone.type && fp.buildingType && fp.buildingType !== zone.type) return false;
  if (fp.surface != null) {
    if (zone.surfaceMin && fp.surface < zone.surfaceMin - 3) return false;
    if (zone.surfaceMax && fp.surface > zone.surfaceMax + 3) return false;
  }
  return true;
}

// Groupes du suivi des biens (un groupe = un bien, toutes ses annonces) situés dans la zone.
function groupsInZone(groups, zone) {
  return (groups || []).filter((g) => (g.sightings || []).some((s) => fpInZone(s.fp, zone)));
}

// Le suivi (statut, note) est rangé sous l'adresse de la première annonce du bien :
// elle ne change pas quand le bien est republié ailleurs.
const trackingKey = (group) => (group && group.sightings && group.sightings[0] ? group.sightings[0].url : null);

function createZoneStore(storageArea) {
  let queue = Promise.resolve();

  async function readKey(key, fallback) {
    try {
      const stored = await storageArea.get(key);
      return stored[key] ?? fallback;
    } catch {
      return fallback;
    }
  }

  // Écritures en file : deux modifications rapprochées ne s'écrasent pas.
  function write(key, fallback, mutator) {
    const run = queue.then(async () => {
      const { data, value } = mutator(await readKey(key, fallback));
      await storageArea.set({ [key]: data });
      return value;
    });
    queue = run.catch(() => {});
    return run;
  }

  return {
    async list() {
      const zones = await readKey(ZONES_KEY, []);
      return Array.isArray(zones) ? zones : [];
    },
    async get(id) {
      return (await this.list()).find((z) => z.id === id) || null;
    },
    save(input, now = Date.now()) {
      return write(ZONES_KEY, [], (zones) => {
        const list = Array.isArray(zones) ? zones : [];
        const previous = list.find((z) => z.id === input.id);
        const zone = cleanZone({ ...(previous || {}), ...input }, now);
        const rest = list.filter((z) => z.id !== zone.id);
        return { data: [zone, ...rest].slice(0, MAX_ZONES), value: zone };
      });
    },
    remove(id) {
      return write(ZONES_KEY, [], (zones) => ({ data: (zones || []).filter((z) => z.id !== id), value: null }));
    },
    // Renvoie la visite précédente (pour les badges « nouveau ») et enregistre celle-ci.
    markVisited(id, now = Date.now()) {
      return write(ZONES_KEY, [], (zones) => {
        const list = Array.isArray(zones) ? zones : [];
        const zone = list.find((z) => z.id === id);
        const previous = zone ? zone.lastVisit || null : null;
        return { data: list.map((z) => (z.id === id ? { ...z, lastVisit: now } : z)), value: previous };
      });
    },
    // DPE déjà montrés dans la zone : renvoie la liste d'avant (null à la première visite)
    // et y ajoute ceux affichés maintenant. Sert au badge « nouveau ».
    swapSeenDpe(zoneId, ids) {
      return write(SEEN_KEY, {}, (data) => {
        const all = { ...(data || {}) };
        const previous = Array.isArray(all[zoneId]) ? all[zoneId] : null;
        all[zoneId] = [...new Set([...ids, ...(previous || [])])].slice(0, MAX_SEEN);
        return { data: all, value: previous };
      });
    },
    async tracking() {
      const data = await readKey(TRACKING_KEY, {});
      return data && typeof data === 'object' ? data : {};
    },
    setTracking(url, { status, note }, now = Date.now()) {
      return write(TRACKING_KEY, {}, (data) => {
        const all = { ...(data || {}) };
        const current = all[url] || {};
        const next = {
          status: status !== undefined ? (STATUSES[status] ? status : null) : current.status || null,
          note: note !== undefined ? String(note || '').slice(0, 1000) : current.note || '',
          updatedAt: now,
        };
        if (!next.status && !next.note) delete all[url];
        else all[url] = next;
        return { data: all, value: all[url] || null };
      });
    },
  };
}

export { ZONES_KEY, TRACKING_KEY, STATUSES, cleanZone, fpInZone, groupsInZone, trackingKey, createZoneStore };
