// Annonces reçues de l'extension (listes ouvertes dans le navigateur de Nathan) et du robot local
// (scripts/robot-local.mjs) : les sites qui refusent le serveur du robot arrivent par ce chemin.
// Une annonce n'est gardée que si elle est sur le site annoncé et dans une commune suivie.
import { HttpError, KEY_PATTERN, spaceOf } from '../sync.js';
import { sourceById, listingUrl, placeSlug } from './sources.js';
import { keys, listingsOf, saveListings, sourceMetaOf, saveSourceMeta, activeCommunes } from './scan-store.js';
import { mergeCard, withTimeout, LOOKUP_VERSION, LOOKUP_MS } from './scan-run.js';

const MAX_CARDS = 200;
// Adresses cherchées tout de suite par appel : le reste attend le prochain passage du robot.
const MAX_LOOKUPS = 5;
const short = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const count = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 1e9 ? Math.round(n) : null;
};
const https = (v) => (typeof v === 'string' && /^https:\/\//.test(v) && v.length < 600 ? v : null);
const grade = (v) => (typeof v === 'string' && /^[A-G]$/.test(v) ? v : null);
// Valeurs du diagnostic lues sur la page d'une annonce : bornées comme le registre les connaît.
const bounded = (v, min, max) => {
  const n = Number(v);
  return v != null && Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
};
const TYPES = new Set(['maison', 'appartement', 'terrain', 'immeuble']);
// « Villeneuve-d'Ascq » s'écrit aussi « Villeneuve-dAscq » sur les sites.
const nameKey = (s) => placeSlug(String(s).replace(/['’]/g, ''));
const sameName = (a, b) => nameKey(a) === nameKey(b);

// Carte reçue, réduite à ce qui est attendu : ces données viennent de l'extérieur.
function cleanCard(raw, source) {
  if (!raw || typeof raw !== 'object') return null;
  const url = listingUrl(raw.url, raw.url, source);
  const type = TYPES.has(raw.type) ? raw.type : null;
  if (!url || !type) return null;
  const d = raw.detail && typeof raw.detail === 'object' ? raw.detail : {};
  return {
    url,
    type,
    price: count(raw.price),
    title: short(raw.title, 160) || type,
    detail: {
      surface: count(d.surface),
      pieces: count(d.pieces),
      chambres: count(d.chambres),
      terrain: count(d.terrain),
      photo: https(d.photo),
      postal: /^\d{5}$/.test(String(d.postal || '')) ? String(d.postal) : null,
      city: short(d.city, 80),
      energyClass: grade(d.energyClass),
      gesClass: grade(d.gesClass),
      // Seulement quand la page de l'annonce les donne (SeLoger : consommation en kWh/m².an, émissions
      // en kg CO₂/m².an) ; les cartes de liste n'ont que les lettres.
      energyConsumption: bounded(d.energyConsumption, 1, 1500),
      gesEmission: bounded(d.gesEmission, 1, 500),
      constructionYear: bounded(d.constructionYear, 1000, 2100),
    },
  };
}

// Annonce déjà connue dont la carte apporte pour la première fois la consommation du diagnostic :
// elle est complétée et son adresse cherchée tout de suite dans le registre des DPE. Une adresse
// déjà sûre n'est pas remise en cause. Registre muet : l'annonce reste à chercher par le prochain
// passage du robot (`lookupVersion` effacée).
async function enrich(entry, detail, lookup) {
  if (detail.energyConsumption == null || entry.energyConsumption != null) return false;
  for (const f of ['energyConsumption', 'gesEmission', 'constructionYear', 'gesClass', 'energyClass']) if (detail[f] != null) entry[f] = detail[f];
  if (entry.addressConfidence === 'haute') return true;
  delete entry.lookupVersion;
  delete entry.lookupTries;
  delete entry.leads;
  if (!lookup) return true;
  let found = null;
  try {
    found = await withTimeout(lookup({ ...entry }), LOOKUP_MS);
  } catch {
    found = null;
  }
  if (found) {
    Object.assign(entry, found);
    entry.lookupVersion = LOOKUP_VERSION;
  }
  return true;
}

// La commune suivie où se trouve le bien : même nom, et même code postal s'il est donné.
function communeOf(card, communes) {
  const { city, postal } = card.detail;
  if (!city) return null;
  return communes.find((c) => sameName(city, c.nom) && (!postal || !c.codesPostaux.length || c.codesPostaux.includes(postal))) || null;
}

// L'envoyeur a déjà synchronisé son espace : un appel au hasard n'écrit rien.
async function checkKey(redis, syncKey) {
  if (!KEY_PATTERN.test(syncKey || '')) throw new HttpError(401, 'bad-key');
  const known = await redis.command(['ZSCORE', keys.spaces, await spaceOf(syncKey)]);
  if (known == null) throw new HttpError(403, 'unknown-space');
}

async function handleCommunes({ syncKey, redis, now = Date.now() }) {
  await checkKey(redis, syncKey);
  const communes = await activeCommunes(redis, now);
  return { communes: communes.map((c) => ({ code: c.code, nom: c.nom, codesPostaux: c.codesPostaux, types: [...c.types] })) };
}

async function handleIngest({ syncKey, body, redis, now = Date.now(), lookup = null }) {
  await checkKey(redis, syncKey);
  const source = sourceById(body && body.source);
  if (!source || !source.local) throw new HttpError(400, 'bad-source');
  if (!Array.isArray(body.cards) || body.cards.length > MAX_CARDS) throw new HttpError(400, 'bad-cards');
  const communes = await activeCommunes(redis, now);
  // Robot local : il sait dans quelle commune il a lu (`insee`). Extension : la commune de la carte.
  const fixed = body.insee ? communes.find((c) => c.code === body.insee) : null;
  if (body.insee && !fixed) return { seen: 0, added: 0, ignored: body.cards.length, addressed: 0 };
  const byCommune = new Map();
  let ignored = 0;
  for (const raw of body.cards) {
    const card = cleanCard(raw, source);
    const commune = card && (fixed || communeOf(card, communes));
    if (!commune) {
      ignored++;
      continue;
    }
    if (!byCommune.has(commune.code)) byCommune.set(commune.code, []);
    byCommune.get(commune.code).push(card);
  }
  let seen = 0;
  let added = 0;
  let addressed = 0;
  let lookups = 0;
  const askLookup = () => (lookup && lookups++ < MAX_LOOKUPS ? lookup : null);
  for (const [insee, cards] of byCommune) {
    const listings = await listingsOf(redis, insee);
    const touched = [];
    for (const card of cards) {
      const r = mergeCard(listings, source, insee, card, now);
      r.entry.pushed = true;
      // Annonce nouvelle : sa carte est déjà dans sa fiche. Annonce connue : seulement si la carte
      // apporte la consommation qui lui manquait.
      const hadAddress = !!r.entry.address;
      if (r.isNew) {
        const run = card.detail.energyConsumption != null ? askLookup() : null;
        if (run) {
          const found = await withTimeout(Promise.resolve(run({ ...r.entry })).catch(() => null), LOOKUP_MS);
          if (found) {
            Object.assign(r.entry, found);
            r.entry.lookupVersion = LOOKUP_VERSION;
          }
        }
      } else await enrich(r.entry, card.detail, card.detail.energyConsumption != null && r.entry.energyConsumption == null ? askLookup() : null);
      if (!hadAddress && r.entry.address) addressed++;
      touched.push(r.entry);
      seen++;
      if (r.isNew) added++;
    }
    await saveListings(redis, insee, touched);
    const meta = await sourceMetaOf(redis, insee);
    await saveSourceMeta(redis, insee, { [source.id]: { ...meta[source.id], lastRun: now, failures: 0, paused: false, pushed: true } });
  }
  return { seen, added, ignored, addressed };
}

export { handleIngest, handleCommunes, cleanCard, communeOf };
