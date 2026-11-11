// Annonces scannées par le robot (api/scan.js), servies par api/listings.js : lecture, regroupement
// des annonces d'un même bien publiées par plusieurs sources, et statut pour le Fil.

const LISTINGS_ENDPOINT = 'https://immodex.vercel.app/api/listings';
// Noms des sources du scan (api/_lib/sources.js, côté serveur seulement).
const SOURCE_LABELS = { leboncoin: 'Leboncoin', pap: 'PAP', bienici: 'Bien’ici', seloger: 'SeLoger', superimmo: 'Superimmo', cledunord: 'Clé du Nord', hoste: 'Hoste Immobilier', agencedecroix: 'L’Agence de Croix', sothebys: 'Nathalie Forest Sotheby’s', espacesatypiques: 'Espaces Atypiques Lille', missimmo: 'Miss Immo', mav: 'MAV Immobilier', pierresdunord: 'Le 12 Immobilier', lelion: 'Le Lion Immobilier', croiximmo: 'Croix Immobilier', norestim: 'Norestim', cityimmo: 'City Immo', immocarre: 'Immocarré', logehome: 'Logéhome', vendome: 'Vendôme Immobilier', metropolimmo: 'Métropol’Immo', hemimmo: 'Hem Immobilier', drtimmo: 'De Rycker Transaction', choquet: 'Cabinet Choquet', audrey: 'Audrey Immobilier', impact: 'Impact Immobilier', orpi: 'Orpi', paruvendu: 'ParuVendu', lesiteimmo: 'Lesiteimmo', maes: 'Maes Immobilier', deleu: 'Deleu Immobilier', compimmo: 'Compagnie Immobilière du Lac', proprietesdulac: 'Propriétés du Lac', leduc: 'Leduc Immobilier', vereecke: 'Vereecke Immobilier', briquerouge: 'Brique Rouge Immobilier', grimmelpont: 'Grimmelpont', marquetteimmo: 'Marquette Immobilier', century21: 'Century 21', laforet: 'Laforêt', iad: 'IAD', safti: 'SAFTI', nestenn: 'Nestenn', fnaim: 'FNAIM', citya: 'Citya', imko: 'Imko', immomarcq: 'Immobilière de Marcq', heron: 'Héron Immobilier', alerteimmo: 'Alerte Immobilier', cestpourtonbien: 'C’est pour ton bien', bhimmo: 'B&H Immobilier', vastimmo: 'Vastimmo', immotram: 'Immotram', avenueimmo: 'Avenue Immobilier Métropole', brice: 'Brice Habitat', actionimmo: 'Action Immobilier', pepites: 'Les Nouvelles Pépites', kw: 'KW Keller Williams', duquesnoy: 'Duquesnoy Immobilier', estime: 'Estime', duparque: 'Valérie Duparque Immobilier', rdimmo: 'RD Immo', immonot: 'Immonot (notaires)', vacossin: 'Vacossin & Associés (notaires)', lekieffre: 'Guillaume Lekieffre Immobilier', arthurimmo: 'Arthurimmo', barnes: 'Barnes Lille', bonte: 'Bonte Immobilier', drhouse: 'Dr House Immo', immosens: 'Immosens', demarez: 'De Marez Immobilier', abrinor: 'Abrinor', pulp: 'Pulp Immobilier', agencelamadeleine: 'Agence de La Madeleine', lecoutre: 'Lecoutre Immobilier', ericfranques: 'Éric Franques Immobilier', immoclef: 'Immoclef', saintmaur: 'L’Agence Saint Maur', grimonprez: 'Grimonprez Immo' };
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

// Deux valeurs connues des deux côtés et différentes (une valeur absente ne contredit rien).
const differs = (x, y, tolerance = 0) => x != null && y != null && Math.abs(x - y) > tolerance;

// Preuve que ce sont deux biens : un détail connu des deux annonces et incompatible. Les
// annonces d'un même bien disent la même chose sur les chambres, les pièces et le terrain ;
// deux maisons voisines de même surface et de prix proche, non.
function contradicts(a, b) {
  if (a.insee !== b.insee) return true;
  if (a.type && b.type && a.type !== b.type) return true;
  if (differs(a.surface, b.surface, 1)) return true;
  if (differs(a.chambres, b.chambres) || differs(a.pieces, b.pieces)) return true;
  // Le terrain est arrondi ou mal lu selon les sites : 10 % de marge.
  if (a.terrain != null && b.terrain != null && differs(a.terrain, b.terrain, 0.1 * Math.max(a.terrain, b.terrain))) return true;
  // Une lettre de DPE connue des deux côtés et différente (E d'un côté, C de l'autre) : deux biens.
  if (a.energyClass && b.energyClass && a.energyClass !== b.energyClass) return true;
  return false;
}

// Détails qui, connus des deux annonces et identiques, rapprochent deux annonces (l'inverse de
// `contradicts`). Sert à choisir le bon groupe quand plusieurs conviennent.
function agreements(a, b) {
  let n = 0;
  if (a.terrain != null && b.terrain != null && !differs(a.terrain, b.terrain, 0.1 * Math.max(a.terrain, b.terrain))) n++;
  for (const f of ['energyClass', 'pieces', 'chambres']) if (a[f] != null && a[f] !== '' && a[f] === b[f]) n++;
  if (a.price && a.price === b.price) n++;
  return n;
}

// Nombre de détails que l'annonce renseigne : plus il est grand, plus elle ancre son groupe.
const richness = (l) => ['terrain', 'energyClass', 'pieces', 'chambres'].filter((f) => l[f] != null && l[f] !== '').length;

// Même bien : mêmes valeurs de DPE et surface à 1 m² près (sûr), ou à défaut même commune,
// même type, surface à 1 m² près et prix à 5 % près, sans aucun détail qui les contredise
// (probable).
function sameProperty(a, b) {
  if (a.insee !== b.insee) return null;
  if (a.energyConsumption != null && b.energyConsumption != null) {
    return a.energyConsumption === b.energyConsumption && a.gesEmission === b.gesEmission && close(a.surface, b.surface, 1) ? 'sure' : null;
  }
  if (a.type === b.type && close(a.surface, b.surface, 1) && a.price && b.price && Math.abs(a.price - b.price) <= 0.05 * Math.max(a.price, b.price) && !contradicts(a, b)) return 'probable';
  return null;
}

// `l` peut rejoindre le groupe `g` s'il ne contredit aucun de ses membres : sans cela, une
// annonce sans DPE (qui ressemble à deux biens voisins) relierait tout un bien à l'autre.
// Un membre relié à `l` par le DPE reste sûr ; pour les autres, pas de détail contraire, et pas
// deux annonces en ligne de la même source (une source publie un bien une fois, une annonce
// retirée puis republiée reste reliée).
function fitsGroup(l, g) {
  return g.listings.every((m) => {
    if (sameProperty(l, m) === 'sure') return true;
    if (l.energyConsumption != null && m.energyConsumption != null) return false;
    if (contradicts(l, m)) return false;
    // Le prix doit rester à 5 % de chaque membre, pas seulement du voisin (sinon 420 k€ → 400 k€ → 389 k€ s'enchaînent).
    if (l.price && m.price && Math.abs(l.price - m.price) > 0.05 * Math.max(l.price, m.price)) return false;
    return !(l.source === m.source && !l.removedAt && !m.removedAt);
  });
}

function groupListings(listings) {
  const groups = [];
  // Ordre de traitement fixe, jamais celui d'arrivée (la base n'en garantit aucun : selon lui, une
  // annonce pauvre en détails prenait la place de la bonne et laissait celle-ci seule, ou réunissait
  // deux maisons jumelles). D'abord les annonces avec DPE, qui forment des groupes solides ; puis
  // les plus riches en détails (terrain, classe, pièces, chambres) ; à égalité la plus ancienne.
  const ordered = [...listings].sort(
    (a, b) => (b.energyConsumption != null) - (a.energyConsumption != null) || richness(b) - richness(a) || a.firstSeen - b.firstSeen || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)
  );
  for (const l of ordered) {
    // Meilleur groupe : celui qui partage le DPE de l'annonce (sûr) avant un simple air de
    // ressemblance (probable), puis celui où le plus de détails concordent, à égalité le premier posé.
    let target = null;
    for (const g of groups) {
      if (!fitsGroup(l, g)) continue;
      const levels = g.listings.map((other) => sameProperty(l, other));
      const how = levels.includes('sure') ? 'sure' : levels.includes('probable') ? 'probable' : null;
      if (!how) continue;
      const affinity = Math.max(...g.listings.map((other) => agreements(l, other)));
      if (!target || (how === 'sure' && target.how === 'probable') || (how === target.how && affinity > target.affinity)) target = { g, how, affinity };
    }
    if (target) {
      target.g.listings.push(l);
      if (target.how === 'probable') target.g.probable = true;
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
    // Aucune page d'annonce lue par le robot : surface et chambres inconnues, le bien
    // passerait tous les critères. Il attend la lecture (commune ajoutée à une recherche).
    unread: g.listings.every((l) => !l.detail),
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

// Bien sans adresse à qui il manque un critère demandé par la recherche (`unknown` de
// checkCriteria) : masqué du Fil, un bouton le remontre. Rien n'est effacé, et un bien que
// Nathan a gardé ou annoté reste à sa place ; écarté, il suit le bouton des écartées.
function isIncomplete(f, track, unknown) {
  if (!unknown.length || placeOf(f, track)) return false;
  return !(track && (track.status || track.note));
}

function statusOf(g, previousVisit, now = Date.now()) {
  if (g.listings.every((l) => l.removedAt)) return { status: 'retire' };
  let drop = 0;
  for (const l of g.listings) {
    const p = l.prices || [];
    if (!l.removedAt && p.length >= 2 && p[p.length - 1].price < p[p.length - 2].price) drop = Math.max(drop, p[p.length - 2].price - p[p.length - 1].price);
  }
  if (drop) return { status: 'baisse', drop };
  const seen = robotSeenAt(g);
  if (previousVisit ? seen > previousVisit : now - seen < FRESH_MS) return { status: 'nouveau' };
  return { status: null };
}

// Un bien entre dans le Fil quand le robot lit une de ses pages : sa date d'arrivée est cette
// lecture (readAt manque pour les pages lues avant le 04/11/2026 : leur première vue suffit).
function robotSeenAt(g) {
  const read = g.listings.filter((l) => l.detail).map((l) => l.readAt || l.firstSeen);
  return Math.min(...(read.length ? read : g.listings.map((l) => l.firstSeen)));
}

// Annonces apportées par le robot depuis cette date : en jaune tant que Nathan ne les a pas
// ouvertes (clic sur la carte du Fil ou sur le point). Les plus anciennes ne le sont jamais.
const UNOPENED_SINCE = Date.UTC(2026, 10, 4);

// Annonce du robot pas encore ouverte : arrivée après UNOPENED_SINCE, toujours en ligne, jamais
// cliquée (`track.opened`), ni déjà vue par Nathan sur le site de l'annonce (`seenUrls`).
function isUnopened(g, track, { since = UNOPENED_SINCE, seenUrls = null } = {}) {
  if (g.listings.every((l) => l.removedAt)) return false;
  if (track && track.opened) return false;
  if (seenUrls && g.listings.some((l) => seenUrls.has(urlKey(l.url)))) return false;
  return robotSeenAt(g) >= since;
}

// Adresse d'annonce comparable d'un site à l'autre de l'appli : origine et chemin, sans paramètres.
function urlKey(url) {
  try {
    const u = new URL(url);
    // « detail.php?item=413 » : le bien n'est reconnu que par ce paramètre.
    return `${u.origin}${u.pathname}${/\/detail\.php$/.test(u.pathname) ? u.search : ''}`;
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
  // Un verdict (écarté, gardé…) passe avant un simple « ouvert » ou une note posés sur une autre
  // annonce du même bien : sans cela, un bien écarté revenait comme non écarté.
  return candidates.find((k) => tracking[k] && tracking[k].status) || candidates.find((k) => tracking[k]) || g.key;
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

export { LISTINGS_ENDPOINT, SOURCE_LABELS, UNOPENED_SINCE, addressKey, placeOf, needsPlace, isIncomplete, urlKey, trackingKeyOf, saleOf, negotiation, negotiationText, shortPrice, fetchListings, groupListings, listingFacts, statusOf, robotSeenAt, isUnopened, sameProperty };
