// Tâche planifiée du scan (Vercel, cinq passages par nuit entre 1 h et 5 h UTC, voir
// vercel.json) : lit les pages de résultats des sources pour les communes des recherches
// actives, puis les nouvelles annonces. Un appel extérieur ne déclenche rien de plus : un
// passage à la fois, 20 min au moins entre deux départs, et les pages de résultats d'un site
// ne sont relues que tous les 2 jours.
import { upstashConfig, upstash } from './sync.js';
import { createPoliteFetcher } from './_lib/polite.js';
import { runScan } from './_lib/scan-run.js';
import { addressLookup } from './_lib/address.js';

const json = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function GET() {
  const config = upstashConfig();
  if (!config) return json(503, { ok: false, error: 'not-configured' });
  try {
    const result = await runScan({ redis: upstash(config), fetcher: createPoliteFetcher(), lookup: addressLookup });
    return json(200, { ok: true, ...result });
  } catch (err) {
    console.error('[scan]', err);
    return json(500, { ok: false, error: 'server-error' });
  }
}
