import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, sourceById, readResults, slugOf } from '../api/_lib/sources.js';

const WAMB = { code: '59636', nom: 'Wambrechies', codesPostaux: ['59118'] };
const ANNECY = { code: '74010', nom: 'Annecy', codesPostaux: ['74000', '74370', '74600', '74940', '74960'] };

// Une carte : lien de l'annonce (deux fois, photo et titre), compteur de photos, prix à part.
const card = (href, price, extra = '') =>
  `<article class="card"><a href="${href}"><img src="x.jpg"><span class="count">13</span></a>
   <div><a href="${href}">Maison 5 pièces ${extra}</a><p>80 m² · Wambrechies (59)</p><div class="price"><span>${price}</span></div></div></article>`;
const page = (cards) => `<!doctype html><html><body><header><a href="/">Accueil</a></header><main>${cards.join('')}</main>
  <footer><a href="/mentions">Mentions</a></footer></body></html>`;

const CASES = {
  orpi: ['https://www.orpi.com/annonces-immobilieres-wambrechies/vente-maison/', ['/annonce-vente-maison-t5-wambrechies-59118-aaa/', '/annonce-vente-maison-t4-wambrechies-59118-bbb/?utm=1', '/annonce-vente-maison-t6-wambrechies-59118-ccc/']],
  paruvendu: ['https://www.paruvendu.fr/immobilier/vente/maison/wambrechies-59118/', ['/immobilier/vente/maison/1295516811A1KIVHMN000', 'https://www.paruvendu.fr/immobilier/vente/maison/1292521679A1KIVHMN000', '/immobilier/vente/maison/1295064750A1KIVHMN000']],
  lesiteimmo: ['https://www.lesiteimmo.com/acheter/maison/wambrechies-59118', ['/acheter/maison-6pieces/wambrechies-59118/34125379', '/acheter/maison-4pieces/wambrechies-59118/34111770', '/acheter/maison-5pieces/wambrechies-59118/33871290']],
  maes: ['https://www.maesimmobilier.fr/type_offre/vente/', ['https://www.maesimmobilier.fr/bien-immobilier/maison-flamande-3-chambres-wambrechies/', 'https://www.maesimmobilier.fr/bien-immobilier/maison-semi-individuelle-wambrechies/', 'https://www.maesimmobilier.fr/bien-immobilier/maison-familiale-wambrechies/']],
  deleu: ['https://deleuimmobilier.com/fr/ventes', ['/fr/propriete/vente+maison+wambrechies+maison-3-chambres+86739359', '/fr/propriete/vente+maison+wambrechies+semi-flamande+87304342', '/fr/propriete/vente+maison+wambrechies+plain-pied+87508776']],
};

test('les 5 sources de la première version', () => {
  assert.deepEqual(SOURCES.map((s) => s.id), ['orpi', 'paruvendu', 'lesiteimmo', 'maes', 'deleu']);
  assert.deepEqual(sourceById('maes').departments, ['59']);
  assert.equal(sourceById('orpi').departments, null);
});

for (const [id, [url, hrefs]] of Object.entries(CASES)) {
  test(`${id} : cartes, adresses propres, prix lu à part du compteur de photos`, () => {
    const html = page([card(hrefs[0], '299 500 €'), card(hrefs[1], 'Prix sur demande'), card(hrefs[2], '1 090 000 €')]);
    const { cards } = readResults(html, url, sourceById(id), WAMB);
    assert.equal(cards.length, 3);
    assert.ok(cards.every((c) => c.url.startsWith('https://') && !c.url.includes('?')));
    assert.deepEqual(cards.map((c) => c.price), [299500, null, 1090000]);
  });
}

test('agence : seules les annonces de la commune sont gardées', () => {
  const html = page([
    card('/fr/propriete/vente+maison+wambrechies+maison-3-chambres+86739359', '299 500 €'),
    card('/fr/propriete/vente+maison+roncq+maison-individuelle+87307696', '420 000 €'),
  ]).replace(/Wambrechies \(59\)/g, '');
  const { cards } = readResults(html, 'https://deleuimmobilier.com/fr/ventes', sourceById('deleu'), WAMB);
  assert.deepEqual(cards.map((c) => c.price), [299500]);
  const maes = page([
    card('https://www.maesimmobilier.fr/bien-immobilier/maison-flamande/', '284 000 €', 'Wambrechies'),
    card('https://www.maesimmobilier.fr/bien-immobilier/maison-quesnoy/', '310 000 €', 'Quesnoy-sur-Deûle'),
  ]).replace(/Wambrechies \(59\)/g, '');
  const r = readResults(maes, 'https://www.maesimmobilier.fr/type_offre/vente/', sourceById('maes'), WAMB);
  assert.deepEqual(r.cards.map((c) => c.price), [284000]);
});

test('adresses des pages de résultats : commune, vente et type', () => {
  assert.equal(slugOf('Saint-André-lez-Lille'), 'saint-andre-lez-lille');
  assert.equal(slugOf("L'Isle-d'Abeau"), 'l-isle-d-abeau');
  assert.deepEqual(sourceById('orpi').listUrls(WAMB, 'maison'), ['https://www.orpi.com/annonces-immobilieres-wambrechies/vente-maison/']);
  assert.deepEqual(sourceById('paruvendu').listUrls(ANNECY, 'maison'), ['https://www.paruvendu.fr/immobilier/vente/maison/annecy-74000/']);
  assert.deepEqual(sourceById('lesiteimmo').listUrls(WAMB, null), ['https://www.lesiteimmo.com/acheter/maison/wambrechies-59118', 'https://www.lesiteimmo.com/acheter/appartement/wambrechies-59118']);
  assert.deepEqual(sourceById('maes').listUrls(WAMB, 'maison'), ['https://www.maesimmobilier.fr/type_offre/vente/']);
  assert.equal(sourceById('lesiteimmo').pageUrl('https://www.lesiteimmo.com/acheter/maison/wambrechies-59118', 2), 'https://www.lesiteimmo.com/acheter/maison/wambrechies-59118?page=2');
  assert.equal(sourceById('maes').pageUrl('https://www.maesimmobilier.fr/type_offre/vente/', 2), null);
});

test('cartes réelles : astérisque après le prix, compteur collé, biens vendus et autres communes écartés', () => {
  const html = page([
    `<article><a href="/annonce-vente-maison-t5-wambrechies-59118-aaa/"><div><span>3</span> <span>275 000 € *</span></div> Maison 82 m2 Wambrechies</a></article>`,
    `<article><a href="/annonce-vente-maison-t5-saint-andre-lez-lille-59350-bbb/">Vendu Soit 1 937,32 €/m2 Maison 5 pièces Saint-André-lez-Lille</a></article>`,
    `<article><a href="/annonce-vente-maison-t4-linselles-59126-ccc/">320 000 € Maison 4 pièces Linselles</a></article>`,
  ]).replace(/Wambrechies \(59\)/g, '');
  const { cards } = readResults(html, 'https://www.orpi.com/annonces-immobilieres-wambrechies/vente-maison/', sourceById('orpi'), WAMB);
  assert.deepEqual(cards.map((c) => c.price), [275000]);
});
