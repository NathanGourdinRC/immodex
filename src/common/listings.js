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

// Adresse comparable : sans accents, sans majuscules, espaces réduits.
const addressKey = (a) =>
  String(a || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

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
  const facts = Object.fromEntries(fields.map((f) => [f, first(g, f)]));
  return {
    ...facts,
    price: prices.length ? Math.min(...prices) : null,
    firstSeen: Math.min(...g.listings.map((l) => l.firstSeen)),
    removed: g.listings.every((l) => l.removedAt),
    hasDpe: g.listings.some((l) => l.energyConsumption != null || l.energyClass),
    leads: facts.address ? null : leadsOfGroup(g),
    // Annonce lue, avec un DPE, pas encore cherchée par la recherche d'adresse actuelle du robot
    // (LOOKUP_VERSION de api/_lib/scan-run.js) : ses pistes arrivent au prochain passage.
    leadsPending: !facts.address && g.listings.some((l) => !l.removedAt && (l.energyConsumption != null || l.energyClass) && (l.lookupVersion || 1) < 2),
  };
}

// Pistes d'adresse du robot (api/_lib/address.js) pour un bien publié sur plusieurs sites :
// une par adresse, avec la meilleure correspondance.
function leadsOfGroup(g) {
  const byAddress = new Map();
  for (const lead of g.listings.flatMap((l) => l.leads || [])) {
    const k = addressKey(lead.address);
    if (!byAddress.has(k) || byAddress.get(k).score < lead.score) byAddress.set(k, lead);
  }
  const leads = [...byAddress.values()].sort((a, b) => b.score - a.score);
  return leads.length ? leads : null;
}

// Point d'un bien sur la carte : l'adresse que Nathan a choisie (piste vérifiée sur Street View
// ou adresse saisie, rangée avec son suivi), sinon celle retrouvée par le robot.
function placeOf(f, track) {
  const p = track && track.place;
  if (p && p.lat != null && p.lon != null) return { address: p.address, lat: p.lat, lon: p.lon, by: p.by };
  if (f.lat != null && f.lon != null) return { address: f.address, lat: f.lat, lon: f.lon, by: 'registre' };
  return null;
}

// Bien encore en vente, ni écarté ni laissé sans point (« introuvable »), et sans point.
function needsPlace(f, track, st) {
  if (st.status === 'retire' || (track && track.status === 'ecarte')) return false;
  if (track && track.place && track.place.none) return false;
  return !placeOf(f, track);
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

// Clé de suivi (statut, note) d'un bien : celle sous laquelle Nathan a déjà posé quelque chose,
// cherchée parmi les adresses de ses annonces et celles des annonces vues du même bien (une
// annonce vue est suivie sous l'adresse de sa première annonce, parfois une autre). Ainsi un
// favori ne disparaît pas quand deux annonces sont réunies, séparées ou lues par le robot.
function trackingKeyOf(g, tracking, seenByUrl = new Map()) {
  const urls = g.listings.map((l) => l.url);
  const candidates = [g.key, ...urls, ...urls.map((u) => seenByUrl.get(urlKey(u))).filter(Boolean)];
  return candidates.find((k) => tracking[k]) || g.key;
}

// Vente DVF reliée à un bien retiré (sûre de préférence), avec l'écart en % entre le premier
// prix relevé (annonce vue la première) et le prix signé. Un bien encore en ligne sur un site
// (annonce revenue, autre agence) n'est pas vendu.
function saleOf(g) {
  if (g.listings.some((l) => !l.removedAt)) return null;
  const withSale = g.listings.filter((l) => l.sale);
  if (!withSale.length) return null;
  const sale = (withSale.find((l) => l.sale.how === 'sure') || withSale[0]).sale;
  const firstListing = [...g.listings].sort((a, b) => a.firstSeen - b.firstSeen)[0];
  const first = firstListing.prices && firstListing.prices[0] ? firstListing.prices[0].price : firstListing.price;
  return { ...sale, margin: first && sale.price ? Math.round((1 - sale.price / first) * 100) : null };
}

// Marge de négociation constatée sur les biens vendus de la recherche (3 ventes reliées au moins).
function negotiation(groups) {
  const sold = groups.map(saleOf).filter((x) => x && x.margin != null);
  if (sold.length < 3) return null;
  const margins = sold.map((x) => x.margin).sort((a, b) => a - b);
  const mid = Math.floor(margins.length / 2);
  const median = margins.length % 2 ? margins[mid] : Math.round((margins[mid - 1] + margins[mid]) / 2);
  return { count: sold.length, median, sure: sold.filter((x) => x.how === 'sure').length };
}

// Prix court des points de la carte, comme sur Airbnb : « 389 k€ », « 1,25 M€ ».
function shortPrice(price) {
  if (!price) return null;
  const k = Math.round(price / 1000);
  if (k < 1000) return `${k} k€`;
  return `${String(Math.round(price / 1e4) / 100).replace('.', ',')} M€`;
}

// Texte de la marge : les liens probables sont dits, et l'écart contient souvent les honoraires
// d'agence (prix affiché honoraires inclus, prix de l'acte hors honoraires à la charge de l'acheteur).
function negotiationText(n) {
  if (!n) return null;
  const probable = n.count - n.sure;
  const plural = (k, word) => `${k} ${word}${k > 1 ? 's' : ''}`;
  const how = !probable ? ', toutes sûres' : !n.sure ? ', toutes probables' : ` : ${plural(n.sure, 'sûre')}, ${plural(probable, 'probable')}`;
  return `Écart médian entre le premier prix relevé et le prix signé : ${n.median} % (${n.count} ventes reliées${how}). Le prix affiché comprend souvent les honoraires d’agence, que le prix de l’acte n’inclut pas.`;
}

export { LISTINGS_ENDPOINT, SOURCE_LABELS, addressKey, placeOf, needsPlace, urlKey, trackingKeyOf, saleOf, negotiation, negotiationText, shortPrice, fetchListings, groupListings, listingFacts, statusOf, sameProperty };
