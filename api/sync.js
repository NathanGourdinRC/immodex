// Synchronisation Immodex+ entre l'extension Chrome et l'appli téléphone (fonction Vercel).
//
// Chaque appareil appairé envoie la même clé de synchro, générée par l'extension. Le serveur
// n'en garde que l'empreinte SHA-256, qui nomme l'espace de données dans Upstash Redis :
// une fuite de la base ne donne donc pas accès aux espaces.
//
// Un espace contient des éléments (une zone, un suivi, une annonce vue, une recherche),
// chacun identifié par « type:clé ». Règle de fusion : par élément, la version la plus récente
// (updated_at) gagne. Chaque écriture reçoit un numéro de révision croissant ; un appareil
// demande « tout ce qui a changé depuis la révision N » et repart de la dernière reçue.
//
// GET  /api/sync  → { ok, configured }        (contrôle, sans clé)
// POST /api/sync  Authorization: Bearer <clé>
//      { since, items: [{ kind, key, data, updated_at, deleted }] }
//    → { ok, rev, head, items, more }          (changements des autres appareils)

const KINDS = new Set(['zone', 'track', 'sight', 'search']);
const KEY_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const MAX_BODY = 1_000_000;
const MAX_PUSH = 200;
const MAX_ITEM_BYTES = 100_000;
const MAX_ITEMS_PER_SPACE = 25_000;
const PAGE = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

// Écriture atomique d'un lot : un élément n'est remplacé que si sa date est plus récente
// que celle déjà stockée. Renvoie [champ, révision, champ, révision…] des éléments acceptés.
// KEYS : éléments (hash), dates (hash), journal des révisions (zset), compteur de révisions.
// ARGV : triplets champ, date, valeur JSON.
const PUSH_SCRIPT = `
local out = {}
for i = 1, #ARGV, 3 do
  local field, ts, value = ARGV[i], tonumber(ARGV[i + 1]), ARGV[i + 2]
  local current = tonumber(redis.call('HGET', KEYS[2], field) or '-1')
  if ts > current then
    local rev = redis.call('INCR', KEYS[4])
    redis.call('HSET', KEYS[1], field, value)
    redis.call('HSET', KEYS[2], field, ARGV[i + 1])
    redis.call('ZADD', KEYS[3], rev, field)
    out[#out + 1] = field
    out[#out + 1] = rev
  end
end
return out
`;

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

// Variables posées par l'intégration Upstash de Vercel (KV_REST_API_* ou UPSTASH_REDIS_REST_*,
// parfois avec un préfixe choisi à la création). Le jeton en lecture seule ne convient pas.
function upstashConfig(env = process.env) {
  const pick = (re, exclude) => Object.keys(env).sort().find((k) => re.test(k) && !(exclude && exclude.test(k)) && env[k]);
  const urlKey = ['UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL'].find((k) => env[k]) || pick(/REST_(API_)?URL$/);
  const tokenKey = ['UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN'].find((k) => env[k]) || pick(/REST_(API_)?TOKEN$/, /READ_ONLY/);
  return urlKey && tokenKey ? { url: env[urlKey].replace(/\/+$/, ''), token: env[tokenKey] } : null;
}

// Client Upstash minimal : une commande ou un lot de commandes par requête HTTP.
// Upstash peut servir une lecture depuis une copie de la base pas encore à jour : son jeton
// « upstash-sync-token », renvoyé à chaque réponse et repassé à la requête suivante,
// garantit qu'une lecture voit les écritures déjà faites par ce même appel.
function upstash({ url, token }, fetchImpl = fetch) {
  let syncToken = null;
  const call = async (path, body) => {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (syncToken) headers['upstash-sync-token'] = syncToken;
    const res = await fetchImpl(`${url}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    syncToken = res.headers.get('upstash-sync-token') || syncToken;
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new HttpError(502, `upstash-${res.status}`);
    return data;
  };
  return {
    async command(args) {
      const data = await call('', args);
      if (data.error) throw new HttpError(502, 'upstash-error');
      return data.result;
    },
    async pipeline(commands) {
      const data = await call('/pipeline', commands);
      return data.map((r) => {
        if (r.error) throw new HttpError(502, 'upstash-error');
        return r.result;
      });
    },
  };
}

async function spaceOf(syncKey) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(syncKey));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const keysOf = (space) => ({
  items: `imx:${space}:items`,
  ts: `imx:${space}:ts`,
  log: `imx:${space}:log`,
  rev: `imx:${space}:rev`,
});

// Élément reçu : type connu, clé courte, date plausible, contenu de taille raisonnable.
function cleanItem(raw, now) {
  if (!raw || typeof raw !== 'object' || !KINDS.has(raw.kind)) throw new HttpError(400, 'bad-item');
  const key = typeof raw.key === 'string' ? raw.key : '';
  const ts = Number(raw.updated_at);
  if (!key || key.length > 600 || !Number.isFinite(ts) || ts < 0 || ts > now + DAY_MS) throw new HttpError(400, 'bad-item');
  const deleted = raw.deleted === true;
  const value = JSON.stringify({ kind: raw.kind, key, data: deleted ? null : raw.data ?? null, updated_at: ts, deleted });
  if (value.length > MAX_ITEM_BYTES) throw new HttpError(413, 'item-too-large');
  return { field: `${raw.kind}:${key}`, ts, value };
}

const parse = (value) => {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

// Cœur de la synchro, indépendant de Vercel : applique le lot reçu puis renvoie les
// changements postérieurs à `since`, sans les éléments que cet appel vient d'écrire.
async function handleSync({ syncKey, body, redis, now = Date.now() }) {
  if (!KEY_PATTERN.test(syncKey || '')) throw new HttpError(401, 'bad-key');
  const since = Math.max(0, Math.floor(Number(body && body.since) || 0));
  const incoming = Array.isArray(body && body.items) ? body.items : [];
  if (incoming.length > MAX_PUSH) throw new HttpError(413, 'too-many-items');
  const items = incoming.map((i) => cleanItem(i, now));
  const k = keysOf(await spaceOf(syncKey));

  const written = new Map();
  const rejected = [];
  if (items.length) {
    if ((await redis.command(['HLEN', k.items])) > MAX_ITEMS_PER_SPACE) throw new HttpError(413, 'space-full');
    const args = items.flatMap((i) => [i.field, String(i.ts), i.value]);
    const out = await redis.command(['EVAL', PUSH_SCRIPT, '4', k.items, k.ts, k.log, k.rev, ...args]);
    for (let i = 0; i < out.length; i += 2) written.set(out[i], Number(out[i + 1]));
    // Version refusée (une plus récente existe) : on renvoie celle du serveur à l'appareil.
    for (const i of items) if (!written.has(i.field) && !rejected.includes(i.field)) rejected.push(i.field);
  }

  // `head` (dernière révision de l'espace) permet à l'appareil de voir qu'un espace a été
  // vidé : sa révision de départ serait alors plus grande que celle du serveur.
  const [log, head] = await redis.pipeline([
    ['ZRANGEBYSCORE', k.log, `(${since}`, '+inf', 'WITHSCORES', 'LIMIT', '0', String(PAGE)],
    ['GET', k.rev],
  ]);
  const changes = [];
  for (let i = 0; i < log.length; i += 2) changes.push({ field: log[i], rev: Number(log[i + 1]) });
  const more = changes.length === PAGE;
  const rev = changes.length ? changes[changes.length - 1].rev : since;
  const wanted = [...changes.filter((c) => written.get(c.field) !== c.rev).map((c) => c.field), ...rejected];
  const fields = [...new Set(wanted)];
  const values = fields.length ? await redis.command(['HMGET', k.items, ...fields]) : [];
  return { ok: true, rev, head: Number(head) || 0, more, items: values.map(parse).filter(Boolean) };
}

const json = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export function GET() {
  return json(200, { ok: true, configured: !!upstashConfig() });
}

export async function POST(request) {
  const config = upstashConfig();
  if (!config) return json(503, { ok: false, error: 'not-configured' });
  try {
    const auth = request.headers.get('authorization') || '';
    const text = await request.text();
    if (text.length > MAX_BODY) throw new HttpError(413, 'body-too-large');
    let body;
    try {
      body = JSON.parse(text || '{}');
    } catch {
      throw new HttpError(400, 'bad-json');
    }
    const result = await handleSync({ syncKey: auth.replace(/^Bearer\s+/i, ''), body, redis: upstash(config) });
    return json(200, result);
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { ok: false, error: err.message });
    console.error('[sync]', err);
    return json(500, { ok: false, error: 'server-error' });
  }
}

export { PUSH_SCRIPT, KEY_PATTERN, MAX_PUSH, PAGE, HttpError, upstashConfig, upstash, spaceOf, handleSync };
