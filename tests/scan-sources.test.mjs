import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, sourceById, readResults, slugOf } from '../api/_lib/sources.js';

const WAMB = { code: '59636', nom: 'Wambrechies', codesPostaux: ['59118'] };
const ANNECY = { code: '74010', nom: 'Annecy', codesPostaux: ['74000', '74370', '74600', '74940', '74960'] };
const SJ = { code: '74242', nom: 'Saint-Jorioz', codesPostaux: ['74410'] };
const SEVRIER = { code: '74267', nom: 'Sévrier', codesPostaux: ['74320'] };

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
  compimmo: ['https://www.compimmo.com/acheter?secteur=Saint-Jorioz', ['https://www.compimmo.com/acheter/maison-saint-jorioz-184', '/acheter/appartement-saint-jorioz-181', 'https://www.compimmo.com/acheter/terrain-saint-jorioz-95']],
  proprietesdulac: ['https://proprietesdulacdannecy.fr/biens-en-vente/', ['https://proprietesdulacdannecy.fr/lecrin/', 'https://proprietesdulacdannecy.fr/biens-en-vente/le-patio/', '/la-canopee/']],
};

test('les sources : 5 de la première version, 2 agences de Saint-Jorioz', () => {
  assert.deepEqual(SOURCES.map((s) => s.id), ['orpi', 'paruvendu', 'lesiteimmo', 'maes', 'deleu', 'compimmo', 'proprietesdulac']);
  assert.deepEqual(sourceById('maes').departments, ['59']);
  assert.deepEqual(sourceById('compimmo').departments, ['74']);
  assert.deepEqual(sourceById('proprietesdulac').departments, ['74']);
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

test('Compagnie Immobilière du Lac : une liste par secteur de l’agence, type lu dans l’adresse', () => {
  const src = sourceById('compimmo');
  assert.deepEqual(src.listUrls(SJ, 'maison'), ['https://www.compimmo.com/acheter?secteur=Saint-Jorioz']);
  assert.deepEqual(src.listUrls(SEVRIER, null), ['https://www.compimmo.com/acheter?secteur=Sevrier']);
  assert.deepEqual(src.listUrls(ANNECY, null), ['https://www.compimmo.com/acheter?secteur=Annecy']);
  // Commune hors des secteurs de l'agence : rien à lire.
  assert.deepEqual(src.listUrls({ code: '74182', nom: 'Menthon-Saint-Bernard', codesPostaux: ['74290'] }, null), []);
  assert.equal(src.pageUrl('https://www.compimmo.com/acheter?secteur=Saint-Jorioz', 2), 'https://www.compimmo.com/acheter?secteur=Saint-Jorioz&p=2');
  assert.equal(src.typeOf('https://www.compimmo.com/acheter/terrain-saint-jorioz-95', ''), 'terrain');
  assert.equal(src.typeOf('https://www.compimmo.com/acheter/appartement-saint-jorioz-181', ''), 'appartement');
  assert.equal(src.typeOf('https://www.compimmo.com/acheter/maison-saint-jorioz-184', ''), 'maison');
  // Locations et autres pages de l'agence : pas des annonces.
  const html = page([
    card('https://www.compimmo.com/acheter/maison-saint-jorioz-184', '1 150 000 €', 'Saint-Jorioz'),
    card('https://www.compimmo.com/louer/appartement-saint-jorioz-12', '1 200 €', 'Saint-Jorioz'),
    card('https://www.compimmo.com/acheter?secteur=Saint-Jorioz&p=2', '', 'Saint-Jorioz'),
  ]);
  const { cards } = readResults(html, 'https://www.compimmo.com/acheter?secteur=Saint-Jorioz', src, SJ);
  assert.deepEqual(cards.map((c) => c.url), ['https://www.compimmo.com/acheter/maison-saint-jorioz-184']);
});

test('Propriétés du Lac : une page pour toute l’agence, pages du site écartées, type lu dans la carte', () => {
  const src = sourceById('proprietesdulac');
  assert.deepEqual(src.listUrls(SJ, 'maison'), ['https://proprietesdulacdannecy.fr/biens-en-vente/']);
  assert.equal(src.pageUrl('https://proprietesdulacdannecy.fr/biens-en-vente/', 2), null);
  const nav = ['/', '/nos-biens/', '/biens-en-vente/', '/biens-vendus/', '/agence/', '/notre-equipe/', '/notre-equipe/sam/', '/nos-conseils/', '/estimation/', '/agence_st_jorioz/', '/agence-menthon-saint-bernard/', '/coups-de-coeur/', '/contact/', '/honoraires/', '/mentions-legales/'];
  const html = page([
    ...nav.map((h) => `<li><a href="${h}">Agence de Saint-Jorioz</a></li>`),
    `<article><a href="/biens-en-vente/le-patio/">Le Patio, bel appartement en rez-de-jardin</a><p>426 400 €</p><p>74410 Saint-Jorioz Type de bien Appartement T3</p></article>`,
    `<article><a href="/la-canopee/">La Canopée</a><p>1 550 000 €</p><p>74410 Saint-Jorioz Type de bien Chalet poteau poutre</p></article>`,
    `<article><a href="/lecrin/">L’Ecrin</a><p>1 120 000 €</p><p>74290 Alex Type de bien Maison</p></article>`,
  ]);
  const { cards } = readResults(html, 'https://proprietesdulacdannecy.fr/biens-en-vente/', src, SJ);
  assert.deepEqual(cards.map((c) => [c.url, c.price, c.type]), [
    ['https://proprietesdulacdannecy.fr/biens-en-vente/le-patio/', 426400, 'appartement'],
    ['https://proprietesdulacdannecy.fr/la-canopee/', 1550000, 'maison'],
  ]);
});

test('chaque source du robot a son nom dans le Fil (lien vers l’annonce)', async () => {
  const { SOURCE_LABELS } = await import('../src/common/listings.js');
  for (const s of SOURCES) assert.equal(SOURCE_LABELS[s.id], s.label, s.id);
});
