// Test de bout en bout : charge l'extension dans un Chromium piloté par
// Playwright et vérifie les parcours réels (API ADEME comprises).
// Lancement : npm run test:e2e
//
// Les pages d'annonce sont simulées : Playwright intercepte l'URL du site et
// renvoie une page de test, l'extension s'y comporte comme sur le vrai site.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\/]$/, '');
const userDataDir = mkdtempSync(join(tmpdir(), 'immodex-e2e-'));
let context;
let extId;

// Logement réel du registre ADEME (vérifié le 25/10/2026) :
// 30 Rue Racine 59000 Lille, 65,1 m², D/B, 201 kWh, 7 kg CO2, DPE du 05/10/2026.
const TARGET = 'Racine';

before(async () => {
  context = await chromium.launchPersistentContext(userDataDir, {
    // Le canal « chromium » est le mode sans fenêtre qui accepte les extensions.
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  extId = new URL(sw.url()).host;
});

after(async () => {
  await context?.close();
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // Chromium garde parfois un fichier ouvert quelques instants : le dossier temporaire reste.
  }
});

const popupUrl = () => `chrome-extension://${extId}/src/popup/popup.html`;

test('popup : recherche par ville et consommation, puis réaffichage après fermeture', async () => {
  const page = await context.newPage();
  await page.goto(popupUrl());
  await page.fill('#dpe-form [name=city]', 'Lille');
  await page.fill('#dpe-form [name=surface]', '65');
  await page.click('#energy-picker [data-letter="D"]');
  await page.click('#ges-picker [data-letter="B"]');
  await page.fill('#dpe-form [name=energyConsumption]', '201');
  await page.fill('#dpe-form [name=gesEmission]', '7');
  await page.click('#dpe-submit');
  await page.waitForSelector('.imx-address', { timeout: 30000 });
  assert.match(await page.textContent('.imx-address'), new RegExp(TARGET));
  assert.match(await page.textContent('#results'), /niveau 0/);

  // Le popup est détruit (fermeture) puis rouvert : le résultat revient.
  await page.close();
  const again = await context.newPage();
  await again.goto(popupUrl());
  await again.waitForSelector('#entry-bar:not(.imx-hidden)');
  assert.match(await again.textContent('#entry-bar'), /Dernier résultat/);
  assert.match(await again.textContent('.imx-address'), new RegExp(TARGET));
  assert.equal(await again.inputValue('#dpe-form [name=city]'), 'Lille');

  // Onglet historique : l'entrée est listée, rouvrable, supprimable.
  await again.click('#mode-history');
  await again.waitForSelector('.imx-history-item');
  assert.match(await again.textContent('.imx-history-item'), new RegExp(TARGET));
  await again.click('.imx-history-item');
  await again.waitForSelector('.imx-address');
  await again.click('#mode-history');
  await again.waitForSelector('.imx-history-item');
  await again.click('.imx-history-item button');
  await again.waitForSelector('#history-list .imx-notice');
  await again.close();
});

test('popup : pré-remplissage envoyé depuis une annonce', async () => {
  const page = await context.newPage();
  await page.goto(popupUrl());
  await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'PREFILL_SET', payload: { kind: 'dpe', postal: '59800', surface: 48, energyClass: 'E' } })
  );
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#dpe-form [name=postal]').value === '59800');
  assert.equal(await page.inputValue('#dpe-form [name=surface]'), '48');
  assert.match(await page.textContent('#status'), /repris de l'annonce/);
  await page.close();
});

const BIENICI_URL = 'https://www.bienici.com/annonce/vente/lille/appartement/3pieces/test-immodex';
const bieniciPage = `<!doctype html><html><head><title>Appartement 3 pièces Lille</title></head><body>
<h1>Appartement 3 pièces 65 m² Lille</h1><div class="fullAdDescription">Bel appartement. DPE réalisé le 05/10/2026.</div>
<script>window.__INITIAL_STATE__ = {"realEstateAd":{"postalCode":"59000","city":"Lille","surfaceArea":65,"energyClassification":"D","greenhouseGasEmissionClassification":"B","propertyType":"flat","title":"Appartement 3 pièces 65 m²","description":"Bel appartement. DPE réalisé le 05/10/2026."}};</script>
</body></html>`;

test('annonce : bouton flottant, résultat, puis résultat enregistré après rechargement', async () => {
  await context.route(BIENICI_URL, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: bieniciPage }));
  const page = await context.newPage();
  await page.goto(BIENICI_URL);
  const btn = page.locator('#immodex-floating-btn');
  await btn.waitFor();
  assert.match(await btn.textContent(), /trouver/i);
  await btn.click();
  await page.waitForSelector('.imx-address', { timeout: 30000 });
  assert.match(await page.textContent('.imx-address'), new RegExp(TARGET));

  // Rechargement : la carte a disparu, le bouton annonce un résultat enregistré.
  await page.reload();
  await page.waitForFunction(() => /voir les adresses/i.test(document.getElementById('immodex-root')?.shadowRoot?.getElementById('immodex-floating-btn')?.textContent || ''));
  await page.click('#immodex-floating-btn');
  await page.waitForSelector('.imx-notice');
  assert.match(await page.textContent('.imx-notice'), /Résultat enregistré/);
  assert.match(await page.textContent('.imx-address'), new RegExp(TARGET));
  await page.close();
});

const VACHERAND_URL = 'https://www.vacherand.fr/immobilier/location-appartement-lille/ref-test-immodex';
const vacherandPage = `<!doctype html><html><head><title>Appartement Lille</title></head><body>
<h1>Location appartement 3 pièces Lille</h1>
<ul><li class="adresse">Rue de test 59000 Lille</li><li class="surface">Appartement 65 m² 3 pièces</li></ul>
<p>${'Bel appartement lumineux proche du métro. '.repeat(15)}</p>
<div class="date_dpe">Date de réalisation DPE : 05/10/2026</div>
<p>Consommation énergétique : 201 kWh / m² / an</p><p>Émission de Co2 : 7 kg Co2 / m² / an</p>
</body></html>`;

test('site d’agence (lecture générique) : bouton flottant et résultat direct', async () => {
  await context.route(VACHERAND_URL, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: vacherandPage }));
  const page = await context.newPage();
  await page.goto(VACHERAND_URL);
  await page.locator('#immodex-floating-btn').waitFor();
  await page.click('#immodex-floating-btn');
  // Consommation lue sur la page : pas de question, recherche précise directe.
  await page.waitForSelector('.imx-address', { timeout: 30000 });
  assert.match(await page.textContent('.imx-address'), new RegExp(TARGET));
  assert.match(await page.textContent('.imx-chips'), /201 kWh/);
  // Street View sur le meilleur candidat, et carte de tous les candidats dans un nouvel onglet.
  assert.ok(await page.locator('.imx-result a[href*="map_action=pano"]').count());
  const [mapPage] = await Promise.all([context.waitForEvent('page'), page.click('text=Carte des')]);
  await mapPage.waitForSelector('.imx-pin');
  assert.match(mapPage.url(), /src\/map\/map\.html#/);
  assert.ok((await mapPage.locator('.imx-pin').count()) >= 2);
  await mapPage.close();
  await page.close();
});

const ABRINOR_URL = 'https://www.abrinor.fr/annonce/appartement-lille-test-immodex';
const abrinorPage = `<!doctype html><html><head><title>Appartement Lille</title></head><body>
<h1>Appartement 3 pièces 65 m² Lille (59000)</h1>
<p>${'Appartement traversant, parquet, cave. '.repeat(15)}</p>
<h2>Bilan énergétique</h2><img src="/admin/dpe.php?idann=1" alt="DPE"><img src="/admin/dpe.php?type=GES&idann=1" alt="GES">
</body></html>`;

test('étiquette en image : la carte demande les lettres puis cherche', async () => {
  await context.route(ABRINOR_URL, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: abrinorPage }));
  await context.route('https://www.abrinor.fr/admin/**', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: '' }));
  const page = await context.newPage();
  await page.goto(ABRINOR_URL);
  await page.locator('#immodex-floating-btn').waitFor();
  await page.click('#immodex-floating-btn');
  await page.waitForSelector('.imx-prompt .imx-letters', { timeout: 8000 }).catch(async (e) => {
    console.log('CARTE:', await page.locator('.imx-card').innerText().catch(() => 'aucune carte'));
    throw e;
  });
  const pickers = page.locator('.imx-prompt .imx-letters');
  await pickers.nth(0).locator('[data-letter="D"]').click();
  await pickers.nth(1).locator('[data-letter="B"]').click();
  await page.fill('.imx-prompt input[type="number"] >> nth=0', '201');
  await page.fill('.imx-prompt input[type="text"]', '05/10/2026');
  await page.click('.imx-prompt .imx-btn-primary');
  await page.waitForSelector('.imx-address', { timeout: 30000 });
  assert.match(await page.textContent('.imx-chips'), /D\s*Énergie/);
  assert.match(await page.textContent('.imx-address'), new RegExp(TARGET));
  await page.close();
});

// « Analyser cette page » n'est pas testable ici : Chrome n'accorde l'accès à
// l'onglet (permission activeTab) qu'après un vrai clic sur l'icône de
// l'extension, ce qu'un navigateur piloté ne peut pas faire. La lecture elle-même
// est couverte par les tests unitaires et par le bouton flottant ci-dessus.

const sameFlat = (price) => `<!doctype html><html><head><title>Appartement Lille</title></head><body>
<h1>Vente appartement 3 pièces Lille</h1><p>Rue de test 59000 Lille · Appartement 72 m² 3 pièces</p>
<p>Prix : ${price} €</p><p>${'Appartement traversant et calme, proche du métro. '.repeat(15)}</p>
<p>Consommation énergétique : 233 kWh / m² / an</p><p>Émission de Co2 : 41 kg Co2 / m² / an</p></body></html>`;
const FIRST_AD = 'https://www.vacherand.fr/immobilier/vente-appartement-lille/ref-suivi-1';
const SECOND_AD = 'https://www.abrinor.fr/annonce/appartement-lille-suivi-2';

test('suivi des biens : le même bien republié ailleurs est signalé, avec l’évolution du prix', async () => {
  await context.route(FIRST_AD, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: sameFlat('315 000') }));
  await context.route(SECOND_AD, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: sameFlat('295 000') }));
  const page = await context.newPage();
  await page.goto(FIRST_AD);
  await page.locator('#immodex-floating-btn').waitFor();
  await page.waitForTimeout(2500); // le suivi enregistre l'annonce 1,5 s après le chargement
  await page.goto(SECOND_AD);
  await page.waitForFunction(() => /\+1/.test(document.getElementById('immodex-root')?.shadowRoot?.getElementById('immodex-floating-btn')?.textContent || ''), null, { timeout: 10000 });
  await page.click('#immodex-floating-btn');
  await page.waitForSelector('.imx-seen');
  const seenText = await page.textContent('.imx-seen');
  assert.match(seenText, /Déjà vu dans 1 autre annonce/);
  assert.match(seenText, /vacherand\.fr/);
  assert.match(seenText, /315\s000\s€ .*→ 295\s000\s€/);
  await page.close();

  // Onglet « Biens » du popup : le bien apparaît avec ses deux annonces.
  const popup = await context.newPage();
  await popup.goto(popupUrl());
  await popup.click('#mode-biens');
  await popup.waitForSelector('#biens-view .imx-pill');
  assert.match(await popup.textContent('#biens-view'), /2 annonces/);
  await popup.close();
});
