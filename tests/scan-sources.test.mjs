import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, sourceById, readResults, slugOf } from '../api/_lib/sources.js';

const WAMB = { code: '59636', nom: 'Wambrechies', codesPostaux: ['59118'] };
const ANNECY = { code: '74010', nom: 'Annecy', codesPostaux: ['74000', '74370', '74600', '74940', '74960'] };
const SJ = { code: '74242', nom: 'Saint-Jorioz', codesPostaux: ['74410'] };
const SEVRIER = { code: '74267', nom: 'Sévrier', codesPostaux: ['74320'] };
const LILLE_2 = { code: '59350', nom: 'Lille', codesPostaux: ['59000', '59800'] };

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
  leduc: ['https://immobilier.agence-leduc.fr/ventes-immobilieres-a-lille', ['/ventes-immobilieres-a-lille/vm332-leduc-wambrechies', 'https://immobilier.agence-leduc.fr/ventes-immobilieres-a-lille/va1967-leduc-wambrechies', '/ventes-immobilieres-a-lille/vm318-leduc-wambrechies']],
  vereecke: ['https://vereecke-immobilier.com/a-vendre/', ['/bien/maison-1930-3-chambres/', 'https://vereecke-immobilier.com/bien/appartement-t3-balcon/', '/bien/maison-semi-individuelle/']],
  briquerouge: ['https://www.brique-rouge-immobilier.fr/acheter/logement/wambrechies/tous_quartiers/toutes_chambres/0-0', ['/vente/maison/rare-canon-d-or-belle-maison-1930_30306', '/vente/appartement/t2-balcon_33317', 'https://www.brique-rouge-immobilier.fr/vente/maison/plain-pied_33491']],
  grimmelpont: ['https://www.grimmelpont.fr/acheter-biens-immobiliers', ['/immobilier/vente-maison-wambrechies/ref-VM473-GRIMMELPONT', 'https://www.grimmelpont.fr/immobilier/vente-appartement-wambrechies/ref-VA2375-GRIMMELPONT', '/immobilier/vente-maison-wambrechies/ref-VM480-GRIMMELPONT']],
  marquetteimmo: ['https://www.marquette-immobilier.fr/transaction/vente/', ['/immobilier/belle-maison-individuelle/', 'https://www.marquette-immobilier.fr/immobilier/maison-atypique/', '/immobilier/semi-individuelle-4-chambres/']],
};

test('les sources : 5 de la première version, 2 agences de Saint-Jorioz, 5 de Lambersart, Marquette et Saint-André, 5 réseaux, puis Marcq, Villeneuve-d’Ascq, Wasquehal et La Madeleine', () => {
  assert.deepEqual(SOURCES.map((s) => s.id), ['seloger', 'orpi', 'paruvendu', 'lesiteimmo', 'maes', 'deleu', 'compimmo', 'proprietesdulac', 'leduc', 'vereecke', 'briquerouge', 'grimmelpont', 'marquetteimmo', 'century21', 'laforet', 'iad', 'safti', 'nestenn', 'fnaim', 'citya', 'imko', 'immomarcq', 'heron', 'alerteimmo', 'cestpourtonbien', 'bhimmo', 'vastimmo', 'immotram', 'avenueimmo', 'brice', 'actionimmo', 'pepites', 'kw', 'duquesnoy', 'estime', 'duparque', 'rdimmo', 'clefs', 'immonot', 'vacossin', 'lekieffre', 'arthurimmo', 'barnes', 'bonte', 'drhouse', 'immosens', 'demarez', 'abrinor', 'pulp', 'agencelamadeleine', 'lecoutre', 'ericfranques', 'immoclef', 'saintmaur', 'grimonprez']);
  for (const id of ['century21', 'laforet', 'iad', 'safti', 'nestenn']) assert.equal(sourceById(id).departments, null, id);
  for (const id of ['leduc', 'vereecke', 'briquerouge', 'grimmelpont', 'marquetteimmo']) assert.deepEqual(sourceById(id).departments, ['59'], id);
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

test('agences de Lambersart, Marquette et Saint-André : listes, types, commune lue dans l’adresse quand la carte en cite d’autres', () => {
  const LAMB = { code: '59328', nom: 'Lambersart', codesPostaux: ['59130'] };
  const STA = { code: '59527', nom: 'Saint-André-lez-Lille', codesPostaux: ['59350'] };
  const LOMPRET = { code: '59356', nom: 'Lompret', codesPostaux: ['59840'] };
  // Brique Rouge : une liste par commune (404 quand l'agence n'y a aucun bien).
  assert.deepEqual(sourceById('briquerouge').listUrls(STA, 'maison'), ['https://www.brique-rouge-immobilier.fr/acheter/logement/saint-andre-lez-lille/tous_quartiers/toutes_chambres/0-0']);
  // Les autres : une seule page pour toute l'agence.
  for (const id of ['leduc', 'vereecke', 'grimmelpont', 'marquetteimmo']) {
    const [url, ...more] = sourceById(id).listUrls(LAMB, null);
    assert.equal(more.length, 0, id);
    assert.equal(sourceById(id).pageUrl(url, 2), null, id);
  }
  // Types lus dans l'adresse de l'annonce.
  const g = sourceById('grimmelpont');
  assert.equal(g.typeOf('https://www.grimmelpont.fr/immobilier/vente-immeuble-lille/ref-VI080-GRIMMELPONT', ''), 'immeuble');
  assert.equal(g.typeOf('https://www.grimmelpont.fr/immobilier/vente-appartement-lomme/ref-VA2375-GRIMMELPONT', ''), 'appartement');
  assert.equal(g.typeOf('https://www.grimmelpont.fr/immobilier/vente-maison-faches-thumesnil/ref-VM473-GRIMMELPONT', ''), 'maison');
  assert.equal(sourceById('leduc').typeOf('https://immobilier.agence-leduc.fr/ventes-immobilieres-a-lille/va1967-leduc-lambersart', ''), 'appartement');
  assert.equal(sourceById('leduc').typeOf('https://immobilier.agence-leduc.fr/ventes-immobilieres-a-lille/vm332-leduc-lambersart', ''), 'maison');
  assert.equal(sourceById('briquerouge').typeOf('https://www.brique-rouge-immobilier.fr/vente/terrain/terrain-constructible-1513m_33538', ''), 'terrain');
  // Grimmelpont : un appartement de Lomme « à la limite de Lambersart » n'est pas à Lambersart.
  const html = page([
    `<article><a href="/immobilier/vente-appartement-lomme/ref-VA2375-GRIMMELPONT">Appartement 53m² Lomme</a><p>179 000 €HAI</p><p>À la limite de Lambersart, au pied du métro</p></article>`,
    `<article><a href="/immobilier/vente-maison-lambersart/ref-VM480-GRIMMELPONT">Maison 120m² Lambersart</a><p>420 000 €HAI</p></article>`,
  ]);
  assert.deepEqual(readResults(html, 'https://www.grimmelpont.fr/acheter-biens-immobiliers', g, LAMB).cards.map((c) => [c.url, c.price]), [['https://www.grimmelpont.fr/immobilier/vente-maison-lambersart/ref-VM480-GRIMMELPONT', 420000]]);
  // Marquette Immobilier : commune en capitales dans la carte, biens vendus écartés.
  const mq = page([
    `<article><a href="/immobilier/belle-maison-individuelle/">Belle maison individuelle.</a>
     <p>LOMPRET</p> <p>Vente</p> <p>540 000 €</p> <p>SHAB 112 m²</p></article>`,
    `<article><a href="/immobilier/maison-atypique/">Maison atypique.</a>
     <p>LOMPRET</p> <p>Vendu</p> <p>155 750 €</p></article>`,
  ]);
  assert.deepEqual(readResults(mq, 'https://www.marquette-immobilier.fr/transaction/vente/', sourceById('marquetteimmo'), LOMPRET).cards.map((c) => [c.price, c.type]), [[540000, 'maison']]);
  // Vereecke : code postal et commune dans la carte.
  const ve = page([`<article><a href="/bien/appartement-t3-balcon/">Appartement T3 avec balcon</a><p>245 000 €</p><p>59350 SAINT ANDRE LEZ LILLE</p></article>`]);
  assert.deepEqual(readResults(ve, 'https://vereecke-immobilier.com/a-vendre/', sourceById('vereecke'), STA).cards.map((c) => [c.price, c.type]), [[245000, 'appartement']]);
});

test('ligature « œ » : Marcq-en-Barœul s’écrit « marcq-en-baroeul » dans les adresses et se reconnaît dans les cartes', () => {
  const MARCQ = { code: '59378', nom: 'Marcq-en-Barœul', codesPostaux: ['59700'] };
  assert.equal(slugOf('Marcq-en-Barœul'), 'marcq-en-baroeul');
  assert.equal(slugOf("Villeneuve-d'Ascq"), 'villeneuve-d-ascq');
  assert.deepEqual(sourceById('orpi').listUrls(MARCQ, 'maison'), ['https://www.orpi.com/annonces-immobilieres-marcq-en-baroeul/vente-maison/']);
  assert.deepEqual(sourceById('century21').listUrls(MARCQ, 'maison'), ['https://www.century21.fr/annonces/achat-maison/v-marcq+en+baroeul/']);
  const html = page([card('/annonce/maison-vente-5-pieces-marcq-en-baroeul-120m2/r1234567', '450 000 €')]);
  const { cards } = readResults(html, 'https://www.iadfrance.fr/annonces/marcq-en-baroeul-59700/vente/maison', sourceById('iad'), MARCQ);
  assert.equal(cards.length, 1);
});

test('commune abrégée dans la carte (« ST ANDRE LEZ LILLE ») : reconnue', () => {
  const STA = { code: '59527', nom: 'Saint-André-lez-Lille', codesPostaux: ['59350'] };
  const html = page([`<article><a href="/annonce-vente-maison-t4-aaa/">Maison 4 pièces</a> <p>ST ANDRE LEZ LILLE 59</p> <p>231 000 €</p></article>`]);
  assert.deepEqual(readResults(html, 'https://www.orpi.com/x/', sourceById('orpi'), STA).cards.map((c) => c.price), [231000]);
});

test('Century 21 : une liste par commune et par type, 20 par page, les biens « à proximité » ignorés', () => {
  const STA = { code: '59527', nom: 'Saint-André-lez-Lille', codesPostaux: ['59350'] };
  const LAMB = { code: '59328', nom: 'Lambersart', codesPostaux: ['59130'] };
  const src = sourceById('century21');
  assert.deepEqual(src.listUrls(STA, null), ['https://www.century21.fr/annonces/achat-maison/v-saint+andre+lez+lille/', 'https://www.century21.fr/annonces/achat-appartement/v-saint+andre+lez+lille/']);
  assert.deepEqual(src.listUrls(SEVRIER, 'maison'), ['https://www.century21.fr/annonces/achat-maison/v-sevrier/']);
  assert.equal(src.pageUrl('https://www.century21.fr/annonces/achat-appartement/v-lille/', 2), 'https://www.century21.fr/annonces/achat-appartement/v-lille/page-2/');
  assert.equal(src.pageSize, 20);
  // Page réelle (04/11/2026) : la carte du bien de la commune est collée à l'en-tête « Maison à
  // vendre Lambersart » ; les biens voisins sont dans un autre bloc.
  const html = `<html><body><header>Maison à vendre Lambersart 1 annonce immobilière</header>
    <section class="c-the-list-of-properties-list"><div class="tw-grid js-the-list-of-properties-list-property">
      <div class="c-the-property-thumbnail-with-content js-the-property-thumbnail-with-content"><a href="/trouver_logement/detail/16958995219/"></a>
        <p>LAMBERSART 59</p> <p>42 m2, 2 pièces</p> <p>Maison à vendre</p> <p>154 800 €</p></div></div></section>
    <div class="c-the-list-of-properties-related"><div class="c-the-list-of-properties-related__item">
      <div class="c-the-property-thumbnail"><a href="/trouver_logement/detail/16619588398/">Exclusivité LA MADELEINE 59</a> <p>529 000 €</p> <p>120 m2, maison, 5 pcs</p></div></div></div>
    </body></html>`;
  const r = readResults(html, 'https://www.century21.fr/annonces/achat-maison/v-lambersart/', src, LAMB);
  assert.deepEqual(r.cards.map((c) => [c.url, c.price, c.type]), [['https://www.century21.fr/trouver_logement/detail/16958995219/', 154800, 'maison']]);
  assert.equal(r.all.length, 1);
  // Commune sans bien : seuls les biens voisins, aucun n'est rangé dans la commune.
  const empty = html.replace(/<section[\s\S]*?<\/section>/, '').replace('Lambersart 1 annonce', 'Marquette-lez-Lille');
  assert.deepEqual(readResults(empty, 'https://www.century21.fr/annonces/achat-maison/v-marquette+lez+lille/', src, { code: '59386', nom: 'Marquette-lez-Lille', codesPostaux: ['59520'] }).cards, []);
});

test('Laforêt : une page par commune et par type, biens « à proximité » ignorés, code postal de la page écarté', () => {
  const src = sourceById('laforet');
  const LAMB = { code: '59328', nom: 'Lambersart', codesPostaux: ['59130'] };
  assert.deepEqual(src.listUrls(LAMB, 'maison'), ['https://www.laforet.com/ville/achat-maison-lambersart-59130']);
  assert.deepEqual(src.listUrls(SJ, null), ['https://www.laforet.com/ville/achat-maison-saint-jorioz-74410', 'https://www.laforet.com/ville/achat-appartement-saint-jorioz-74410']);
  assert.equal(src.pageUrl('https://www.laforet.com/ville/achat-maison-lambersart-59130', 2), null);
  // La fiche donne le code postal de l'agence (mentions légales) : la commune de la liste fait foi.
  assert.equal(src.pagePlace, false);
  const html = page([
    `<div id="standard--page--1" class="grid"><article><a href="/agence-immobiliere/la-madeleine/acheter/lambersart/maison-5-pieces-52842835"><img src="x.jpg"></a>
      <p>Maison</p> <p>449 000 €</p> <p>LAMBERSART (59130)</p> <p>140 m² • 5 pièces • 4 chambres</p></article></div>`,
    `<div id="nearest--page--1" class="grid"><article><a href="/agence-immobiliere/lambersart/acheter/lille/maison-6-pieces-52380889"><img src="x.jpg"></a>
      <p>Maison</p> <p>675 000 €</p> <p>LILLE (59000) près de Lambersart</p></article></div>`,
  ]);
  const r = readResults(html, 'https://www.laforet.com/ville/achat-maison-lambersart-59130', src, LAMB);
  assert.deepEqual(r.cards.map((c) => [c.url, c.price, c.type]), [['https://www.laforet.com/agence-immobiliere/la-madeleine/acheter/lambersart/maison-5-pieces-52842835', 449000, 'maison']]);
  assert.equal(src.typeOf('https://www.laforet.com/agence-immobiliere/lille/acheter/lille/appartement-2-pieces-52979419', ''), 'appartement');
});

test('IAD et SAFTI : une liste par commune, code postal et type, commune lue dans l’adresse', () => {
  const LAMB = { code: '59328', nom: 'Lambersart', codesPostaux: ['59130'] };
  const iad = sourceById('iad');
  assert.deepEqual(iad.listUrls(LAMB, null), ['https://www.iadfrance.fr/annonces/lambersart-59130/vente/maison', 'https://www.iadfrance.fr/annonces/lambersart-59130/vente/appartement']);
  // Commune à plusieurs codes postaux : une liste par code postal.
  assert.deepEqual(iad.listUrls(LILLE_2, 'maison'), ['https://www.iadfrance.fr/annonces/lille-59000/vente/maison', 'https://www.iadfrance.fr/annonces/lille-59800/vente/maison']);
  assert.equal(iad.pageSize, 30);
  assert.equal(iad.pageUrl('https://www.iadfrance.fr/annonces/lille-59000/vente/appartement', 2), 'https://www.iadfrance.fr/annonces/lille-59000/vente/appartement?page=2');
  assert.equal(iad.typeOf('https://www.iadfrance.fr/annonce/appartement-vente-3-pieces-lille-62m2/r2100000', ''), 'appartement');
  assert.equal(iad.typeOf('https://www.iadfrance.fr/annonce/maison-vente-4-pieces-lambersart-80m2/r2124051', ''), 'maison');
  const safti = sourceById('safti');
  assert.deepEqual(safti.listUrls(LAMB, 'maison'), ['https://www.safti.fr/annonces/achat/maison/lambersart-59130']);
  assert.deepEqual(safti.listUrls(ANNECY, 'appartement'), ['https://www.safti.fr/annonces/achat/appartement/annecy-all-cp']);
  assert.equal(safti.pageSize, 24);
  assert.equal(safti.pageUrl('https://www.safti.fr/annonces/achat/maison/lambersart-59130', 2), 'https://www.safti.fr/annonces/achat/maison/lambersart-59130?page=2');
  assert.equal(safti.typeOf('https://www.safti.fr/annonces/achat/immeuble/lavelanet-09300/1737652', ''), 'immeuble');
  // IAD : un bien « Sous compromis » n'est plus à vendre.
  const html = page([
    `<article><a href="/annonce/maison-vente-4-pieces-lambersart-80m2/r2124051">Maison à Lambersart</a> <p>323 000 €</p> <p>80 m²</p></article>`,
    `<article><a href="/annonce/maison-vente-5-pieces-lambersart-92m2/r2099836">Maison à Lambersart</a> <p>Sous compromis</p> <p>344 900 €</p></article>`,
  ]);
  assert.deepEqual(readResults(html, 'https://www.iadfrance.fr/annonces/lambersart-59130/vente/maison', iad, LAMB).cards.map((c) => c.price), [323000]);
});

test('Nestenn : une page par commune et par type, biens voisins (« À 900 m de 59130 ») et biens vendus écartés', () => {
  const LAMB = { code: '59328', nom: 'Lambersart', codesPostaux: ['59130'] };
  const src = sourceById('nestenn');
  assert.deepEqual(src.listUrls(LAMB, null), ['https://nestenn.com/vente/maison/lambersart-59130', 'https://nestenn.com/vente/appartement/lambersart-59130']);
  // Les biens disponibles viennent en tête de la première page ; les suivantes ne montrent que des biens vendus.
  assert.equal(src.pageUrl('https://nestenn.com/vente/maison/lambersart-59130', 2), null);
  const html = page([
    `<div><a href="/lambersart-bourg-mairie-maison-renovee-4-chambres-et-jardin-ref-39657233"></a> <p>EXCLU</p> <p>59130 LAMBERSART</p> <p>Maison à vendre</p> <p>110m² 5 pièces 4 chambres</p> <p>435 000 €</p></div>`,
    `<div><a href="/maison-lille-5-piece-s-112-m2-ref-39637823"></a> <p>EXCLU</p> <p>À 900 m de 59130 Lambersart</p> <p>Maison à vendre</p> <p>294 500 €</p></div>`,
    `<div><a href="/lambersart-canteleu-ref-33088721"></a> <p>59130 LAMBERSART</p> <p>Maison vendue</p> <p>72m² 5 pièces</p></div>`,
    `<div><a href="/maison-lambersart-ref-33088308"></a> <p>59130 LAMBERSART</p> <p>Maison plus disponible</p> <p>85m²</p></div>`,
  ]);
  assert.deepEqual(readResults(html, 'https://nestenn.com/vente/maison/lambersart-59130', src, LAMB).cards.map((c) => [c.url, c.price, c.type]), [['https://nestenn.com/lambersart-bourg-mairie-maison-renovee-4-chambres-et-jardin-ref-39657233', 435000, 'maison']]);
});

const MARCQ = { code: '59378', nom: 'Marcq-en-Barœul', codesPostaux: ['59700'] };
const VDA = { code: '59009', nom: "Villeneuve-d'Ascq", codesPostaux: ['59491', '59493', '59650'] };

// Page Netty : biens dans un bloc de données codé en base64, aucun lien vers les fiches.
const nettyPage = (prodId, prodCount) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
  return `<html><body><script>var _TEMPLATE_DATA = JSON.parse(b64_to_utf8('${b64({ menu: [1, 2] })}'));</script>
    <script>var _TEMPLATE_DATA = JSON.parse(b64_to_utf8('${b64({ prodId, prodCount })}'));</script></body></html>`;
};
const prod = (slug, extra) => ({ url: { fr: slug }, type_offer: 1, prod_type: 'house', city: 'Villeneuve-d’Ascq', cp: '59650', price2: 300000, promo: 0, promo_list: '[]', title: { fr: '' }, ...extra });

test('sites Netty : biens lus dans les données codées, vendus, locations et autres communes écartés', () => {
  const src = sourceById('heron');
  assert.deepEqual(src.listUrls(VDA, 'maison'), ['59491', '59493', '59650'].map((cp) => `https://www.heronimmobilier.fr/vente/maison/villeneuve-d-ascq/${cp}`));
  const html = nettyPage(
    {
      VM1: prod('maison-individuelle-5-pieces-villeneuve-d-ascq-59650', { title: { fr: 'Maison familiale' } }),
      VA2: prod('appartement-3-pieces-villeneuve-d-ascq-59650', { prod_type: 'appt', price2: 0, pricePrimary: 189000 }),
      VM3: prod('maison-4-pieces-villeneuve-d-ascq-59650', { promo: 1000 }),
      VM4: prod('maison-4-pieces-villeneuve-d-ascq-59650-b', { promo_list: '[1001]' }),
      LM5: prod('maison-4-pieces-villeneuve-d-ascq-59650-c', { type_offer: 2 }),
      VM6: prod('maison-lille-59000', { city: 'Lille', cp: '59000' }),
    },
    30,
  );
  const r = readResults(html, 'https://www.heronimmobilier.fr/vente/maison/villeneuve-d-ascq/59650', src, VDA);
  assert.deepEqual(r.cards.map((c) => [c.url, c.price, c.type]), [
    ['https://www.heronimmobilier.fr/vente/maison-individuelle-5-pieces-villeneuve-d-ascq-59650,VM1', 300000, 'maison'],
    ['https://www.heronimmobilier.fr/vente/appartement-3-pieces-villeneuve-d-ascq-59650,VA2', 189000, 'appartement'],
  ]);
  // Les biens vendus et ceux d'autres communes comptent parmi les biens vus (pas la location).
  assert.equal(r.all.length, 5);
  assert.equal(r.full, false);
  // Page pleine (12 biens) et d'autres pages annoncées : la liste continue.
  const twelve = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`VM${i}`, prod(`maison-${i}-villeneuve-d-ascq-59650`)]));
  const p2 = 'https://www.imko.fr/vente/maison/villeneuve-d-ascq/59650?page=2';
  assert.equal(readResults(nettyPage(twelve, 30), p2, sourceById('imko'), VDA).full, true);
  assert.equal(readResults(nettyPage(twelve, 24), p2, sourceById('imko'), VDA).full, false);
  assert.equal(readResults('<html><body>Aucun bien</body></html>', p2, sourceById('imko'), VDA).cards.length, 0);
});

test('FNAIM : une liste par commune et par type, commune lue dans le code INSEE quand la fiche porte « nord-59 »', () => {
  const src = sourceById('fnaim');
  assert.deepEqual(src.listUrls(MARCQ, null), ['maison', 'appartement'].map((t) => `https://www.fnaim.fr/liste-annonces-immobilieres/17-acheter-${t}-marcq-en-baroeul-59700.htm`));
  assert.equal(src.pageUrl(src.listUrls(MARCQ, 'maison')[0], 2), 'https://www.fnaim.fr/liste-annonces-immobilieres/17-acheter-maison-marcq-en-baroeul-59700-page-2.htm');
  const fn = (id, slug, code, text) =>
    `<li class="item"><a class="linkAnnonce" data-code="${code}" href="/annonce-immobiliere/${id}/17-acheter-maison-${slug}.htm#AGE_CONTACT"><img></a>
     <a class="linkAnnonce" data-code="${code}" href="/annonce-immobiliere/${id}/17-acheter-maison-${slug}.htm">Maison 4 pièces</a><p>${text}</p><span>320 000€</span></li>`;
  const html = page([
    fn(1, 'marcq-en-baroeul-59700', '59378', 'MARCQ EN BAROEUL 59700'),
    fn(2, 'nord-59', '59378', 'Jolie maison proche du tram'),
    fn(3, 'nord-59', '59009', 'Jolie maison proche du lac'),
    fn(4, 'nord-59', '59378', 'SOUS COMPROMIS ! Maison 1930'),
  ]);
  const r = readResults(html, src.listUrls(MARCQ, 'maison')[0], src, MARCQ);
  assert.deepEqual(r.cards.map((c) => c.url.split('/')[4]), ['1', '2']);
  assert.ok(r.cards.every((c) => c.price === 320000 && c.type === 'maison'));
});

test('Citya, Immotram, La Boîte Immo et Action : listes par commune, biens sous compromis ou vendus écartés', () => {
  assert.deepEqual(sourceById('citya').listUrls(VDA, 'maison'), ['https://www.citya.com/annonces/vente/maison/villeneuve-dascq-59009']);
  assert.deepEqual(sourceById('citya').listUrls(MARCQ, 'maison'), ['https://www.citya.com/annonces/vente/maison/marcq-en-baroeul-59700']);
  assert.deepEqual(sourceById('immotram').listUrls(MARCQ, 'maison'), ['https://www.immotram.fr/acheter-bien-immobilier-ville-marcq-en-baroeul-3.html']);
  assert.deepEqual(sourceById('immotram').listUrls(WAMB, 'maison'), []);
  const brice = sourceById('brice');
  assert.deepEqual(brice.listUrls(VDA, 'maison'), ['https://www.brice-habitat.com/vente/1-villeneuve-d-ascq/maison/1']);
  assert.deepEqual(brice.listUrls(MARCQ, 'maison'), []);
  assert.equal(brice.pageUrl('https://www.brice-habitat.com/vente/1-villeneuve-d-ascq/maison/1', 3), 'https://www.brice-habitat.com/vente/1-villeneuve-d-ascq/maison/3');
  const lbi = page([
    `<div class="bien"><a href="/vente/1-villeneuve-d-ascq/maison/4355-plain-pied-sur-1054-m">Villeneuve-d'Ascq (59493) Maison 3 pièce(s) <span>462 000 €</span></a></div>`,
    `<div class="bien"><a href="/vente/1-villeneuve-d-ascq/maison/4235-3-chambres-jardin">Sous-compromis Villeneuve-d'Ascq (59650) Maison <span>323 900 €</span></a></div>`,
    `<nav><a href="/vente/1-villeneuve-d-ascq/maison/2">2</a></nav>`,
  ]);
  const r = readResults(lbi, 'https://www.brice-habitat.com/vente/1-villeneuve-d-ascq/maison/1', brice, VDA);
  assert.deepEqual(r.cards.map((c) => c.price), [462000]);
  assert.equal(r.all.length, 2);
  const action = page([
    `<div class="bien"><a href="/fiche-maison-a-vendre-villeneuve-d-ascq-ref-1248.php"><img alt="Maison"> MAISON A VENDRE VILLENEUVE D ASCQ <b>310 000 €</b></a></div>`,
    `<div class="bien"><a href="/fiche-maison-a-vendre-villeneuve-d-ascq-ref-1034.php"><img alt="Maison - VENDU"> MAISON A VENDRE VILLENEUVE D ASCQ <b>250 000 €</b></a></div>`,
  ]);
  const a = readResults(action, 'https://action.immo/achat-maison-villeneuve-d-ascq.php', sourceById('actionimmo'), VDA);
  assert.deepEqual(a.cards.map((c) => c.price), [310000]);
});

const WASQ = { code: '59646', nom: 'Wasquehal', codesPostaux: ['59290'] };

test('lot 2 : adresses des listes (KW sous « /fr », Kaio, notaires, Arthurimmo, Dr House...)', () => {
  assert.deepEqual(sourceById('kw').listUrls(MARCQ, 'maison'), ['https://www.kwfrance.com/fr/vente/maison/marcq-en-baroeul/59700']);
  assert.equal(sourceById('kw').departments, null);
  assert.deepEqual(sourceById('duquesnoy').listUrls(WASQ, 'maison'), ['https://www.duquesnoyimmobilier.com/vente/1-wasquehal/maison/1']);
  assert.deepEqual(sourceById('estime').listUrls(MARCQ, 'appartement'), ['https://www.estime-immo.com/vente/158-marcq-en-baroeul/appartement/1']);
  const kaio = sourceById('duparque');
  assert.deepEqual(kaio.listUrls(MARCQ, null), ['https://www.valerie-duparque-immobilier.com/vente-maisons,c11/', 'https://www.valerie-duparque-immobilier.com/vente-appartements,c12/']);
  assert.equal(kaio.pageUrl('https://www.valerie-duparque-immobilier.com/vente-maisons,c11/', 2), 'https://www.valerie-duparque-immobilier.com/vente-maisons,c11/page-2/');
  assert.deepEqual(sourceById('rdimmo').listUrls(MARCQ, 'maison'), ['https://www.rdimmo.fr/vente/immobilier/marcq-en-baroeul/']);
  assert.equal(sourceById('rdimmo').pageUrl('https://www.rdimmo.fr/vente/immobilier/marcq-en-baroeul/', 2), 'https://www.rdimmo.fr/vente/immobilier/marcq-en-baroeul/?p=2');
  assert.deepEqual(sourceById('clefs').listUrls(VDA, 'maison'), ['https://www.lesclefsdechezmoi.fr/achat-immobilier/nord/villeneuve-d-ascq/maisons/']);
  assert.deepEqual(sourceById('immonot').listUrls(MARCQ, 'maison'), ['https://www.immonot.com/immobilier-notaire/annonces/Ccom_59378_59700/achat-maison-a-vendre-59700-marcq-en-baroeul-nord.html']);
  assert.deepEqual(sourceById('arthurimmo').listUrls(WASQ, 'maison'), ['https://www.arthurimmo.com/immobilier/achat/immo-wasquehal-59290/bien-maison']);
  assert.deepEqual(sourceById('arthurimmo').listUrls(VDA, 'maison'), ['https://www.arthurimmo.com/immobilier/achat/immo-villeneuve-d-ascq-59/bien-maison']);
  assert.deepEqual(sourceById('drhouse').listUrls(VDA, 'maison'), ['https://www.drhouse-immo.com/annonces/vente/maison/villeneuve-d-ascq-59491']);
  assert.deepEqual(sourceById('immosens').listUrls(MARCQ, 'maison'), ['https://www.immosens.fr/vente-maison-marcq-en-baroeul.htm']);
  assert.deepEqual(sourceById('barnes').listUrls(MARCQ, 'maison'), ['https://www.barnes-lille.com/fr/vente/marcq-en-baroeul.html']);
});

test('lot 2 : listes de toute l’agence, commune lue dans l’adresse de la fiche (même écrite « villeneuve-dascq »)', () => {
  const html = page([
    card('/ventes-immobilieres/annonces/vente-maison-t4-137m2-villeneuve-dascq-59650-9997.htm', '430 000,00 €'),
    card('/ventes-immobilieres/annonces/vente-maison-t5-93m2-lomme-59160-10138.htm', '250 000,00 €'),
    card('/ventes-immobilieres/annonces/vente-appartement-t3-75m2-roubaix-59100-10184.htm', '150 000,00 €'),
  ]);
  const r = readResults(html, 'https://vacossin-associes.notaires.fr/ventes-immobilieres.htm', sourceById('vacossin'), VDA);
  assert.deepEqual(r.cards.map((c) => [c.price, c.type]), [[430000, 'maison']]);
  assert.equal(r.all.length, 3);
  const lk = page([
    card('/fiche-maison-a-vendre-wasquehal-ref-114.php', '364 000 €'),
    card('/fiche-type-5-a-vendre-wasquehal-ref-123.php', '199 000 €'),
    card('/fiche-maison-a-vendre-lambersart-ref-122.php', '420 000 €'),
  ]);
  assert.deepEqual(readResults(lk, 'https://www.lekieffre-immobilier.fr/vente.php', sourceById('lekieffre'), WASQ).cards.map((c) => c.type), ['maison', 'appartement']);
  const bonte = page([
    card('/fr/propriete/vente+maison+marcq-en-baroeul+demeure-d-architecte+87302601', '1 490 000 €'),
    card('/fr/propriete/vente+appartement+lannoy+appartement-t2+87109458', '120 000 €'),
  ]);
  assert.deepEqual(readResults(bonte, 'https://bonteimmo.com/fr/vente', sourceById('bonte'), MARCQ).cards.map((c) => c.price), [1490000]);
  const kaio = page([
    card('https://www.valerie-duparque-immobilier.com/vente-maison-marcq-en-baroeul,b562/', '289 500 €'),
    card('https://www.valerie-duparque-immobilier.com/vente-maison-bondues,b570/', '389 500 €'),
    card('https://www.valerie-duparque-immobilier.com/nos-biens-immobilier-vendus,c30/', '1 €'),
  ]);
  assert.deepEqual(readResults(kaio, 'https://www.valerie-duparque-immobilier.com/vente-maisons,c11/', sourceById('duparque'), MARCQ).cards.map((c) => c.price), [289500]);
});

test('KW (Netty sous « /fr ») : fiches sous « /fr/vente/ »', () => {
  const html = nettyPage({ VM49828: prod('maison-individuelle-8-pieces-marcq-en-baroeul-59700', { city: 'Marcq-en-Baroeul', cp: '59700', price2: 848000 }) }, 1);
  const r = readResults(html, 'https://www.kwfrance.com/fr/vente/maison/marcq-en-baroeul/59700', sourceById('kw'), MARCQ);
  assert.deepEqual(r.cards.map((c) => [c.url, c.price]), [['https://www.kwfrance.com/fr/vente/maison-individuelle-8-pieces-marcq-en-baroeul-59700,VM49828', 848000]]);
});

test('Dr House : la carte s’arrête au bloc de l’annonce, le filtre de prix de la page est ignoré', () => {
  const html = `<html><body><form><label>Prix max</label><span>75 000 €</span></form><div class="grid">
    <article><a href="/annonce/vente/marcq-en-baroeul-59700/maison-4-pieces-83m2/162183">Maison 4 pièces de 83 m² - Marcq-en-Barœul (59700)</a><p><span>389 000 €</span></p></article></div></body></html>`;
  const r = readResults(html, 'https://www.drhouse-immo.com/annonces/vente/maison/marcq-en-baroeul-59700', sourceById('drhouse'), MARCQ);
  assert.deepEqual(r.cards.map((c) => c.price), [389000]);
});

test('Abrinor : interface JSON filtrée par commune, parkings et locations écartés', () => {
  const src = sourceById('abrinor');
  const list = src.listUrls(VDA, 'maison')[0];
  const u = new URL(list);
  assert.equal(u.pathname, '/wp-json/laconfection-abrinor/v1/annonces-results');
  assert.equal(u.searchParams.get('lab_cities[]'), "59009;Villeneuve-d'Ascq;;");
  assert.equal(new URL(src.pageUrl(list, 3)).searchParams.get('paged'), '3');
  const inner = page([
    card('https://www.abrinor.fr/annonce/vente-maison-villeneuve-d-ascq-59650-vda-40301-ab/', '259 800 €'),
    card('https://www.abrinor.fr/annonce/location-maison-villeneuve-d-ascq-59650-lmai1234/', '1 200 €'),
    card('https://www.abrinor.fr/annonce/vente-parking-villeneuve-d-ascq-59650-260128/', '20 000 €'),
    card('https://www.abrinor.fr/annonce/vente-appartement-lille-59000-lill-40290-jl/', '189 000 €'),
  ]);
  const r = readResults(JSON.stringify({ html: inner }), list, src, VDA);
  assert.deepEqual(r.cards.map((c) => [c.price, c.type]), [[259800, 'maison']]);
  assert.equal(r.all.length, 4);
  // Réponse d'une autre forme : erreur (liste non confirmée), jamais une liste vide.
  assert.throws(() => readResults('<html>erreur</html>', list, src, VDA));
  assert.throws(() => readResults('{"code":"rest_no_route"}', list, src, VDA));
  const dm = page([
    card('/fiche-maison-a-vendre-villeneuve-d-ascq-ref-1887.php', '555 000 €'),
    card('/fiche-studio-a-vendre-mons-en-baroeul-ref-1598.php', '99 000 €'),
  ]);
  assert.deepEqual(readResults(dm, 'https://www.demarezimmo.fr/vente.php', sourceById('demarez'), VDA).cards.map((c) => c.price), [555000]);
});

const LMD = { code: '59368', nom: 'La Madeleine', codesPostaux: ['59110'] };

test('La Madeleine : Immotram, sites 3Clics, Saint Maur et Grimonprez', () => {
  assert.deepEqual(sourceById('immotram').listUrls(LMD, 'maison'), ['https://www.immotram.fr/acheter-bien-immobilier-ville-la-madeleine-2.html']);
  assert.deepEqual(sourceById('saintmaur').listUrls(LMD, 'maison'), ['https://www.agencesaintmaur.fr/vente/maison/la-madeleine/59110']);
  assert.deepEqual(sourceById('grimonprez').listUrls(LMD, 'maison'), ['https://www.grimonprez.immo/vente/588-la-madeleine/maison/1']);
  const adlm = sourceById('agencelamadeleine');
  assert.deepEqual(adlm.listUrls(LMD, 'maison'), ['https://www.agencedelamadeleine.com/vente']);
  assert.equal(adlm.pageUrl('https://www.agencedelamadeleine.com/vente', 2), 'https://www.agencedelamadeleine.com/vente/page-2');
  assert.equal(sourceById('lecoutre').pageUrl('https://www.lecoutre-immobilier.com/vente', 2), null);
  const html = page([
    card('/vente/maison/la-madeleine/annonce-immobiliere-ref3724', '529 000 €'),
    card('/vente/maison/la-madeleine/annonce-immobiliere-ref3657', '190 000 €', 'SOUS COMPROMIS'),
    card('/vente/appartement/la-madeleine/annonce-immobiliere-ref3701', '187 000 €'),
    card('/vente/parking/la-madeleine/annonce-immobiliere-ref3702', '15 000 €'),
    card('/vente/maison/marcq-en-baroeul/annonce-immobiliere-ref3696-2', '450 000 €'),
  ]);
  const r = readResults(html, 'https://www.agencedelamadeleine.com/vente', adlm, LMD);
  assert.deepEqual(r.cards.map((c) => [c.price, c.type]), [[529000, 'maison'], [187000, 'appartement']]);
  assert.equal(r.all.length, 5);
});

test('Immoclef : la commune est celle de l’adresse de la fiche, sinon celle qui ouvre la carte', () => {
  const src = sourceById('immoclef');
  const c = (href, place, price, text) => `<article><a href="${href}"><img src="x.jpg"></a><div><a href="${href}">${place} Vente maison</a><span>${price}</span><p>${text}</p></div></article>`;
  const html = page([
    c('/bien-immobilier-vente-maison-la-madeleine-R-vm472.html', 'La Madeleine', '367 000 €', 'L’agence IMMOCLEF, rue Pompidou à La Madeleine'),
    c('/bien-immobilier-vente-maison--R-vm462.html', 'Marcq-en-Baroeul', '390 000 €', 'L’agence IMMOCLEF à La Madeleine'),
    c('/bien-immobilier-vente-maison--R-vm470.html', 'La Madeleine Exclu', '262 000 €', 'Maison 83 m²'),
    c('/bien-immobilier-vente-appartement-lille-R-va2021.html', 'Lille', '294 000 €', 'L’agence IMMOCLEF à La Madeleine'),
  ]);
  const url = 'https://www.immoclef.fr/acheter-bien-immobilier.html';
  assert.deepEqual(readResults(html, url, src, LMD).cards.map((x) => x.price), [367000, 262000]);
  assert.deepEqual(readResults(html, url, src, MARCQ).cards.map((x) => x.price), [390000]);
  assert.equal(src.pageUrl(url, 2), 'https://www.immoclef.fr/acheter-bien-immobilier.html?page=2');
});

test('Pulp : annonces lues dans le plan du site (interface interdite par robots.txt), prix lu sur la fiche', () => {
  const src = sourceById('pulp');
  const xml = `<?xml version="1.0"?><urlset>
    <url><loc>https://www.pulp-immobilier.fr/annonces-vente/maison-la-madeleine-lam16905.htm</loc></url>
    <url><loc>https://www.pulp-immobilier.fr/annonces-vente/appartement-la-madeleine-lam16950.htm</loc></url>
    <url><loc>https://www.pulp-immobilier.fr/annonces-vente/garage-villeneuve-d-ascq-vda201.htm</loc></url>
    <url><loc>https://www.pulp-immobilier.fr/annonces-vente/maison-seclin-secf64.htm</loc></url></urlset>`;
  const r = readResults(xml, src.listUrls(LMD, 'maison')[0], src, LMD);
  assert.deepEqual(r.cards.map((c) => [c.url, c.price, c.type]), [
    ['https://www.pulp-immobilier.fr/annonces-vente/maison-la-madeleine-lam16905.htm', null, 'maison'],
    ['https://www.pulp-immobilier.fr/annonces-vente/appartement-la-madeleine-lam16950.htm', null, 'appartement'],
  ]);
  assert.equal(r.full, false);
});

test('Nestenn : `<base href="/">`, les liens relatifs partent de la racine du site', () => {
  const LAMB = { code: '59328', nom: 'Lambersart', codesPostaux: ['59130'] };
  const list = 'https://nestenn.com/vente/maison/lambersart-59130';
  const html = page([`<div><a href="lambersart-maison-4-chambres-ref-39657233"></a> <p>59130 LAMBERSART</p> <p>Maison à vendre</p> <p>435 000 €</p></div>`]).replace('<html>', '<html><head><base href="/"></head>');
  assert.deepEqual(readResults(html, list, sourceById('nestenn'), LAMB).cards.map((c) => c.url), ['https://nestenn.com/lambersart-maison-4-chambres-ref-39657233']);
});

test('« vendu » : les biens vendus sont écartés, pas ceux qui « seront vendus avec un garage »', () => {
  const LAMB = { code: '59328', nom: 'Lambersart', codesPostaux: ['59130'] };
  const list = 'https://www.grimmelpont.fr/acheter-biens-immobiliers';
  const hrefOf = (i) => `/immobilier/vente-maison-lambersart/ref-VM47${i}-GRIMMELPONT`;
  const cardWith = (i, text) => `<article><a href="${hrefOf(i)}">Maison ${text} Lambersart</a><p>299 000 €</p></article>`;
  const kept = (texts) => readResults(page(texts.map((t, i) => cardWith(i, t))), list, sourceById('grimmelpont'), LAMB).cards.length;
  for (const text of ['sera vendu avec un garage', 'vendu occupé', 'vendue meublée', 'à vendre']) assert.equal(kept([text]), 1, text);
  for (const text of ['Vendu', 'vendue', 'sous compromis', 'plus disponible']) assert.equal(kept([text]), 0, text);
});

// Une page SeLoger : le bloc de données que le site place dans sa page, encodé comme lui.
const selogerAd = (id, over = {}) => ({
  url: `https://www.seloger.com/annonce/achat/hauts-de-france/nord-59/marcq-en-baroeul-59700/${id}`,
  status: 'Published',
  location: { address: { city: 'Marcq-en-Barœul', zipCode: '59700' } },
  hardFacts: { title: 'Maison à vendre', facts: [{ type: 'numberOfRooms', splitValue: '6' }, { type: 'numberOfBedrooms', splitValue: '4' }, { type: 'livingSpace', splitValue: '140,5' }, { type: 'plotSpace', splitValue: '1 200' }] },
  rawData: { price: 490000, propertyType: 'HOUSE' },
  energyClass: 'C',
  gallery: { images: [{ url: 'https://photo.test/1.jpg' }] },
  ...over,
});
const selogerPage = (ads, links = '') => `<html><body>${links}<script>window["__UFRN_FETCHER__"]=JSON.parse(${JSON.stringify(JSON.stringify({ data: { classifieds: ads } }))});</script></body></html>`;

test('SeLoger : les annonces et leurs détails viennent du bloc de données de la page', () => {
  const src = sourceById('seloger');
  const url = src.listUrls(MARCQ, 'maison')[0];
  assert.equal(url, 'https://www.seloger.com/immobilier/achat/immo-marcq-en-baroeul-59/bien-maison/');
  const html = selogerPage([selogerAd('AAA111'), selogerAd('BBB222', { url: 'https://www.bellesdemeures.com/annonces/achat/BBB222' }), selogerAd('CCC333', { status: 'Sold' })]);
  const { cards } = readResults(html, url, src, MARCQ);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].url, 'https://www.seloger.com/annonce/achat/hauts-de-france/nord-59/marcq-en-baroeul-59700/AAA111');
  assert.equal(cards[0].price, 490000);
  assert.equal(cards[0].type, 'maison');
  assert.deepEqual(cards[0].detail, { surface: 141, pieces: 6, chambres: 4, terrain: 1200, photo: 'https://photo.test/1.jpg', postal: '59700', city: 'Marcq-en-Barœul', energyClass: 'C' });
  // Page d'une autre forme : une erreur, pour ne rien conclure sur les absences.
  assert.throws(() => readResults('<html><body>Maintenance</body></html>', url, src, MARCQ));
});

test('SeLoger : ne suit que les quartiers et nombres de pièces de la commune, jamais sa pagination', () => {
  const src = sourceById('seloger');
  const url = src.listUrls(MARCQ, 'maison')[0];
  const links = ['/recherche/achat/maison/marcq-en-baroeul-59700/mairie-59700/nbh2fr4474', '/recherche/achat/maison/piece-3/hauts-de-france/marcq-en-baroeul-59700/ad08fr23643', '/recherche/achat/appartement/marcq-en-baroeul-59700/mairie-59700/nbh2fr4474', '/recherche/achat/maison/lille-59000/centre-59000/nbh2fr1', '/immobilier/achat/immo-marcq-en-baroeul-59/bien-maison/?page=2', '/recherche/achat/maison/marcq-en-baroeul-59700/mairie-59700/nbh2fr4474?page=2'].map((h) => `<a href="${h}">x</a>`).join('');
  assert.deepEqual(src.moreLists(selogerPage([], links), url, MARCQ), ['https://www.seloger.com/recherche/achat/maison/marcq-en-baroeul-59700/mairie-59700/nbh2fr4474', 'https://www.seloger.com/recherche/achat/maison/piece-3/hauts-de-france/marcq-en-baroeul-59700/ad08fr23643']);
});

test('chaque source du robot a son nom dans le Fil (lien vers l’annonce)', async () => {
  const { SOURCE_LABELS } = await import('../src/common/listings.js');
  for (const s of SOURCES) assert.equal(SOURCE_LABELS[s.id], s.label, s.id);
});
