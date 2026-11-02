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
    seen.add(url);
    // Plus grand bloc qui ne mène qu'à cette annonce.
    let card = a;
    while (card.parentElement && card.parentElement !== doc.body) {
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
    // Biens déjà vendus (Orpi en montre) et annonces d'autres communes : écartés.
    if (/\bvendu\b/i.test(text)) continue;
    if (!slugOf(`${url} ${text}`).includes(slugOf(commune.nom))) continue;
    cards.push({ url, price, title: text.slice(0, 160), type: source.typeOf(url, text) });
  }
  return { cards, all: [...seen], full: !!source.pageSize && seen.size >= source.pageSize };
}

export { SOURCES, sourceById, readResults, slugOf, listingUrl };
