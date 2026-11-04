// Les sources scannées en première version (spec §6.1) et la lecture de leurs pages de
// résultats. Une « carte » est le plus grand bloc de la page qui ne mène qu'à une annonce ;
// son prix est le premier élément dont tout le texte est un prix (le compteur de photos
// collé au prix, chez ParuVendu, est ainsi laissé de côté).
import { parseHtml, priceOf, norm } from './page.js';

const TYPES = ['maison', 'appartement'];

// « Saint-André-lez-Lille » → « saint-andre-lez-lille », comme dans les adresses des sites.
function slugOf(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const withoutAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

const UNAVAILABLE = /\bvendue?s?\b|sous compromis|plus disponible/i;
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

const SOURCES = [
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
    id: 'deleu',
    label: 'Deleu Immobilier',
    host: 'deleuimmobilier.com',
    departments: ['59'],
    pageSize: 12,
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
];

const sourceById = (id) => SOURCES.find((s) => s.id === id) || null;

// Adresse d'annonce propre : absolue, sans paramètres ni ancre (pour la reconnaître d'un passage à l'autre).
function listingUrl(href, base, source) {
  try {
    const u = new URL(href, base);
    if (u.hostname !== source.host || !source.isListing(u)) return null;
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

function readResults(html, pageUrl, source, commune) {
  const doc = parseHtml(html, pageUrl);
  const keyOf = (a) => listingUrl(a.getAttribute('href'), pageUrl, source);
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
    // Biens plus à vendre (« Vendu », « Maison vendue », « Sous compromis », « plus disponible »),
    // biens voisins (« À 900 m de 59130 Lambersart ») et annonces d'autres communes : écartés.
    // Commune lue dans l'adresse seule quand la carte cite d'autres communes (`communeInUrl`).
    if (UNAVAILABLE.test(text) || NEARBY.test(text)) continue;
    if (!placeSlug(source.communeInUrl ? url : `${url} ${text}`).includes(placeSlug(commune.nom))) continue;
    cards.push({ url, price, title: text.slice(0, 160), type: source.typeOf(url, text) });
  }
  return { cards, all: [...seen], full: !!source.pageSize && seen.size >= source.pageSize };
}

export { SOURCES, sourceById, readResults, slugOf, listingUrl };
