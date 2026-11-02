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
