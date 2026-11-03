// Appli téléphone (dist-web) dans le moteur de l'iPhone (WebKit, écran d'iPhone 13) :
// le téléphone de Nathan est un iPhone, et WebKit ne se comporte pas toujours comme Chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit, devices } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = join(ROOT, 'dist-web');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let server;
let base;
let browser;

before(async () => {
  execFileSync(process.execPath, [join(ROOT, 'scripts/build-web.mjs')]);
  server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([\\/])+/, '');
    let file = join(WEB, path || 'index.html');
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://localhost:${server.address().port}`;
  browser = await webkit.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
});

// La carte est cadrée si le contour de la commune occupe une bonne part du cadre,
// et lisible si un secteur de 400 m fait plus de 10 pixels.
async function assertFitted(page) {
  await page.waitForSelector('.imx-contour', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const map = document.getElementById('map').getBoundingClientRect();
    const c = document.querySelector('.imx-contour').getBoundingClientRect();
    return { w: c.width / map.width, h: c.height / map.height };
  });
  assert.ok(Math.max(r.w, r.h) > 0.5, `contour de la commune : ${Math.round(r.w * 100)} % × ${Math.round(r.h * 100)} % de la carte`);
  const box = await page.locator('.imx-sector.is-moyenne').first().boundingBox();
  assert.ok(box && box.width > 10, `secteur de ${box && Math.round(box.width)} px`);
}

test('iPhone : la carte ouverte après le Fil, puis directement sur la Carte, est cadrée sur la commune', async () => {
  const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  await page.goto(`${base}/src/dashboard/dashboard.html`);
  await page.fill('input[type="search"]', 'Wambrechies');
  await page.click('.imx-suggest button:has-text("Wambrechies ·")', { timeout: 20000 });
  await page.selectOption('select.imx-select', 'maison');
  await page.click('button:has-text("Créer la recherche")');
  await page.waitForTimeout(3000);
  await page.click('.imx-views button:has-text("Carte")');
  await page.waitForSelector('.imx-sector', { timeout: 60000 });
  await assertFitted(page);
  // Rechargée : l'adresse garde la vue Carte, la carte s'ouvre cachée puis apparaît.
  await page.reload();
  await page.waitForSelector('.imx-sector', { timeout: 60000 });
  await assertFitted(page);
  await page.close();
});

test('iPhone : un clic sur une annonce du Fil ouvre la Carte centrée sur son point, bulle ouverte', async () => {
  // Service worker bloqué : sinon les annonces passent par lui et échappent aux fausses données du test.
  const page = await (await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' })).newPage();
  const now = Date.now();
  const listing = { id: 'orpi:/annonce-vente-maison-iphone/', source: 'orpi', url: 'https://www.orpi.com/annonce-vente-maison-iphone/', insee: '59636', type: 'maison', title: 'Maison 5 pièces', price: 389000, prices: [{ at: now, price: 389000 }], surface: 120, pieces: 5, firstSeen: now, lastSeen: now, missed: 0, removedAt: null, detail: true, address: '12 Rue de Quesnoy 59118 Wambrechies', lat: 50.6862, lon: 3.0489 };
  // Huit annonces plus récentes sans adresse retrouvée : le bien placé est loin dans le Fil.
  const others = Array.from({ length: 8 }, (_, i) => ({ ...listing, id: `orpi:/autre-${i}/`, url: `https://www.orpi.com/autre-${i}/`, price: 300000 + i * 1000, surface: 90 + i * 7, address: null, lat: null, lon: null }));
  listing.firstSeen = now - 5 * 24 * 3600 * 1000;
  await page.route('https://immodex.vercel.app/api/listings**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, listings: [...others, listing], sources: {}, lastRun: now }) }));
  await page.goto(`${base}/src/dashboard/dashboard.html`);
  await page.fill('input[type="search"]', 'Wambrechies');
  await page.click('.imx-suggest button:has-text("Wambrechies ·")', { timeout: 20000 });
  await page.selectOption('select.imx-select', 'maison');
  await page.click('button:has-text("Créer la recherche")');
  await page.click('.imx-views button:has-text("Fil")');
  await page.locator('.imx-annonce').first().waitFor({ timeout: 30000 });
  await page.locator('.imx-annonce.is-placed .imx-meta').first().click();
  await page.locator('.leaflet-popup-content').filter({ hasText: /389\s000/ }).waitFor({ timeout: 10000 });
  assert.match(await page.evaluate(() => document.body.className), /view-carte/);
  // Le point est dans le cadre de la carte, pas caché sous un bord, et à l'écran : la page
  // descendue jusqu'à l'annonce cliquée remonte sur la carte.
  await page.waitForTimeout(500);
  const pin = await page.locator('.imx-price-pin.is-selected').boundingBox();
  const map = await page.locator('#map').boundingBox();
  assert.ok(pin && pin.x >= map.x && pin.x + pin.width <= map.x + map.width && pin.y >= map.y && pin.y + pin.height <= map.y + map.height, `point ${JSON.stringify(pin)} hors de la carte ${JSON.stringify(map)}`);
  const screen = page.viewportSize();
  assert.ok(pin.y >= 0 && pin.y + pin.height <= screen.height, `point hors de l'écran : ${JSON.stringify(pin)}`);
  await page.close();
});
