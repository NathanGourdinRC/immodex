// Envoi d'annonces lues dans le navigateur de Nathan vers le Fil (POST /api/ingest, voir
// api/_lib/ingest.js), avec la clé de synchro de l'extension. Partagé par l'envoi des pages de
// résultats (service-worker.js) et par la tournée SeLoger (seloger-tour-runner.js).
const SYNC_STATE_KEY = 'immodex.sync.v1';
const ORIGIN = 'https://immodex.vercel.app';

// Coupure réseau (« Failed to fetch » : aucune réponse du serveur, Wi-Fi qui change, serveur un
// instant injoignable) : l'envoi est retenté après ces délais. Renvoyer les mêmes annonces est sans
// risque, le serveur reconnaît celles qu'il a déjà (elles ne comptent pas comme nouvelles).
export const RETRY_DELAYS_MS = [2000, 5000];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// `insee` : commune où le bien a été lu, quand l'envoyeur la connaît (la tournée SeLoger ouvre les
// annonces de communes précises) ; sinon le serveur la déduit de la ville de chaque carte.
export async function sendCards({ source, cards, insee }, { delays = RETRY_DELAYS_MS } = {}) {
  const stored = await chrome.storage.local.get(SYNC_STATE_KEY);
  const key = stored[SYNC_STATE_KEY] && stored[SYNC_STATE_KEY].key;
  if (!key) throw new Error('synchro non activée');
  const request = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(insee ? { source, insee, cards } : { source, cards }),
  };
  let res = null;
  for (let attempt = 0; !res; attempt++) {
    try {
      res = await fetch(`${ORIGIN}/api/ingest`, request);
    } catch {
      // fetch ne lève une erreur que si aucune réponse n'est arrivée (une réponse 500 ne lève rien).
      if (attempt >= delays.length) throw new Error('serveur du Fil injoignable (réseau coupé ?), un nouveau clic réessaie');
      await wait(delays[attempt]);
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `erreur ${res.status}`);
  return { seen: data.seen, added: data.added, addressed: data.addressed || 0, ignored: data.ignored || 0 };
}
