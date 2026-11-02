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
