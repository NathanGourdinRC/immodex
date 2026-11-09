// Test de bout en bout de la tournée quotidienne de Leboncoin : l'extension (Chromium piloté par
// Playwright) ouvre les recherches d'une commune suivie, lit les pages, les envoie au Fil, et
// s'arrête net devant une page de défi. Leboncoin et le serveur du Fil sont simulés : aucun appel
// réel n'est fait.
// Lancement : npm run test:e2e
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '');
const userDataDir = mkdtempSync(join(tmpdir(), 'immodex-lbc-e2e-'));
const STATE_KEY = 'immodex.lbc-tour.v1';
// Les appels du service worker (envoi des annonces au Fil) passent aussi par les simulations ci-dessous :
// sans cela, le test parlerait au vrai serveur.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
let context;
let extId;

before(async () => {
  context = await chromium.launchPersistentContext(userDataDir, {
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
    // dossier temporaire encore verrouillé par Chromium : il reste
  }
});

const ad = (id) => ({
  list_id: id,
  subject: `Maison ${id}`,
  url: `https://www.leboncoin.fr/ad/ventes_immobilieres/${id}`,
  price: [400000 + id],
  status: 'active',
  category_id: '9',
  location: { city: 'Marcq-en-Baroeul', zipcode: '59700' },
  images: { urls: [] },
  attributes: [
    { key: 'real_estate_type', value: '1' },
    { key: 'square', value: '100' },
  ],
});
const searchPage = (ads, extra) => `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { searchData: { ads, total: 3, max_pages: 2, ...extra } } } })}</script><h1>Résultats</h1></body></html>`;

// Une page de l'extension sert de poste de commande : stockage et messages passent par elle.
async function control() {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/src/popup/popup.html`);
  return page;
}

async function setup(page, { withKey = true } = {}) {
  await page.evaluate(
    async ({ withKey, STATE_KEY }) => {
      await chrome.storage.local.clear();
      const items = {
        'immodex.zones.v1': [{ id: 'z1', name: 'Marcq', type: null, communes: [{ code: '59378', nom: 'Marcq-en-Barœul', codesPostaux: ['59700'], centre: null }] }],
        // Rythme accéléré pour le test seulement : le vrai rythme est de 45 secondes.
        [STATE_KEY]: { paceMs: 600 },
      };
      if (withKey) items['immodex.sync.v1'] = { key: 'k'.repeat(40) };
      await chrome.storage.local.set(items);
    },
    { withKey, STATE_KEY }
  );
}

async function waitTour(page, timeout = 90_000) {
  const start = Date.now();
  for (;;) {
    const state = await page.evaluate(async (k) => (await chrome.storage.local.get(k))[k], STATE_KEY);
    if (state && state.tour && state.tour.status !== 'running') return state;
    if (Date.now() - start > timeout) throw new Error(`tournée toujours en cours : ${JSON.stringify(state && state.tour && { idx: state.tour.idx, page: state.tour.page })}`);
    await page.waitForTimeout(500);
  }
}

test('tournée : lit les deux pages de la commune, les envoie au Fil, puis ferme sa fenêtre', async () => {
  const visited = [];
  const posted = [];
  await context.route('https://www.leboncoin.fr/**', (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/recherche')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' });
    visited.push(url.search);
    const page = Number(url.searchParams.get('page') || 1);
    return route.fulfill({ status: 200, contentType: 'text/html', body: searchPage(page === 1 ? [ad(1), ad(2)] : [ad(3)]) });
  });
  await context.route('https://immodex.vercel.app/**', async (route) => {
    const req = route.request();
    if (req.url().endsWith('/api/ingest')) {
      const body = JSON.parse(req.postData());
      posted.push(body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, seen: body.cards.length, added: body.cards.length }) });
    }
    return route.fulfill({ status: 503, body: 'indisponible' });
  });
  const page = await control();
  await setup(page);
  const res = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'LBC_TOUR_RUN_NOW' }));
  assert.equal(res.ok, true);
  assert.equal(res.started, true);

  const state = await waitTour(page);
  assert.equal(state.tour.status, 'done', state.tour.reason);
  assert.equal(visited.length, 2, visited.join(' | '));
  assert.match(visited[0], /locations=Marcq-en-Baroeul_59700/);
  assert.match(visited[0], /category=9/);
  assert.match(visited[1], /page=2/);
  const urls = posted.flatMap((b) => b.cards.map((c) => c.url));
  assert.equal(urls.length, 3, JSON.stringify(state.tour.results));
  assert.ok(posted.every((b) => b.source === 'leboncoin'));
  assert.equal(state.lastDay, state.tour.day);
  assert.equal(state.window, null, 'la fenêtre de la tournée est fermée');

  const status = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'LBC_TOUR_STATUS' }));
  assert.equal(status.status.tour.added, 3);
  assert.equal(status.status.tour.pages, 2);
  await page.close();
  await context.unroute('https://www.leboncoin.fr/**');
  await context.unroute('https://immodex.vercel.app/**');
});

test('tournée : page de défi anti-robot = arrêt net, rien d’envoyé, reprise le lendemain', async () => {
  let visits = 0;
  let posts = 0;
  await context.route('https://www.leboncoin.fr/**', (route) => {
    visits++;
    return route.fulfill({ status: 403, contentType: 'text/html', body: '<html><body><iframe src="about:blank" title="captcha-delivery"></iframe><p>Veuillez résoudre le défi</p></body></html>' });
  });
  await context.route('https://immodex.vercel.app/**', (route) => {
    if (route.request().url().endsWith('/api/ingest')) posts++;
    return route.fulfill({ status: 503, body: 'indisponible' });
  });
  const page = await control();
  await setup(page);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'LBC_TOUR_RUN_NOW' }));
  const state = await waitTour(page);
  assert.equal(state.tour.status, 'stopped');
  assert.match(state.tour.reason, /refus|défi|anti-robot/i);
  assert.equal(visits, 1, 'aucune autre page ouverte après le refus');
  assert.equal(posts, 0);
  assert.equal(state.window, null);
  const status = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'LBC_TOUR_STATUS' }));
  assert.match(status.status.tour.reason, /refus|défi|anti-robot/i);
  await page.close();
  await context.unroute('https://www.leboncoin.fr/**');
  await context.unroute('https://immodex.vercel.app/**');
});

test('tournée : sans synchro activée, rien n’est ouvert', async () => {
  let visits = 0;
  await context.route('https://www.leboncoin.fr/**', (route) => {
    visits++;
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' });
  });
  const page = await control();
  await setup(page, { withKey: false });
  const res = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'LBC_TOUR_RUN_NOW' }));
  assert.equal(res.started, false);
  assert.match(res.reason, /synchro/);
  await page.waitForTimeout(1500);
  assert.equal(visits, 0);
  await page.close();
  await context.unroute('https://www.leboncoin.fr/**');
});

test('tournée : désactivée depuis le Fil, la tournée en cours s’arrête', async () => {
  await context.route('https://www.leboncoin.fr/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: searchPage([ad(1)], { max_pages: 5 }) }));
  await context.route('https://immodex.vercel.app/**', (route) => {
    if (route.request().url().endsWith('/api/ingest')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, seen: 1, added: 1 }) });
    return route.fulfill({ status: 503, body: 'indisponible' });
  });
  const page = await control();
  await setup(page);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'LBC_TOUR_RUN_NOW' }));
  const off = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'LBC_TOUR_SET', enabled: false }));
  assert.equal(off.status.enabled, false);
  const state = await waitTour(page, 30_000);
  assert.equal(state.tour.status, 'stopped');
  assert.match(state.tour.reason, /désactivée/);
  await page.close();
  await context.unroute('https://www.leboncoin.fr/**');
  await context.unroute('https://immodex.vercel.app/**');
});
