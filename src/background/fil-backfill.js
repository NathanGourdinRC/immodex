// Rattrapage du Fil : les recherches Leboncoin de l'historique (7 jours) renvoient leur date du DPE
// au Fil. Avant la 0.30.4 (21/11/2026), une recherche faite avec la date (saisie par Nathan ou lue
// dans la description) ne partait pas au Fil : le serveur hésitait entre plusieurs logements de même
// surface et de mêmes lettres, et le bien restait sans point jusqu'à ce que Nathan rouvre sa page.
// Le serveur ne fait que compléter les annonces qu'il connaît déjà (`onlyKnown`, api/_lib/ingest.js) :
// l'historique n'a pas le prix, et une recherche ancienne ne prouve pas que l'annonce est en ligne.

const STATE_KEY = 'immodex.filBackfill.v1';
// Au plus un passage toutes les 6 heures : le service worker se réveille souvent.
const EVERY_MS = 6 * 3600 * 1000;
// Adresses cherchées tout de suite par appel côté serveur (MAX_LOOKUPS d'api/_lib/ingest.js) :
// au-delà, elles attendraient le prochain passage du robot.
const BATCH = 5;
const MAX_SENT = 300;
const LBC_AD = /^https:\/\/www\.leboncoin\.fr\/ad\/ventes_immobilieres\/(\d+)/;

// Même clé que l'envoi depuis la page (content/leboncoin.js) : une annonce, une date.
const keyOf = (card) => `${card.url}|${JSON.stringify(card.detail.dateRange)}|${card.detail.energyConsumption}`;

// Cartes à renvoyer : annonces de vente Leboncoin cherchées avec une date ou les chiffres du DPE.
function cardsFromHistory(entries) {
  const out = new Map();
  for (const e of entries || []) {
    const p = e && e.payload;
    const m = e && e.page && typeof e.page.url === 'string' && e.page.url.match(LBC_AD);
    if (!m || !p || e.kind === 'land' || p.kind === 'land') continue;
    if (!p.dateRange && p.energyConsumption == null) continue;
    const title = (e.page.title || '').slice(0, 160);
    const type = p.buildingType === 'maison' || p.buildingType === 'appartement' ? p.buildingType : /\bmaison\b/i.test(title) ? 'maison' : /\bappartement\b/i.test(title) ? 'appartement' : null;
    if (!type || !p.city) continue;
    const card = {
      url: `https://www.leboncoin.fr/ad/ventes_immobilieres/${m[1]}`,
      type,
      price: null,
      title: title || null,
      detail: {
        surface: p.surface ?? null,
        postal: p.postal || null,
        city: p.city,
        energyClass: p.energyClass || null,
        gesClass: p.gesClass || null,
        energyConsumption: p.energyConsumption ?? null,
        gesEmission: p.gesEmission ?? null,
        dateRange: p.dateRange || null,
      },
    };
    // Historique rangé du plus récent au plus ancien : la dernière recherche d'une annonce l'emporte.
    if (![...out.values()].some((c) => c.url === card.url)) out.set(keyOf(card), card);
  }
  return [...out.values()];
}

// `send` : sendCards d'ingest-client.js. Une annonce acceptée par le Fil n'est plus renvoyée ;
// une annonce qu'il ne connaît pas encore (`skipped`) l'est au passage suivant, tant qu'elle est
// dans l'historique (le robot ou la tournée Leboncoin a pu la lire entre-temps).
// `force` : relancé à la main (immodexRattrapage() dans la console du service worker), sans attendre
// 6 heures et en renvoyant aussi les recherches déjà acceptées.
async function backfillFil({ history, storage, send, now = Date.now(), force = false }) {
  const stored = (await storage.get(STATE_KEY))[STATE_KEY] || {};
  if (!force && stored.lastRun && now - stored.lastRun < EVERY_MS) return { skipped: 'recent', lastRun: stored.lastRun, last: stored.last || null };
  const sent = new Set(force ? [] : stored.sent || []);
  const all = cardsFromHistory(await history.list());
  const todo = all.filter((c) => !sent.has(keyOf(c)));
  let addressed = 0;
  let unknown = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const cards = todo.slice(i, i + BATCH);
    // Synchro non activée, réseau coupé : rien n'est noté, nouvel essai au prochain réveil.
    const r = await send({ source: 'leboncoin', cards, onlyKnown: true });
    const notInFil = new Set(r.skipped || []);
    for (const c of cards) if (!notInFil.has(c.url)) sent.add(keyOf(c));
    addressed += r.addressed || 0;
    unknown += notInFil.size;
  }
  // `last` : résultat du passage, gardé pour être relu (le message de la console se perd quand
  // elle est ouverte après le démarrage de l'extension).
  const last = { at: now, inHistory: all.length, sent: todo.length, addressed, unknown };
  await storage.set({ [STATE_KEY]: { lastRun: now, sent: [...sent].slice(-MAX_SENT), last } });
  return { sent: todo.length, addressed, unknown, inHistory: all.length };
}

export { backfillFil, cardsFromHistory, STATE_KEY };
