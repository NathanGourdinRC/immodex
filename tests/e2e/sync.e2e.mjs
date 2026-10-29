// Test de bout en bout de la synchro : l'extension (Chromium piloté par Playwright) relie un
// « téléphone » (l'appli web construite dans dist-web/, servie en local, écran de téléphone),
// puis une note prise sur le téléphone revient dans l'extension.
// Passe par le vrai serveur immodex.vercel.app, avec un espace de synchro neuf à chaque fois.
// Lancement : npm run test:e2e
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EXT = ROOT.replace(/[\\/]$/, '');
const WEB = join(ROOT, 'dist-web');
const SYNC = 'https://immodex.vercel.app/api/sync';
const userDataDir = mkdtempSync(join(tmpdir(), 'immodex-sync-e2e-'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain' };
let context;
let browser;
let server;
let base;
let extId;

before(async () => {
  execFileSync(process.execPath, [join(ROOT, 'scripts/build-web.mjs')]);
  // Serveur statique minimal, comme Vercel pour dist-web/.
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

  context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  extId = new URL(sw.url()).host;
  browser = await chromium.launch({ channel: 'chromium' });
});

after(async () => {
  await context?.close();
  await browser?.close();
  server?.close();
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // dossier temporaire encore verrouillé par Chromium : il reste
  }
});

// En ligne, l'appli et le serveur ont la même adresse. Servie en local, elle appelle le
// serveur d'une autre adresse : on relaie ses appels et on ajoute les en-têtes CORS.
async function phonePage() {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.route(SYNC, async (route) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const res = await route.fetch();
    return route.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
  });
  return phone.newPage();
}

// Relance une lecture tant qu'elle échoue (page en cours de rechargement) ou ne renvoie rien.
async function until(read, timeout = 30000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await read().catch(() => null);
    if (value) return value;
    if (Date.now() > end) throw new Error('délai dépassé');
    await new Promise((r) => setTimeout(r, 300));
  }
}

const send = (page, message) => page.evaluate((m) => chrome.runtime.sendMessage(m), message);

test('appairage par le lien du QR code, puis note du téléphone reçue par l’extension', async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  const now = Date.now();
  await popup.evaluate(
    (t) =>
      chrome.storage.local.set({
        'immodex.zones.v1': [{ id: 'zsev', name: 'Sévrier test', communes: [], type: 'maison', surfaceMin: 80, surfaceMax: null, createdAt: t, updatedAt: t, lastVisit: null }],
        'immodex.tracking.v1': { 'https://www.exemple-agence.fr/annonce/1': { status: 'favori', note: 'vue lac', updatedAt: t } },
      }),
    now
  );

  // Bouton téléphone, puis « Relier mon téléphone » : le QR code apparaît.
  await popup.click('#phone-btn');
  await popup.click('#sync-view button:has-text("Relier mon téléphone")');
  await popup.waitForSelector('#sync-view .imx-qr');
  const { status } = await send(popup, { type: 'SYNC_STATUS' });
  assert.match(status.pairUrl, /^https:\/\/immodex\.vercel\.app\/#k=[\w-]{43}$/);
  const sent = await send(popup, { type: 'SYNC_NOW' });
  assert.equal(sent.result.ok, true, JSON.stringify(sent.result));

  // Le téléphone ouvre le lien du QR code (ici sur l'appli servie en local).
  const phone = await phonePage();
  await phone.goto(`${base}/${new URL(status.pairUrl).hash}`);
  await phone.waitForURL(/\/src\/popup\/popup\.html$/);
  // Après l'appairage, la page se recharge avec les données reçues : on attend ce rechargement.
  const zones = await until(() => phone.evaluate(async () => (await chrome.storage.local.get('immodex.zones.v1'))['immodex.zones.v1']));
  await phone.waitForLoadState('load');
  assert.equal(await phone.isVisible('#analyze-btn'), false, 'pas de lecture d’onglet sur le téléphone');
  assert.equal(zones[0].name, 'Sévrier test');

  // Tableau de bord du téléphone : la zone reçue s'y affiche.
  await phone.click('#dashboard-btn');
  await phone.waitForSelector('.imx-zone-tab:has-text("Sévrier test")');
  assert.ok(await phone.isVisible('.imx-web-back'));

  // Note prise sur le téléphone après la visite, renvoyée au serveur…
  await phone.evaluate(async (t) => {
    const all = (await chrome.storage.local.get('immodex.tracking.v1'))['immodex.tracking.v1'];
    all['https://www.exemple-agence.fr/annonce/1'] = { status: 'visite', note: 'humidité au sous-sol', updatedAt: t };
    await chrome.storage.local.set({ 'immodex.tracking.v1': all });
    const r = await chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
    if (!r.result.ok) throw new Error(r.result.error);
  }, Date.now());

  // … et reçue par l'extension à sa synchro suivante.
  const back = await send(popup, { type: 'SYNC_NOW' });
  assert.equal(back.result.applied, 1);
  const tracking = await popup.evaluate(async () => (await chrome.storage.local.get('immodex.tracking.v1'))['immodex.tracking.v1']);
  assert.equal(tracking['https://www.exemple-agence.fr/annonce/1'].note, 'humidité au sous-sol');
  await phone.context().close();
  await popup.close();
});

test('appli téléphone : appairage par lien collé, puis annonce partagée lue et suivie', async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  const { status } = await send(popup, { type: 'SYNC_STATUS' });
  assert.ok(status.paired, 'espace créé par le test précédent');

  // Appli de l'écran d'accueil d'un iPhone : stockage vide, lien copié dans le presse-papiers.
  const phone = await phonePage();
  await phone.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await phone.goto(`${base}/src/popup/popup.html`);
  await phone.click('#phone-btn');
  await phone.evaluate((link) => navigator.clipboard.writeText(link), status.pairUrl);
  await phone.click('#sync-view button:has-text("Coller le lien")');
  const zones = await until(() => phone.evaluate(async () => (await chrome.storage.local.get('immodex.zones.v1'))['immodex.zones.v1']));
  assert.equal(zones[0].name, 'Sévrier test');
  await phone.waitForLoadState('load');

  // Annonce partagée depuis une autre appli (Android : share_target ; ici par l'adresse).
  const title = 'Vente maison 5 pièces Sévrier (74320) - 120 m² - 890 000 € | SeLoger';
  const url = 'https://www.seloger.com/annonces/achat/maison/sevrier-74/999.htm';
  await phone.goto(`${base}/src/popup/popup.html?title=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`);
  await phone.waitForFunction(() => document.querySelector('#dpe-form [name=postal]').value === '74320');
  assert.equal(await phone.inputValue('#dpe-form [name=surface]'), '120');
  assert.equal(new URL(phone.url()).search, '', 'le partage est retiré de l’adresse');
  const sightings = await until(() =>
    phone.evaluate(async () => (await chrome.storage.local.get('immodex.sightings.v1'))['immodex.sightings.v1'])
  );
  const seen = sightings.find((s) => s.url === url);
  assert.ok(seen, 'annonce ajoutée aux biens suivis');
  assert.equal(seen.prices[0].price, 890000);
  // La recherche part d'elle-même (lieu et surface connus) et reste liée à l'annonce.
  await phone.waitForSelector('#results .imx-panel, #status .imx-alert', { timeout: 30000 });
  await phone.context().close();
  await popup.close();
});
