import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract, loadPage } from './helpers/dom.mjs';

// Les objets créés dans la fenêtre jsdom n’ont pas le même prototype que ceux de Node.
const plain = (v) => JSON.parse(JSON.stringify(v));
const page = (body, head = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

test('annonce d’agence classique : tous les champs lus dans le texte', () => {
  const r = extract(
    page(`
      <h1>Appartement T3 Lille (59000)</h1>
      <main>
        <p>Au cœur du Vieux-Lille, bel appartement de type 3 en excellent état, proche métro et commerces.</p>
        <ul>
          <li>Surface habitable : 65 m²</li>
          <li>Classe énergie : D</li>
          <li>GES : B</li>
          <li>Consommation : 212 kWh/m²/an</li>
          <li>Émissions : 8 kg CO2/m²/an</li>
          <li>DPE réalisé le 12/03/2023</li>
        </ul>
        <p>${'Texte de remplissage pour un bloc principal assez long. '.repeat(10)}</p>
      </main>`, '<title>Vente appartement Lille</title>')
  );
  assert.equal(r.kind, 'dpe');
  assert.equal(r.postal, '59000');
  assert.equal(r.city, 'Lille');
  assert.equal(r.surface, 65);
  assert.equal(r.energyClass, 'D');
  assert.equal(r.gesClass, 'B');
  assert.equal(r.energyConsumption, 212);
  assert.equal(r.gesEmission, 8);
  assert.equal(r.buildingType, 'appartement');
  assert.deepEqual(plain(r.dateRange), { gte: '2023-03-12', lte: '2023-03-12', precision: 'day' });
  assert.deepEqual(plain(r.missing), []);
});

test('JSON-LD schema.org prioritaire pour la localisation et la surface', () => {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'SingleFamilyResidence',
    address: { '@type': 'PostalAddress', postalCode: '59700', addressLocality: 'Marcq-en-Barœul' },
    floorSize: { '@type': 'QuantitativeValue', value: 142, unitCode: 'MTK' },
  };
  const r = extract(
    page(`<h1>Belle maison 1930</h1><p>Classe énergie C, classe climat C.</p>`,
      `<script type="application/ld+json">${JSON.stringify(ld)}</script>`)
  );
  assert.equal(r.postal, '59700');
  assert.equal(r.city, 'Marcq-en-Barœul');
  assert.equal(r.surface, 142);
  assert.equal(r.buildingType, 'maison');
  assert.equal(r.energyClass, 'C');
  assert.equal(r.gesClass, 'C');
});

test('ville avec département seulement : la ville et le département sont transmis', () => {
  const r = extract(page(`<h1>Maison 5 pièces 110 m² Villeneuve d'Ascq (59)</h1><p>DPE : E</p>`));
  assert.equal(r.postal, null);
  assert.equal(r.city, "Villeneuve d'Ascq");
  assert.equal(r.department, '59');
  assert.equal(r.surface, 110);
  assert.equal(r.energyClass, 'E');
  // la ville remplace le code postal : il ne manque rien de bloquant
  assert.ok(!r.missing.includes('postal'));
});

test('« DPE : A venir » et un « a » minuscule ne donnent pas de classe', () => {
  const r = extract(page(`<h1>Studio 18 m² Roubaix 59100</h1><p>DPE : A venir. Classe énergie : a définir.</p>`));
  assert.equal(r.energyClass, null);
  assert.equal(r.postal, '59100');
  assert.equal(r.city, 'Roubaix');
  assert.ok(r.missing.includes('energyClass'));
});

test('classes calculées depuis la consommation et les émissions (DPE 2021)', () => {
  const r = extract(page(`<h1>Appartement 72 m² Tourcoing (59200)</h1><p>Consommation énergétique 260 kWhEP/m².an · 48 kg éq CO2/m².an</p>`));
  assert.equal(r.energyConsumption, 260);
  assert.equal(r.gesEmission, 48);
  // 260 kWh → E ; 48 kg → D ; classe énergie = la moins bonne des deux
  assert.equal(r.energyClass, 'E');
  assert.equal(r.gesClass, 'D');
  assert.equal(r.found.energyClass, 'calculée');
});

test('pas de classe calculée sous 40 m² (seuils ajustés)', () => {
  const r = extract(page(`<h1>Studio 25 m² Lille (59000)</h1><p>300 kWh/m²/an, 10 kg CO2/m²/an</p>`));
  assert.equal(r.energyClass, null);
});

test('étiquette DPE dessinée : lettre active et image', () => {
  const r = extract(
    page(`<h1>Maison 95 m² La Madeleine (59110)</h1>
      <div class="dpe-graph"><span>A</span><span>B</span><span class="is-active">C</span></div>
      <img alt="" src="/img/etiquettes/ges-d.png">`)
  );
  assert.equal(r.energyClass, 'C');
  assert.equal(r.gesClass, 'D');
});

test('terrain : surface avec séparateur de milliers', () => {
  const r = extract(page(`<h1>Terrain à bâtir Bondues (59910)</h1><p>Beau terrain de 1 200 m² viabilisé, section AB.</p>`));
  assert.equal(r.kind, 'land');
  assert.equal(r.postal, '59910');
  assert.equal(r.surface, 1200);
});

test('« maison avec terrain » reste un logement', () => {
  const r = extract(page(`<h1>Maison avec terrain 120 m² Lambersart (59130)</h1><p>Terrain de 600 m². Classe énergie : D</p>`));
  assert.equal(r.kind, 'dpe');
  assert.equal(r.surface, 120);
});

test('JSON embarqué dans un script en dernier recours', () => {
  const r = extract(
    page(`<h1>Appartement Lille</h1>`,
      `<script>window.__DATA__ = {"property":{"zipCode":"59800","livingArea":54.5,"dpeLetter":"F","gesLetter":"C","energyConsumption":355}}</script>`)
  );
  assert.equal(r.postal, '59800');
  assert.equal(r.surface, 55);
  assert.equal(r.energyClass, 'F');
  assert.equal(r.gesClass, 'C');
  assert.equal(r.energyConsumption, 355);
});

test('extracteur dédié du site utilisé en premier par extractPage', () => {
  const win = loadPage(page(`<h1>Rien d'utile</h1>`));
  win.__immodexSiteExtract = () => ({ kind: 'dpe', postal: '59000', surface: 40, energyClass: 'B', source: 'leboncoin-json' });
  const r = win.__immodexGeneric.extractPage();
  assert.equal(r.postal, '59000');
  assert.equal(r.found.tout, 'leboncoin-json');
});

// ─── Cas tirés de vraies pages d'annonces (structure reproduite, contenu inventé) ───

test('PAP : lettre active dans l’échelle, la légende du texte est ignorée', () => {
  const r = extract(
    page(`<h1>Vente maison 113 m² Lambersart (59130)</h1>
      <div class="energy-indice"><div class="item-title">Classe énergie</div><ul><li>A</li><li>B</li><li class="active">C</li><li>D</li><li>E</li><li>F</li><li>G</li></ul></div>
      <div class="ges-indice"><div class="item-title">GES</div><ul><li class="active">A</li><li>B</li><li>C</li><li>D</li><li>E</li><li>F</li><li>G</li></ul></div>`)
  );
  assert.equal(r.energyClass, 'C');
  assert.equal(r.gesClass, 'A');
});

test('ParuVendu : lettre après la légende, date « Fait le », mention de juillet 2021 ignorée', () => {
  const r = extract(
    page(`<h1>Vente maison 138 m² Lille 59000</h1>
      <p>Diagnostic de performance énergétique (DPE) A B C D E F G F Classe Énergie 380 kWh/m² an C Indice d'émissions de gaz à effet de serre 19 kgCO₂/m².an</p>
      <p>Diagnostic de Performance Energétique Fait le : 19/08/2025</p>
      <p>Pour les DPE délivrés à compter du 1er juillet 2021, les valeurs E, F et G diffèrent.</p>`)
  );
  assert.equal(r.energyClass, 'F');
  assert.equal(r.gesClass, 'C');
  assert.deepEqual(plain(r.dateRange), { gte: '2025-08-19', lte: '2025-08-19', precision: 'day' });
});

test('dates de mentions légales ou impossibles : pas de date de DPE', () => {
  const r = extract(
    page(`<h1>Appartement 60 m² Lille (59000)</h1><p>Classe énergie : D. Prix moyens des énergies indexés au 1er janvier 2021. DPE réalisé le 01/01/2064.</p>`)
  );
  assert.equal(r.dateRange, null);
});

test('Foncia : classe et valeurs dans le texte alternatif des images d’étiquette', () => {
  const r = extract(
    page(`<h1>Location appartement 41 m² Lille (59000)</h1>
      <img alt="Diagnostic classe énergie : C indice : 150 kWhEP/m².an" src="/dpe.png">
      <img alt="Diagnostic classe climat : A indice : 5 KgéqCO2/m².an" src="/ges.png">`)
  );
  assert.equal(r.energyClass, 'C');
  assert.equal(r.gesClass, 'A');
  assert.equal(r.energyConsumption, 150);
  assert.equal(r.gesEmission, 5);
});

test('Apimo : valeurs lues dans une étiquette SVG intégrée en base64', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>CLASSE ÉNERGIE</text><text>285</text><text>kWh/m².year</text><text>émission</text><text>38</text><text>kg CO2/m².an</text></svg>';
  const b64 = Buffer.from(svg, 'utf8').toString('base64');
  const r = extract(page(`<h1>Vente maison 247 m² Tourcoing (59200)</h1><img alt="Diagnostic Graph" src="data:image/svg+xml;base64,${b64}">`));
  assert.equal(r.energyConsumption, 285);
  assert.equal(r.gesEmission, 38);
  assert.equal(r.energyClass, 'E');
  assert.equal(r.gesClass, 'D');
});

test('IAD : « DPE classé en B et GES classé en B »', () => {
  const r = extract(page(`<h1>Appartement 44 m² Lille (59000)</h1><p>Performance énergétique : DPE classé en B et GES classé en B.</p>`));
  assert.equal(r.energyClass, 'B');
  assert.equal(r.gesClass, 'B');
});

test('annonces similaires et vignettes : leurs DPE et surfaces sont ignorés', () => {
  const r = extract(
    page(`<article class="card"><h3>Appartement 47 m²</h3><p>${'Autre bien. '.repeat(50)} 137 kWh/m².an 28 kg CO2/m².an Classe énergie : C</p></article>
      <h1>Location appartement 41 m² Lille (59000)</h1><p>Classe énergie : B</p><p>${'Description du bien loué. '.repeat(40)}</p>
      <section class="similar-ads"><p>Appartement 39 m² 216 kWh/m².an 7 kg CO2/m².an</p></section>`)
  );
  assert.equal(r.surface, 41);
  assert.equal(r.energyClass, 'B');
  assert.equal(r.energyConsumption, null);
});

test('Safti : petite surface, classe lue dans « consommation énergétique excessive : classe E »', () => {
  const r = extract(page(`<h1>Appartement 16 m² Lille (59000)</h1><p>388kWh/m².an 15*kgCO₂/m².an</p><p>Logement à consommation énergétique excessive : classe E</p>`));
  assert.equal(r.energyClass, 'E');
  assert.equal(r.energyConsumption, 388);
  assert.equal(r.gesEmission, 15);
});

test('Vacherand : surface seulement dans « Appartement 19 m² 1 pièce »', () => {
  const r = extract(page(`<h1>Location Lille</h1><p>60/62 rue d'Arras 59000 Lille Appartement 19 m² 1 pièce Meublé. Terrasse de 6 m².</p>`));
  assert.equal(r.surface, 19);
});

test('La Boîte Immo : étiquette en image JPEG, la classe reste à demander', () => {
  const r = extract(page(`<h1>Appartement T5 89 m² Lille (59000)</h1><img class="energy__img" src="/admin/dpe.php?idann=1" alt="DPE"><img src="/admin/dpe.php?type=GES&idann=1" alt="GES">`));
  assert.equal(r.energyClass, null);
  assert.ok(r.missing.includes('energyClass'));
});

test('accents décomposés et ville en majuscules sur une ligne isolée', () => {
  const r = extract(page(`<h1>Maison 163 m²</h1><p>59000 LILLE\nTéléphone Siège</p><p>Classe énergétique : D</p>`));
  assert.equal(r.city, 'Lille');
  assert.equal(r.energyClass, 'D');
});

// ─── Données structurées embarquées ───

test('Nuxt (Figaro, IAD) : état « devalue » décodé, adresse de l’agence ignorée', () => {
  // Tableau plat : chaque objet référence ses valeurs par leur position.
  const nuxt = [
    ['ShallowReactive', 1],
    { data: 2 },
    { classified: 3 },
    { agency: 4, location: 6, area: 8, dpe: 9, type: 13 },
    { postalCode: 5 },
    '77127',
    { postalCode: 7, cityOnly: 14 },
    '59000',
    130,
    { energyCategory: 10, gesCategory: 11, dateDpeFr: 12 },
    'C',
    'B',
    '28/04/2026',
    'maison',
    'Lille',
  ];
  const r = extract(page(`<h1>Maison</h1>`, `<script type="application/json" id="__NUXT_DATA__">${JSON.stringify(nuxt)}</script>`));
  assert.equal(r.postal, '59000');
  assert.equal(r.city, 'Lille');
  assert.equal(r.surface, 130);
  assert.equal(r.energyClass, 'C');
  assert.equal(r.gesClass, 'B');
  assert.deepEqual(plain(r.dateRange), { gte: '2026-04-28', lte: '2026-04-28', precision: 'day' });
});

test('Angular (Foncia, Square Habitat) : état avec guillemets échappés « &q; »', () => {
  const state = '{&q;bien&q;:{&q;localisation&q;:{&q;codePostal&q;:&q;59800&q;},&q;surface&q;:{&q;habitable&q;:48.5},&q;noteConsoEnergie&q;:&q;E&q;,&q;noteEmissionGES&q;:&q;B&q;,&q;dpe&q;:{&q;date&q;:&q;2025-06-11&q;}}}';
  const r = extract(page(`<h1>Location appartement</h1>`, `<script id="serverApp-state" type="application/json">${state}</script>`));
  assert.equal(r.postal, '59800');
  assert.equal(r.surface, 49);
  assert.equal(r.energyClass, 'E');
  assert.equal(r.gesClass, 'B');
  assert.equal(plain(r.dateRange).gte, '2025-06-11');
});

test('Orpi : attribut data-estate avec indices 1 à 7 pour les classes', () => {
  const estate = JSON.stringify({ zipCode: '59160', liveableSurface: 69, consumptionIndex: 5, emissionIndex: 3, dpeDate: '2026-05-15' });
  const r = extract(page(`<h1>Maison 69 m²</h1><div data-component="estate-poi-map" data-estate='${estate}'></div>`));
  assert.equal(r.postal, '59160');
  assert.equal(r.energyClass, 'E');
  assert.equal(r.gesClass, 'C');
});

test('Netty : données en base64 dans window._TEMPLATE_DATA', () => {
  const b64 = Buffer.from(JSON.stringify({ product: { cp: '59000', city: 'Lille', surface: 129, prod_type: 'Appartement', dpeLetter: 'C' } }), 'utf8').toString('base64');
  const r = extract(page(`<h1>Appartement</h1>`, `<script>window._TEMPLATE_DATA = JSON.parse(b64_to_utf8("${b64}"));</script>`));
  assert.equal(r.surface, 129);
  assert.equal(r.energyClass, 'C');
});

test('Laforêt : étiquette SVG en ligne avec groupes g#DPE_D et g#GES_C', () => {
  const r = extract(page(`<h1>Maison 163 m² Lille (59000)</h1><svg><g id="DPE_D"><g id="Graph"></g></g><g id="GES_C"></g></svg>`));
  assert.equal(r.energyClass, 'D');
  assert.equal(r.gesClass, 'C');
});

test('Abrinor et Citya : classe dans un aria-label', () => {
  const r = extract(page(`<h1>Appartement 51 m² Tourcoing (59200)</h1><div aria-label="DPE F (365)"></div><span aria-label="Classe GES actuelle : D"></span>`));
  assert.equal(r.energyClass, 'F');
  assert.equal(r.gesClass, 'D');
});
