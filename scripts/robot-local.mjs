// Robot local : lit depuis ce PC les sources qui refusent le serveur Vercel mais répondent à une
// connexion ordinaire (SeLoger, Superimmo, Héron, Alerte Immobilier), avec les mêmes règles que le
// robot : nom honnête, robots.txt respecté, pages espacées, arrêt au premier refus du site.
// Les annonces partent ensuite dans le Fil par /api/ingest.
//
//   npm run robot:local
//
//   npm run robot:local -- seloger      une seule source
//
// Clé : ce robot a son propre espace de synchro, sans recherche ni statut. Sa clé est créée au
// premier lancement et gardée dans .immodex-key (fichier ignoré par git). Les annonces qu'il envoie
// vont dans les communes suivies par Nathan, elles ne dépendent pas de l'espace qui les envoie.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SOURCES, SLOW_HOSTS, sourceById } from '../api/_lib/sources.js';
import { createPoliteFetcher } from '../api/_lib/polite.js';
import { readList, readCrawl } from '../api/_lib/scan-run.js';
import { readListing } from '../api/_lib/page.js';

const ORIGIN = 'https://immodex.vercel.app';
const PAGES_PER_COMMUNE = 40; // de quoi lire toute une commune ; le site reste libre de refuser
const CHUNK = 100;

function syncKey() {
  const file = fileURLToPath(new URL('../.immodex-key', import.meta.url));
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    const key = randomBytes(32).toString('base64url');
    writeFileSync(file, key);
    return key;
  }
}

const key = syncKey();
// Un appel de synchro vide : l'espace du robot existe et reste noté actif.
const hello = await fetch(`${ORIGIN}/api/sync`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{"since":0,"items":[]}' });
if (!hello.ok) throw new Error(`/api/sync : ${hello.status}`);
const api = async (method, body) => {
  const res = await fetch(`${ORIGIN}/api/ingest`, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(`/api/ingest : ${res.status} ${data.error || ''}`);
  return data;
};

const FIELDS = ['surface', 'pieces', 'chambres', 'terrain', 'photo', 'postal', 'city', 'energyClass', 'gesClass'];

// Annonce sans détails sur sa carte, pas encore connue du Fil : sa page est lue une fois.
async function withDetail(card, source, commune, fetcher, known) {
  if (card.detail || known.has(card.url)) return card;
  const res = await fetcher.get(card.url);
  if (!res.ok) return null;
  try {
    const d = readListing(res.html, card.url);
    const detail = Object.fromEntries(FIELDS.map((f) => [f, d[f] != null && d[f] !== '' ? d[f] : null]));
    return { ...card, price: card.price || d.price || null, detail: { ...detail, city: detail.city || commune.nom } };
  } catch {
    return null;
  }
}

async function readSource(source, communes, fetcher, known) {
  let refused = false;
  for (const commune of communes) {
    if (refused) break;
    if (source.departments && !source.departments.some((d) => commune.code.startsWith(d))) continue;
    const types = commune.types.includes(null) ? [null] : commune.types;
    const urls = [...new Set(types.flatMap((t) => source.listUrls(commune, t)))];
    if (!urls.length) continue;
    const budget = { pages: PAGES_PER_COMMUNE };
    const fetchPage = (url) => fetcher.get(url);
    const reads = [];
    if (source.crawl) reads.push(await readCrawl({ fetchPage, source, commune, pending: urls, visited: [], budget, deadline: Infinity }));
    else for (const listUrl of urls) reads.push(await readList({ fetchPage, source, listUrl, commune, budget, deadline: Infinity }));
    refused = reads.some((r) => r.blocked);
    const cards = [];
    for (const card of reads.flatMap((r) => r.cards)) {
      const full = await withDetail(card, source, commune, fetcher, known);
      // Titre propre donné par la source (Superimmo : le texte de sa carte commence par les favoris).
      if (full) cards.push({ ...full, title: (full.detail && full.detail.title) || full.title });
    }
    let seen = 0;
    let added = 0;
    for (let i = 0; i < cards.length; i += CHUNK) {
      const r = await api('POST', { source: source.id, insee: commune.code, cards: cards.slice(i, i + CHUNK) });
      seen += r.seen;
      added += r.added;
    }
    console.log(`${source.label} · ${commune.nom} : ${seen} annonces lues, ${added} nouvelles${refused ? ' (le site a refusé la suite)' : ''}`);
  }
}

const only = process.argv.slice(2);
const sources = SOURCES.filter((s) => s.local && !s.browserOnly && (!only.length || only.includes(s.id)));
const { communes } = await api('GET');
console.log(`${communes.length} communes suivies, ${sources.length} sources : ${sources.map((s) => s.label).join(', ')}`);
const codes = communes.map((c) => c.code).join(',');
const listed = await (await fetch(`${ORIGIN}/api/listings?insee=${codes}`)).json();
const known = new Set((listed.listings || []).map((l) => l.url));
const fetcher = createPoliteFetcher({ hostDelays: SLOW_HOSTS });
// Un site à la fois par source, plusieurs sites en parallèle.
await Promise.all(sources.map((s) => readSource(sourceById(s.id), communes, fetcher, known).catch((err) => console.error(`${s.label} : ${err.message}`))));
console.log('Terminé.');
