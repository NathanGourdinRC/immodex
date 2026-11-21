// Annonces scannées par le robot (api/scan.js), servies par api/listings.js : lecture, regroupement
// des annonces d'un même bien publiées par plusieurs sources, et statut pour le Fil.

const LISTINGS_ENDPOINT = 'https://immodex.vercel.app/api/listings';
// Noms des sources du scan (api/_lib/sources.js, côté serveur seulement).
const SOURCE_LABELS = { leboncoin: 'Leboncoin', pap: 'PAP', bienici: 'Bien’ici', seloger: 'SeLoger', superimmo: 'Superimmo', cledunord: 'Clé du Nord', hoste: 'Hoste Immobilier', agencedecroix: 'L’Agence de Croix', sothebys: 'Nathalie Forest Sotheby’s', espacesatypiques: 'Espaces Atypiques Lille', missimmo: 'Miss Immo', mav: 'MAV Immobilier', pierresdunord: 'Le 12 Immobilier', lelion: 'Le Lion Immobilier', croiximmo: 'Croix Immobilier', norestim: 'Norestim', cityimmo: 'City Immo', immocarre: 'Immocarré', logehome: 'Logéhome', vendome: 'Vendôme Immobilier', metropolimmo: 'Métropol’Immo', hemimmo: 'Hem Immobilier', drtimmo: 'De Rycker Transaction', choquet: 'Cabinet Choquet', audrey: 'Audrey Immobilier', impact: 'Impact Immobilier', orpi: 'Orpi', paruvendu: 'ParuVendu', lesiteimmo: 'Lesiteimmo', maes: 'Maes Immobilier', deleu: 'Deleu Immobilier', compimmo: 'Compagnie Immobilière du Lac', proprietesdulac: 'Propriétés du Lac', leduc: 'Leduc Immobilier', vereecke: 'Vereecke Immobilier', briquerouge: 'Brique Rouge Immobilier', grimmelpont: 'Grimmelpont', marquetteimmo: 'Marquette Immobilier', century21: 'Century 21', laforet: 'Laforêt', iad: 'IAD', safti: 'SAFTI', nestenn: 'Nestenn', fnaim: 'FNAIM', citya: 'Citya', imko: 'Imko', immomarcq: 'Immobilière de Marcq', heron: 'Héron Immobilier', alerteimmo: 'Alerte Immobilier', cestpourtonbien: 'C’est pour ton bien', bhimmo: 'B&H Immobilier', vastimmo: 'Vastimmo', immotram: 'Immotram', avenueimmo: 'Avenue Immobilier Métropole', brice: 'Brice Habitat', actionimmo: 'Action Immobilier', pepites: 'Les Nouvelles Pépites', kw: 'KW Keller Williams', duquesnoy: 'Duquesnoy Immobilier', estime: 'Estime', duparque: 'Valérie Duparque Immobilier', rdimmo: 'RD Immo', immonot: 'Immonot (notaires)', vacossin: 'Vacossin & Associés (notaires)', lekieffre: 'Guillaume Lekieffre Immobilier', arthurimmo: 'Arthurimmo', barnes: 'Barnes Lille', bonte: 'Bonte Immobilier', drhouse: 'Dr House Immo', immosens: 'Immosens', demarez: 'De Marez Immobilier', abrinor: 'Abrinor', pulp: 'Pulp Immobilier', agencelamadeleine: 'Agence de La Madeleine', lecoutre: 'Lecoutre Immobilier', ericfranques: 'Éric Franques Immobilier', immoclef: 'Immoclef', saintmaur: 'L’Agence Saint Maur', grimonprez: 'Grimonprez Immo' };
const DAY = 24 * 3600 * 1000;
const FRESH_MS = 3 * DAY; // première visite : « nouveau » = vu il y a moins de 3 jours

async function fetchListings(codes, { fetchImpl = fetch } = {}) {
  if (!codes.length) return { listings: [], sources: {}, lastRun: null };
  // `no-store` : jamais la copie gardée par le navigateur (une adresse trouvée à l'instant manquerait).
  const res = await fetchImpl(`${LISTINGS_ENDPOINT}?insee=${codes.map(encodeURIComponent).join(',')}`, { cache: 'no-store' });
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

// Terrain lu sur l'annonce, sauf s'il est manifestement faux : moins de 10 m² (« terrain 1 m² » sur
// Leboncoin, 4 ou 8 m² sur ParuVendu) est une erreur de lecture, pas une cour. Compté comme inconnu :
// il n'exclut plus le bien d'une recherche avec un terrain minimum, et ne coupe plus un bien en deux
// cartes face aux annonces qui donnent le vrai terrain. Les vraies petites cours (18 m²) restent.
const MIN_TERRAIN = 10;
const terrainOf = (l) => (l && l.terrain != null && l.terrain >= MIN_TERRAIN ? l.terrain : null);

const close = (a, b, tolerance) => a != null && b != null && Math.abs(a - b) <= tolerance;

// Deux valeurs connues des deux côtés et différentes (une valeur absente ne contredit rien).
const differs = (x, y, tolerance = 0) => x != null && y != null && Math.abs(x - y) > tolerance;

// Preuve que ce sont deux biens : un détail connu des deux annonces et incompatible. Les
// annonces d'un même bien disent la même chose sur les chambres, les pièces et le terrain ;
// deux maisons voisines de même surface et de prix proche, non.
// `ignore` : détails qui ne sont pas des indices fiables pour ce bien (voir unreliableOf).
const NONE = new Set();
function contradicts(a, b, ignore = NONE) {
  if (a.insee !== b.insee) return true;
  if (a.type && b.type && a.type !== b.type) return true;
  if (differs(a.surface, b.surface, 1)) return true;
  if ((!ignore.has('chambres') && differs(a.chambres, b.chambres)) || (!ignore.has('pieces') && differs(a.pieces, b.pieces))) return true;
  // Le terrain est arrondi ou mal lu selon les sites : 10 % de marge.
  const ta = terrainOf(a);
  const tb = terrainOf(b);
  if (!ignore.has('terrain') && ta != null && tb != null && differs(ta, tb, 0.1 * Math.max(ta, tb))) return true;
  // Une lettre de DPE connue des deux côtés et différente (E d'un côté, C de l'autre) : deux biens.
  if (a.energyClass && b.energyClass && a.energyClass !== b.energyClass) return true;
  return false;
}

// Détails qui, connus des deux annonces et identiques, rapprochent deux annonces (l'inverse de
// `contradicts`). Sert à choisir le bon groupe quand plusieurs conviennent.
function agreements(a, b) {
  let n = 0;
  const ta = terrainOf(a);
  const tb = terrainOf(b);
  if (ta != null && tb != null && !differs(ta, tb, 0.1 * Math.max(ta, tb))) n++;
  for (const f of ['energyClass', 'pieces', 'chambres']) if (a[f] != null && a[f] !== '' && a[f] === b[f]) n++;
  if (a.price && a.price === b.price) n++;
  return n;
}

// Nombre de détails que l'annonce renseigne : plus il est grand, plus elle ancre son groupe.
const richness = (l) => (terrainOf(l) != null ? 1 : 0) + ['energyClass', 'pieces', 'chambres'].filter((f) => l[f] != null && l[f] !== '').length;

// Annonce nue : ni détail ni chiffres de DPE, seulement le prix et la surface (les pages
// Superimmo, qui reprennent les annonces des agences). Elle ne peut ni confirmer ni contredire.
const bare = (l) => richness(l) === 0 && l.energyConsumption == null;

// Deux DPE aux chiffres différents pour un même bien : DPE refait, ou chiffres lus autrement d'un
// site à l'autre (227 puis 194 kWh/m², toujours classe D). Même bien quand tout le reste concorde :
// même prix à l'euro près, même surface, même lettre connue des deux côtés, aucun détail contraire,
// et au moins un détail de plus en commun (pièces, chambres ou terrain). Deux appartements voisins
// au même prix, à la même surface et à la même lettre ont rarement aussi le même nombre de pièces.
function redoneDpe(a, b) {
  if (!a.price || a.price !== b.price || !close(a.surface, b.surface, 1)) return false;
  if (!a.energyClass || a.energyClass !== b.energyClass || contradicts(a, b)) return false;
  // agreements compte déjà le prix et la classe : il en faut un troisième.
  return agreements(a, b) >= 3;
}

// Même bien : mêmes valeurs de DPE et surface à 1 m² près (sûr), ou à défaut même commune,
// même type, surface à 1 m² près et prix à 5 % près, sans aucun détail qui les contredise
// (probable). Deux DPE aux chiffres différents : probable seulement si redoneDpe le permet.
function sameProperty(a, b) {
  if (a.insee !== b.insee) return null;
  // Les deux annonces ont été reliées par le robot au même DPE du registre (`dpeId`, posé avec une
  // adresse sûre) : même logement, même quand le site n'affiche pas les chiffres du DPE (Leboncoin,
  // iad) ou dit 6 pièces quand un autre en dit 5. Sans cela, une maison de Wasquehal se coupait
  // en quatre cartes, trois d'entre elles posées au même point. Surface à 1 m² près, comme pour
  // les chiffres du DPE : un groupe aux surfaces écartées (108 et 105 m²) refuserait ensuite les
  // autres annonces de chacune.
  // Chiffres du DPE affichés des deux côtés : eux seuls décident (même numéro de DPE mais 167 et
  // 169 kWh, 710 000 et 439 000 € : deux biens, ou un DPE mal attribué à l'un des deux).
  if (a.energyConsumption != null && b.energyConsumption != null) {
    if (a.energyConsumption === b.energyConsumption && a.gesEmission === b.gesEmission && close(a.surface, b.surface, 1)) return 'sure';
    return redoneDpe(a, b) ? 'probable' : null;
  }
  if (a.dpeId && a.dpeId === b.dpeId && close(a.surface, b.surface, 1)) return 'sure';
  if (a.type === b.type && close(a.surface, b.surface, 1) && a.price && b.price && Math.abs(a.price - b.price) <= 0.05 * Math.max(a.price, b.price) && !contradicts(a, b)) return 'probable';
  return null;
}

// Détails sur lesquels les membres d'un groupe (réuni par le DPE) sont déjà en désaccord : les sites
// les lisent différemment pour ce bien (terrain de 45 m² pour les uns, 775 m² pour les autres ;
// 5 pièces chez Deleu, 6 chez Citya). Ils ne prouvent plus rien ici, sinon ils refuseraient
// chaque annonce qui ne dit pas comme tous les membres.
function unreliableOf(g) {
  const out = new Set();
  const spread = (values, tolerance) => {
    const v = values.filter((x) => x != null);
    return v.length > 1 && differs(Math.max(...v), Math.min(...v), tolerance(Math.max(...v)));
  };
  if (spread(g.listings.map(terrainOf), (max) => 0.1 * max)) out.add('terrain');
  for (const f of ['pieces', 'chambres']) if (spread(g.listings.map((m) => m[f]), () => 0)) out.add(f);
  return out;
}

// `l` peut rejoindre le groupe `g` s'il ne contredit aucun de ses membres : sans cela, une
// annonce sans DPE (qui ressemble à deux biens voisins) relierait tout un bien à l'autre.
// Un membre relié à `l` par le DPE reste sûr ; pour les autres, pas de détail contraire, et pas
// deux annonces en ligne de la même source (une source publie un bien une fois, une annonce
// retirée puis republiée reste reliée).
function fitsGroup(l, g) {
  const unreliable = unreliableOf(g);
  // Groupe ancré par au moins une annonce détaillée : une annonce nue de la même source qu'un
  // autre membre nu y entre quand même (Superimmo garde en ligne l'ancien prix et le nouveau,
  // 249 000 puis 239 000 €, et une page par agence). Entre annonces nues seules, la règle
  // « une annonce en ligne par source » tient : rien ne prouve qu'il s'agit du même bien.
  const anchored = g.listings.some((m) => !bare(m));
  // Prix comparé aux annonces encore en ligne : une ancienne annonce retirée à 276 000 € ne
  // ferme plus la porte au bien affiché aujourd'hui 260 000 € (sa propre annonce est déjà là).
  const live = g.listings.filter((m) => !m.removedAt);
  const priceRefs = new Set(!l.removedAt && live.length ? live : g.listings);
  return g.listings.every((m) => {
    const how = sameProperty(l, m);
    if (how === 'sure') return true;
    // Deux DPE différents : deux biens, sauf DPE refait ou relu (redoneDpe, alors « probable »).
    if (l.energyConsumption != null && m.energyConsumption != null && !how) return false;
    if (contradicts(l, m, unreliable)) return false;
    // Le prix doit rester à 5 % de chaque membre, pas seulement du voisin (sinon 420 k€ → 400 k€ → 389 k€ s'enchaînent).
    if (priceRefs.has(m) && l.price && m.price && Math.abs(l.price - m.price) > 0.05 * Math.max(l.price, m.price)) return false;
    if (anchored && bare(l) && bare(m)) return true;
    // Membre relié par le robot au DPE du groupe (`dpeId`) : sa présence ne prouve pas que l'annonce
    // est un autre bien (trois annonces Leboncoin d'une même maison à Marquette, celle reliée au DPE
    // dit 2 chambres, les autres 3). Les autres contrôles (détails, prix à 5 %) tiennent toujours.
    if (m.dpeId) return true;
    return !(l.source === m.source && !l.removedAt && !m.removedAt) || twins(l, m);
  });
}

// Annonces jumelles : même surface et, parmi les quatre détails (pièces, chambres, terrain,
// classe), trois identiques sans contradiction ; ou le même prix au euro près et deux détails
// identiques. Une même source en publie deux pour un seul bien (deux agences, republication, prix
// baissé : 365 k€ puis 349 k€) ; sans cela le bien se coupait en deux cartes et l'écartée revenait.
// Le prix à 5 % près est déjà exigé par fitsGroup.
// Annonce nue (Superimmo publie un même bien une fois par agence, sans aucun détail) : le prix à
// l'euro près suffit. Sans cela, une seule de ses annonces rejoignait la carte du bien, les autres
// restaient seules, sans adresse, et revenaient dans le Fil alors que le bien était écarté.
function twins(a, b) {
  if (!close(a.surface, b.surface, 1)) return false;
  const samePrice = !!a.price && a.price === b.price;
  if (samePrice && (bare(a) || bare(b))) return true;
  return agreements(a, b) - (samePrice ? 1 : 0) >= 3 || (samePrice && agreements(a, b) >= 3);
}

function groupListings(listings) {
  const groups = [];
  // Ordre de traitement fixe, jamais celui d'arrivée (la base n'en garantit aucun : selon lui, une
  // annonce pauvre en détails prenait la place de la bonne et laissait celle-ci seule, ou réunissait
  // deux maisons jumelles). D'abord les annonces avec DPE, qui forment des groupes solides ; puis
  // les plus riches en détails (terrain, classe, pièces, chambres) ; à égalité la plus ancienne.
  // Une annonce reliée par le robot à un DPE du registre (`dpeId`) compte comme une annonce avec DPE.
  const solid = (l) => l.energyConsumption != null || !!l.dpeId;
  const ordered = [...listings].sort(
    (a, b) => solid(b) - solid(a) || richness(b) - richness(a) || a.firstSeen - b.firstSeen || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)
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
  // Terrain : celui de la première annonce qui en donne un vrai (terrainOf).
  facts.terrain = g.listings.map(terrainOf).find((t) => t != null) ?? null;
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

// Adresse probable d'un bien sans adresse sûre : la meilleure piste du robot, quand elle est seule
// ou devant les autres, avec ses coordonnées. Le bien a ainsi un point sur la carte (en pointillé,
// à confirmer d'un « C'est ici ») au lieu de rester invisible. Pistes à égalité (quatre maisons de
// 102 m² en D/D, 70 points chacune) : pas de point, il tomberait au hasard sur l'une d'elles.
// « Je ne le trouve pas » (`place.none`) : pas de point non plus.
function probablePlaceOf(f, track) {
  if (placeOf(f, track) || (track && track.place && track.place.none)) return null;
  const [top, second] = f.leads || [];
  if (!top || top.lat == null || top.lon == null) return null;
  if (second && (second.score || 0) >= (top.score || 0)) return null;
  return { address: top.address, lat: top.lat, lon: top.lon, by: 'probable', score: top.score || 0 };
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
// `linked` (linkedKeys) : clés des verdicts qui gardent l'adresse d'une annonce du bien. Un bien
// dont une annonce faisait partie d'une carte écartée reste écarté, même si la carte a été
// coupée depuis et que l'annonce-clé n'en fait plus partie.
function trackingKeyOf(g, tracking, seenByUrl = new Map(), linked = linkedKeys(tracking)) {
  const urls = g.listings.map((l) => l.url);
  const candidates = [g.key, ...urls, ...urls.map((u) => seenByUrl.get(urlKey(u))).filter(Boolean), ...urls.flatMap((u) => linked.get(urlKey(u)) || [])];
  // Un verdict (écarté, gardé…) passe avant un simple « ouvert » ou une note posés sur une autre
  // annonce du même bien : sans cela, un bien écarté revenait comme non écarté. Et si deux annonces
  // du bien portent deux verdicts, « écarté » l'emporte : un bien refusé ne doit pas revenir parce
  // qu'une autre de ses annonces avait été gardée.
  return (
    candidates.find((k) => tracking[k] && tracking[k].status === 'ecarte') ||
    candidates.find((k) => tracking[k] && tracking[k].status) ||
    candidates.find((k) => tracking[k]) ||
    g.key
  );
}

// Index des verdicts par annonce : urlKey → clés des suivis qui ont un verdict et gardent cette
// adresse (champ `urls`, zones.js). À calculer une fois pour tout le Fil.
function linkedKeys(tracking) {
  const out = new Map();
  for (const [key, t] of Object.entries(tracking || {})) {
    if (!t || !t.status || !Array.isArray(t.urls)) continue;
    for (const u of t.urls) out.set(u, [...(out.get(u) || []), key]);
  }
  return out;
}

// Adresses (urlKey) des annonces d'un bien, à garder avec son verdict.
const groupUrls = (g) => [...new Set(g.listings.map((l) => urlKey(l.url)))];

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

export { LISTINGS_ENDPOINT, SOURCE_LABELS, UNOPENED_SINCE, addressKey, placeOf, probablePlaceOf, needsPlace, isIncomplete, urlKey, trackingKeyOf, linkedKeys, groupUrls, saleOf, negotiation, negotiationText, shortPrice, fetchListings, groupListings, listingFacts, statusOf, robotSeenAt, isUnopened, sameProperty };
