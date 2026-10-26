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

// ─── Sites d'agences du Lillois (structures reproduites, contenus inventés) ───

const long = (s) => `${s}<p>${'Description du bien, lumineux et bien situé. '.repeat(20)}</p>`;

test('Spot My Place : zone sélectionnée #dpe_D parmi #dpe_A … #dpe_G', () => {
  const zones = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((l) => `<div class="zone${l === 'D' ? ' selected' : ''}" id="dpe_${l}">${l === 'D' ? '217' : ''}</div>`).join('');
  const r = extract(page(long(`<h1>Maison 89 m² Tourcoing (59200)</h1>${zones}`)));
  assert.equal(r.energyClass, 'D');
});

test('légende avec une classe par lettre (letter-a … letter-g) : ignorée sans lettre active', () => {
  const legend = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((l) => `<span class="diagnostic-letter letter-${l}">${l.toUpperCase()}</span>`).join('');
  const r = extract(page(long(`<h1>Appartement 86 m² Lille (59000)</h1><div class="diagnostic-scale number">${legend}</div>`)));
  assert.equal(r.energyClass, null);
});

test('lettre portée par une classe CSS et valeurs en attributs data-*', () => {
  const r = extract(
    page(long(`<h1>Maison 112 m² Comines (59560)</h1><span class="dpeInfoConso e"><span class="txt">305</span></span><span id="ges-svg" data-lettre="D" data-ges="35"></span>`))
  );
  assert.equal(r.energyClass, 'E');
  assert.equal(r.gesClass, 'D');
  assert.equal(r.gesEmission, 35);
});

test('Century 21 (sites d’agences) : valeurs dans g[data-name="chiffres"], classes calculées', () => {
  const r = extract(page(long(`<h1>Maison 90 m² Lille (59260)</h1><svg><g data-name="chiffres"><text>173</text><text>40</text></g></svg>`)));
  assert.equal(r.energyConsumption, 173);
  assert.equal(r.gesEmission, 40);
  assert.equal(r.energyClass, 'D');
  assert.equal(r.gesClass, 'D');
});

test('série de 7 images : la lettre est celle dont le nom de fichier diffère', () => {
  const imgs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((l) => `<img src="/img/energie-${l === 'd' ? 'd2021' : `${l}-v2021`}.png">`).join('');
  const r = extract(page(long(`<h1>Maison 85 m² Lille (59000)</h1>${imgs}`)));
  assert.equal(r.energyClass, 'D');
});

test('code postal : ni une référence d’annonce ni l’adresse de l’agence en JSON-LD', () => {
  const agent = { '@type': 'RealEstateAgent', address: { '@type': 'PostalAddress', postalCode: '59100', addressLocality: 'Roubaix' } };
  const r = extract(
    page(long(`<h1>Appartement 60 m²</h1><p>RÉF. 18784 Appeler</p><p>Lille 59800, proche gare</p><p>Classe énergie : D</p>`), `<script type="application/ld+json">${JSON.stringify(agent)}</script>`)
  );
  assert.equal(r.postal, '59800');
  assert.equal(r.city, 'Lille');
});

test('ville du titre sans code postal, sous plusieurs formes', () => {
  assert.equal(extract(page(long(`<h1>Appartement à vendre Lille Réf. VA2276</h1><p>Surface habitable : 33 m²</p>`))).city, 'Lille');
  assert.equal(extract(page(long(`<h1>MOUVAUX ST GERMAIN: Maison trois chambres</h1><p>105 m² habitables</p>`))).city, 'Mouvaux St Germain');
  assert.equal(extract(page(long(`<h1>Maison bourgeoise – centre ville de Wervicq-Sud</h1><p>97 m² habitables</p>`))).city, 'Wervicq-Sud');
  // le nom de l'agence en fin de titre n'est pas une ville
  assert.notEqual(extract(page(long(`<h1>Appartement 2 pièces 46 m2 - Leduc Immobilier</h1>`))).city, 'Leduc Immobilier');
});

test('ville tirée de l’adresse de la page quand la page ne la donne pas', () => {
  const html = page(long(`<h1>Jolie maison</h1><p>Surface habitable : 120 m²</p>`));
  assert.equal(extract(html, 'https://www.agence.fr/ventes-immobilieres-a-lille/va1909').city, 'Lille');
  assert.equal(extract(html, 'https://www.agence.fr/vente-maison-marcq-en-baroeul,b551/').city, 'Marcq En Baroeul');
});

test('surface : « m² hab. », « T3 de 49,2 m² », et pas la « chambre de 12 m² »', () => {
  assert.equal(extract(page(long(`<h1>Appartement Lille (59000)</h1><p>44.49 m² hab.</p>`))).surface, 44);
  assert.equal(extract(page(long(`<h1>Appartement La Madeleine (59110)</h1><p>Beau T3 de 49,2 m² lumineux</p>`))).surface, 49);
  const r = extract(page(long(`<h1>Appartement Lille (59800)</h1><p>Appartement avec une chambre de 12 m² et un séjour.</p><p>2 pièces - 58 m²</p>`)));
  assert.equal(r.surface, 58);
});

test('libellés d’agences : « DPE conso : 144, Lettre : C », « Consommation énergie primaire », « Co² »', () => {
  const r = extract(page(long(`<h1>Maison 80 m² Hem (59510)</h1><p>DPE conso : 144, Lettre : C</p><p>DPE émi : 22, Lettre : C</p>`)));
  assert.equal(r.energyConsumption, 144);
  assert.equal(r.energyClass, 'C');
  assert.equal(r.gesEmission, 22);
  assert.equal(r.gesClass, 'C');
  const r2 = extract(page(long(`<h1>Studio 28 m² Lille (59000)</h1><div>Consommation énergie primaire</div><div><b>E</b></div><p>9* kg Co²/m².an</p>`)));
  assert.equal(r2.energyClass, 'E');
  assert.equal(r2.gesEmission, 9);
});

test('Immotram : lettres dans les noms d’images, valeurs sans unité dans conso-index / emi-index', () => {
  const r = extract(
    page(
      long(`<h1>Vente Appartement 151m 2 - 3 chambre(s) - Roubaix, Alfred Mongy</h1>
        <div class="bloc_product_dpe">
          <div class="conso"><img id="conso-img" src="./assets/img/dpe/conso-D.svg" alt="Consommation énergétique" />
            <strong class="conso-index conso-index_D">184</strong><strong class="conso-index2 conso-index2_D">39*</strong></div>
          <div class="emission"><img id="emi-img" src="./assets/img/dpe/emi-D.svg" alt="Émissions GES" />
            <strong class="emi-index emi-index_D">39</strong></div>
        </div>`)
    )
  );
  assert.equal(r.city, 'Roubaix');
  assert.equal(r.energyClass, 'D');
  assert.equal(r.energyConsumption, 184);
  assert.equal(r.gesEmission, 39);
});

test('valeur sans unité dans la vignette d’une autre annonce : ignorée (Foncia)', () => {
  const r = extract(
    page(
      long(`<h1>Location appartement 41 m² Lille (59000)</h1>
        <img alt="Diagnostic classe énergie : C indice : 150 kWhEP/m².an" src="/dpe.png">
        <div class="foncia-card"><a href="/location/lille-59/appartement/331699885.htm">Autre appartement</a>
          <span class="dpe-values"><span class="dpe-number">137</span><span class="dpe-unit">kWh/m²</span></span></div>`)
    ),
    'https://fr.foncia.com/location/lille-59/appartement/331682132.htm'
  );
  assert.equal(r.energyConsumption, 150);
});

// ─── Prix (suivi des biens) ───

test('prix : JSON-LD, titre, libellé, et pas les honoraires ni le prix au m²', () => {
  const win = (html, url) => {
    const w = loadPage(html, url);
    return w.__immodexGeneric.extractPrice(w.document);
  };
  const offer = { '@type': 'Product', offers: { '@type': 'Offer', price: '294000', priceCurrency: 'EUR' } };
  assert.equal(win(page('<h1>Maison</h1>', `<script type="application/ld+json">${JSON.stringify(offer)}</script>`)), 294000);
  assert.equal(win(page('<h1>Vente maison 113 m² Lambersart (59130)</h1><p>460.000 €</p>')), 460000);
  assert.equal(win(page('<h1>Appartement Lille</h1><p>Honoraires : 9 500 € TTC</p><p>Prix : 249 000 €</p><p>4 156 €/m²</p>')), 249000);
  // location : loyer mensuel
  assert.equal(win(page('<h1>Location appartement 41 m² Lille</h1><p>Loyer charges comprises 676,39 € / mois</p>'), 'https://fr.foncia.com/location/lille-59/1.htm'), 676);
});
