// Lecture d'une page d'annonce SeLoger (src/common/seloger-detail.js) : consommation, émissions,
// année de construction. Les valeurs viennent de la vraie page de l'annonce 26FM4ZXVBZ5H lue le
// 09/11/2026 (Villeneuve-d'Ascq, maison 107,5 m², DPE D) ; seul le texte de description est raccourci.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const code = readFileSync(fileURLToPath(new URL('../src/common/seloger-detail.js', import.meta.url)), 'utf8');
const URL_26FM = 'https://www.seloger.com/annonce/achat/hauts-de-france/nord-59/villeneuve-d-ascq-59491/26FM4ZXVBZ5H';

const scale = (type, name, rating, values) => ({ type, name, efficiencyClass: { index: 3, rating }, key: type, segments: [{ label: 'A', value: '' }], values });
const classified = (energy, over = {}) => ({
  rawData: { propertyType: 'HOUSE', price: 369000 },
  metadata: { isNewBuildProject: false },
  sections: {
    location: { address: { country: 'FRA', city: "Villeneuve-d'Ascq", zipCode: '59650' } },
    hardFacts: {
      title: 'Maison à vendre',
      facts: [
        { type: 'numberOfRooms', value: '5 pièces', splitValue: '5', label: 'pièces' },
        { type: 'numberOfBedrooms', value: '3 chambres', splitValue: '3', label: 'chambres' },
        { type: 'livingSpace', value: '107,5 m²', splitValue: '107,5', label: 'm²' },
        { type: 'plotSpace', value: '300 m² de terrain', splitValue: '300', label: 'm² de terrain' },
      ],
    },
    energy,
    description: { description: 'Classe énergie D, Classe climat D' },
  },
  ...over,
});

const REAL_ENERGY = {
  features: [
    { label: 'Année de construction', type: 'yearOfConstruction', value: '1982' },
    { label: "Sources d'énergie", type: 'energySource', value: 'Gaz' },
  ],
  hasScales: true,
  certificates: [
    {
      key: 'c81b7255-42c0-49a3-86b0-4b35b7c42ecc',
      features: [
        { type: 'minMaxEstimation', label: 'Estimation de la facture énergétique', value: 'entre 2260 et 3090 €/an' },
        { type: 'nameOfCertificate', label: 'Diagnostic réalisé', value: 'Après le 1er juillet 2021' },
      ],
      scales: [
        scale('FR_ENERGY_AFTER_2021', 'Diagnostic de performance énergétique (DPE)', 'D', [
          { value: '226 kWh/m².an', label: 'Consommation (énergie primaire)' },
          { value: '41 kg CO₂/m².an', label: 'Émissions' },
        ]),
        scale('FR_GHG_AFTER_2021', "Indice d'émission de gaz à effet de serre (GES)", 'D', [{ value: '41 kg CO₂/m².an', label: 'Émissions' }]),
      ],
    },
  ],
};

// Même habillage que SeLoger : JSON en texte JavaScript, lui-même dans un script.
function page(data, { url = URL_26FM, extra = '' } = {}) {
  const json = JSON.stringify({ app_cldp: { data: { classified: data }, error: null } });
  const script = data ? `<script id="__UFRN_LIFECYCLE_SERVERREQUEST__">window["__UFRN_LIFECYCLE_SERVERREQUEST__"]=JSON.parse(${JSON.stringify(json)});</script>` : '';
  const dom = new JSDOM(`<!doctype html><html><body>${script}${extra}</body></html>`, { url, runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  dom.window.eval(code);
  return dom.window;
}
const api = (win) => win.__immodexSelogerDetail;
const plain = (v) => JSON.parse(JSON.stringify(v));

test('page réelle : consommation, émissions, GES et année de construction', () => {
  const win = page(classified(REAL_ENERGY));
  assert.deepEqual(plain(api(win).energyOf(classified(REAL_ENERGY))), {
    energyClass: 'D',
    gesClass: 'D',
    energyConsumption: 226,
    gesEmission: 41,
    constructionYear: 1982,
  });
});

test('carte de l’annonce : celle que le Fil reçoit, avec l’adresse de la page', () => {
  const win = page(classified(REAL_ENERGY));
  const r = plain(api(win).readDetail(win.document));
  assert.equal(r.hasData, true);
  assert.deepEqual(r.card, {
    url: URL_26FM,
    type: 'maison',
    price: 369000,
    title: "Maison 108 m² Villeneuve-d'Ascq 59650",
    detail: {
      surface: 108,
      pieces: 5,
      chambres: 3,
      terrain: 300,
      postal: '59650',
      city: "Villeneuve-d'Ascq",
      energyClass: 'D',
      gesClass: 'D',
      energyConsumption: 226,
      gesEmission: 41,
      constructionYear: 1982,
    },
  });
});

test('adresse de la carte : sans paramètres ni ancre (c’est l’identifiant de l’annonce dans le Fil)', () => {
  const win = page(classified(REAL_ENERGY), { url: `${URL_26FM}?utm_source=mail#photos` });
  assert.equal(api(win).readDetail(win.document).card.url, URL_26FM);
});

test('diagnostic sans chiffres (lettres seules) : pas de consommation inventée', () => {
  const energy = { certificates: [{ key: 'x', scales: [scale('FR_ENERGY_BEFORE_2021', 'DPE', 'E', []), scale('FR_GHG_BEFORE_2021', 'GES', 'F', [])] }] };
  const win = page(classified(energy));
  const d = api(win).readDetail(win.document).card.detail;
  assert.equal(d.energyClass, 'E');
  assert.equal(d.gesClass, 'F');
  assert.equal(d.energyConsumption, null);
  assert.equal(d.gesEmission, null);
  assert.equal(d.constructionYear, null);
});

test('valeurs absurdes ou illisibles : ignorées', () => {
  const energy = { certificates: [{ key: 'x', scales: [scale('FR_ENERGY_AFTER_2021', 'DPE', 'D', [{ value: 'non communiqué', label: 'Consommation (énergie primaire)' }, { value: '99999 kWh/m².an', label: 'Consommation' }])] }] };
  const win = page(classified(energy));
  assert.equal(api(win).readDetail(win.document).card.detail.energyConsumption, null);
});

test('chiffres avec virgule décimale et séparateur de milliers', () => {
  const energy = { certificates: [{ key: 'x', scales: [scale('FR_ENERGY_AFTER_2021', 'DPE', 'G', [{ value: '1 026 kWh/m².an', label: 'Consommation (énergie primaire)' }, { value: '9,4 kg CO₂/m².an', label: 'Émissions' }])] }] };
  const win = page(classified(energy));
  const d = api(win).readDetail(win.document).card.detail;
  assert.equal(d.energyConsumption, 1026);
  assert.equal(d.gesEmission, 9);
});

test('terrain : type terrain, sans diagnostic', () => {
  const win = page(classified({ certificates: [] }, { rawData: { propertyType: 'LAND' } }));
  const r = api(win).readDetail(win.document);
  assert.equal(r.card.type, 'terrain');
  assert.equal(r.card.detail.energyConsumption, null);
});

test('page sans bloc de données : rien lu, et pas un défi', () => {
  const win = page(null, { extra: '<p>Cette annonce n’est plus disponible.</p>' });
  assert.equal(api(win).readDetail(win.document), null);
  assert.equal(api(win).isChallenge(win.document), false);
});

test('page de défi anti-robot : reconnue pour s’arrêter, jamais résolue', () => {
  const iframe = page(null, { extra: '<iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=abc"></iframe>' });
  assert.equal(api(iframe).isChallenge(iframe.document), true);
  const text = page(null, { extra: '<p>Veuillez compléter la vérification de sécurité pour continuer</p>' });
  assert.equal(api(text).isChallenge(text.document), true);
});

test('une annonce normale qui parle de captcha n’est pas un défi', () => {
  const win = page(classified(REAL_ENERGY), { extra: '<p>captcha robot</p>' });
  assert.equal(api(win).isChallenge(win.document), false);
});
