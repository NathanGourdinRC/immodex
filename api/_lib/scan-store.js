// Stockage du scan dans Upstash Redis. Les annonces scannées sont publiques : elles sont
// rangées par commune, hors des espaces de synchro (qui gardent les statuts de Nathan).
//   imx:scan:{insee}:l    hash  identifiant d'annonce → annonce (JSON)
//   imx:scan:{insee}:src  hash  source → { lastRun, failures, paused, complete }
//   imx:scan:queue        liste pages d'annonce à lire { insee, id, url }
//   imx:scan:last         date du dernier passage
//   imx:scan:lock         verrou d'un passage (expire après 20 h)
//   imx:spaces            zset  espace de synchro → date de sa dernière synchro

const ACTIVE_MS = 21 * 24 * 3600 * 1000;
const MAX_COMMUNES = 30;
// La synchro est ouverte : on ne suit que les quelques espaces les plus récemment actifs
// (ceux de Nathan), pour qu'un inconnu ne puisse pas faire lire au robot ses propres communes.
const MAX_SPACES = 5;
// Espaces examinés au plus par passage (les plus récents), avec ou sans recherche.
const MAX_SCANNED_SPACES = 50;
const CHUNK = 100;

const keys = {
  listings: (insee) => `imx:scan:${insee}:l`,
  meta: (insee) => `imx:scan:${insee}:src`,
  queue: 'imx:scan:queue',
  last: 'imx:scan:last',
  lock: 'imx:scan:lock',
  spaces: 'imx:spaces',
};

const parse = (v) => {
  try {
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
};

// Réponse HGETALL d'Upstash : [champ, valeur, champ, valeur…].
function pairs(flat) {
  const out = [];
  for (let i = 0; i + 1 < (flat || []).length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

async function listingsOf(redis, insee) {
  return new Map(pairs(await redis.command(['HGETALL', keys.listings(insee)])).map(([id, v]) => [id, parse(v)]).filter(([, v]) => v));
}

async function saveListings(redis, insee, listings) {
  for (let i = 0; i < listings.length; i += CHUNK) {
    const part = listings.slice(i, i + CHUNK);
    await redis.command(['HSET', keys.listings(insee), ...part.flatMap((l) => [l.id, JSON.stringify(l)])]);
  }
}

async function sourceMetaOf(redis, insee) {
  return Object.fromEntries(pairs(await redis.command(['HGETALL', keys.meta(insee)])).map(([s, v]) => [s, parse(v) || {}]));
}

async function saveSourceMeta(redis, insee, meta) {
  const entries = Object.entries(meta);
  if (entries.length) await redis.command(['HSET', keys.meta(insee), ...entries.flatMap(([s, m]) => [s, JSON.stringify(m)])]);
}

async function readQueue(redis) {
  return ((await redis.command(['LRANGE', keys.queue, '0', '-1'])) || []).map(parse).filter(Boolean);
}

// La file est réécrite en entier, en une seule requête (suppression puis ajouts) : le scan
// est le seul à l'écrire, un passage à la fois.
async function writeQueue(redis, items) {
  const cmds = [['DEL', keys.queue]];
  for (let i = 0; i < items.length; i += CHUNK) cmds.push(['RPUSH', keys.queue, ...items.slice(i, i + CHUNK).map((x) => JSON.stringify(x))]);
  await redis.pipeline(cmds);
}

// Recherches (collection « zone » de la synchro) des espaces actifs depuis 21 jours :
// communes à suivre, avec les types cherchés (null : maisons et appartements).
async function activeCommunes(redis, now) {
  // Espaces inactifs depuis 21 jours : oubliés.
  await redis.command(['ZREMRANGEBYSCORE', keys.spaces, '-inf', String(now - ACTIVE_MS)]);
  const spaces = ((await redis.command(['ZRANGEBYSCORE', keys.spaces, String(now - ACTIVE_MS), '+inf'])) || []).reverse().slice(0, MAX_SCANNED_SPACES);
  const found = new Map();
  // Seuls comptent les espaces qui ont une recherche avec des communes : un appareil neuf ou
  // un test ne repousse pas les recherches de Nathan.
  let withSearches = 0;
  for (const space of spaces) {
    if (withSearches >= MAX_SPACES) break;
    let contributes = false;
    let cursor = '0';
    do {
      const [next, flat] = await redis.command(['HSCAN', `imx:${space}:items`, cursor, 'MATCH', 'zone:*', 'COUNT', '500']);
      cursor = String(next);
      for (const [, v] of pairs(flat)) {
        const item = parse(v);
        const zone = item && !item.deleted ? item.data : null;
        for (const c of (zone && zone.communes) || []) {
          if (!c || !/^(\d{5}|2[AB]\d{3})$/.test(String(c.code))) continue;
          contributes = true;
          if (!found.has(c.code)) found.set(c.code, { code: String(c.code), nom: c.nom, codesPostaux: c.codesPostaux || [], types: new Set() });
          found.get(c.code).types.add(zone.type === 'maison' || zone.type === 'appartement' ? zone.type : null);
        }
      }
    } while (cursor !== '0');
    if (contributes) withSearches++;
  }
  return [...found.values()].slice(0, MAX_COMMUNES);
}

export { keys, listingsOf, saveListings, sourceMetaOf, saveSourceMeta, readQueue, writeQueue, activeCommunes, MAX_COMMUNES, MAX_SPACES };
