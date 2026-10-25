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
  await page.selectOption('#dpe-form [name=energyClass]', 'D');
  await page.selectOption('#dpe-form [name=gesClass]', 'B');
  await page.fill('#dpe-form [name=energyConsumption]', '201');
  await page.fill('#dpe-form [name=gesEmission]', '7');
  await page.click('#dpe-submit');
  await page.waitForSelector('.result-address', { timeout: 30000 });
  assert.match(await page.textContent('.result-address'), new RegExp(TARGET));
  assert.match(await page.textContent('#status'), /tier 0/);

  // Le popup est détruit (fermeture) puis rouvert : le résultat revient.
  await page.close();
  const again = await context.newPage();
  await again.goto(popupUrl());
  await again.waitForSelector('#entry-bar:not(.hidden)');
  assert.match(await again.textContent('#entry-bar'), /Dernier résultat/);
  assert.match(await again.textContent('.result-address'), new RegExp(TARGET));
  assert.equal(await again.inputValue('#dpe-form [name=city]'), 'Lille');

  // Onglet historique : l'entrée est listée, rouvrable, supprimable.
  await again.click('#mode-history');
  await again.waitForSelector('.history-item');
  assert.match(await again.textContent('.history-item'), new RegExp(TARGET));
  await again.click('.history-item');
  await again.waitForSelector('.result-address');
  await again.click('#mode-history');
  await again.waitForSelector('.history-item');
  await again.click('.history-del');
  await again.waitForSelector('#history-list .empty');
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
  await page.waitForSelector('.immodex-address', { timeout: 30000 });
  assert.match(await page.textContent('.immodex-address'), new RegExp(TARGET));

  // Rechargement : la carte a disparu, le bouton annonce un résultat enregistré.
  await page.reload();
  await page.waitForFunction(() => /enregistr/i.test(document.getElementById('immodex-floating-btn')?.textContent || ''));
  await page.click('#immodex-floating-btn');
  await page.waitForSelector('.immodex-saved');
  assert.match(await page.textContent('.immodex-saved'), /Résultat enregistré/);
  assert.match(await page.textContent('.immodex-address'), new RegExp(TARGET));
  await page.close();
});
