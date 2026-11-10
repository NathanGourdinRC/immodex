// Test de bout en bout de la lecture guidée de Leboncoin : à chaque message « lire la suivante » (le
// clic du Fil), l'extension (Chromium piloté par Playwright) ouvre la recherche suivante d'une commune
// suivie, lit la page, l'envoie au Fil, et attend devant une page de défi sans rien ouvrir d'autre.
// Leboncoin et le serveur du Fil sont simulés : aucun appel réel n'est fait.
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
const STATE_KEY = 'immodex.lbc-guided.v1';
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
      };
      if (withKey) items['immodex.sync.v1'] = { key: 'k'.repeat(40) };
      await chrome.storage.local.set(items);
    },
    { withKey, STATE_KEY }
  );
}

const next = (page) => page.evaluate(() => chrome.runtime.sendMessage({ type: 'LBC_GUIDED_NEXT' }));

const okIngest = (route) => {
  if (route.request().url().endsWith('/api/ingest')) {
    const n = JSON.parse(route.request().postData()).cards.length;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, seen: n, added: n }) });
  }
  return route.fulfill({ status: 503, body: 'indisponible' });
};

test('lecture guidée : un clic par page, les deux pages de la commune sont envoyées au Fil', async () => {
  const visited = [];
  const posted = [];
  await context.route('https://www.leboncoin.fr/**', (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/recherche')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' });
    visited.push(url.search);
    const page = Number(url.searchParams.get('page') || 1);
    return route.fulfill({ status: 200, contentType: 'text/html', body: searchPage(page === 1 ? [ad(1), ad(2)] : [ad(3)]) });
  });
  await context.route('https://immodex.vercel.app/**', (route) => {
    if (route.request().url().endsWith('/api/ingest')) posted.push(JSON.parse(route.request().postData()));
    return okIngest(route);
  });
  const page = await control();
  await setup(page);

  const before = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'LBC_GUIDED_STATUS' }));
  assert.equal(before.status.total, 1);
  assert.equal(before.status.next, 'Marcq-en-Barœul 59700');
  await page.waitForTimeout(1000);
  assert.equal(visited.length, 0, 'rien ne s’ouvre sans clic');

  const first = await next(page);
  assert.equal(first.ok, true);
  assert.equal(visited.length, 1, visited.join(' | '));
  assert.match(visited[0], /locations=Marcq-en-Baroeul_59700/);
  assert.match(visited[0], /category=9/);
  assert.equal(first.status.finished, 0);
  assert.equal(first.status.next, 'Marcq-en-Barœul 59700, page 2');

  const second = await next(page);
  assert.equal(visited.length, 2, visited.join(' | '));
  assert.match(visited[1], /page=2/);
  assert.equal(second.status.finished, 1);
  assert.equal(second.status.next, null);
  assert.equal(second.status.added, 3);
  assert.equal(posted.flatMap((b) => b.cards.map((c) => c.url)).length, 3);
  assert.ok(posted.every((b) => b.source === 'leboncoin'));

  // Tout est lu : un clic de plus n’ouvre rien.
  await next(page);
  assert.equal(visited.length, 2);
  await page.close();
  await context.unroute('https://www.leboncoin.fr/**');
  await context.unroute('https://immodex.vercel.app/**');
});

test('lecture guidée : défi anti-robot = l’onglet reste ouvert en attente, rien d’autre ouvert ni envoyé', async () => {
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
  const first = await next(page);
  assert.equal(first.status.waiting, 'Marcq-en-Barœul 59700');
  assert.equal(first.status.finished, 0);
  // Nathan clique sans avoir passé le test : la page est relue, mais pas rouverte.
  const again = await next(page);
  assert.equal(again.status.waiting, 'Marcq-en-Barœul 59700');
  assert.equal(visits, 1, 'aucune autre page ouverte pendant l’attente du test');
  assert.equal(posts, 0);
  await page.close();
  await context.unroute('https://www.leboncoin.fr/**');
  await context.unroute('https://immodex.vercel.app/**');
});

test('lecture guidée : onglet fermé sans que le test soit passé = la recherche est laissée', async () => {
  await context.route('https://www.leboncoin.fr/**', (route) => route.fulfill({ status: 403, contentType: 'text/html', body: '<html><body><iframe src="about:blank" title="captcha-delivery"></iframe></body></html>' }));
  const page = await control();
  await setup(page);
  const first = await next(page);
  assert.equal(first.status.waiting, 'Marcq-en-Barœul 59700');
  await page.evaluate(async (k) => {
    const st = (await chrome.storage.local.get(k))[k];
    await chrome.tabs.remove(st.tabId);
  }, STATE_KEY);
  const after = await next(page);
  assert.equal(after.status.waiting, null);
  assert.equal(after.status.finished, 1);
  assert.equal(after.status.next, null);
  assert.match(after.status.notes[0], /non lue/);
  await page.close();
  await context.unroute('https://www.leboncoin.fr/**');
});

test('lecture guidée : sans synchro activée, rien n’est ouvert', async () => {
  let visits = 0;
  await context.route('https://www.leboncoin.fr/**', (route) => {
    visits++;
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' });
  });
  const page = await control();
  await setup(page, { withKey: false });
  const res = await next(page);
  assert.match(res.status.error, /synchro/);
  await page.waitForTimeout(1500);
  assert.equal(visits, 0);
  await page.close();
  await context.unroute('https://www.leboncoin.fr/**');
});
