// Lecture des pages de résultats ouvertes dans le navigateur (src/common/list-extract.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { handleIngest } from '../api/_lib/ingest.js';
import { keys } from '../api/_lib/scan-store.js';
import { spaceOf } from '../api/sync.js';
import { fakeRedis as createFakeRedis } from './helpers/fake-redis.mjs';

const code = readFileSync(fileURLToPath(new URL('../src/common/list-extract.js', import.meta.url)), 'utf8');

function read(html, url) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  dom.window.eval(code);
  // Passé par JSON : les objets créés dans jsdom n'ont pas les prototypes de Node.
  return JSON.parse(JSON.stringify(dom.window.__immodexListExtract.extractList(dom.window.document)));
}

const lbcData = (ads) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { searchData: { ads } } } })}</script>`;
const lbcAd = {
  list_id: 3100000001,
  subject: 'Maison 167 m²',
  url: 'https://www.leboncoin.fr/ad/ventes_immobilieres/3100000001',
  price: [742000],
  status: 'active',
  ad_type: 'offer',
  category_id: '9',
  location: { city: 'Marcq-en-Baroeul', zipcode: '59700' },
  images: { urls: ['https://img.leboncoin.fr/1.jpg'] },
  attributes: [
    { key: 'real_estate_type', value: '1' },
    { key: 'square', value: '167' },
    { key: 'rooms', value: '6' },
    { key: 'bedrooms', value: '4' },
    { key: 'land_plot_surface', value: '50' },
    { key: 'energy_rate', value: 'c' },
    { key: 'ges', value: 'b' },
  ],
};

test('Leboncoin : le bloc de données de la page donne tout', () => {
  const parking = { ...lbcAd, url: 'https://www.leboncoin.fr/ad/ventes_immobilieres/2', attributes: [{ key: 'real_estate_type', value: '4' }] };
  const r = read(`<html><body>${lbcData([lbcAd, parking])}</body></html>`, 'https://www.leboncoin.fr/recherche?category=9');
  assert.equal(r.source, 'leboncoin');
  assert.equal(r.cards.length, 1);
  const [c] = r.cards;
  assert.equal(c.price, 742000);
  assert.equal(c.type, 'maison');
  assert.deepEqual(c.detail, { surface: 167, pieces: 6, chambres: 4, terrain: 50, photo: 'https://img.leboncoin.fr/1.jpg', postal: '59700', city: 'Marcq-en-Baroeul', energyClass: 'C', gesClass: 'B' });
});

test('Leboncoin : page suivante ouverte sans recharger, les cartes affichées font foi', () => {
  // Texte relevé sur une vraie page le 08/11/2026 : feuille de style dans la carte, pièces, terrain.
  const box = `<div data-qa-id="aditem_container"><a href="/ad/ventes_immobilieres/999?x=1"><style>.adcard { margin: 16px 0 } .b::after { content: "1 €" }</style><img src="https://img.leboncoin.fr/9.jpg"><p>312\u00a0000\u00a0€</p><p>Prix: 312\u00a0000\u00a0€.</p><p>3\u00a0545\u00a0€ par m²</p><p>Maison · 4 pièces · 88m²</p><p>Terrain : 120 m²</p><p>Marcq-en-Baroeul 59700 Mairie</p><p>Située à Marcq-en-Baroeul 59700 Mairie.</p></a></div>`;
  const r = read(`<html><body>${lbcData([lbcAd])}${box}</body></html>`, 'https://www.leboncoin.fr/recherche?category=9&page=2');
  assert.equal(r.cards.length, 1);
  assert.equal(r.cards[0].url, 'https://www.leboncoin.fr/ad/ventes_immobilieres/999');
  assert.equal(r.cards[0].price, 312000);
  assert.equal(r.cards[0].detail.city, 'Marcq-en-Baroeul');
  assert.equal(r.cards[0].detail.surface, 88);
  assert.equal(r.cards[0].detail.pieces, 4);
  assert.equal(r.cards[0].detail.terrain, 120);
});

test('Bien’ici : carte « Maison 5 pièces 100 m² 59700 Marcq-en-Barœul 495 000 € 4 800 €/m² »', () => {
  const html = `<article class="ad-overview" data-id="ag-1"><a href="/annonce/vente/marcq-en-baroeul/maison/5pieces/ag-1?q=1"><img src="https://file.bienici.com/1.jpg"><span>Agence de la Passerelle 28 VIDÉO</span> <span>Maison 5 pièces 100 m²</span> <span>59700 Marcq-en-Barœul</span> <span>495 000 €</span> <span>4 800 €/m²</span></a></article>`;
  const { source, cards } = read(`<html><body>${html}</body></html>`, 'https://www.bienici.com/recherche/achat/marcq-en-baroeul-59700/maison');
  assert.equal(source, 'bienici');
  assert.equal(cards[0].url, 'https://www.bienici.com/annonce/vente/marcq-en-baroeul/maison/5pieces/ag-1');
  assert.equal(cards[0].price, 495000);
  assert.equal(cards[0].detail.surface, 100);
  assert.equal(cards[0].detail.pieces, 5);
  assert.equal(cards[0].detail.postal, '59700');
  assert.equal(cards[0].detail.city, 'Marcq-en-Barœul');
});

test('Bien’ici : texte réel, le prix collé à la ville, quartier entre parenthèses', () => {
  const box = (id, place) => `<article class="ad-overview"><a href="/annonce/vente/marcq-en-baroeul/maison/4pieces/${id}">ABRINOR - MARCQ6 Maison 4 pièces 110 m² 59700 ${place}510\u00a0000\u00a0€4\u00a0455\u00a0€/m²maison 4 pièces</a></article>`;
  const { cards } = read(`<html><body>${box('a', 'Marcq-en-Barœul (Croisé Laroche - Rouges Barres)')}${box('b', 'Marcq-en-Barœul')}</body></html>`, 'https://www.bienici.com/recherche/achat/x');
  for (const c of cards) {
    assert.equal(c.detail.city, 'Marcq-en-Barœul');
    assert.equal(c.detail.postal, '59700');
    assert.equal(c.price, 510000);
    assert.equal(c.detail.surface, 110);
  }
});

test('PAP : ville à part du « à 3 km de », blocs publicitaires ignorés', () => {
  const html = `<div class="search-list-item-alt"><a href="https://ads.example/x">pub</a></div>
    <div class="search-list-item-alt"><a href="/annonces/maison-pussay-91740-r464002040"><img src="https://cdn.pap.fr/1.jpg"></a>
      <span class="item-price">340.000 €</span>
      <div class="item-title">Pussay (91740) <small>à 3km de Monnerville</small><ul><li>9 pièces</li><li>5 chambres</li><li>185 m²</li></ul></div></div>`;
  const { source, cards } = read(`<html><body>${html}</body></html>`, 'https://www.pap.fr/annonce/vente-maisons-monnerville-91930-g43262');
  assert.equal(source, 'pap');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].url, 'https://www.pap.fr/annonces/maison-pussay-91740-r464002040');
  assert.equal(cards[0].price, 340000);
  assert.deepEqual([cards[0].detail.city, cards[0].detail.postal, cards[0].detail.surface, cards[0].detail.pieces, cards[0].detail.chambres], ['Pussay', '91740', 185, 9, 5]);
});

test('PAP : bien d’une commune voisine, ville sans code postal, badge laissé de côté', () => {
  const html = `<div class="search-list-item-alt"><a href="/annonces/maison-mereville-r462804059"></a>
    <div class="item-title"><span class="item-price">220.000 €</span><span>Moins cher sur PAP</span>Méréville <small>à 5km de Monnerville</small><ul><li>6 pièces</li><li>104 m²</li></ul></div></div>`;
  const { cards } = read(`<html><body>${html}</body></html>`, 'https://www.pap.fr/annonce/x');
  assert.equal(cards[0].detail.city, 'Méréville');
  assert.equal(cards[0].detail.postal, null);
  assert.equal(cards[0].price, 220000);
});

test('SeLoger : bloc de données, annonces publiées seulement', () => {
  const ad = {
    url: '/annonces/achat/maison/marcq-en-baroeul-59/1.htm',
    status: 'Published',
    rawData: { propertyType: 'HOUSE', price: 650000 },
    hardFacts: { facts: [{ type: 'livingSpace', splitValue: '150,5' }, { type: 'numberOfRooms', splitValue: '6' }, { type: 'plotSpace', splitValue: '300' }] },
    location: { address: { city: 'Marcq-en-Barœul', zipCode: '59700' } },
    gallery: { images: [{ url: 'https://v.seloger.com/1.jpg' }] },
    energyClass: 'D',
  };
  const payload = JSON.stringify(JSON.stringify({ data: { items: [ad, { ...ad, url: '/2.htm', status: 'Sold' }] } }));
  const { source, cards } = read(`<html><body><script>window["__UFRN_FETCHER__"]=JSON.parse(${payload})</script></body></html>`, 'https://www.seloger.com/recherche/achat/maison/x');
  assert.equal(source, 'seloger');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].url, 'https://www.seloger.com/annonces/achat/maison/marcq-en-baroeul-59/1.htm');
  assert.equal(cards[0].price, 650000);
  assert.equal(cards[0].detail.surface, 151);
  assert.equal(cards[0].detail.terrain, 300);
  assert.equal(cards[0].detail.energyClass, 'D');
});

test('page sans annonce ou site inconnu : rien à envoyer', () => {
  assert.equal(read('<html><body>rien</body></html>', 'https://www.leboncoin.fr/recherche'), null);
  assert.equal(read('<html><body>rien</body></html>', 'https://www.exemple.fr/recherche'), null);
});

test('ce que lit l’extension passe le contrôle du serveur, pour les 4 sites', async () => {
  const KEY = 'a'.repeat(40);
  const NOW = 1_800_000_000_000;
  const redis = createFakeRedis();
  const space = await spaceOf(KEY);
  await redis.command(['ZADD', keys.spaces, String(NOW), space]);
  const zone = { communes: [{ code: '59378', nom: 'Marcq-en-Barœul', codesPostaux: ['59700'] }], type: 'maison' };
  await redis.command(['HSET', `imx:${space}:items`, 'zone:1', JSON.stringify({ data: zone, deleted: false })]);
  const lbc = read(`<html><body>${lbcData([lbcAd])}</body></html>`, 'https://www.leboncoin.fr/recherche');
  const bi = read(`<html><body><article class="ad-overview"><a href="/annonce/vente/marcq-en-baroeul/maison/5pieces/ag-1">Maison 5 pièces 100 m² 59700 Marcq-en-Barœul 495 000 €</a></article></body></html>`, 'https://www.bienici.com/recherche/achat');
  const pap = read(`<html><body><div class="search-list-item-alt"><a href="/annonces/maison-marcq-en-baroeul-59700-r1"></a><span class="item-price">300.000 €</span><div class="item-title">Marcq-en-Barœul (59700)<ul><li>100 m²</li></ul></div></div></body></html>`, 'https://www.pap.fr/annonce/x');
  for (const list of [lbc, bi, pap]) {
    const r = await handleIngest({ syncKey: KEY, redis, now: NOW, body: { source: list.source, cards: list.cards } });
    assert.deepEqual(r, { seen: 1, added: 1, ignored: 0 }, list.source);
  }
});

// Ce que la tournée quotidienne demande à la page : la liste est-elle arrivée, et combien de pages ?
function info(html, url) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  dom.window.eval(code);
  return JSON.parse(JSON.stringify(dom.window.__immodexListExtract.searchInfo(dom.window.document)));
}
const lbcSearch = (searchData) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { searchData } } })}</script>`;

test('Leboncoin : informations de la recherche (total, pages) quand la liste est arrivée', () => {
  const r = info(`<html><body>${lbcSearch({ ads: [lbcAd], total: 71, max_pages: 3 })}</body></html>`, 'https://www.leboncoin.fr/recherche?category=9');
  assert.deepEqual(r, { hasData: true, total: 71, maxPages: 3 });
});

test('Leboncoin : liste vide mais bien arrivée = résultat vide, pas un refus', () => {
  const r = info(`<html><body>${lbcSearch({ ads: [], total: 0 })}</body></html>`, 'https://www.leboncoin.fr/recherche?category=9');
  assert.equal(r.hasData, true);
  assert.equal(r.total, 0);
});

test('Leboncoin : page de défi (sans bloc de données ni carte) = pas de liste', () => {
  const r = info('<html><body><iframe src="https://geo.captcha-delivery.com/captcha/"></iframe></body></html>', 'https://www.leboncoin.fr/recherche?category=9');
  assert.equal(r.hasData, false);
});

test('autre site que Leboncoin : pas d’informations de recherche', () => {
  const dom = new JSDOM('<html></html>', { url: 'https://www.pap.fr/annonce/vente-maison', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  dom.window.eval(code);
  assert.equal(dom.window.__immodexListExtract.searchInfo(dom.window.document), null);
});
