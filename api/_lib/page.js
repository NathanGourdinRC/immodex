// Lecture d'une page côté serveur (fonction Vercel du scan) : jsdom, sans exécuter les
// scripts de la page, puis le lecteur d'annonces de l'extension (extract.js et
// generic-extract.js), le même que celui qui tourne dans Chrome.
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const READERS = ['../../src/common/extract.js', '../../src/common/generic-extract.js'].map((p) => readFileSync(new URL(p, import.meta.url), 'utf8'));

// Les erreurs CSS ou de scripts de la page ne concernent pas la lecture.
const quiet = () => new VirtualConsole();

function parseHtml(html, url) {
  return new JSDOM(html, { url, virtualConsole: quiet() }).window.document;
}

const norm = (s) => String(s || '').replace(/[\s  ]+/g, ' ').trim();

// Texte qui ne contient que le prix : « 299 500 € », « Prix : 332 000 € ».
// Accepte aussi « 275 000 € * » et « 299 000 € HAI » (honoraires inclus).
const ONLY_PRICE = /^(?:prix\s*:?\s*)?(\d{1,3}(?:[ .]\d{3}){1,2}|\d{4,7})\s?€\s*(?:\*|hai|fai|ttc|honoraires inclus)?$/i;

function priceOf(text) {
  const m = norm(text).match(ONLY_PRICE);
  return m ? Number(m[1].replace(/\D/g, '')) : null;
}

const int = (m) => (m ? Number(m[1].replace(/\D/g, '')) : null);

const OTHER_BLOCKS = /similai|related|swiper|carousel|slider|autres-biens|reco|breadcrumb|ariane/i;

// Texte de l'annonce seule : sans menus, pied de page, encadrés, ni les cartes d'autres biens
// (« biens similaires » en bas de page, qui prêteraient leur terrain ou leurs chambres).
function listingText(doc, url) {
  if (!doc.body) return '';
  const here = new URL(url);
  const body = doc.body.cloneNode(true);
  for (const el of [...body.querySelectorAll('nav, footer, aside, script, style, noscript')]) el.remove();
  // Formulaires (recherche, contact) écartés, sauf celui qui enveloppe toute la page (sites
  // ASP.NET : la fiche entière est dans <form id="aspnetForm">).
  const total = norm(body.textContent).length;
  for (const el of [...body.querySelectorAll('form')]) if (body.contains(el) && norm(el.textContent).length < total / 2) el.remove();
  for (const el of [...body.querySelectorAll('header')]) if (!el.closest('main, article')) el.remove();
  for (const el of [...body.querySelectorAll('[class], [id]')]) {
    const name = `${typeof el.className === 'string' ? el.className : ''} ${el.id || ''}`;
    if (OTHER_BLOCKS.test(name) && body.contains(el)) el.remove();
  }
  // Carte d'un autre bien du même site : le plus grand bloc qui ne mène qu'à lui, s'il montre un prix.
  const target = (a) => {
    try {
      const u = new URL(a.getAttribute('href'), url);
      return u.host === here.host && u.pathname !== here.pathname && u.pathname.length > 1 ? u.pathname : null;
    } catch {
      return null;
    }
  };
  for (const a of [...body.querySelectorAll('a[href]')]) {
    if (!body.contains(a)) continue;
    const path = target(a);
    if (!path) continue;
    let card = a;
    while (card.parentElement && card.parentElement !== body) {
      const paths = new Set([...card.parentElement.querySelectorAll('a[href]')].map(target).filter(Boolean));
      const ownLink = [...card.parentElement.querySelectorAll('a[href]')].some((x) => !target(x));
      if (paths.size > 1 || ownLink) break;
      card = card.parentElement;
    }
    // Une vraie carte est courte et ne contient pas le titre de l'annonce : le bloc principal,
    // qui n'a parfois qu'un lien « Retour aux résultats », n'est jamais retiré.
    if (card !== a && /€/.test(card.textContent) && !card.querySelector('h1') && card.textContent.length < 800) card.remove();
  }
  // Texte nœud par nœud, séparé par des espaces : « Réf. MX517 » puis « 4 pièces » ne se
  // collent pas en « MX5174 pièces ».
  const parts = [];
  const walker = doc.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue);
  return norm(parts.join(' '));
}

// Premier nombre trouvé par une liste de formes, de la plus précise à la plus libre.
function firstNumber(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return int(m);
  }
  return null;
}

// « trois chambres » quand la fiche ne donne pas le chiffre (maisons neuves, descriptions).
const WORD_NUMBERS = { une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8 };
function wordCount(text, noun) {
  const m = text.match(new RegExp(`\\b(${Object.keys(WORD_NUMBERS).join('|')})\\s+${noun}`, 'i'));
  return m ? WORD_NUMBERS[m[1].toLowerCase()] : null;
}

function readListing(html, url) {
  // Fenêtre où l'on exécute seulement nos lecteurs, jamais les scripts de la page.
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', virtualConsole: quiet() });
  const win = dom.window;
  win.TextDecoder = TextDecoder;
  for (const code of READERS) win.eval(code);
  const doc = win.document;
  const gen = win.__immodexGeneric;
  const p = gen.extractFromDocument(doc) || {};
  const text = listingText(doc, url);
  const meta = (prop) => {
    const el = doc.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
    return el ? el.getAttribute('content') : null;
  };
  const h1 = doc.querySelector('h1');
  const listing = {
    price: gen.extractPrice(doc, 'vente') || null,
    surface: p.surface ?? null,
    pieces: firstNumber(text, [/nombre de pi[eè]ces?\s*:?\s*(\d{1,2})\b/i, /\bpi[eè]ces?\s*:\s*(\d{1,2})\b/i, /(?<![\d.,])(\d{1,2})\s*pi[eè]ces?\b/i]),
    chambres: firstNumber(text, [/nombre de chambres?\s*:?\s*(\d{1,2})\b/i, /\bchambres?\s*:\s*(\d{1,2})\b/i, /(?<![\d.,])(\d{1,2})\s*chambres?\b/i]) ?? wordCount(text, 'chambres?\\b'),
    // « m<sup>2</sup> » devient « m 2 » quand le texte est lu nœud par nœud ; décimales
    // (« 262,79 m2 ») ignorées.
    terrain: int(text.match(/terrain[^0-9]{0,30}(\d[\d ]{0,8})(?:[.,]\d{1,2})?\s*m\s?(?:²|2)(?![a-z0-9])/i)),
    garage: /\bgarages?\b/i.test(text),
    title: norm(h1 ? h1.textContent : meta('og:title') || doc.title).slice(0, 200) || null,
    photo: meta('og:image'),
    postal: p.postal || null,
    city: p.city || null,
    buildingType: p.buildingType || null,
    energyClass: p.energyClass || null,
    gesClass: p.gesClass || null,
    energyConsumption: p.energyConsumption ?? null,
    gesEmission: p.gesEmission ?? null,
    // Date du DPE quand l'annonce la donne : elle resserre la recherche d'adresse.
    dateRange: p.dateRange || null,
  };
  win.close();
  return listing;
}

export { parseHtml, priceOf, readListing, listingText, norm };
