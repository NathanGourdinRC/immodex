// Envoi d'annonces lues dans le navigateur de Nathan vers le Fil (POST /api/ingest, voir
// api/_lib/ingest.js), avec la clé de synchro de l'extension. Partagé par l'envoi des pages de
// résultats (service-worker.js) et par la tournée SeLoger (seloger-tour-runner.js).
const SYNC_STATE_KEY = 'immodex.sync.v1';
const ORIGIN = 'https://immodex.vercel.app';

// `insee` : commune où le bien a été lu, quand l'envoyeur la connaît (la tournée SeLoger ouvre les
// annonces de communes précises) ; sinon le serveur la déduit de la ville de chaque carte.
export async function sendCards({ source, cards, insee }) {
  const stored = await chrome.storage.local.get(SYNC_STATE_KEY);
  const key = stored[SYNC_STATE_KEY] && stored[SYNC_STATE_KEY].key;
  if (!key) throw new Error('synchro non activée');
  const res = await fetch(`${ORIGIN}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(insee ? { source, insee, cards } : { source, cards }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `erreur ${res.status}`);
  return { seen: data.seen, added: data.added, addressed: data.addressed || 0 };
}
