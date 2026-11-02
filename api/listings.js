// Annonces scannées des communes demandées (données publiques des sites, pas de données de
// Nathan) et état des sources : GET /api/listings?insee=59636,59388.
import { upstashConfig, upstash, HttpError } from './sync.js';

const INSEE = /^(\d{5}|2[AB]\d{3})$/;
const MAX_CODES = 30;

const parse = (v) => {
  try {
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
};
const pairs = (flat) => {
  const out = [];
  for (let i = 0; i + 1 < (flat || []).length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
};

async function handleListings({ codes, redis }) {
  const list = [...new Set(String(codes || '').split(',').map((c) => c.trim()).filter(Boolean))];
  if (!list.length || list.length > MAX_CODES || !list.every((c) => INSEE.test(c))) throw new HttpError(400, 'bad-insee');
  const results = await redis.pipeline([...list.flatMap((c) => [['HGETALL', `imx:scan:${c}:l`], ['HGETALL', `imx:scan:${c}:src`]]), ['GET', 'imx:scan:last']]);
  const listings = [];
  const sources = {};
  list.forEach((code, i) => {
    for (const [, v] of pairs(results[2 * i])) {
      const l = parse(v);
      if (l) listings.push(l);
    }
    sources[code] = Object.fromEntries(pairs(results[2 * i + 1]).map(([s, v]) => [s, parse(v) || {}]));
  });
  return { listings, sources, lastRun: Number(results[results.length - 1]) || null };
}

const CORS = { 'Access-Control-Allow-Origin': '*' };

export async function GET(request) {
  const config = upstashConfig();
  const headers = { ...CORS, 'Content-Type': 'application/json' };
  if (!config) return new Response(JSON.stringify({ ok: false, error: 'not-configured' }), { status: 503, headers });
  try {
    const data = await handleListings({ codes: new URL(request.url).searchParams.get('insee'), redis: upstash(config) });
    return new Response(JSON.stringify({ ok: true, ...data }), { status: 200, headers: { ...headers, 'Cache-Control': 'public, max-age=300, s-maxage=300' } });
  } catch (err) {
    if (err instanceof HttpError) return new Response(JSON.stringify({ ok: false, error: err.message }), { status: err.status, headers });
    console.error('[listings]', err);
    return new Response(JSON.stringify({ ok: false, error: 'server-error' }), { status: 500, headers });
  }
}

export { handleListings };
