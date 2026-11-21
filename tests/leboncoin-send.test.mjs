// Page d'annonce Leboncoin (src/content/leboncoin.js) : ce qu'elle envoie au Fil. Les listes ne
// donnent que les lettres du DPE ; la date du DPE de la description départage les logements de
// même surface dans le registre, et le bien reçoit enfin son point sur la carte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const src = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const extractCode = src('src/common/extract.js');
const pageCode = src('src/content/leboncoin.js');

const AD = {
  list_id: 3280694365,
  subject: 'Maison 4 pièces 102 m²',
  url: 'https://www.leboncoin.fr/ad/ventes_immobilieres/3280694365',
  price: [344000],
  category_id: '9',
  category_name: 'Ventes immobilières',
  location: { city: 'Marquette-lez-Lille', zipcode: '59520' },
  images: { urls: ['https://img.leboncoin.fr/1.jpg'] },
  attributes: [
    { key: 'real_estate_type', value: '1', value_label: 'Maison' },
    { key: 'square', value: '102', value_label: '102 m²' },
    { key: 'rooms', value: '4' },
    { key: 'bedrooms', value: '2' },
    { key: 'energy_rate', value: 'd', value_label: 'D' },
    { key: 'ges', value: 'd', value_label: 'D' },
  ],
};

// Ouvre la page dans jsdom avec une extension simulée ; renvoie les messages envoyés.
async function openAd(ad, { path = '/ad/ventes_immobilieres/3280694365', saved = null } = {}) {
  const html = `<html><body><h1>${ad.subject}</h1><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { ad } } })}</script></body></html>`;
  const dom = new JSDOM(html, { url: `https://www.leboncoin.fr${path}`, runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  const sent = [];
  const w = dom.window;
  // Recherche gardée dans l'historique pour cette page (`saved`), sinon aucune.
  w.chrome = { runtime: { sendMessage: async (m) => (sent.push(JSON.parse(JSON.stringify(m))), m.type === 'HISTORY_GET_FOR_URL' ? { ok: true, entry: saved } : { ok: true }) } };
  w.__immodexOverlay = { mountListingButton() {}, onNavigate() {}, closeCard() {}, showLoading() {}, showResult() {}, showError() {}, showDatePrompt() {} };
  w.setInterval = () => 0;
  w.eval(extractCode);
  w.eval(pageCode);
  // La page lance sa lecture au chargement du document (DOMContentLoaded).
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { sent: sent.filter((m) => m.type === 'LIST_CARDS'), window: w };
}

test('description qui donne la date du DPE : l’annonce part au Fil avec cette date, dès l’ouverture', async () => {
  const { sent } = await openAd({ ...AD, body: 'Maison lumineuse. Diagnostic de performance énergétique réalisé le 14/05/2026.' });
  assert.equal(sent.length, 1);
  const [m] = sent;
  assert.equal(m.source, 'leboncoin');
  const [card] = m.cards;
  assert.equal(card.url, AD.url);
  assert.equal(card.type, 'maison');
  assert.equal(card.price, 344000);
  assert.deepEqual(card.detail.dateRange, { gte: '2026-05-14', lte: '2026-05-14', precision: 'day' });
  assert.deepEqual([card.detail.surface, card.detail.pieces, card.detail.chambres, card.detail.postal, card.detail.energyClass, card.detail.gesClass], [102, 4, 2, '59520', 'D', 'D']);
});

test('sans date ni chiffres du DPE : rien n’est envoyé (la liste a déjà tout)', async () => {
  assert.equal((await openAd({ ...AD, body: 'Maison lumineuse, proche gare.' })).sent.length, 0);
});

test('location, ou bloc de données d’une autre annonce (navigation interne) : rien n’est envoyé', async () => {
  const body = 'DPE réalisé le 14/05/2026.';
  assert.equal((await openAd({ ...AD, body, category_id: '10' })).sent.length, 0);
  assert.equal((await openAd({ ...AD, body }, { path: '/ad/ventes_immobilieres/999' })).sent.length, 0);
});

// Page servie sans le bloc __NEXT_DATA__ : la recherche Immodex relit les étiquettes affichées
// (et trouvait 100/100), mais l'envoi au Fil exigeait le bloc et ne partait jamais, sans message.
test('page sans bloc de données : l’annonce part quand même, construite avec ce que la page affiche', async () => {
  const html = `<html><head><meta property="product:price:amount" content="344000"></head><body>
    <h1>Maison 4 pièces 102 m²</h1>
    <div data-qa-id="criteria_item_square">Surface habitable 102 m²</div>
    <div data-qa-id="criteria_item_energy_rate">D</div>
    <div data-qa-id="criteria_item_ges">D</div>
    <div data-qa-id="adview_location_informations">Marquette-lez-Lille 59520</div>
    <div data-qa-id="adview_description_container">Belle maison. DPE réalisé le 14/05/2026.</div>
  </body></html>`;
  const dom = new JSDOM(html, { url: 'https://www.leboncoin.fr/ad/ventes_immobilieres/3280694365?utm=x', runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  const w = dom.window;
  const sent = [];
  w.chrome = { runtime: { sendMessage: async (m) => (sent.push(JSON.parse(JSON.stringify(m))), { ok: true }) } };
  w.__immodexOverlay = { mountListingButton() {}, onNavigate() {}, closeCard() {} };
  w.setInterval = () => 0;
  w.eval(extractCode);
  w.eval(src('src/common/generic-extract.js'));
  w.eval(pageCode);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const cards = sent.filter((m) => m.type === 'LIST_CARDS');
  assert.equal(cards.length, 1);
  const [card] = cards[0].cards;
  assert.equal(card.url, 'https://www.leboncoin.fr/ad/ventes_immobilieres/3280694365');
  assert.equal(card.type, 'maison');
  assert.equal(card.price, 344000);
  assert.deepEqual(card.detail.dateRange, { gte: '2026-05-14', lte: '2026-05-14', precision: 'day' });
  assert.deepEqual([card.detail.surface, card.detail.postal, card.detail.energyClass], [102, '59520', 'D']);
});

// Cas réel (Marquette-lez-Lille, 21/11/2026) : la date du DPE avait été saisie par Nathan lors d'une
// première recherche. En rouvrant l'annonce, le bouton réaffiche le résultat gardé (100/100) sans
// relancer la recherche : rien ne partait au Fil. La date est reprise de cette recherche gardée.
test('date saisie lors d’une recherche gardée dans l’historique : reprise et envoyée à la réouverture', async () => {
  const saved = { payload: { kind: 'dpe', surface: 102, energyClass: 'D', dateRange: { gte: '2026-05-14', lte: '2026-05-14', precision: 'day' } } };
  const { sent } = await openAd({ ...AD, body: 'Maison lumineuse, proche gare.' }, { saved });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].cards[0].detail.dateRange, saved.payload.dateRange);
  // Recherche gardée sans date (saisie passée) : toujours rien.
  assert.equal((await openAd({ ...AD, body: 'Sans date.' }, { saved: { payload: { kind: 'dpe', dateRange: null } } })).sent.length, 0);
});
