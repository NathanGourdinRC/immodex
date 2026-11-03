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

const intOrNull = (v) => {
  const n = numberOrNull(v);
  return n == null ? null : Math.round(n) || null;
};

// Minimum et maximum remis dans l'ordre (saisie inversée).
function ordered(min, max) {
  return min && max && min > max ? [max, min] : [min, max];
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
  const [surfaceMin, surfaceMax] = ordered(numberOrNull(input.surfaceMin), numberOrNull(input.surfaceMax));
  const [budgetMin, budgetMax] = ordered(numberOrNull(input.budgetMin), numberOrNull(input.budgetMax));
  const [terrainMin, terrainMax] = ordered(numberOrNull(input.terrainMin), numberOrNull(input.terrainMax));
  const name = String(input.name || '').trim() || communes.map((c) => c.nom).join(', ') || 'Ma zone';
  return {
    id: input.id || newId(now),
    name: name.slice(0, 80),
    communes: communes.slice(0, MAX_COMMUNES),
    type: input.type === 'maison' || input.type === 'appartement' ? input.type : null,
    surfaceMin,
    surfaceMax,
    budgetMin,
    budgetMax,
    terrainMin,
    terrainMax,
    piecesMin: intOrNull(input.piecesMin),
    chambresMin: intOrNull(input.chambresMin),
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

// Une annonce passe-t-elle les critères chiffrés de la recherche ? Le budget est strict, la
// surface habitable garde la marge de 3 m² de fpInZone. Une information absente de l'annonce
// n'exclut rien : elle est signalée (« terrain non précisé »), seulement si la recherche la demande.
const CRITERIA = [
  { field: 'price', min: 'budgetMin', max: 'budgetMax', margin: 0, unknown: 'prix non précisé' },
  { field: 'surface', min: 'surfaceMin', max: 'surfaceMax', margin: 3, unknown: 'surface non précisée' },
  { field: 'terrain', min: 'terrainMin', max: 'terrainMax', margin: 0, unknown: 'terrain non précisé' },
  { field: 'pieces', min: 'piecesMin', max: null, margin: 0, unknown: 'pièces non précisées' },
  { field: 'chambres', min: 'chambresMin', max: null, margin: 0, unknown: 'chambres non précisées' },
];

function checkCriteria(listing, search) {
  const unknown = [];
  let ok = true;
  // Code postal lu sur la page d'une autre commune : certains sites mêlent les communes voisines.
  const postals = new Set(((search && search.communes) || []).flatMap((c) => c.codesPostaux || []));
  if (listing && listing.postal && postals.size && !postals.has(String(listing.postal))) ok = false;
  for (const c of CRITERIA) {
    const min = search[c.min] || null;
    const max = c.max ? search[c.max] || null : null;
    if (!min && !max) continue;
    const v = listing ? listing[c.field] : null;
    if (v == null) {
      unknown.push(c.unknown);
      continue;
    }
    if ((min && v < min - c.margin) || (max && v > max + c.margin)) ok = false;
  }
  return { ok, unknown };
}

// Groupes du suivi des biens (un groupe = un bien, toutes ses annonces) situés dans la zone.
function groupsInZone(groups, zone) {
  return (groups || []).filter((g) => (g.sightings || []).some((s) => fpInZone(s.fp, zone)));
}

// Adresse d'un bien choisie à la main (piste du registre vérifiée sur Street View, ou adresse
// saisie) : coordonnées en France métropolitaine, sinon rien. `{ none: true }` : bien
// introuvable, laissé sans point.
function cleanPlace(place, now) {
  if (!place || typeof place !== 'object') return null;
  if (place.none) return { none: true, at: now };
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  const address = String(place.address || '').trim().slice(0, 200);
  if (!address || !isFinite(lat) || !isFinite(lon) || lat < 41 || lat > 51.5 || lon < -5.5 || lon > 10) return null;
  return { address, lat, lon, by: place.by === 'saisie' ? 'saisie' : 'piste', at: now };
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
    setTracking(url, { status, note, place }, now = Date.now()) {
      return write(TRACKING_KEY, {}, (data) => {
        const all = { ...(data || {}) };
        const current = all[url] || {};
        const next = {
          status: status !== undefined ? (STATUSES[status] ? status : null) : current.status || null,
          note: note !== undefined ? String(note || '').slice(0, 1000) : current.note || '',
        };
        const kept = place !== undefined ? cleanPlace(place, now) : current.place || null;
        if (kept) next.place = kept;
        next.updatedAt = now;
        if (!next.status && !next.note && !next.place) delete all[url];
        else all[url] = next;
        return { data: all, value: all[url] || null };
      });
    },
  };
}

export { ZONES_KEY, TRACKING_KEY, MAX_ZONES, STATUSES, cleanZone, checkCriteria, fpInZone, groupsInZone, trackingKey, createZoneStore };
