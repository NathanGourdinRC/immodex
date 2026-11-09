// Test de bout en bout de la tournée quotidienne de SeLoger : l'extension (Chromium piloté par
// Playwright) récupère la liste des annonces sans consommation, ouvre chacune dans une fenêtre
// réduite, lit la page, envoie la carte au Fil, et s'arrête net devant une page de défi.
// SeLoger et le serveur du Fil sont simulés : aucun appel réel n'est fait.
// Lancement : npm run test:e2e
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '');
const userDataDir = mkdtempSync(join(tmpdir(), 'immodex-seloger-e2e-'));
const STATE_KEY = 'immodex.seloger-tour.v1';
// Les appels du service worker (liste, envoi au Fil) passent aussi par les simulations ci-dessous :
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

const path = (n) => `/annonce/achat/hauts-de-france/nord-59/villeneuve-d-ascq-59491/26FM4ZXVB${String(n).padStart(3, '0')}`;
const url = (n) => `https://www.seloger.com${path(n)}`;
const listing = (n) => ({ id: `seloger:${path(n)}`, source: 'seloger', url: url(n), insee: '59009', type: 'maison', title: `Maison ${n}`, firstSeen: 1000 - n, removedAt: null, energyClass: 'D' });

// Page d'annonce au format de SeLoger : le JSON est un texte JavaScript, lui-même dans un script.
const detailPage = (n) => {
  const scale = (type, rating, values) => ({ type, efficiencyClass: { index: 3, rating }, values });
  const classified = {
    rawData: { propertyType: 'HOUSE', price: 369000 },
    sections: {
      location: { address: { city: "Villeneuve-d'Ascq", zipCode: '59650' } },
      hardFacts: { facts: [{ type: 'livingSpace', value: '107,5 m²', splitValue: '107,5' }] },
      energy: {
        features: [{ type: 'yearOfConstruction', value: '1982' }],
        certificates: [
          {
            scales: [
              scale('FR_ENERGY_AFTER_2021', 'D', [{ value: `${220 + n} kWh/m².an`, label: 'Consommation (énergie primaire)' }, { value: '41 kg CO₂/m².an', label: 'Émissions' }]),
              scale('FR_GHG_AFTER_2021', 'D', [{ value: '41 kg CO₂/m².an', label: 'Émissions' }]),
            ],
          },
        ],
      },
    },
  };
  const json = JSON.stringify({ app_cldp: { data: { classified }, error: null } });
  return `<html><body><h1>Maison ${n}</h1><script id="__UFRN_LIFECYCLE_SERVERREQUEST__">window["__UFRN_LIFECYCLE_SERVERREQUEST__"]=JSON.parse(${JSON.stringify(json)});</script></body></html>`;
};

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
        'immodex.zones.v1': [{ id: 'z1', name: 'Villeneuve', type: null, communes: [{ code: '59009', nom: "Villeneuve-d'Ascq", codesPostaux: ['59650'], centre: null }] }],
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
    if (Date.now() - start > timeout) throw new Error(`tournée toujours en cours : ${JSON.stringify(state && state.tour && { idx: state.tour.idx })}`);
    await page.waitForTimeout(500);
  }
}

// Serveur du Fil simulé : liste des annonces, et envoi (enregistré dans `posted`).
const fil = (listings, posted, { ingestStatus = 200 } = {}) => async (route) => {
  const req = route.request();
  const u = new URL(req.url());
  if (u.pathname === '/api/listings') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, listings }) });
  if (u.pathname === '/api/ingest') {
    const body = JSON.parse(req.postData());
    posted.push(body);
    return route.fulfill({ status: ingestStatus, contentType: 'application/json', body: JSON.stringify({ ok: ingestStatus === 200, seen: body.cards.length, added: 0, addressed: body.cards.length }) });
  }
  return route.fulfill({ status: 503, body: 'indisponible' });
};

test('tournée : lit chaque annonce sans consommation, l’envoie au Fil avec sa commune, puis ferme sa fenêtre', async () => {
  const visited = [];
  const posted = [];
  await context.route('https://www.seloger.com/**', (route) => {
    const u = new URL(route.request().url());
    const m = u.pathname.match(/ZXVB(\d{3})$/);
    if (!m) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<html></html>' });
    visited.push(u.pathname);
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: detailPage(Number(m[1])) });
  });
  await context.route('https://immodex.vercel.app/**', fil([listing(1), listing(2)], posted));
  const page = await control();
  await setup(page);
  const res = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SELOGER_TOUR_RUN_NOW' }));
  assert.equal(res.ok, true);
  assert.equal(res.started, true);

  const state = await waitTour(page);
  assert.equal(state.tour.status, 'done', state.tour.reason);
  assert.deepEqual(visited.sort(), [path(1), path(2)]);
  // Une seule carte par annonce : la visite de la tournée ne double pas l'envoi.
  await page.waitForTimeout(1000);
  assert.equal(posted.length, 2, JSON.stringify(posted));
  for (const body of posted) {
    assert.equal(body.source, 'seloger');
    assert.equal(body.insee, '59009');
    assert.equal(body.cards.length, 1);
    assert.equal(body.cards[0].detail.energyConsumption, body.cards[0].url.endsWith('001') ? 221 : 222);
    assert.equal(body.cards[0].detail.gesEmission, 41);
    assert.equal(body.cards[0].detail.constructionYear, 1982);
  }
  assert.deepEqual(posted.map((b) => b.cards[0].url).sort(), [url(1), url(2)]);
  assert.equal(state.lastDay, state.tour.day);
  assert.equal(state.window, null, 'la fenêtre de la tournée est fermée');

  const status = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SELOGER_TOUR_STATUS' }));
  assert.equal(status.status.tour.pages, 2);
  assert.equal(status.status.tour.ok, 2);
  assert.equal(status.status.tour.addressed, 2);
  await page.close();
  await context.unroute('https://www.seloger.com/**');
  await context.unroute('https://immodex.vercel.app/**');
});

test('tournée : page de défi anti-robot = arrêt net, rien d’envoyé, reprise le lendemain', async () => {
  let visits = 0;
  const posted = [];
  await context.route('https://www.seloger.com/**', (route) => {
    if (!/ZXVB\d{3}$/.test(new URL(route.request().url()).pathname)) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<html></html>' });
    visits++;
    return route.fulfill({ status: 403, contentType: 'text/html; charset=utf-8', body: '<html><body><iframe src="about:blank" title="captcha-delivery"></iframe><p>Veuillez compléter la vérification de sécurité pour continuer</p></body></html>' });
  });
  await context.route('https://immodex.vercel.app/**', fil([listing(1), listing(2), listing(3)], posted));
  const page = await control();
  await setup(page);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SELOGER_TOUR_RUN_NOW' }));
  const state = await waitTour(page);
  assert.equal(state.tour.status, 'stopped');
  assert.match(state.tour.reason, /anti-robot/);
  assert.equal(visits, 1, 'aucune autre page ouverte après le défi');
  assert.equal(posted.length, 0);
  assert.equal(state.window, null);
  const status = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SELOGER_TOUR_STATUS' }));
  assert.match(status.status.tour.reason, /anti-robot/);
  assert.equal(status.status.tour.waiting, 2);
  await page.close();
  await context.unroute('https://www.seloger.com/**');
  await context.unroute('https://immodex.vercel.app/**');
});

test('tournée : annonce déjà lue (consommation connue) ou autre site, rien n’est ouvert', async () => {
  let visits = 0;
  const posted = [];
  await context.route('https://www.seloger.com/**', (route) => {
    visits++;
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<html></html>' });
  });
  await context.route('https://immodex.vercel.app/**', fil([{ ...listing(1), energyConsumption: 226 }, { ...listing(2), source: 'leboncoin' }], posted));
  const page = await control();
  await setup(page);
  const res = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SELOGER_TOUR_RUN_NOW' }));
  assert.equal(res.started, false);
  assert.match(res.reason, /aucune annonce/);
  await page.waitForTimeout(1000);
  assert.equal(visits, 0);
  assert.equal(posted.length, 0);
  await page.close();
  await context.unroute('https://www.seloger.com/**');
  await context.unroute('https://immodex.vercel.app/**');
});

test('tournée : sans synchro activée, rien n’est ouvert', async () => {
  let visits = 0;
  await context.route('https://www.seloger.com/**', (route) => {
    visits++;
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<html></html>' });
  });
  const page = await control();
  await setup(page, { withKey: false });
  const res = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SELOGER_TOUR_RUN_NOW' }));
  assert.equal(res.started, false);
  assert.match(res.reason, /synchro/);
  await page.waitForTimeout(1500);
  assert.equal(visits, 0);
  await page.close();
  await context.unroute('https://www.seloger.com/**');
});

test('tournée : désactivée depuis le Fil, la tournée en cours s’arrête', async () => {
  const posted = [];
  await context.route('https://www.seloger.com/**', (route) => {
    const m = new URL(route.request().url()).pathname.match(/ZXVB(\d{3})$/);
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: m ? detailPage(Number(m[1])) : '<html></html>' });
  });
  await context.route('https://immodex.vercel.app/**', fil([1, 2, 3, 4, 5].map(listing), posted));
  const page = await control();
  await setup(page);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SELOGER_TOUR_RUN_NOW' }));
  const off = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SELOGER_TOUR_SET', enabled: false }));
  assert.equal(off.status.enabled, false);
  const state = await waitTour(page, 30_000);
  assert.equal(state.tour.status, 'stopped');
  assert.match(state.tour.reason, /désactivée/);
  assert.equal(state.window, null);
  await page.close();
  await context.unroute('https://www.seloger.com/**');
  await context.unroute('https://immodex.vercel.app/**');
});

test('visite de Nathan : la page d’annonce envoie sa lecture au Fil', async () => {
  const posted = [];
  await context.route('https://www.seloger.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: detailPage(7) }));
  await context.route('https://immodex.vercel.app/**', fil([], posted));
  const control1 = await control();
  await setup(control1);
  const visit = await context.newPage();
  await visit.goto(url(7));
  const start = Date.now();
  while (!posted.length && Date.now() - start < 15_000) await visit.waitForTimeout(300);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].cards[0].detail.energyConsumption, 227);
  assert.equal(posted[0].cards[0].url, url(7));
  await visit.close();
  await control1.close();
  await context.unroute('https://www.seloger.com/**');
  await context.unroute('https://immodex.vercel.app/**');
});
