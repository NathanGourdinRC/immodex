// Captures d'écran de l'interface (popup, carte, question) pour relire le design.
// Usage : node tests/e2e/screenshots.mjs <dossier de sortie>
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '');
const out = process.argv[2] || join(tmpdir(), 'immodex-shots');
mkdirSync(out, { recursive: true });

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'immodex-shots-')), {
  headless: true,
  channel: 'chromium',
  viewport: { width: 1280, height: 860 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;

const listing = `<!doctype html><html><head><title>Appartement Lille</title><style>body{font-family:Georgia,serif;margin:40px;background:#faf7f2;color:#222}h1{font-size:28px}</style></head><body>
<h1>Location appartement 3 pièces Lille</h1><p>Rue de test 59000 Lille · Appartement 65 m² 3 pièces</p>
<p>${'Bel appartement lumineux proche du métro, parquet ancien, belle hauteur sous plafond. '.repeat(12)}</p>
<div>Date de réalisation DPE : 05/10/2026</div><p>Consommation énergétique : 201 kWh / m² / an</p><p>Émission de Co2 : 7 kg Co2 / m² / an</p></body></html>`;
const noDpe = `<!doctype html><html><head><title>Maison Lille</title></head><body style="font-family:Arial;margin:40px">
<h1>Maison 5 pièces 110 m² Lille (59000)</h1><p>${'Maison de ville avec jardin. '.repeat(30)}</p><h2>Bilan énergétique</h2><img src="/dpe.jpg" alt="DPE"></body></html>`;

await context.route('https://www.vacherand.fr/immobilier/shot-1', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: listing }));
await context.route('https://www.vacherand.fr/immobilier/shot-2', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: noDpe }));

const page = await context.newPage();
await page.goto('https://www.vacherand.fr/immobilier/shot-1');
await page.locator('#immodex-floating-btn').waitFor();
await page.screenshot({ path: join(out, '1-bouton.png') });
await page.click('#immodex-floating-btn');
await page.waitForSelector('.imx-address', { timeout: 30000 });
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, '2-carte-resultat.png') });

await page.goto('https://www.vacherand.fr/immobilier/shot-2');
await page.locator('#immodex-floating-btn').waitFor();
await page.click('#immodex-floating-btn');
await page.waitForSelector('.imx-prompt');
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, '3-carte-question.png') });

const popup = await context.newPage();
await popup.setViewportSize({ width: 384, height: 900 });
await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
await popup.waitForSelector('.imx-address', { timeout: 30000 }).catch(() => {});
await popup.waitForTimeout(300);
await popup.screenshot({ path: join(out, '4-popup-dernier-resultat.png'), fullPage: true });
await popup.click('#mode-dpe');
await popup.waitForTimeout(200);
await popup.screenshot({ path: join(out, '5-popup-formulaire.png'), fullPage: true });
await popup.click('#mode-history');
await popup.waitForSelector('.imx-history-item');
await popup.screenshot({ path: join(out, '6-popup-historique.png'), fullPage: true });
await popup.click('#mode-sites');
await popup.waitForTimeout(200);
await popup.screenshot({ path: join(out, '7-popup-sites.png'), fullPage: true });

await context.close();
console.log('captures dans', out);
