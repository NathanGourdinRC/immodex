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
const ONLY_PRICE = /^(?:prix\s*:?\s*)?(\d{1,3}(?:[ .]\d{3}){1,2}|\d{4,7})\s?€$/i;

function priceOf(text) {
  const m = norm(text).match(ONLY_PRICE);
  return m ? Number(m[1].replace(/\D/g, '')) : null;
}

const int = (m) => (m ? Number(m[1].replace(/\D/g, '')) : null);

function readListing(html, url) {
  // Fenêtre où l'on exécute seulement nos lecteurs, jamais les scripts de la page.
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', virtualConsole: quiet() });
  const win = dom.window;
  win.TextDecoder = TextDecoder;
  for (const code of READERS) win.eval(code);
  const doc = win.document;
  const gen = win.__immodexGeneric;
  const p = gen.extractFromDocument(doc) || {};
  const text = norm(doc.body ? doc.body.textContent : '');
  const meta = (prop) => {
    const el = doc.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
    return el ? el.getAttribute('content') : null;
  };
  const h1 = doc.querySelector('h1');
  const listing = {
    price: gen.extractPrice(doc, 'vente') || null,
    surface: p.surface ?? null,
    pieces: int(text.match(/(\d{1,2})\s*pi[eè]ces?\b/i)),
    chambres: int(text.match(/(\d{1,2})\s*chambres?\b/i)),
    terrain: int(text.match(/terrain[^0-9]{0,30}(\d[\d ]{0,8})\s*m(?:²|2)(?![a-z0-9])/i)),
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
  };
  win.close();
  return listing;
}

export { parseHtml, priceOf, readListing, norm };
