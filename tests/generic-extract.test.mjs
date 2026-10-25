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
