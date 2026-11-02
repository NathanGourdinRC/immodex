import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readListing, priceOf, parseHtml } from '../api/_lib/page.js';

// Page d'annonce synthétique, à la manière d'un site d'agence.
const PAGE = `<!doctype html><html><head><title>Maison 5 pièces Wambrechies</title>
<meta property="og:image" content="https://cdn.exemple.fr/photo1.jpg">
<meta property="og:title" content="Vente maison 5 pièces 134 m² Wambrechies">
<script>window.pasExecute = true;</script></head><body>
<h1>Vente maison 5 pièces 134 m² Wambrechies</h1>
<p>59118 Wambrechies · Maison de 134 m² · 5 pièces · 3 chambres · Terrain 293 m² · garage double</p>
<p>Prix : 332 000 €</p>
<p>Diagnostic de performance énergétique : D 204 kWh/m².an · 22 kg CO2/m².an</p>
<p>${'Belle maison familiale proche des écoles, du tram et du centre. '.repeat(10)}</p>
</body></html>`;

test('page d’annonce lue côté serveur : prix, surfaces, pièces, chambres, DPE, photo', () => {
  const r = readListing(PAGE, 'https://www.agence-exemple.fr/bien/123');
  assert.equal(r.price, 332000);
  assert.equal(r.surface, 134);
  assert.equal(r.pieces, 5);
  assert.equal(r.chambres, 3);
  assert.equal(r.terrain, 293);
  assert.equal(r.garage, true);
  assert.equal(r.postal, '59118');
  assert.equal(r.buildingType, 'maison');
  assert.equal(r.energyConsumption, 204);
  assert.equal(r.gesEmission, 22);
  assert.equal(r.photo, 'https://cdn.exemple.fr/photo1.jpg');
  assert.match(r.title, /Vente maison 5 pièces/);
});

test('les scripts de la page ne sont jamais exécutés', () => {
  const doc = parseHtml(PAGE, 'https://www.agence-exemple.fr/bien/123');
  assert.equal(doc.defaultView.pasExecute, undefined);
});

test('prix d’un élément qui ne contient que le prix', () => {
  assert.equal(priceOf('299 500 €'), 299500);
  assert.equal(priceOf('Prix : 332 000 €'), 332000);
  assert.equal(priceOf('1 090 000 €'), 1090000);
  assert.equal(priceOf('245000€'), 245000);
  assert.equal(priceOf('Prix sur demande'), null);
  assert.equal(priceOf('13 photos'), null);
  assert.equal(priceOf('Maison 80 m² 299 500 €'), null);
  assert.equal(priceOf('275 000 € *'), 275000);
  assert.equal(priceOf('299 000 € HAI'), 299000);
});

test('les biens similaires en bas de page ne prêtent pas leurs chiffres à l’annonce', () => {
  const html = `<!doctype html><html><body><header><nav><a href="/">Accueil</a> Terrain 999 m²</nav></header>
  <main><h1>Maison 5 chambres – terrasse et jardin</h1><p>59118 Wambrechies · 110 m² · 6 pièces · 5 chambres · jardin</p><p>Prix : 329 000 €</p>
  <p>${'Belle maison lumineuse, proche des écoles et du centre. '.repeat(8)}</p></main>
  <section class="biens-similaires"><div class="swiper-wrapper">
    <article class="vignette-bien"><a href="/bien-immobilier/terrain-constructible-706/"><h3>Terrain constructible de 706 m2</h3></a><p>275 000 € · 706 m2 · Wambrechies</p></article>
    <article class="vignette-bien"><a href="/bien-immobilier/maison-3-chambres/"><h3>Maison 3 chambres</h3></a><p>290 000 € · Terrain 410 m² · 4 pièces</p></article>
  </div></section><footer>Mentions légales · garage solidaire</footer></body></html>`;
  const r = readListing(html, 'https://www.maesimmobilier.fr/bien-immobilier/maison-5-chambres-terrasse-et-jardin/');
  assert.equal(r.terrain, null);
  assert.equal(r.chambres, 5);
  assert.equal(r.pieces, 6);
  assert.equal(r.garage, false);
});

test('pièces et chambres : « Nombre de pièces : 6 », références collées, fil d’Ariane ignoré', () => {
  const page = (body) => `<!doctype html><html><body>${body}<p>${'Description de la maison, lumineuse et calme. '.repeat(8)}</p></body></html>`;
  const maes = readListing(page('<h1>Maison familiale</h1><ul><li>Nombre de chambres : 5</li><li>Nombre de pièces : 6</li></ul>'), 'https://www.maesimmobilier.fr/bien-immobilier/x/');
  assert.deepEqual([maes.pieces, maes.chambres], [6, 5]);
  const deleu = readListing(page('<h1>Maison individuelle</h1><div><span>Réf. MX517</span><span>4 pièces</span><span>3 chambres</span><span>110 m²</span></div>'), 'https://deleuimmobilier.com/fr/propriete/vente+maison+mouvaux+x+1');
  assert.deepEqual([deleu.pieces, deleu.chambres], [4, 3]);
  const lsi = readListing(page('<nav class="breadcrumb"><a href="/a">Maisons 5 pièces à vendre en France</a></nav><div class="fiche"><h1>Maison 5 chambres</h1><p>Maison · 6 pièces · 177 m²</p></div>'), 'https://www.lesiteimmo.com/acheter/maison-6pieces/wambrechies-59118/1');
  assert.equal(lsi.pieces, 6);
});

test('terrain écrit « 350 m<sup>2</sup> » dans la fiche détaillée', () => {
  const html = `<!doctype html><html><body><main><h1>Maison flamande</h1><a href="/type_offre/vente/">Retour aux résultats</a>
    <ul class="caracteristiques"><li>Surface : <strong>80 m<sup>2</sup></strong></li><li>Surface terrain : <strong>350 m<sup>2</sup></strong></li></ul>
    <p>Prix : 284 000 €</p><p>${'Charmante maison flamande avec jardin. '.repeat(8)}</p></main></body></html>`;
  assert.equal(readListing(html, 'https://www.maesimmobilier.fr/bien-immobilier/x/').terrain, 350);
});
