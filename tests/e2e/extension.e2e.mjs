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
  // Ventes passées (DVF, vraie API) : le 30 rue Racine a des ventes, dont un T3 de 63 m²
  // proche des 65 m² de l'annonce, mis en avant.
  await page.click('.imx-result button:has-text("Ventes passées")');
  await page.waitForSelector('.imx-result .imx-sales', { timeout: 30000 });
  assert.match(await page.textContent('.imx-result .imx-sales'), /Ventes à cette adresse/);
  assert.ok((await page.locator('.imx-result .imx-sale').count()) >= 1);
  assert.ok((await page.locator('.imx-result .imx-sale.is-match').count()) >= 1);
  const [mapPage] = await Promise.all([context.waitForEvent('page'), page.click('text=Carte des')]);
  await mapPage.waitForSelector('.imx-pin');
  assert.match(mapPage.url(), /src\/map\/map\.html#/);
  assert.ok((await mapPage.locator('.imx-pin').count()) >= 2);
  // Même bouton dans la bulle du meilleur candidat, ouverte d'office.
  await mapPage.click('.leaflet-popup button:has-text("Ventes passées")');
  await mapPage.waitForSelector('.leaflet-popup .imx-sales', { timeout: 30000 });
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

test('tableau de bord : zone Lille, nouveaux DPE, annonce vue suivie, prix par section', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/src/dashboard/dashboard.html`);
  // Aucune zone encore : la page ouvre le formulaire de création.
  await page.fill('input[type="search"]', 'Lille');
  await page.click('.imx-suggest button:has-text("Lille ·")', { timeout: 15000 });
  await page.selectOption('select.imx-select', 'appartement');
  await page.fill('input[name="surfaceMin"]', '50');
  await page.fill('input[name="surfaceMax"]', '90');
  await page.fill('input[name="budgetMax"]', '450000');
  await page.fill('input[name="piecesMin"]', '2');
  await page.click('button:has-text("Créer la recherche")');
  await page.waitForSelector('.imx-zone-tab.is-active');
  // Nouveaux DPE de la zone (vraie API ADEME) en liste et en pastilles sur la carte.
  await page.waitForSelector('.imx-row .imx-row-title', { timeout: 30000 });
  assert.ok((await page.locator('.leaflet-overlay-pane .leaflet-interactive').count()) > 5);
  // L'appartement de 72 m² vu au test précédent (59000, 295 000 €) passe les critères : Garder et note.
  const bien = page.locator('.imx-bien').first();
  await bien.waitFor({ timeout: 15000 });
  await bien.locator('button:has-text("Garder")').click();
  await page.fill('textarea.imx-note', 'Belle lumière, cave humide');
  await page.keyboard.press('Tab');
  assert.ok(await page.locator('.imx-bien button:has-text("Castorus")').count());
  // Le nombre de pièces n'est pas lu sur l'annonce : signalé, sans l'exclure.
  assert.match(await bien.textContent(), /pièces non précisées/);
  // Prix au m² de l'annonce vue : 295 000 € pour 72 m².
  assert.match(await bien.textContent(), /4\s097\s€\/m²/);
  assert.match(await page.textContent('.imx-kpis'), /1 favori/);
  // Trois vues ; la vue est gardée dans l'adresse.
  for (const label of ['Fil', 'Carte', 'Ventes passées']) assert.equal(await page.locator(`.imx-views button:has-text("${label}")`).count(), 1);
  await page.click('.imx-views button:has-text("Carte")');
  assert.match(page.url(), /vue=carte/);
  // Légende des secteurs (le détail est vérifié sur Wambrechies, plus petite).
  await page.waitForSelector('.imx-legend', { timeout: 30000 });
  await page.click('.imx-views button:has-text("Fil")');
  // Après rechargement : la recherche, le statut et la note sont gardés.
  await page.reload();
  await page.waitForSelector('.imx-bien select.imx-status', { timeout: 30000 });
  assert.equal(await page.locator('.imx-bien select.imx-status').first().inputValue(), 'favori');
  assert.equal(await page.locator('textarea.imx-note').first().inputValue(), 'Belle lumière, cave humide');
  // Écarter : le bien sort du fil, un bouton permet de revoir les écartés.
  // (D'autres annonces de Lille vues par les tests précédents peuvent aussi être dans le fil.)
  const visible = await page.locator('.imx-bien:visible').count();
  await page.locator('.imx-bien button:has-text("Écarter")').first().click();
  await page.waitForSelector('button:has-text("Afficher les écartées (1)")');
  assert.equal(await page.locator('.imx-bien:visible').count(), visible - 1);
  // Les critères de la recherche sont gardés et repris dans le formulaire.
  await page.click('button:has-text("Modifier")');
  assert.equal(await page.inputValue('input[name="budgetMax"]'), '450000');
  assert.equal(await page.inputValue('input[name="piecesMin"]'), '2');
  assert.match(await page.textContent('#subtitle'), /Modifier/);
  await page.close();
  // Le bouton du popup mène à « Mes recherches ».
  const popup = await context.newPage();
  await popup.goto(popupUrl());
  assert.match(await popup.textContent('#dashboard-btn'), /Mes recherches/);
  await popup.close();
});

test('carte en secteurs : Wambrechies', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/src/dashboard/dashboard.html`);
  await page.click('#zone-tabs button:has-text("Nouvelle recherche")');
  await page.fill('input[type="search"]', 'Wambrechies');
  await page.click('.imx-suggest button:has-text("Wambrechies ·")', { timeout: 15000 });
  await page.selectOption('select.imx-select', 'maison');
  await page.click('button:has-text("Créer la recherche")');
  await page.click('.imx-views button:has-text("Carte")');
  // Ventes DVF de la commune (vraie API d'Etalab) regroupées en secteurs de 400 m.
  await page.waitForSelector('.imx-sector', { timeout: 60000 });
  assert.ok((await page.locator('.imx-sector').count()) >= 10);
  assert.ok((await page.locator('.imx-sector.is-moins, .imx-sector.is-plus').count()) >= 1);
  assert.ok((await page.locator('.imx-sector.is-peu').count()) >= 1);
  const legend = await page.textContent('#side');
  for (const t of ['moins cher', 'dans la moyenne', 'plus cher']) assert.match(legend, new RegExp(t));
  assert.match(legend, /Ventes connues jusqu’au/);
  // Bulle d'un secteur : un tableau lisible de ses ventes.
  await page.locator('.imx-sector.is-moyenne').first().click({ force: true });
  await page.waitForSelector('.leaflet-popup .imx-sector-table tbody tr', { timeout: 10000 });
  const popupHead = await page.textContent('.leaflet-popup .imx-sector-table thead');
  for (const t of ['Date', 'Adresse', 'Prix', '€/m²', 'Surface', 'Terrain']) assert.ok(popupHead.includes(t), t);
  assert.ok((await page.locator('.leaflet-popup-content-wrapper').boundingBox()).width >= 420);
  await page.keyboard.press('Escape');
  // Ventes passées : tableau avec prix au m², terrain et dépendance.
  await page.click('.imx-views button:has-text("Ventes passées")');
  await page.waitForSelector('.imx-sales-table tbody tr', { timeout: 60000 });
  assert.ok((await page.locator('.imx-sales-table tbody tr').count()) >= 20);
  const head = await page.textContent('.imx-sales-table thead');
  for (const t of ['€/m²', 'Terrain', 'Dépendance']) assert.ok(head.includes(t), t);
  assert.match(await page.textContent('.imx-view-ventes'), /Ventes connues jusqu’au/);
  // Plus de lignes à la demande.
  const before = await page.locator('.imx-sales-table tbody tr').count();
  await page.click('button:has-text("Afficher 50 de plus")');
  assert.ok((await page.locator('.imx-sales-table tbody tr').count()) > before);
  await page.close();
});

test('ventes passées : une section DVF injoignable ne fait pas tout perdre', async () => {
  const page = await context.newPage();
  // Serveur des ventes allégées injoignable : repli section par section, dont une en panne.
  await page.route('https://immodex.vercel.app/api/dvf**', (route) => route.fulfill({ status: 503, body: 'indisponible' }));
  await page.route('**/api/mutations3/59636/0000B', (route) => route.fulfill({ status: 503, body: 'indisponible' }));
  await page.goto(`chrome-extension://${extId}/src/dashboard/dashboard.html`);
  await page.click('#zone-tabs button:has-text("Wambrechies")');
  await page.click('.imx-views button:has-text("Ventes passées")');
  await page.waitForSelector('.imx-sales-table tbody tr', { timeout: 60000 });
  assert.match(await page.textContent('.imx-view-ventes'), /section cadastrale injoignable/);
  await page.click('.imx-views button:has-text("Carte")');
  await page.waitForSelector('.imx-sector', { timeout: 30000 });
  await page.close();
});

test('téléphone : carte cadrée sur la commune, « Voir sur la carte », tableau sans défilement de côté', async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`chrome-extension://${extId}/src/dashboard/dashboard.html`);
  await page.click('#zone-tabs button:has-text("Wambrechies")');
  await page.click('.imx-views button:has-text("Fil")');
  // Carte ouverte après le Fil : cadrée sur la commune, secteurs de taille lisible.
  await page.waitForTimeout(3000);
  await page.click('.imx-views button:has-text("Carte")');
  await page.waitForSelector('.imx-sector', { timeout: 60000 });
  await page.waitForTimeout(800);
  const box = await page.locator('.imx-sector').first().boundingBox();
  assert.ok(box && box.width > 10, `secteur de ${box && box.width} px`);
  // « Voir sur la carte » depuis le Fil bascule sur la carte.
  await page.click('.imx-views button:has-text("Fil")');
  await page.locator('.imx-row-title').first().click();
  assert.match(page.url(), /vue=carte/);
  assert.ok(await page.locator('#map').isVisible());
  // Ventes passées : tout tient dans la largeur de l'écran.
  await page.click('.imx-views button:has-text("Ventes passées")');
  await page.waitForSelector('.imx-sales-table tbody tr', { timeout: 60000 });
  const overflow = await page.$eval('.imx-table-wrap', (w) => w.scrollWidth - w.clientWidth);
  assert.ok(overflow <= 1, `débordement de ${overflow} px`);
  await page.close();
});

test('contour de la commune injoignable : la carte se cadre sur les secteurs', async () => {
  const page = await context.newPage();
  await page.route(/geo\.api\.gouv\.fr\/communes\/59636\?.*geometry=contour/, (route) => route.fulfill({ status: 503, body: 'indisponible' }));
  await page.goto(`chrome-extension://${extId}/src/dashboard/dashboard.html`);
  await page.click('#zone-tabs button:has-text("Wambrechies")');
  await page.click('.imx-views button:has-text("Carte")');
  await page.waitForSelector('.imx-sector', { timeout: 60000 });
  await page.waitForTimeout(1500);
  const box = await page.locator('.imx-sector.is-moyenne').first().boundingBox();
  assert.ok(box && box.width > 15, `secteur de ${box && Math.round(box.width)} px`);
  await page.close();
});

test('fil : annonces scannées, nouveautés, baisses et retraits, Garder', async () => {
  const now = Date.now();
  const DAY = 24 * 3600 * 1000;
  const l = (o) => ({ insee: '59636', type: 'maison', missed: 0, removedAt: null, detail: true, lastSeen: now - DAY, ...o });
  const listings = [
    l({ id: 'orpi:/annonce-vente-maison-t5-wambrechies-e2e1/', source: 'orpi', url: 'https://www.orpi.com/annonce-vente-maison-t5-wambrechies-e2e1/', title: 'Maison 5 pièces Wambrechies', price: 389000, prices: [{ at: now - DAY, price: 389000 }], surface: 120, pieces: 5, chambres: 4, terrain: 300, energyClass: 'D', firstSeen: now }),
    l({ id: 'paruvendu:/immobilier/vente/maison/1295516811E2E', source: 'paruvendu', url: 'https://www.paruvendu.fr/immobilier/vente/maison/1295516811E2E', title: 'Maison 4 pièces', price: 280000, prices: [{ at: now - 20 * DAY, price: 300000 }, { at: now - DAY, price: 280000 }], surface: 95, pieces: 4, firstSeen: now - 20 * DAY }),
    l({ id: 'lesiteimmo:/acheter/maison-4pieces/wambrechies-59118/9999', source: 'lesiteimmo', url: 'https://www.lesiteimmo.com/acheter/maison-4pieces/wambrechies-59118/9999', title: 'Maison retirée', price: 330000, prices: [{ at: now - 30 * DAY, price: 330000 }], surface: 100, firstSeen: now - 30 * DAY, removedAt: now - DAY, sale: { date: '2026-10-01', price: 315000, pricePerM2: 3150, how: 'probable' } }),
  ];
  const page = await context.newPage();
  await page.route('https://immodex.vercel.app/api/listings**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, listings, sources: { 59636: { orpi: { lastRun: now - DAY, paused: false }, deleu: { lastRun: now - DAY, paused: true } } }, lastRun: now - DAY }) })
  );
  // Ventes de la commune avec leur classe énergie et les statistiques DPE de la commune.
  const sale = (i, cls, ppm) => ({ id: `s${i}`, date: '2025-06-01', commune: '59636', address: `${i} RUE DE QUESNOY`, price: ppm * 100, type: 'Maison', surface: 100, pieces: 5, terrain: 200, dependances: 0, pricePerM2: ppm, lon: 3.05 + i / 1000, lat: 50.68, energyClass: cls, dpeDays: 150 });
  const dvf = { insee: '59636', type: 'maison', sales: Array.from({ length: 30 }, (_, i) => sale(i + 1, i % 2 ? 'D' : 'C', 3300 + i * 10)), energy: { byClass: { C: { count: 53, median: 3757 }, D: { count: 82, median: 3379 } }, delay: { count: 177, median: 156, p25: 126, p75: 224 } }, lastDate: '2025-12-30', years: [2025] };
  await page.route('https://immodex.vercel.app/api/dvf**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dvf) }));
  await page.goto(`chrome-extension://${extId}/src/dashboard/dashboard.html`);
  await page.click('#zone-tabs button:has-text("Wambrechies")');
  await page.click('.imx-views button:has-text("Fil")');
  await page.waitForSelector('.imx-annonce', { timeout: 30000 });
  // Repère de la classe énergie : prix médian des maisons de classe D vendues dans la commune.
  await page.waitForSelector('.imx-annonce .imx-energy', { timeout: 30000 });
  assert.match(await page.locator('.imx-annonce').first().textContent(), /Classe D à Wambrechies : 3\s379\s€\/m² médian \(82 ventes\)/);
  assert.equal(await page.locator('.imx-annonce').count(), 3);
  const text = await page.textContent('.imx-view-fil');
  assert.match(text, /Nouveau/);
  assert.match(text, /Prix baissé de 20\s000\s€/);
  assert.match(text, /Retiré/);
  // Annonce retirée reliée à sa vente DVF : prix signé et écart au premier prix affiché.
  assert.match(text, /Vendue 315\s000\s€ le 01\/10\/2026, 5 % sous le premier prix affiché \(lien probable\)/);
  // Prix au m² de chaque bien : 389 000 € pour 120 m².
  assert.match(await page.locator('.imx-annonce').first().textContent(), /3\s242\s€\/m²/);
  assert.match(text, /Dernier passage du robot/);
  assert.match(text, /Deleu Immobilier en pause/);
  const first = page.locator('.imx-annonce').first();
  await first.locator('button:has-text("Garder")').click();
  await first.locator('button:has-text("Gardé")').waitFor();
  // Ventes passées : délai DPE → vente, prix par classe et colonne DPE.
  await page.click('.imx-views button:has-text("Ventes passées")');
  await page.waitForSelector('.imx-sales-table tbody tr', { timeout: 30000 });
  const ventes = await page.textContent('.imx-view-ventes');
  assert.match(ventes, /Délai médian entre le DPE et la vente : 5 mois/);
  assert.match(ventes, /Prix au m² selon la classe énergie/);
  assert.ok((await page.textContent('.imx-sales-table thead')).includes('DPE'));
  await page.close();
});
