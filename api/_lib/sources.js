// Les sources scannées en première version (spec §6.1) et la lecture de leurs pages de
// résultats. Une « carte » est le plus grand bloc de la page qui ne mène qu'à une annonce ;
// son prix est le premier élément dont tout le texte est un prix (le compteur de photos
// collé au prix, chez ParuVendu, est ainsi laissé de côté).
import { parseHtml, priceOf, norm } from './page.js';

const TYPES = ['maison', 'appartement'];

// « Saint-André-lez-Lille » → « saint-andre-lez-lille », comme dans les adresses des sites.
// La ligature « œ » ne se décompose pas comme un accent : « Marcq-en-Barœul » s'écrit
// « marcq-en-baroeul » sur les sites, pas « marcq-en-bar-ul ».
function slugOf(s) {
  return String(s || '')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'Oe')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'Ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const withoutAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Bien plus à vendre : « Vendu », « Maison vendue », « Sous compromis ». Une description peut dire
// « sera vendu avec un garage » ou « vendu occupé » d'un bien à vendre : ces tournures ne comptent pas.
const UNAVAILABLE = /(?<!\b(?:sera|seront|[êe]tre)\s)\bvendue?s?\b(?!\s*\(e\)|\s+(?:occup|lou[ée]|libre|meubl|avec|sans|en\s|par\s|tel\b|telle\b|dans|[ée]quip|cl[ée]|[àa]\s|au\s|aux\s|comme|ou\s))|sous[- ]compromis|plus disponible/i;
// (« \b » ne marche pas devant « à » : JavaScript ne connaît que les lettres sans accent.)
const NEARBY = /(?:^|\s)à\s+[\d.,]+\s*k?m\s+de\s+\d{5}\b/i;

// Commune comparable dans une carte : « ST ANDRE LEZ LILLE » vaut « Saint-André-lez-Lille ».
const placeSlug = (s) => slugOf(s).replace(/(^|-)st(?=-)/g, '$1saint').replace(/(^|-)ste(?=-)/g, '$1sainte');

// Secteurs de la Compagnie Immobilière du Lac (menu « Acheter » de son site, 03/11/2026).
const COMPIMMO_SECTORS = new Set(['annecy', 'argonay', 'doussard', 'duingt', 'entrevernes', 'faverges', 'faverges-seythenex', 'lathuile', 'leschaux', 'saint-jorioz', 'sevrier']);
// Pages de Propriétés du Lac qui ne sont pas des biens (menu et pied de page, 03/11/2026).
const PDL_PAGES = new Set(['nos-biens', 'biens-en-vente', 'biens-vendus', 'agence', 'notre-equipe', 'nos-conseils', 'estimation', 'agence-menthon-saint-bernard', 'coups-de-coeur', 'contact', 'honoraires', 'mentions-legales', 'feed']);

const typesOf = (type) => (type ? [type] : TYPES);
const withParam = (name) => (url, n) => {
  const u = new URL(url);
  u.searchParams.set(name, String(n));
  return u.toString();
};
// Type d'un bien d'agence d'après son adresse et sa carte : appartement, terrain, sinon maison.
const guessType = (text) => (/appartement|\bt[1-6]\b|studio/i.test(text) ? 'appartement' : /terrain/i.test(text) && !/maison/i.test(text) ? 'terrain' : 'maison');

// Sites Netty, gabarit « Modelo » (Imko, Immobilière de Marcq, Héron...) : la page de liste
// n'a aucun lien vers les fiches. Ses biens sont dans un bloc de données codé en base64
// (`_TEMPLATE_DATA = JSON.parse(b64_to_utf8('...'))`) : référence, adresse de la fiche (`url.fr`),
// ville, prix, type et statut (`promo` : 1000 sous compromis, 1001 vendu). Une liste par commune,
// type et code postal (« /vente/maison/villeneuve-d-ascq/59650 »), puis `?page=N`.
const NETTY_STATUS = { 24: 'Sous offre', 1000: 'Sous compromis', 1001: 'Vendu', 1002: 'Loué' };
const NETTY_TYPES = { house: 'Maison', appt: 'Appartement', land: 'Terrain', building: 'Immeuble' };
function nettyCards(html, pageUrl, pageSize, base = '') {
  const items = [];
  let count = null;
  for (const m of String(html).matchAll(/_TEMPLATE_DATA\s*=\s*JSON\.parse\(b64_to_utf8\(['"]([A-Za-z0-9+/=]+)['"]\)\)/g)) {
    let data;
    try {
      data = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
    } catch {
      continue;
    }
    // Seul le bloc des biens porte `prodId` (les autres décrivent le menu, l'agence...).
    if (!data || !data.prodId || typeof data.prodId !== 'object') continue;
    if (Number.isFinite(Number(data.prodCount))) count = Number(data.prodCount);
    for (const [ref, p] of Object.entries(data.prodId)) {
      const slug = p && p.url && (p.url.fr || Object.values(p.url)[0]);
      // Ventes seulement (`type_offer` 1), pas les locations.
      if (!slug || Number(p.type_offer) !== 1) continue;
      let list = [];
      try {
        list = JSON.parse(p.promo_list || '[]');
      } catch {}
      const status = [p.promo, ...(Array.isArray(list) ? list : [])].map((x) => NETTY_STATUS[x]).filter(Boolean).join(' ');
      const title = p.title && typeof p.title === 'object' ? p.title.fr || '' : '';
      const text = `${NETTY_TYPES[p.prod_type] || ''} ${title} ${p.city || ''} ${p.cp || ''} ${status}`;
      items.push({ href: `${base}/vente/${slug},${ref}`, price: Number(p.price2 || p.pricePrimary) || null, text });
    }
  }
  const n = Number(new URL(pageUrl).searchParams.get('page')) || 1;
  return { items, full: items.length >= pageSize && (count == null || n * pageSize < count) };
}
function netty({ id, label, host, base = '', pageSize = 12, departments = ['59'] }) {
  return {
    id,
    label,
    host,
    departments,
    pageSize,
    listUrls: (c, type) => typesOf(type).flatMap((t) => c.codesPostaux.map((cp) => `https://${host}${base}/vente/${t}/${slugOf(c.nom)}/${cp}`)),
    pageUrl: withParam('page'),
    cardsFrom: (html, pageUrl) => nettyCards(html, pageUrl, pageSize, base),
    isListing: (u) => u.pathname.startsWith(`${base}/vente/`) && /^\/vente\/[a-z0-9-]+,[A-Za-z0-9_-]+$/.test(u.pathname.slice(base.length)),
    typeOf: (url, text) => (/^Appartement/.test(text) ? 'appartement' : /^Terrain/.test(text) ? 'terrain' : /^Immeuble/.test(text) ? 'immeuble' : 'maison'),
  };
}

// Sites La Boîte Immo : une liste par commune et par type, la commune repérée par un numéro
// propre à chaque site (« /vente/1-villeneuve-d-ascq/maison/1 », le dernier nombre est la page).
// `cities` : numéro de chaque commune où l'agence a des biens (relevé sur son site).
function boiteImmo({ id, label, host, cities, pageSize = 10 }) {
  return {
    id,
    label,
    host,
    departments: ['59'],
    pageSize,
    listUrls: (c, type) => {
      const slug = slugOf(c.nom);
      return cities[slug] ? typesOf(type).map((t) => `https://${host}/vente/${cities[slug]}-${slug}/${t}/1`) : [];
    },
    pageUrl: (url, n) => url.replace(/\/1$/, `/${n}`),
    isListing: (u) => /^\/vente\/\d+-[a-z0-9-]+\/(maison|appartement|terrain|immeuble)\/.*\d+.*$/.test(u.pathname) && !/\/(maison|appartement|terrain|immeuble)\/\d+\/?$/.test(u.pathname),
    typeOf: (url) => (/\/appartement\//.test(url) ? 'appartement' : /\/terrain\//.test(url) ? 'terrain' : /\/immeuble\//.test(url) ? 'immeuble' : 'maison'),
  };
}

// Sites d'agence 3Clics à fiches « /vente/maison/la-madeleine/annonce-immobiliere-ref3724 »
// (Agence de La Madeleine, Lecoutre, Éric Franques) : la liste complète des ventes (`/vente`,
// pages « /vente/page-2 » quand le site en a plusieurs) est lue une fois pour toutes les
// communes ; la commune et le type sont dans l'adresse de la fiche, « sous compromis » sur la carte.
function troisClics({ id, label, host, pageSize = null }) {
  return {
    id,
    label,
    host,
    departments: ['59'],
    pageSize,
    communeInUrl: true,
    listUrls: () => [`https://${host}/vente`],
    pageUrl: pageSize ? (url, n) => `${url}/page-${n}` : () => null,
    isListing: (u) => /^\/vente\/[a-z-]+\/[a-z0-9-]+\/annonce-immobiliere-[A-Za-z0-9-]+$/.test(u.pathname),
    // Parkings, garages et locaux ne sont pas des logements.
    wanted: (url) => !/\/vente\/(parking|garage|box|local|commerce|bureau|fonds|cave)/.test(url),
    typeOf: (url) => (/\/vente\/(appartement|studio|loft|duplex)\//.test(url) ? 'appartement' : /\/vente\/terrain\//.test(url) ? 'terrain' : /\/vente\/immeuble\//.test(url) ? 'immeuble' : 'maison'),
  };
}

// SeLoger : les données de la page sont dans un bloc JSON (`__UFRN_FETCHER__`) qui donne, pour chaque
// annonce, tout ce que le robot chercherait sur sa fiche : aucune fiche n'est donc demandée.
const SELOGER_TYPES = { HOUSE: 'Maison', APARTMENT: 'Appartement', LAND: 'Terrain' };
function selogerAds(html) {
  const m = String(html).match(/window\["__UFRN_FETCHER__"\]=JSON\.parse\("((?:[^"\\]|\\.)*)"\)/);
  // Page d'une autre forme : erreur, le robot tient alors la liste pour non confirmée.
  if (!m) throw new Error('page SeLoger sans données');
  const ads = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (o.hardFacts && o.url) ads.push(o);
    Object.values(o).forEach(walk);
  };
  walk(JSON.parse(JSON.parse(`"${m[1]}"`)));
  return ads;
}
function selogerCards(html) {
  const items = [];
  for (const ad of selogerAds(html)) {
    const kind = SELOGER_TYPES[ad.rawData && ad.rawData.propertyType];
    if (!kind || ad.status !== 'Published') continue;
    const fact = (type) => {
      const f = (ad.hardFacts.facts || []).find((x) => x.type === type);
      const n = f ? Math.round(Number(String(f.splitValue).replace(/\s/g, '').replace(',', '.'))) : NaN;
      return Number.isFinite(n) ? n : null;
    };
    const place = (ad.location && ad.location.address) || {};
    const images = (ad.gallery && ad.gallery.images) || [];
    const surface = fact('livingSpace');
    items.push({
      href: ad.url,
      price: Number(ad.rawData.price) || null,
      text: `${kind} ${surface ? `${surface} m²` : ''} ${place.city || ''} ${place.zipCode || ''}`,
      detail: {
        surface,
        pieces: fact('numberOfRooms'),
        chambres: fact('numberOfBedrooms'),
        terrain: fact('plotSpace'),
        photo: images[0] ? images[0].url : null,
        postal: place.zipCode || null,
        city: place.city || null,
        energyClass: typeof ad.energyClass === 'string' ? ad.energyClass : null,
      },
    });
  }
  return { items, full: false };
}

// Agences dont la liste n'a pas de pagination lisible (ou interdite par robots.txt) : la liste n'est
// peut-être pas entière, une annonce absente n'est retirée qu'après 3 semaines sans être revue.
const THREE_WEEKS = 21 * 24 * 3600 * 1000;
// Type lu dans le chemin de l'adresse : le premier mot compte (« /vente/maison/avec-studio-et-terrain »
// reste une maison), sinon « studio », « t3 », « type-2 » sont des appartements.
function typeFromUrl(url) {
  const path = new URL(url).pathname;
  const word = path.match(/maison|appartement|terrain|immeuble/i);
  if (word) return word[0].toLowerCase();
  return /studio|(^|[-/])(t|f|type-)[1-6]([-/]|$)/i.test(path) ? 'appartement' : 'maison';
}
// Annonces qui ne sont pas des logements, dans une liste mêlée.
const notHousing = (url) => /garage|parking|\bbox\b|local-commercial|bureau|fonds-de-commerce/i.test(url);

// Sites 3Clics à fiches « detail.php?item=413 » (Métropol'Immo, Hem Immobilier, De Rycker) : le
// bien n'est reconnu que par le paramètre `item` (`keepSearch`), « Sous compromis » est un attribut
// du bloc de la carte (`data-ribbon`), la commune est dans le texte de la carte.
function detailPhp({ id, label, host, list, pageSize = null }) {
  return {
    id,
    label,
    host,
    departments: ['59'],
    pageSize,
    keepSearch: true,
    listUrls: () => [`https://${host}${list}`],
    pageUrl: pageSize ? withParam('paged') : () => null,
    isListing: (u) => u.pathname === '/detail.php' && /^\?item=\d+$/.test(u.search),
    flagOf: (a) => {
      const box = a.closest('[data-ribbon]');
      return box ? box.getAttribute('data-ribbon') : '';
    },
    typeOf: (url, text) => guessType(text),
  };
}

// Sites Pilotim (Audrey, Choquet, Impact) : toutes les ventes sur `/vente.php?Page=N`, la commune
// et le type dans l'adresse de la fiche (« /fiche-maison-a-vendre-loos-ref-5335.php »).
function pilotim({ id, label, host, pageSize = 8 }) {
  return {
    id,
    label,
    host,
    departments: ['59'],
    pageSize,
    // Longue liste : lue en plusieurs passages, pour qu'une annonce retirée soit bien repérée.
    resumable: true,
    maxPages: 4,
    communeInUrl: true,
    listUrls: () => [`https://${host}/vente.php`],
    pageUrl: withParam('Page'),
    isListing: (u) => /^\/fiche-[a-z0-9-]+-ref-[a-z0-9-]+\.php$/i.test(u.pathname),
    wanted: (url) => !notHousing(url),
    typeOf: typeFromUrl,
  };
}

// Sites Spot My Place (Logéhome, Vendôme) : première page de chaque type. La suite (`?numpage=`)
// est interdite par robots.txt chez Logéhome. La commune est dans le texte de la carte.
function spotMyPlace({ id, label, host }) {
  return {
    id,
    label,
    host,
    departments: ['59'],
    pageSize: null,
    staleAfter: THREE_WEEKS,
    listUrls: (c, type) => typesOf(type).map((t) => `https://${host}/achat,${t}s`),
    pageUrl: () => null,
    isListing: (u) => /^\/achat,(maison|appartement|terrain)-[^,/]+,[A-Za-z0-9-]+$/.test(u.pathname),
    typeOf: (url) => (/^[^,]*\/achat,appartement/.test(url) ? 'appartement' : /\/achat,terrain/.test(url) ? 'terrain' : 'maison'),
  };
}

const SOURCES = [
  {
    // Superimmo : portail qui reprend les annonces de nombreuses agences (Junot, La Lilloise...).
    // Une liste par commune et par type, lue de proche en proche par ses liens « /p/N ».
    id: 'superimmo',
    label: 'Superimmo',
    host: 'www.superimmo.com',
    departments: ['59'],
    pageSize: null,
    resumable: true,
    crawl: true,
    maxPages: 4,
    staleAfter: THREE_WEEKS,
    communeInUrl: true,
    listUrls: (c, type) => typesOf(type).flatMap((t) => c.codesPostaux.map((cp) => `https://www.superimmo.com/achat/${t}/nord-pas-de-calais/nord/${slugOf(c.nom)}-${cp}`)),
    pageUrl: () => null,
    moreLists: (html, pageUrl) => {
      const base = new URL(pageUrl).pathname.replace(/\/p\/\d+$/, '');
      const out = new Set();
      for (const m of String(html).matchAll(/href="([^"]+\/p\/\d+)"/g)) if (m[1].replace(/\/p\/\d+$/, '') === base) out.add(`https://www.superimmo.com${m[1]}`);
      return [...out];
    },
    isListing: (u) => /^\/annonces\/achat-(maison|appartement|terrain|immeuble)[a-z0-9-]*-[a-z0-9]+$/.test(u.pathname),
    typeOf: typeFromUrl,
    // Le site refuse le serveur Vercel (`local`, robot local). Depuis un PC, il répond 429 à 5 s
    // d'intervalle et accepte une page toutes les 45 s (mesuré le 08/11/2026).
    local: true,
    delayMs: 45000,
    // À ce rythme les fiches ne sont pas demandées : l'adresse donne surface et code postal, la carte
    // son prix et sa photo. Le titre de la carte commence par le texte des favoris : remplacé.
    detailOf: (url, card, c) => {
      const m = new URL(url).pathname.match(/^\/annonces\/achat-([a-z]+)(?:-(\d+)m)?-[a-z0-9-]*?-?(\d{5})-[a-z0-9]+$/);
      if (!m) return null;
      const surface = m[2] ? Number(m[2]) : null;
      const kind = m[1].charAt(0).toUpperCase() + m[1].slice(1);
      const photo = [...card.querySelectorAll('img')].map((i) => i.getAttribute('src') || '').find((s) => /^https:\/\/photo\./.test(s)) || null;
      return { surface, postal: m[3], city: c.nom, photo, title: `${kind}${surface ? ` ${surface} m²` : ''} ${c.nom}` };
    },
  },
  {
    // Miss Immo (Marcq-en-Barœul) : une page par type, la commune et le type dans l'adresse.
    id: 'missimmo',
    label: 'Miss Immo',
    host: 'www.miss-immo.fr',
    departments: ['59'],
    pageSize: null,
    communeInUrl: true,
    listUrls: () => ['https://www.miss-immo.fr/vente-maisons', 'https://www.miss-immo.fr/vente-appartements'],
    pageUrl: () => null,
    isListing: (u) => /^\/vente\/(maison|appartement|terrain|immeuble)\/[a-z0-9-]+\/\d+$/.test(u.pathname),
    typeOf: typeFromUrl,
  },
  {
    // MAV Immobilier (Marcq-en-Barœul) : une page par type et par commune.
    id: 'mav',
    label: 'MAV Immobilier',
    host: 'www.mavimmobilier.fr',
    departments: ['59'],
    pageSize: null,
    communeInUrl: true,
    listUrls: (c, type) => typesOf(type).map((t) => `https://www.mavimmobilier.fr/annonces/vente/${t}/${slugOf(c.nom)}/`),
    pageUrl: () => null,
    isListing: (u) => /^\/annonces\/vente\/(maison|appartement|terrain|immeuble)\/[a-z0-9-]+\/[A-Z0-9]+$/.test(u.pathname),
    typeOf: typeFromUrl,
  },
  {
    // Le 12 Immobilier / Pierres du Nord (Marcq-en-Barœul) : tous les biens sur une page.
    id: 'pierresdunord',
    label: 'Le 12 Immobilier',
    host: 'www.pierresdunordimmobilier.fr',
    departments: ['59'],
    pageSize: null,
    listUrls: () => ['https://www.pierresdunordimmobilier.fr/biens-a-vendre/'],
    pageUrl: () => null,
    isListing: (u) => /^\/bien\/[^/]+\/$/.test(u.pathname),
    typeOf: (url, text) => guessType(`${url} ${text}`),
  },
  {
    // Le Lion Immobilier : même gabarit que Brique Rouge, tirets bas dans le nom de la commune.
    id: 'lelion',
    label: 'Le Lion Immobilier',
    host: 'www.le-lion-immobilier.fr',
    departments: ['59'],
    pageSize: null,
    listUrls: (c) => [`https://www.le-lion-immobilier.fr/acheter/logement/${slugOf(c.nom).replace(/-/g, '_')}/tous_quartiers/toutes_chambres/0-0`],
    pageUrl: () => null,
    isListing: (u) => /^\/vente\/(maison|appartement|terrain)\/[^/]+_\d+$/.test(u.pathname),
    // La page est celle de la commune : seul le filtre « vendu » reste à faire sur la carte.
    pageIsCommune: true,
    typeOf: typeFromUrl,
  },
  // Croix Immobilier : montre tout le stock du groupe Forest, comme Immobilière de Wasquehal,
  // Agence de la Forêt et Immobilière de Linselles. Une seule source suffit pour ces quatre sites.
  netty({ id: 'croiximmo', label: 'Croix Immobilier', host: 'www.croix-immobilier.fr' }),
  {
    // Norestim (Lille, Lambersart) : toutes les ventes, dix par page, la commune dans l'adresse.
    id: 'norestim',
    label: 'Norestim',
    host: 'www.norestim.fr',
    departments: ['59'],
    pageSize: 10,
    resumable: true,
    maxPages: 4,
    communeInUrl: true,
    listUrls: () => ['https://www.norestim.fr/statut/vente/'],
    pageUrl: (url, n) => `https://www.norestim.fr/statut/vente/page/${n}/`,
    isListing: (u) => /^\/annonces-immobilieres\/[a-z0-9-]+\/$/.test(u.pathname),
    wanted: (url) => !notHousing(url),
    typeOf: typeFromUrl,
  },
  {
    // City Immo (Quesnoy-sur-Deûle) : tous ses biens sur une page, la commune dans l'adresse.
    id: 'cityimmo',
    label: 'City Immo',
    host: 'www.city-immo.fr',
    departments: ['59'],
    pageSize: null,
    communeInUrl: true,
    listUrls: () => ['https://www.city-immo.fr/nos-biens-immobiliers.php'],
    pageUrl: () => null,
    isListing: (u) => /^\/vente-(maison|appartement|terrain|immeuble)[a-z-]*-\d+$/.test(u.pathname),
    typeOf: typeFromUrl,
  },
  {
    // Immocarré (Lille) : ses derniers biens en page d'accueil, sa page de liste n'en montre aucun.
    id: 'immocarre',
    label: 'Immocarré',
    host: 'www.immocarre.com',
    departments: ['59'],
    pageSize: null,
    staleAfter: THREE_WEEKS,
    communeInUrl: true,
    listUrls: () => ['https://www.immocarre.com/'],
    pageUrl: () => null,
    isListing: (u) => /^\/(maison|appartement|terrain)-a-vendre-[a-z0-9-]+-\d+\.html$/.test(u.pathname),
    typeOf: typeFromUrl,
  },
  spotMyPlace({ id: 'logehome', label: 'Logéhome', host: 'www.logehome.fr' }),
  spotMyPlace({ id: 'vendome', label: 'Vendôme Immobilier', host: 'www.vendome-immobilier.fr' }),
  detailPhp({ id: 'metropolimmo', label: 'Métropol’Immo', host: 'www.metropolimmo.fr', list: '/ventes-de-biens-immobiliers' }),
  detailPhp({ id: 'hemimmo', label: 'Hem Immobilier', host: 'www.hem-immobilier.fr', list: '/vente' }),
  detailPhp({ id: 'drtimmo', label: 'De Rycker Transaction', host: 'drtimmo.com', list: '/vente' }),
  pilotim({ id: 'choquet', label: 'Cabinet Choquet', host: 'www.cabinet-choquet.com', pageSize: 12 }),
  pilotim({ id: 'audrey', label: 'Audrey Immobilier', host: 'www.audrey-immobilier.fr', pageSize: 8 }),
  pilotim({ id: 'impact', label: 'Impact Immobilier', host: 'www.impact-immobilier.fr', pageSize: 12 }),
  // Sites qui refusent tout robot : leurs annonces viennent seulement des listes que Nathan ouvre
  // dans son navigateur (src/content/list-capture.js). Une annonce reste 6 semaines sans être revue.
  { id: 'leboncoin', label: 'Leboncoin', host: 'www.leboncoin.fr', departments: null, local: true, browserOnly: true, staleAfter: 2 * THREE_WEEKS, listUrls: () => [], isListing: (u) => /^\/ad\/ventes_immobilieres\/\d+\/?$/.test(u.pathname) },
  { id: 'pap', label: 'PAP', host: 'www.pap.fr', departments: null, local: true, browserOnly: true, staleAfter: 2 * THREE_WEEKS, listUrls: () => [], isListing: (u) => /^\/annonces\/(maison|appartement|terrain)-[a-z0-9-]+-r\d+$/.test(u.pathname) },
  { id: 'bienici', label: 'Bien’ici', host: 'www.bienici.com', departments: null, local: true, browserOnly: true, staleAfter: 2 * THREE_WEEKS, listUrls: () => [], isListing: (u) => /^\/annonce\/vente\/[^/]+\/(maison|appartement|terrain)\//.test(u.pathname) },
  {
    // SeLoger : robots.txt interdit sa pagination (« ?page= », « ?LISTING-LISTpg »), pas ses pages
    // de commune, de quartier et de nombre de pièces, reliées entre elles. Le robot lit ces pages-là
    // (une trentaine d'annonces chacune), sans jamais demander une page interdite. Il n'est pas sûr
    // de voir toute la commune : une annonce est retirée après 3 semaines sans être revue (`staleAfter`).
    // Le site refuse le serveur Vercel (`local`) : cette lecture tourne sur le PC de Nathan
    // (scripts/robot-local.mjs), et ses listes ouvertes dans le navigateur s'y ajoutent.
    id: 'seloger',
    local: true,
    label: 'SeLoger',
    host: 'www.seloger.com',
    departments: null,
    pageSize: null,
    resumable: true,
    crawl: true,
    maxPages: 4,
    staleAfter: 21 * 24 * 3600 * 1000,
    communeInUrl: true,
    listUrls: (c, type) => typesOf(type).map((t) => `https://www.seloger.com/immobilier/achat/immo-${slugOf(c.nom)}-${String(c.code).slice(0, 2)}/bien-${t}/`),
    pageUrl: () => null,
    cardsFrom: selogerCards,
    moreLists: (html, pageUrl, c) => {
      const slug = slugOf(c.nom);
      const type = /(?:bien-|\/achat\/)appartement/.test(pageUrl) ? 'appartement' : 'maison';
      const out = new Set();
      for (const m of String(html).matchAll(/href="(?:https:\/\/www\.seloger\.com)?(\/recherche\/achat\/[^"?#]+)"/g)) {
        const quartier = new RegExp(`^/recherche/achat/${type}/${slug}-\\d{5}/[a-z0-9-]+/nbh[0-9a-z]+$`).test(m[1]);
        const pieces = new RegExp(`^/recherche/achat/${type}/piece-\\d+/[a-z-]+/${slug}-\\d{5}/ad[0-9a-z]+$`).test(m[1]);
        if (quartier || pieces) out.add(`https://www.seloger.com${m[1]}`);
      }
      return [...out];
    },
    isListing: (u) => /^\/annonce\/achat\/[a-z-]+\/[a-z0-9-]+\/[a-z0-9-]+\/[A-Z0-9]+$/.test(u.pathname),
    typeOf: (url, text) => (/^Appartement/.test(text) ? 'appartement' : /^Terrain/.test(text) ? 'terrain' : 'maison'),
  },
  {
    id: 'orpi',
    label: 'Orpi',
    host: 'www.orpi.com',
    departments: null,
    pageSize: 30,
    listUrls: (c, type) => typesOf(type).map((t) => `https://www.orpi.com/annonces-immobilieres-${slugOf(c.nom)}/vente-${t}/`),
    pageUrl: withParam('page'),
    isListing: (u) => /^\/annonce-vente-(maison|appartement)-/.test(u.pathname),
    typeOf: (url) => (/annonce-vente-appartement/.test(url) ? 'appartement' : 'maison'),
  },
  {
    id: 'paruvendu',
    label: 'ParuVendu',
    host: 'www.paruvendu.fr',
    departments: null,
    pageSize: 25,
    listUrls: (c, type) => typesOf(type).map((t) => `https://www.paruvendu.fr/immobilier/vente/${t}/${slugOf(c.nom)}-${c.codesPostaux[0]}/`),
    pageUrl: withParam('p'),
    isListing: (u) => /^\/immobilier\/vente\/(maison|appartement)\/[^/]*\d{6,}/.test(u.pathname),
    typeOf: (url) => (/\/vente\/appartement\//.test(url) ? 'appartement' : 'maison'),
  },
  {
    id: 'lesiteimmo',
    label: 'Lesiteimmo',
    host: 'www.lesiteimmo.com',
    departments: null,
    pageSize: 25,
    listUrls: (c, type) => typesOf(type).map((t) => `https://www.lesiteimmo.com/acheter/${t}/${slugOf(c.nom)}-${c.codesPostaux[0]}`),
    pageUrl: withParam('page'),
    isListing: (u) => /^\/acheter\/(maison|appartement)[^/]*\/[^/]+\/\d{5,}$/.test(u.pathname),
    typeOf: (url) => (/\/acheter\/appartement/.test(url) ? 'appartement' : 'maison'),
  },
  {
    id: 'maes',
    label: 'Maes Immobilier',
    host: 'www.maesimmobilier.fr',
    departments: ['59'],
    pageSize: null,
    listUrls: () => ['https://www.maesimmobilier.fr/type_offre/vente/'],
    pageUrl: () => null,
    isListing: (u) => /^\/bien-immobilier\/[^/]+\/?$/.test(u.pathname),
    typeOf: (url, text) => guessType(`${url} ${text}`),
  },
  {
    // Cinq agences (Wambrechies, Wasquehal, Neuville, Roncq, Mouvaux) sur une seule liste de
    // 500 biens environ (43 pages de 12, 07/11/2026), du plus récent au plus ancien. La recherche
    // du site passe par un formulaire (POST) que le robot n'emploie pas : la liste entière est
    // lue en plusieurs passages, 20 pages par passage (`resumable`), soit une nuit pour un tour.
    id: 'deleu',
    label: 'Deleu Immobilier',
    host: 'deleuimmobilier.com',
    departments: ['59'],
    pageSize: 12,
    maxPages: 20,
    resumable: true,
    listUrls: () => ['https://deleuimmobilier.com/fr/ventes'],
    pageUrl: withParam('page'),
    isListing: (u) => /^\/fr\/propriete\/vente\+/.test(u.pathname),
    typeOf: (url) => (/vente\+appartement\+/.test(url) ? 'appartement' : /vente\+terrain\+/.test(url) ? 'terrain' : 'maison'),
  },
  {
    // Agence de Saint-Jorioz : une liste par secteur (ses communes du lac), 18 annonces par
    // page, le type en tête de l'adresse de l'annonce (« /acheter/terrain-saint-jorioz-95 »).
    id: 'compimmo',
    label: 'Compagnie Immobilière du Lac',
    host: 'www.compimmo.com',
    departments: ['74'],
    pageSize: 18,
    listUrls: (c) => (COMPIMMO_SECTORS.has(slugOf(c.nom)) ? [`https://www.compimmo.com/acheter?secteur=${encodeURIComponent(withoutAccents(c.nom))}`] : []),
    pageUrl: withParam('p'),
    isListing: (u) => /^\/acheter\/(maison|appartement|terrain)-[a-z0-9-]+-\d+$/.test(u.pathname),
    typeOf: (url) => (/\/acheter\/appartement-/.test(url) ? 'appartement' : /\/acheter\/terrain-/.test(url) ? 'terrain' : 'maison'),
  },
  {
    // Agence de Saint-Jorioz et Menthon-Saint-Bernard : tous ses biens sur une page, chacun sur
    // une page du site à son nom (« /la-canopee/ »). Les pages de l'agence elle-même sont
    // écartées par leur nom ; le type se lit dans la carte (« Type de bien Appartement T3 »).
    id: 'proprietesdulac',
    label: 'Propriétés du Lac',
    host: 'proprietesdulacdannecy.fr',
    departments: ['74'],
    pageSize: null,
    listUrls: () => ['https://proprietesdulacdannecy.fr/biens-en-vente/'],
    pageUrl: () => null,
    isListing: (u) => {
      const m = /^\/(?:biens-en-vente\/)?([a-z0-9-]+)\/$/.exec(u.pathname);
      return !!m && !PDL_PAGES.has(m[1]);
    },
    typeOf: (url, text) => guessType(`${url} ${text}`),
  },
  {
    // Agence de Lambersart : tous ses biens sur une page, la commune en fin d'adresse
    // (« /vm332-leduc-lambersart », vm maison, va appartement). La page n'a pas de bloc par
    // bien : la carte est la page entière, d'où la commune lue dans l'adresse seule.
    id: 'leduc',
    label: 'Leduc Immobilier',
    host: 'immobilier.agence-leduc.fr',
    departments: ['59'],
    pageSize: null,
    communeInUrl: true,
    listUrls: () => ['https://immobilier.agence-leduc.fr/ventes-immobilieres-a-lille'],
    pageUrl: () => null,
    isListing: (u) => /^\/ventes-immobilieres-a-lille\/v[a-z]\d+-leduc/.test(u.pathname),
    typeOf: (url, text) => (/\/va\d/.test(url) ? 'appartement' : /\/vm\d/.test(url) ? 'maison' : guessType(`${url} ${text}`)),
  },
  {
    // Agence de Saint-André-lez-Lille (WordPress, extension Estatik) : tous ses biens sur une
    // page, code postal et commune dans la carte (« 59350 SAINT ANDRE LEZ LILLE »).
    id: 'vereecke',
    label: 'Vereecke Immobilier',
    host: 'vereecke-immobilier.com',
    departments: ['59'],
    pageSize: null,
    listUrls: () => ['https://vereecke-immobilier.com/a-vendre/'],
    pageUrl: () => null,
    isListing: (u) => /^\/bien\/[^/]+\/$/.test(u.pathname),
    typeOf: (url, text) => guessType(`${url} ${text}`),
  },
  {
    // Agence de Lambersart et Haubourdin : une liste par commune. Commune où l'agence n'a aucun
    // bien : page 404, lue comme liste incomplète (aucun retrait déduit).
    id: 'briquerouge',
    label: 'Brique Rouge Immobilier',
    host: 'www.brique-rouge-immobilier.fr',
    departments: ['59'],
    pageSize: null,
    listUrls: (c) => [`https://www.brique-rouge-immobilier.fr/acheter/logement/${slugOf(c.nom)}/tous_quartiers/toutes_chambres/0-0`],
    pageUrl: () => null,
    isListing: (u) => /^\/vente\/(maison|appartement|terrain)\/[^/]+_\d+$/.test(u.pathname),
    typeOf: (url) => (/\/vente\/appartement\//.test(url) ? 'appartement' : /\/vente\/terrain\//.test(url) ? 'terrain' : 'maison'),
  },
  {
    // Agence de Lambersart : tous ses biens sur une page, la commune dans l'adresse
    // (« /vente-appartement-lomme/ »). Ses cartes citent les communes voisines (« à la limite
    // de Lambersart ») : la commune est lue dans l'adresse seule.
    id: 'grimmelpont',
    label: 'Grimmelpont',
    host: 'www.grimmelpont.fr',
    departments: ['59'],
    pageSize: null,
    communeInUrl: true,
    listUrls: () => ['https://www.grimmelpont.fr/acheter-biens-immobiliers'],
    pageUrl: () => null,
    isListing: (u) => /^\/immobilier\/vente-[a-z]+-[a-z0-9-]+\/ref-[A-Za-z0-9-]+$/.test(u.pathname),
    typeOf: (url) => (/\/vente-appartement-/.test(url) ? 'appartement' : /\/vente-immeuble-/.test(url) ? 'immeuble' : /\/vente-terrain-/.test(url) ? 'terrain' : 'maison'),
  },
  {
    // Agence de Marquette-lez-Lille (WordPress) : tous ses biens sur une page, la commune en
    // capitales dans la carte ; les biens vendus y restent, écartés par leur mention « Vendu ».
    id: 'marquetteimmo',
    label: 'Marquette Immobilier',
    host: 'www.marquette-immobilier.fr',
    departments: ['59'],
    pageSize: null,
    listUrls: () => ['https://www.marquette-immobilier.fr/transaction/vente/'],
    pageUrl: () => null,
    isListing: (u) => /^\/immobilier\/[^/]+\/$/.test(u.pathname),
    typeOf: (url, text) => guessType(`${url} ${text}`),
  },
  {
    // Réseau Century 21 : une liste par commune et par type (« v-saint+andre+lez+lille »), 20
    // biens par page. Sous la liste, des biens « à proximité » d'autres communes : seules les
    // cartes du bloc de la commune comptent (`cardOf`). robots.txt interdit /annonces/f/.
    id: 'century21',
    label: 'Century 21',
    host: 'www.century21.fr',
    departments: null,
    pageSize: 20,
    listUrls: (c, type) => typesOf(type).map((t) => `https://www.century21.fr/annonces/achat-${t}/v-${slugOf(c.nom).replace(/-/g, '+')}/`),
    pageUrl: (url, n) => `${url}page-${n}/`,
    isListing: (u) => /^\/trouver_logement\/detail\/\d+\/?$/.test(u.pathname),
    cardOf: (a) => a.closest('.js-the-list-of-properties-list-property .c-the-property-thumbnail-with-content'),
    typeOf: (url, text) => (/appartement à vendre/i.test(text) ? 'appartement' : /terrain à vendre/i.test(text) ? 'terrain' : 'maison'),
  },
  {
    // Réseau Laforêt : une page par commune et par type avec tous ses biens (37 appartements à
    // Lille sur une page, 04/11/2026), puis des biens « à proximité » dans un autre bloc. La
    // recherche du site (/acheter/rechercher?) est interdite par robots.txt, pas ces pages.
    // La fiche donne le code postal de l'agence (mentions légales) : ignoré (`pagePlace`).
    id: 'laforet',
    label: 'Laforêt',
    host: 'www.laforet.com',
    departments: null,
    pageSize: null,
    pagePlace: false,
    listUrls: (c, type) => typesOf(type).map((t) => `https://www.laforet.com/ville/achat-${t}-${slugOf(c.nom)}-${c.codesPostaux[0]}`),
    pageUrl: () => null,
    isListing: (u) => /^\/agence-immobiliere\/[^/]+\/acheter\/[^/]+\/(maison|appartement|terrain)-[a-z0-9-]*\d{6,}$/.test(u.pathname),
    cardOf: (a) => a.closest('[id^="standard--page"] article'),
    typeOf: (url) => (/\/acheter\/[^/]+\/appartement-/.test(url) ? 'appartement' : /\/acheter\/[^/]+\/terrain-/.test(url) ? 'terrain' : 'maison'),
  },
  {
    // Réseau de mandataires IAD : une liste par commune, code postal et type (« lambersart-59130 »),
    // 30 biens par page, la commune dans l'adresse de l'annonce (« maison-vente-4-pieces-lambersart-80m2 »).
    id: 'iad',
    label: 'IAD',
    host: 'www.iadfrance.fr',
    departments: null,
    pageSize: 30,
    communeInUrl: true,
    listUrls: (c, type) => typesOf(type).flatMap((t) => c.codesPostaux.map((cp) => `https://www.iadfrance.fr/annonces/${slugOf(c.nom)}-${cp}/vente/${t}`)),
    pageUrl: withParam('page'),
    isListing: (u) => /^\/annonce\/[a-z0-9-]+\/r\d+$/.test(u.pathname),
    typeOf: (url) => (/\/annonce\/appartement-/.test(url) ? 'appartement' : /\/annonce\/terrain-/.test(url) ? 'terrain' : 'maison'),
  },
  {
    // Réseau de mandataires SAFTI : une liste par commune et par type (« lambersart-59130 »,
    // « annecy-all-cp » pour une commune à plusieurs codes postaux), 24 biens par page.
    id: 'safti',
    label: 'SAFTI',
    host: 'www.safti.fr',
    departments: null,
    pageSize: 24,
    communeInUrl: true,
    listUrls: (c, type) => typesOf(type).map((t) => `https://www.safti.fr/annonces/achat/${t}/${slugOf(c.nom)}-${c.codesPostaux.length > 1 ? 'all-cp' : c.codesPostaux[0]}`),
    pageUrl: withParam('page'),
    isListing: (u) => /^\/annonces\/achat\/[a-z]+\/[a-z0-9-]+-\d{5}\/\d+$/.test(u.pathname),
    typeOf: (url) => (/\/achat\/appartement\//.test(url) ? 'appartement' : /\/achat\/terrain\//.test(url) ? 'terrain' : /\/achat\/immeuble\//.test(url) ? 'immeuble' : 'maison'),
  },
  {
    // Réseau Nestenn : une page par commune et par type. Les biens disponibles viennent en tête de
    // la première page, avec des biens voisins (« À 900 m de 59130 Lambersart ») ; les pages
    // suivantes ne montrent que des biens vendus (04/11/2026). robots.txt interdit /listing.
    id: 'nestenn',
    label: 'Nestenn',
    host: 'nestenn.com',
    departments: null,
    pageSize: null,
    listUrls: (c, type) => typesOf(type).map((t) => `https://nestenn.com/vente/${t}/${slugOf(c.nom)}-${c.codesPostaux[0]}`),
    pageUrl: () => null,
    isListing: (u) => /^\/[a-z0-9-]+-ref-\d+$/.test(u.pathname),
    typeOf: (url, text) => (/appartement à vendre/i.test(text) ? 'appartement' : /terrain à vendre/i.test(text) ? 'terrain' : 'maison'),
  },
  {
    // Portail de la FNAIM : une liste par commune et par type (« 17-acheter-maison-wasquehal-59290 »,
    // un code postal suffit pour toute la commune), 25 biens par page, « -page-2.htm » ensuite.
    // Il réunit des agences dont le site ne se lit pas (Abrinor, Sotheby's...). Certaines fiches
    // portent « nord-59 » au lieu de la commune, sans la citer dans la carte : la commune se lit
    // alors dans le code INSEE du lien (`data-code="59009"`).
    id: 'fnaim',
    label: 'FNAIM',
    host: 'www.fnaim.fr',
    departments: null,
    pageSize: 25,
    listUrls: (c, type) => typesOf(type).map((t) => `https://www.fnaim.fr/liste-annonces-immobilieres/17-acheter-${t}-${slugOf(c.nom)}-${c.codesPostaux[0]}.htm`),
    pageUrl: (url, n) => url.replace(/\.htm$/, `-page-${n}.htm`),
    codeOf: (a, card) => {
      const el = a.closest('[data-code]') || card.querySelector('[data-code]');
      const code = el ? el.getAttribute('data-code') : '';
      return /^\d[\dAB]\d{3}$/.test(code) ? code : null;
    },
    isListing: (u) => /^\/annonce-immobiliere\/\d+\/17-acheter-[a-z0-9-]+\.htm$/.test(u.pathname),
    typeOf: (url, text) => (/-acheter-appartement-/.test(url) ? 'appartement' : /-acheter-maison-/.test(url) ? 'maison' : guessType(`${url} ${text}`)),
  },
  {
    // Réseau Citya : une liste par commune et par type, la commune écrite sans apostrophe et
    // suivie de son code postal (« marcq-en-baroeul-59700 »), ou de son code INSEE quand elle
    // en a plusieurs (« villeneuve-dascq-59009 ») ; une autre forme mène à la liste nationale.
    // Toutes les agences Citya de la commune, 24 biens par page, puis « ?page=2 ».
    id: 'citya',
    label: 'Citya',
    host: 'www.citya.com',
    departments: null,
    pageSize: 24,
    listUrls: (c, type) => {
      const place = `${slugOf(String(c.nom).replace(/['’]/g, ''))}-${c.codesPostaux.length > 1 ? c.code : c.codesPostaux[0]}`;
      return typesOf(type).map((t) => `https://www.citya.com/annonces/vente/${t}/${place}`);
    },
    pageUrl: withParam('page'),
    isListing: (u) => /^\/annonces\/vente\/(maison|appartement)\/[a-z0-9-]+\/[A-Za-z0-9-]+$/.test(u.pathname),
    typeOf: (url) => (/\/vente\/appartement\//.test(url) ? 'appartement' : 'maison'),
  },
  // Sites Netty (gabarit « Modelo »), agences de Marcq-en-Barœul et Villeneuve-d'Ascq. Le Groupe
  // Forest (Immobilière de Marcq, Croix Immobilier, Immobilière de Wasquehal, Agence de la Forêt)
  // partage un seul fichier de biens : immomarcq.fr suffit.
  netty({ id: 'imko', label: 'Imko', host: 'www.imko.fr' }),
  netty({ id: 'immomarcq', label: 'Immobilière de Marcq', host: 'www.immomarcq.fr', pageSize: 10 }),
  // Ces deux sites répondent depuis un PC et refusent le serveur Vercel (`local`, robot local).
  { ...netty({ id: 'heron', label: 'Héron Immobilier', host: 'www.heronimmobilier.fr' }), local: true, staleAfter: THREE_WEEKS },
  { ...netty({ id: 'alerteimmo', label: 'Alerte Immobilier', host: 'www.alerteimmobilier.fr' }), local: true, staleAfter: THREE_WEEKS },
  netty({ id: 'cestpourtonbien', label: 'C’est pour ton bien', host: 'www.cestpourtonbien.com' }),
  netty({ id: 'bhimmo', label: 'B&H Immobilier', host: 'www.bh-immo.fr' }),
  netty({ id: 'vastimmo', label: 'Vastimmo', host: 'www.vastimmo.fr' }),
  {
    // Agence de La Madeleine, Marcq-en-Barœul, Wasquehal et Villeneuve-d'Ascq (3Clics) : une liste par
    // commune, repérée par un numéro du site ; les biens vendus y restent, avec leur mention.
    id: 'immotram',
    label: 'Immotram',
    host: 'www.immotram.fr',
    departments: ['59'],
    pageSize: 12,
    communeInUrl: true,
    listUrls: (c) => {
      const ids = { 'la-madeleine': 2, 'marcq-en-baroeul': 3, wasquehal: 4, 'villeneuve-d-ascq': 5 };
      const slug = slugOf(c.nom);
      return ids[slug] ? [`https://www.immotram.fr/acheter-bien-immobilier-ville-${slug}-${ids[slug]}.html`] : [];
    },
    pageUrl: withParam('page'),
    isListing: (u) => /^\/bien-immobilier-vente-[a-z]+-[a-z0-9-]+-R-[a-z0-9]+\.html$/.test(u.pathname),
    typeOf: (url) => (/-vente-appartement-/.test(url) ? 'appartement' : /-vente-terrain-/.test(url) ? 'terrain' : /-vente-immeuble-/.test(url) ? 'immeuble' : 'maison'),
  },
  // Agences de Villeneuve-d'Ascq sur La Boîte Immo.
  boiteImmo({ id: 'avenueimmo', label: 'Avenue Immobilier Métropole', host: 'www.avenue-immobilier-metropole.fr', cities: { 'villeneuve-d-ascq': 1, wasquehal: 5 } }),
  boiteImmo({ id: 'brice', label: 'Brice Habitat', host: 'www.brice-habitat.com', cities: { 'villeneuve-d-ascq': 1 } }),
  {
    // Agence de Villeneuve-d'Ascq et Wattrelos (Pilotim) : une page par commune et par type ;
    // les biens vendus y restent, marqués dans l'image (« - VENDU » dans son texte de remplacement).
    id: 'actionimmo',
    label: 'Action Immobilier',
    host: 'action.immo',
    departments: ['59'],
    pageSize: null,
    communeInUrl: true,
    listUrls: (c, type) => typesOf(type).map((t) => `https://action.immo/achat-${t}-${slugOf(c.nom)}.php`),
    pageUrl: () => null,
    isListing: (u) => /^\/fiche-[a-z]+-a-vendre-[a-z0-9-]+-ref-\d+\.php$/.test(u.pathname),
    typeOf: (url) => (/\/fiche-appartement-/.test(url) ? 'appartement' : /\/fiche-terrain-/.test(url) ? 'terrain' : 'maison'),
  },
  // Agences de Wasquehal et Croix, et réseau KW (sites Netty « Modelo », KW sous « /fr »).
  netty({ id: 'pepites', label: 'Les Nouvelles Pépites', host: 'www.lesnouvellespepitesimmo.fr', pageSize: 10 }),
  netty({ id: 'kw', label: 'KW Keller Williams', host: 'www.kwfrance.com', base: '/fr', pageSize: 10, departments: null }),
  // Agences de Wasquehal et Marcq-en-Barœul sur La Boîte Immo.
  boiteImmo({ id: 'duquesnoy', label: 'Duquesnoy Immobilier', host: 'www.duquesnoyimmobilier.com', cities: { wasquehal: 1 } }),
  boiteImmo({ id: 'estime', label: 'Estime', host: 'www.estime-immo.com', cities: { 'marcq-en-baroeul': 158, wasquehal: 145 } }),
  {
    // Agence de Marcq-en-Barœul (Kaio) : une liste par type pour toutes ses communes
    // (« /vente-maisons,c11/ », puis « page-2/ ») ; la commune se lit dans l'adresse de la fiche
    // (« /vente-maison-marcq-en-baroeul,b562/ »). Les biens vendus sont sur une autre page.
    id: 'duparque',
    label: 'Valérie Duparque Immobilier',
    host: 'www.valerie-duparque-immobilier.com',
    departments: ['59'],
    // 4 biens par page : la liste des maisons dépasse les 5 pages lues d'habitude.
    pageSize: 4,
    maxPages: 10,
    communeInUrl: true,
    listUrls: (c, type) => typesOf(type).map((t) => `https://www.valerie-duparque-immobilier.com/${t === 'appartement' ? 'vente-appartements,c12' : 'vente-maisons,c11'}/`),
    pageUrl: (url, n) => `${url}page-${n}/`,
    isListing: (u) => /^\/vente-[a-z]+-[a-z0-9-]+,b\d+\/$/.test(u.pathname),
    typeOf: (url) => (/\/vente-appartement-/.test(url) ? 'appartement' : /\/vente-terrain-/.test(url) ? 'terrain' : 'maison'),
  },
  {
    // Agence de Marcq-en-Barœul : une liste par commune (« /vente/immobilier/marcq-en-baroeul/ »,
    // puis « ?p=2 »), biens à vendre puis biens vendus ; la commune finit l'adresse de la fiche.
    id: 'rdimmo',
    label: 'RD Immo',
    host: 'www.rdimmo.fr',
    departments: ['59'],
    pageSize: 9,
    communeInUrl: true,
    listUrls: (c) => [`https://www.rdimmo.fr/vente/immobilier/${slugOf(c.nom)}/`],
    pageUrl: withParam('p'),
    isListing: (u) => /^\/vente\/\d+-[a-z0-9-]+$/.test(u.pathname),
    typeOf: (url, text) => guessType(`${url} ${text}`),
  },
  {
    // Annonces des notaires (Immonot) : une liste par commune et par type, repérée par le code
    // INSEE et le code postal (« Ccom_59378_59700 ») ; la commune est dans l'adresse de la fiche.
    id: 'immonot',
    label: 'Immonot (notaires)',
    host: 'www.immonot.com',
    departments: ['59'],
    pageSize: 20,
    communeInUrl: true,
    listUrls: (c, type) => {
      const cp = c.codesPostaux[0];
      return typesOf(type).map((t) => `https://www.immonot.com/immobilier-notaire/annonces/Ccom_${c.code}_${cp}/achat-${t}-a-vendre-${cp}-${slugOf(c.nom)}-nord.html`);
    },
    pageUrl: withParam('page'),
    isListing: (u) => /^\/immobilier-notaire\/detail\/[A-Za-z0-9_-]+\/achat-[a-z0-9-]+\.html$/.test(u.pathname),
    typeOf: (url) => (/\/achat-appartement-/.test(url) ? 'appartement' : /\/achat-terrain-/.test(url) ? 'terrain' : 'maison'),
  },
  {
    // Étude de notaires Vacossin & Associés (Lille) : toutes ses ventes sur une page ; la commune
    // est dans l'adresse de la fiche, sans apostrophe (« villeneuve-dascq-59650 »).
    id: 'vacossin',
    label: 'Vacossin & Associés (notaires)',
    host: 'vacossin-associes.notaires.fr',
    departments: ['59'],
    pageSize: null,
    communeInUrl: true,
    listUrls: () => ['https://vacossin-associes.notaires.fr/ventes-immobilieres.htm'],
    pageUrl: () => null,
    isListing: (u) => /^\/ventes-immobilieres\/annonces\/vente-[a-z0-9-]+-\d+\.htm$/.test(u.pathname),
    typeOf: (url) => (/\/vente-appartement-/.test(url) ? 'appartement' : /\/vente-terrain-/.test(url) ? 'terrain' : 'maison'),
  },
  {
    // Agence de Lambersart (Pilotim) : toutes ses ventes sur une page ; la commune est dans
    // l'adresse de la fiche, les biens vendus marqués dans le texte de leur image.
    id: 'lekieffre',
    label: 'Guillaume Lekieffre Immobilier',
    host: 'www.lekieffre-immobilier.fr',
    departments: ['59'],
    pageSize: null,
    communeInUrl: true,
    listUrls: () => ['https://www.lekieffre-immobilier.fr/vente.php'],
    pageUrl: () => null,
    isListing: (u) => /^\/fiche-[a-z0-9-]+-a-vendre-[a-z0-9-]+-ref-\d+\.php$/.test(u.pathname),
    typeOf: (url) => (/\/fiche-maison-/.test(url) ? 'maison' : /\/fiche-terrain-/.test(url) ? 'terrain' : /\/fiche-(appartement|type-\d)-/.test(url) ? 'appartement' : 'maison'),
  },
  {
    // Réseau Arthurimmo : une page par commune et par type (« immo-wasquehal-59290 », ou
    // « immo-villeneuve-d-ascq-59 » pour une commune à plusieurs codes postaux).
    id: 'arthurimmo',
    label: 'Arthurimmo',
    host: 'www.arthurimmo.com',
    departments: null,
    pageSize: null,
    communeInUrl: true,
    listUrls: (c, type) => {
      const place = `${slugOf(c.nom)}-${c.codesPostaux.length > 1 ? c.code.slice(0, 2) : c.codesPostaux[0]}`;
      return typesOf(type).map((t) => `https://www.arthurimmo.com/immobilier/achat/immo-${place}/bien-${t}`);
    },
    pageUrl: () => null,
    isListing: (u) => /^\/annonces\/achat\/[a-z]+\/[a-z0-9-]+-\d{5}\/\d+\.htm$/.test(u.pathname),
    typeOf: (url) => (/\/achat\/appartement\//.test(url) ? 'appartement' : /\/achat\/terrain\//.test(url) ? 'terrain' : 'maison'),
  },
  {
    // Barnes Lille (Apimo) : une page par commune, qui montre aussi des biens d'autres
    // communes ; la commune est dans l'adresse de la fiche (« /fr/vente/marcq-en-baroeul/87443424 »).
    id: 'barnes',
    label: 'Barnes Lille',
    host: 'www.barnes-lille.com',
    departments: ['59'],
    pageSize: null,
    communeInUrl: true,
    listUrls: (c) => [`https://www.barnes-lille.com/fr/vente/${slugOf(c.nom)}.html`],
    pageUrl: () => null,
    isListing: (u) => /^\/fr\/vente\/[a-z0-9-]+\/\d+$/.test(u.pathname),
    typeOf: (url, text) => guessType(text),
  },
  {
    // Bonte Immobilier (Apimo, Roubaix et Marcq-en-Barœul) : toutes ses ventes, « ?page=2 » ;
    // le type et la commune sont dans l'adresse (« /fr/propriete/vente+maison+marcq-en-baroeul+... »).
    id: 'bonte',
    label: 'Bonte Immobilier',
    host: 'bonteimmo.com',
    departments: ['59'],
    pageSize: 12,
    communeInUrl: true,
    listUrls: () => ['https://bonteimmo.com/fr/vente'],
    pageUrl: withParam('page'),
    isListing: (u) => /^\/fr\/propriete\/vente\+[a-z]+\+[a-z0-9-]+\+/.test(u.pathname),
    typeOf: (url) => (/vente\+appartement\+/.test(url) ? 'appartement' : /vente\+terrain\+/.test(url) ? 'terrain' : /vente\+maison\+/.test(url) ? 'maison' : 'immeuble'),
  },
  {
    // Réseau Dr House : une liste par commune et par type (« marcq-en-baroeul-59700 » ; à
    // Villeneuve-d'Ascq, un code postal donne toute la commune).
    id: 'drhouse',
    label: 'Dr House Immo',
    host: 'www.drhouse-immo.com',
    departments: null,
    pageSize: 20,
    communeInUrl: true,
    listUrls: (c, type) => typesOf(type).map((t) => `https://www.drhouse-immo.com/annonces/vente/${t}/${slugOf(c.nom)}-${c.codesPostaux[0]}`),
    pageUrl: withParam('page'),
    // Carte : le bloc « article » de l'annonce (seule sur la page, elle s'étendrait au filtre de prix).
    cardOf: (a) => a.closest('article'),
    isListing: (u) => /^\/annonce\/vente\/[a-z0-9-]+-\d{5}\/[a-z0-9-]+\/\d+$/.test(u.pathname),
    typeOf: (url) => (/\/appartement-/.test(url) ? 'appartement' : /\/terrain-/.test(url) ? 'terrain' : 'maison'),
  },
  {
    // Agence Immosens (3Clics, Croix et Lille) : une page par commune et par type.
    id: 'immosens',
    label: 'Immosens',
    host: 'www.immosens.fr',
    departments: ['59'],
    pageSize: null,
    communeInUrl: true,
    listUrls: (c, type) => typesOf(type).map((t) => `https://www.immosens.fr/vente-${t}-${slugOf(c.nom)}.htm`),
    pageUrl: () => null,
    isListing: (u) => /^\/vente-[a-z]+-[a-z0-9-]+,[A-Z0-9]+,\d+\.htm$/.test(u.pathname),
    typeOf: (url) => (/\/vente-appartement-/.test(url) ? 'appartement' : /\/vente-terrain-/.test(url) ? 'terrain' : 'maison'),
  },
  {
    // Agence De Marez (Pilotim, Marcq-en-Barœul) : toutes ses ventes sur une page ; la commune
    // est dans l'adresse de la fiche, les biens vendus marqués dans le texte de leur image.
    id: 'demarez',
    label: 'De Marez Immobilier',
    host: 'www.demarezimmo.fr',
    departments: ['59'],
    pageSize: null,
    communeInUrl: true,
    listUrls: () => ['https://www.demarezimmo.fr/vente.php'],
    pageUrl: () => null,
    isListing: (u) => /^\/fiche-[a-z0-9-]+-a-vendre-[a-z0-9-]+-ref-\d+\.php$/.test(u.pathname),
    typeOf: (url) => (/\/fiche-maison-/.test(url) ? 'maison' : /\/fiche-terrain-/.test(url) ? 'terrain' : /\/fiche-(appartement|studio|type-\d)-/.test(url) ? 'appartement' : 'maison'),
  },
  {
    // Réseau Abrinor (Croix, Villeneuve-d'Ascq, Marcq, Lille...). La page de liste du site ne
    // montre que les 20 premiers biens et ignore le numéro de page : la suite est chargée par
    // l'interface de résultats du site (wp-json, permise par robots.txt), qui filtre par commune
    // (code INSEE et nom, rayon 0) et renvoie du JSON dont le champ `html` contient les cartes.
    // La commune et le type sont dans l'adresse de la fiche.
    id: 'abrinor',
    label: 'Abrinor',
    host: 'www.abrinor.fr',
    departments: ['59'],
    pageSize: 20,
    communeInUrl: true,
    listUrls: (c) => {
      const u = new URL('https://www.abrinor.fr/wp-json/laconfection-abrinor/v1/annonces-results');
      u.searchParams.set('lab_search', '1');
      u.searchParams.set('lab_op', 'vente');
      u.searchParams.append('lab_cities[]', `${c.code};${c.nom};;`);
      u.searchParams.set('lab_radius', '0');
      u.searchParams.set('per_page', '20');
      u.searchParams.set('part', 'full');
      u.searchParams.set('paged', '1');
      return [u.toString()];
    },
    pageUrl: withParam('paged'),
    // Réponse JSON : seules les cartes (champ `html`) sont lues. Une réponse d'une autre forme
    // lève une erreur : le robot tient alors la liste pour non confirmée et ne retire aucun bien
    // (une page vide ferait croire que tous les biens ont disparu).
    htmlOf: (body) => {
      const { html } = JSON.parse(body);
      if (typeof html !== 'string') throw new Error('réponse Abrinor sans cartes');
      return html;
    },
    isListing: (u) => /^\/annonce\/(vente|location)-[a-z0-9-]+\/$/.test(u.pathname),
    // Ventes de logements et de terrains seulement : parkings, locaux et locations écartés.
    wanted: (url) => /\/annonce\/vente-(maison|appartement|terrain|immeuble)-/.test(url),
    typeOf: (url) => (/\/vente-appartement-/.test(url) ? 'appartement' : /\/vente-terrain-/.test(url) ? 'terrain' : /\/vente-immeuble-/.test(url) ? 'immeuble' : 'maison'),
  },
  {
    // Réseau Pulp Immobilier (agence de La Madeleine, 140 avenue Saint-Maur). Ses pages de liste
    // n'affichent qu'un bien, le reste vient de son interface, interdite par robots.txt
    // (« Disallow: /api/ »). Son plan du site des fiches (permis) donne toutes ses annonces, la
    // commune et le type dans l'adresse ; il n'a pas de prix : le robot le lit sur la fiche.
    id: 'pulp',
    label: 'Pulp Immobilier',
    host: 'www.pulp-immobilier.fr',
    departments: ['59'],
    pageSize: null,
    communeInUrl: true,
    listUrls: () => ['https://www.pulp-immobilier.fr/sitemap-biens-detail.xml'],
    pageUrl: () => null,
    cardsFrom: (xml) => ({ items: [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => ({ href: m[1], text: '', price: null })), full: false }),
    isListing: (u) => /^\/annonces-vente\/(maison|appartement|terrain|immeuble)-[a-z0-9-]+\.htm$/.test(u.pathname),
    typeOf: (url) => (/\/annonces-vente\/appartement-/.test(url) ? 'appartement' : /\/annonces-vente\/terrain-/.test(url) ? 'terrain' : /\/annonces-vente\/immeuble-/.test(url) ? 'immeuble' : 'maison'),
  },
  troisClics({ id: 'agencelamadeleine', label: 'Agence de La Madeleine', host: 'www.agencedelamadeleine.com', pageSize: 10 }),
  troisClics({ id: 'lecoutre', label: 'Lecoutre Immobilier', host: 'www.lecoutre-immobilier.com' }),
  troisClics({ id: 'ericfranques', label: 'Éric Franques Immobilier', host: 'www.eric-franques.com' }),
  {
    // Immoclef (La Madeleine) : toutes ses ventes, 12 par page (« ?page=2 »). Certaines fiches
    // n'ont pas la commune dans leur adresse (« vente-maison--R-vm450 ») ; la carte commence
    // alors par elle (« Marcq-en-Baroeul Vente maison 1930 »). Le reste du texte cite l'adresse
    // de l'agence à La Madeleine : seule cette commune de tête compte (`placeOf`).
    id: 'immoclef',
    label: 'Immoclef',
    host: 'www.immoclef.fr',
    departments: ['59'],
    pageSize: 12,
    listUrls: () => ['https://www.immoclef.fr/acheter-bien-immobilier.html'],
    pageUrl: withParam('page'),
    isListing: (u) => /^\/bien-immobilier-vente-[a-z]+-[a-z0-9-]*-R-[a-z0-9]+\.html$/.test(u.pathname),
    placeOf: (url, text) => {
      const m = url.match(/-vente-[a-z]+-([a-z0-9-]+)-R-[a-z0-9]+\.html$/);
      return m ? m[1] : text.replace(/\s+(Exclu|Nouveaut[ée])\b[\s\S]*/i, '').split(' Vente ')[0];
    },
    typeOf: (url) => (/-vente-appartement-/.test(url) ? 'appartement' : /-vente-terrain-/.test(url) ? 'terrain' : /-vente-immeuble-/.test(url) ? 'immeuble' : 'maison'),
  },
  // L'Agence Saint Maur (Groupe Forest, La Madeleine), même gabarit Netty que l'Immobilière de Marcq.
  netty({ id: 'saintmaur', label: 'L’Agence Saint Maur', host: 'www.agencesaintmaur.fr' }),
  boiteImmo({ id: 'grimonprez', label: 'Grimonprez Immo', host: 'www.grimonprez.immo', cities: { 'la-madeleine': 588 } }),
  {
    // Clé du Nord (3Clics, Mouvaux) : les pages suivantes de sa liste répondent « File not found »,
    // dans un navigateur aussi (constaté le 08/11/2026). Seules les annonces de `/vente` et de
    // l'accueil se lisent : une absence ne prouve rien, d'où le retrait à l'ancienneté (`staleAfter`).
    id: 'cledunord',
    label: 'Clé du Nord',
    host: 'www.cledunord.com',
    departments: ['59'],
    pageSize: null,
    staleAfter: THREE_WEEKS,
    communeInUrl: true,
    listUrls: () => ['https://www.cledunord.com/vente', 'https://www.cledunord.com/'],
    pageUrl: () => null,
    isListing: (u) => /^\/vente-[a-z]+-\d+-[a-z0-9-]+,\d+$/.test(u.pathname),
    wanted: (url) => !notHousing(url),
    typeOf: typeFromUrl,
  },
  {
    // Hoste Immobilier (Tourcoing) : toutes ses ventes, 5 par page (« /fr/vente/2/ »). Le numéro de
    // page fait partie de l'adresse des fiches : ramené à 1 pour qu'un bien qui change de page reste
    // la même annonce (la fiche répond à cette adresse).
    id: 'hoste',
    label: 'Hoste Immobilier',
    host: 'www.hoste-immobilier.fr',
    departments: ['59'],
    pageSize: 5,
    communeInUrl: true,
    listUrls: () => ['https://www.hoste-immobilier.fr/fr/vente/1/'],
    pageUrl: (url, n) => `https://www.hoste-immobilier.fr/fr/vente/${n}/`,
    isListing: (u) => /^\/fr\/vente\/\d+\/\d+-[a-z0-9-]+$/.test(u.pathname),
    canonicalPath: (path) => path.replace(/^\/fr\/vente\/\d+\//, '/fr/vente/1/'),
    wanted: (url) => !notHousing(url),
    typeOf: typeFromUrl,
  },
  {
    // L'Agence de Croix (Proximedia) : sa page de ventes se remplit par une interface qui renvoie
    // des fiches de 2022, pas les annonces affichées. Seules les cartes récentes de l'accueil sont
    // fiables : une absence ne prouve rien (`staleAfter`). Ses fiches donnent le logo comme photo :
    // tout est pris sur la carte. La commune est dans un bloc à part (« 59100 Roubaix »).
    id: 'agencedecroix',
    label: 'L’Agence de Croix',
    host: 'www.agence-de-croix.com',
    departments: ['59'],
    pageSize: null,
    staleAfter: THREE_WEEKS,
    listUrls: () => ['https://www.agence-de-croix.com/fr/'],
    pageUrl: () => null,
    cardsFrom: (html, pageUrl) => {
      const items = [];
      for (const box of parseHtml(html, pageUrl).querySelectorAll('.tableProperty')) {
        const link = box.querySelector('a.immoListTitleLink');
        const place = norm(box.querySelector('.immoListLocationLink')?.textContent).match(/^(\d{5}) (.+)$/);
        const text = norm(box.textContent);
        // Le modèle vide de la page n'a pas de commune ; locations et fonds de commerce écartés.
        if (!link || !place || /par mois|en location|fonds de commerce|garage en/i.test(text)) continue;
        const priced = [...box.querySelectorAll('*')].filter((el) => priceOf(el.textContent));
        const deepest = priced.find((el) => !priced.some((other) => other !== el && el.contains(other)));
        const photo = box.querySelector('img.immoListPhotoImage')?.getAttribute('src');
        items.push({
          href: link.getAttribute('href'),
          text: `${place[2]} · ${norm(link.textContent)} · ${text}`,
          price: deepest ? priceOf(deepest.textContent) : null,
          detail: {
            surface: Number((text.match(/\+-\s*(\d+)\s*m2/i) || [])[1]) || null,
            chambres: Number((text.match(/\b(\d+) chambres?\b/i) || [])[1]) || null,
            photo: photo ? new URL(photo, pageUrl).href : null,
            postal: place[1],
            city: place[2],
          },
        });
      }
      return { items, full: false };
    },
    isListing: (u) => /^\/fr\/[a-z0-9-]+$/.test(u.pathname),
    placeOf: (url, text) => text.split(' · ')[0],
    typeOf: (url, text) => guessType(text.split(' · ')[1] || text),
  },
  {
    // Nathalie Forest Sotheby's (Lille) : ses listes ne changent pas de page et ne montrent que
    // 10 biens. Son plan du site des fiches (permis) les donne tous, sans les biens vendus (10
    // vérifiés le 08/11/2026) ; il n'a pas de prix : le robot le lit sur la fiche.
    id: 'sothebys',
    label: 'Nathalie Forest Sotheby’s',
    host: 'www.nathalieforest-sothebysrealty.com',
    departments: ['59', '62'],
    pageSize: null,
    communeInUrl: true,
    listUrls: () => ['https://www.nathalieforest-sothebysrealty.com/sitemap_1_fr.xml'],
    pageUrl: () => null,
    cardsFrom: (xml) => ({ items: [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => ({ href: m[1], text: '', price: null })), full: false }),
    isListing: (u) => /^\/fr\/nos-biens\/ref-[a-z0-9-]+\/vente-[a-z0-9-]+\/$/.test(u.pathname),
    typeOf: (url) => (/\/vente-appartement-/.test(url) ? 'appartement' : /\/vente-immeuble-/.test(url) ? 'immeuble' : /\/vente-terrain-/.test(url) ? 'terrain' : 'maison'),
  },
  {
    // Espaces Atypiques Lille : sa page d'agence et sa page « acheter à Lille » montrent des biens
    // différents, sans page suivante (« /lille/page/2/ » redonne la même) : une absence ne prouve
    // rien (`staleAfter`). La fin de l'adresse décrit le bien et cite parfois une autre commune :
    // seule compte celle de la carte, en capitales avant le code postal (« LAMBERSART 59130 »).
    id: 'espacesatypiques',
    label: 'Espaces Atypiques Lille',
    host: 'www.espaces-atypiques.com',
    departments: ['59', '62'],
    pageSize: null,
    staleAfter: THREE_WEEKS,
    listUrls: () => ['https://www.espaces-atypiques.com/lille/', 'https://www.espaces-atypiques.com/immobilier/acheter-un-bien-immobilier-a-lille/'],
    pageUrl: () => null,
    isListing: (u) => /^\/ventes\/\d{5}-[a-z0-9-]+\/$/.test(u.pathname),
    placeOf: (url, text) => (text.match(/([A-ZÀ-ÖØ-ÝŒ][A-ZÀ-ÖØ-ÝŒ'’ -]+) \d{5}\b/) || [])[1],
    typeOf: (url, text) => (/appartement|loft|duplex|triplex|studio/i.test(text) ? 'appartement' : /terrain/i.test(text) && !/maison/i.test(text) ? 'terrain' : 'maison'),
  },
];

const sourceById = (id) => SOURCES.find((s) => s.id === id) || null;

// Adresse d'annonce propre : absolue, sans paramètres ni ancre (pour la reconnaître d'un passage à l'autre).
function listingUrl(href, base, source) {
  try {
    const u = new URL(href, base);
    if (u.hostname !== source.host || !source.isListing(u)) return null;
    // Bien reconnu par un paramètre (« detail.php?item=413 ») : il reste dans l'adresse.
    // Adresse qui contient autre chose que le bien (numéro de page chez Hoste) : `canonicalPath`.
    const path = source.canonicalPath ? source.canonicalPath(u.pathname) : u.pathname;
    return `${u.origin}${path}${source.keepSearch ? u.search : ''}`;
  } catch {
    return null;
  }
}

// Annonce gardée : encore à vendre, pas un bien voisin, dans la commune cherchée.
// Biens plus à vendre (« Vendu », « Maison vendue », « Sous compromis », « plus disponible »),
// biens voisins (« À 900 m de 59130 Lambersart ») et annonces d'autres communes : écartés.
// Commune lue dans l'adresse seule quand la carte cite d'autres communes (`communeInUrl`), ou
// d'après le code INSEE que le site donne pour le bien (`code`, lu par `codeOf`).
function keeps(url, text, source, commune, code = null) {
  // Annonce vue mais d'une autre sorte (location dans une liste mêlée, `wanted`) : écartée.
  if (source.wanted && !source.wanted(url)) return false;
  if (UNAVAILABLE.test(text) || NEARBY.test(text)) return false;
  // Page propre à la commune, dont les cartes ne la citent pas toujours : rien de plus à vérifier.
  if (source.pageIsCommune) return true;
  if (code && commune.code) return code === commune.code;
  // Source qui sait où lire la commune d'une annonce (`placeOf`) : ce seul morceau, en entier.
  if (source.placeOf) {
    const place = placeSlug(source.placeOf(url, text) || '');
    return place === placeSlug(commune.nom) || place === placeSlug(String(commune.nom).replace(/['’]/g, ''));
  }
  const where = placeSlug(source.communeInUrl ? url : `${url} ${text}`);
  return where.includes(placeSlug(commune.nom)) || where.includes(placeSlug(String(commune.nom).replace(/['’]/g, '')));
}

function readResults(html, pageUrl, source, commune) {
  // Source dont les annonces ne sont pas des liens de la page (données codées, Netty) : elle
  // les donne elle-même, avec leur texte et leur prix.
  if (source.cardsFrom) {
    const { items, full } = source.cardsFrom(html, pageUrl);
    const cards = [];
    const seen = new Set();
    for (const it of items) {
      const url = listingUrl(it.href, pageUrl, source);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const text = norm(it.text);
      if (!keeps(url, text, source, commune)) continue;
      cards.push({ url, price: it.price || null, title: text.slice(0, 160), type: source.typeOf(url, text), ...(it.detail ? { detail: it.detail } : {}) });
    }
    return { cards, all: [...seen], full };
  }
  // Source qui répond en JSON (Abrinor) : elle en extrait le HTML de ses cartes.
  const doc = parseHtml(source.htmlOf ? source.htmlOf(html) : html, pageUrl);
  // `doc.baseURI` et non `pageUrl` : une page peut déclarer `<base href="/">` (Nestenn), ses liens
  // relatifs partent alors de la racine du site et non de l'adresse de la page.
  const keyOf = (a) => listingUrl(a.getAttribute('href'), doc.baseURI, source);
  const cards = [];
  // `seen` : toutes les annonces de la page, avant les filtres (commune, biens vendus).
  const seen = new Set();
  for (const a of doc.querySelectorAll('a[href]')) {
    const url = keyOf(a);
    if (!url || seen.has(url)) continue;
    // Bloc de carte propre au site (`cardOf`) : un lien hors de ce bloc (biens « à proximité »
    // d'autres communes) n'est pas une annonce de la liste.
    const own = source.cardOf ? source.cardOf(a) : null;
    if (source.cardOf && !own) continue;
    seen.add(url);
    // Sinon, plus grand bloc qui ne mène qu'à cette annonce.
    let card = own || a;
    while (!own && card.parentElement && card.parentElement !== doc.body) {
      const links = new Set([...card.parentElement.querySelectorAll('a[href]')].map(keyOf).filter(Boolean));
      if (links.size > 1) break;
      card = card.parentElement;
    }
    // Le prix est lu dans l'élément le plus profond qui ne contient que lui : un parent qui
    // y ajoute le compteur de photos (« 3 » puis « 275 000 € ») donnerait 3 275 000 €.
    const priced = [...card.querySelectorAll('*')].filter((el) => priceOf(el.textContent));
    const deepest = priced.find((el) => !priced.some((other) => other !== el && el.contains(other)));
    const price = deepest ? priceOf(deepest.textContent) : null;
    const text = norm(card.textContent);
    // Mention « vendu » portée par une image (texte de remplacement « Maison - VENDU »).
    const alts = [...card.querySelectorAll('img[alt]')].map((img) => img.getAttribute('alt')).join(' ');
    // Mention portée par un attribut du bloc de la carte (`flagOf`, « Sous compromis ! »).
    if (source.flagOf && UNAVAILABLE.test(source.flagOf(a) || '')) continue;
    if (UNAVAILABLE.test(alts) || !keeps(url, text, source, commune, source.codeOf ? source.codeOf(a, card) : null)) continue;
    const detail = source.detailOf ? source.detailOf(url, card, commune) : null;
    cards.push({ url, price, title: text.slice(0, 160), type: source.typeOf(url, text), ...(detail ? { detail } : {}) });
  }
  return { cards, all: [...seen], full: !!source.pageSize && seen.size >= source.pageSize };
}

// Sites à lire plus lentement que les autres (`delayMs`) : hôte → délai, pour le client poli.
const SLOW_HOSTS = Object.fromEntries(SOURCES.filter((s) => s.delayMs).map((s) => [s.host, s.delayMs]));

export { SOURCES, SLOW_HOSTS, sourceById, readResults, slugOf, placeSlug, listingUrl };
