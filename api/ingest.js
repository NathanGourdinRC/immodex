// Annonces envoyées par l'extension et par le robot local (voir api/_lib/ingest.js).
//   GET  /api/ingest  Authorization: Bearer <clé>  communes suivies
//   POST /api/ingest  Authorization: Bearer <clé>  { source, insee?, cards: [...] }
import { upstashConfig, upstash, HttpError } from './sync.js';
import { handleIngest, handleCommunes } from './_lib/ingest.js';
import { addressLookup } from './_lib/address.js';

const MAX_BODY = 512 * 1024;

const json = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
const keyOf = (request) => (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

async function guarded(run) {
  const config = upstashConfig();
  if (!config) return json(503, { ok: false, error: 'not-configured' });
  try {
    return json(200, { ok: true, ...(await run(upstash(config))) });
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { ok: false, error: err.message });
    console.error('[ingest]', err);
    return json(500, { ok: false, error: 'server-error' });
  }
}

export function GET(request) {
  return guarded((redis) => handleCommunes({ syncKey: keyOf(request), redis }));
}

export function POST(request) {
  return guarded(async (redis) => {
    const text = await request.text();
    if (text.length > MAX_BODY) throw new HttpError(413, 'body-too-large');
    let body;
    try {
      body = JSON.parse(text || '{}');
    } catch {
      throw new HttpError(400, 'bad-json');
    }
    // L'adresse d'une annonce qui arrive avec la consommation de son DPE est cherchée tout de suite.
    return handleIngest({ syncKey: keyOf(request), body, redis, lookup: addressLookup });
  });
}
