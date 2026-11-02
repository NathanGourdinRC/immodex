// Annonces scannées par le robot (api/scan.js), servies par api/listings.js : lecture, regroupement
// des annonces d'un même bien publiées par plusieurs sources, et statut pour le Fil.

const LISTINGS_ENDPOINT = 'https://immodex.vercel.app/api/listings';
// Noms des sources du scan (api/_lib/sources.js, côté serveur seulement).
const SOURCE_LABELS = { orpi: 'Orpi', paruvendu: 'ParuVendu', lesiteimmo: 'Lesiteimmo', maes: 'Maes Immobilier', deleu: 'Deleu Immobilier' };
const DAY = 24 * 3600 * 1000;
const FRESH_MS = 3 * DAY; // première visite : « nouveau » = vu il y a moins de 3 jours

async function fetchListings(codes, { fetchImpl = fetch } = {}) {
  if (!codes.length) return { listings: [], sources: {}, lastRun: null };
  const res = await fetchImpl(`${LISTINGS_ENDPOINT}?insee=${codes.map(encodeURIComponent).join(',')}`);
  if (!res.ok) throw new Error(`listings ${res.status}`);
  return res.json();
}

const close = (a, b, tolerance) => a != null && b != null && Math.abs(a - b) <= tolerance;

// Même bien : mêmes valeurs de DPE et surface à 1 m² près (sûr), ou à défaut même commune,
// même type, surface à 1 m² près et prix à 5 % près (probable).
function sameProperty(a, b) {
  if (a.insee !== b.insee) return null;
  if (a.energyConsumption != null && b.energyConsumption != null) {
    return a.energyConsumption === b.energyConsumption && a.gesEmission === b.gesEmission && close(a.surface, b.surface, 1) ? 'sure' : null;
  }
  if (a.type === b.type && close(a.surface, b.surface, 1) && a.price && b.price && Math.abs(a.price - b.price) <= 0.05 * Math.max(a.price, b.price)) return 'probable';
  return null;
}

function groupListings(listings) {
  const groups = [];
  for (const l of listings) {
    let target = null;
    let how = null;
    for (const g of groups) {
      for (const other of g.listings) {
        const s = sameProperty(l, other);
        if (s) {
          target = g;
          how = s;
          break;
        }
      }
      if (target) break;
    }
    if (target) {
      target.listings.push(l);
      if (how === 'probable') target.probable = true;
    } else groups.push({ listings: [l], probable: false });
  }
  for (const g of groups) {
    g.listings.sort((a, b) => a.firstSeen - b.firstSeen);
    g.key = g.listings[0].url;
  }
  return groups;
}

const first = (g, field) => {
  for (const l of g.listings) if (l[field] != null && l[field] !== '') return l[field];
  return null;
};

// Caractéristiques d'un bien : le prix le plus bas des annonces encore en ligne, le reste
// pris dans la première annonce qui le précise.
function listingFacts(g) {
  const live = g.listings.filter((l) => !l.removedAt);
  const prices = (live.length ? live : g.listings).map((l) => l.price).filter(Boolean);
  const fields = ['type', 'surface', 'pieces', 'chambres', 'terrain', 'garage', 'title', 'photo', 'postal', 'city', 'address', 'lat', 'lon', 'energyClass'];
  return {
    ...Object.fromEntries(fields.map((f) => [f, first(g, f)])),
    price: prices.length ? Math.min(...prices) : null,
    firstSeen: Math.min(...g.listings.map((l) => l.firstSeen)),
    removed: g.listings.every((l) => l.removedAt),
  };
}

function statusOf(g, previousVisit, now = Date.now()) {
  if (g.listings.every((l) => l.removedAt)) return { status: 'retire' };
  let drop = 0;
  for (const l of g.listings) {
    const p = l.prices || [];
    if (!l.removedAt && p.length >= 2 && p[p.length - 1].price < p[p.length - 2].price) drop = Math.max(drop, p[p.length - 2].price - p[p.length - 1].price);
  }
  if (drop) return { status: 'baisse', drop };
  const seen = Math.min(...g.listings.map((l) => l.firstSeen));
  if (previousVisit ? seen > previousVisit : now - seen < FRESH_MS) return { status: 'nouveau' };
  return { status: null };
}

// Adresse d'annonce comparable d'un site à l'autre de l'appli : origine et chemin, sans paramètres.
function urlKey(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return String(url || '');
  }
}

export { LISTINGS_ENDPOINT, SOURCE_LABELS, urlKey, fetchListings, groupListings, listingFacts, statusOf, sameProperty };
