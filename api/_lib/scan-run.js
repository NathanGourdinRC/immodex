// Un passage du scan (spec §6.2 et §6.3) : pour chaque commune suivie et chaque source,
// les pages de résultats (au plus tous les 46 h, 5 pages au plus), puis les pages des
// nouvelles annonces, une seule fois chacune, dans le temps imparti. Nouveautés, baisses de
// prix et retraits sont déduits en comparant les passages. Tout est enregistré au fil de
// l'eau : une fonction coupée par Vercel ne perd que la page en cours.
import { SOURCES, readResults } from './sources.js';
import { readListing } from './page.js';
import { keys, listingsOf, saveListings, sourceMetaOf, saveSourceMeta, readQueue, writeQueue, activeCommunes } from './scan-store.js';

const HOUR = 3600 * 1000;
const LOCK_MS = 20 * HOUR; // un passage au plus toutes les 20 h, posé atomiquement
const RESULTS_EVERY = 46 * HOUR; // pages de résultats d'une source relues tous les 2 jours
const RETRY_PAUSED = 7 * 24 * HOUR; // source en pause : nouvel essai une semaine plus tard
const MAX_PAGES = 5; // par source et par commune, toutes adresses de liste confondues
const LOOKUP_MS = 8000; // recherche d'adresse ADEME : au-delà, abandonnée
const KEEP_MS = 3 * 365 * 24 * HOUR;
const DETAIL_FIELDS = ['surface', 'pieces', 'chambres', 'terrain', 'garage', 'photo', 'postal', 'city', 'energyClass', 'gesClass', 'energyConsumption', 'gesEmission'];

const idOf = (source, url) => `${source.id}:${new URL(url).pathname}`;

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

// Pages de résultats d'une adresse de liste. La décision « page pleine » et « page qui
// apporte du nouveau » porte sur toutes les annonces de la page, avant le filtre par commune
// (une page d'agence peut ne contenir aucune annonce de la commune et en annoncer d'autres).
// `complete` : toute la liste a été lue, sans erreur ni doute ; seulement alors les absences
// comptent. `aborted` : temps écoulé, rien n'est enregistré, la source reste à faire.
async function readList({ fetchPage, source, listUrl, commune, budget, deadline }) {
  const cards = new Map();
  const allSeen = new Set();
  let complete = true;
  let blocked = false;
  for (let n = 1; ; n++) {
    const url = n === 1 ? listUrl : source.pageUrl(listUrl, n);
    if (!url) break;
    if (budget.pages <= 0) {
      complete = false;
      break;
    }
    budget.pages--;
    const res = await fetchPage(url, deadline);
    if (res.late) return { aborted: true };
    if (!res.ok) {
      complete = false;
      blocked = blocked || !!res.blocked;
      break;
    }
    let found;
    try {
      found = readResults(res.html, url, source, commune);
    } catch (err) {
      console.error('[scan] page de résultats illisible', url, err && err.message);
      complete = false;
      break;
    }
    const before = allSeen.size;
    for (const u of found.all) allSeen.add(u);
    for (const c of found.cards) if (!cards.has(c.url)) cards.set(c.url, c);
    if (n > 1 && found.all.length && allSeen.size === before) {
      // Page identique à une précédente : le site ignore sans doute le numéro de page.
      complete = false;
      break;
    }
    if (!found.full || !found.all.length) break;
  }
  return { cards: [...cards.values()], complete, blocked, links: allSeen.size };
}

async function runScan({ redis, fetcher, now = Date.now, budgetMs = 240000, sources = SOURCES, readListingImpl = readListing, lookup = null }) {
  const start = now();
  // Verrou atomique : deux appels simultanés ne lancent jamais deux robots.
  const locked = await redis.command(['SET', keys.lock, String(start), 'NX', 'PX', String(LOCK_MS)]);
  if (locked !== 'OK') {
    // Verrou d'un passage trop ancien resté en place (horloge, base sans expiration) : repris.
    const held = Number(await redis.command(['GET', keys.lock])) || 0;
    if (start - held < LOCK_MS) return { skipped: 'recent' };
    await redis.command(['SET', keys.lock, String(start), 'PX', String(LOCK_MS)]);
  }
  await redis.command(['SET', keys.last, String(start)]);

  const communes = await activeCommunes(redis, start);
  const summary = { communes: communes.length, results: 0, added: 0, details: 0, removed: 0, paused: [] };
  // Les pages de résultats prennent au plus 60 % du temps ; le reste va aux pages d'annonce.
  const resultsDeadline = start + budgetMs * 0.6;
  const detailsDeadline = start + budgetMs;
  // Une même page (liste d'une agence, toutes communes) n'est demandée qu'une fois par passage.
  const pageMemo = new Map();
  const fetchPage = (url, deadline) => {
    if (!pageMemo.has(url)) {
      pageMemo.set(
        url,
        fetcher.get(url, { deadline }).then((r) => {
          if (!r.late) summary.results++;
          else pageMemo.delete(url);
          return r;
        })
      );
    }
    return pageMemo.get(url);
  };

  // Annonces par commune : une seule carte en mémoire par commune, partagée par tous.
  const loaded = new Map();
  const listingsFor = (insee) => {
    if (!loaded.has(insee)) loaded.set(insee, listingsOf(redis, insee));
    return loaded.get(insee);
  };
  const metas = new Map();

  const queue = await readQueue(redis);
  const queued = new Set(queue.map((q) => q.id));

  await Promise.all(
    communes.map(async (commune) => {
      const listings = await listingsFor(commune.code);
      const meta = await sourceMetaOf(redis, commune.code);
      metas.set(commune.code, meta);
      // Annonce restée sans page lue et absente de la file (passage coupé) : remise en file.
      for (const l of listings.values()) {
        if (!l.detail && !l.removedAt && !queued.has(l.id)) {
          queue.push({ insee: commune.code, id: l.id, url: l.url });
          queued.add(l.id);
        }
      }
      const types = commune.types.has(null) ? [null] : [...commune.types];
      await Promise.all(
        sources.map(async (source) => {
          if (source.departments && !source.departments.some((d) => commune.code.startsWith(d))) return;
          const m = meta[source.id] || { lastRun: 0, failures: 0, paused: false };
          if (start - (m.lastRun || 0) < RESULTS_EVERY) return;
          if (m.paused && start - (m.lastRun || 0) < RETRY_PAUSED) return;
          const urls = [...new Set(types.flatMap((t) => source.listUrls(commune, t)))];
          const budget = { pages: MAX_PAGES };
          const reads = [];
          for (const listUrl of urls) {
            const r = await readList({ fetchPage, source, listUrl, commune, budget, deadline: resultsDeadline });
            // Temps écoulé : rien n'est enregistré pour cette source, elle reste à faire.
            if (r.aborted) return;
            reads.push(r);
          }
          const blocked = reads.some((r) => r.blocked);
          const known = [...listings.values()].some((l) => l.source === source.id && !l.removedAt);
          // Page servie sans aucune annonce alors qu'on en connaît (maintenance, consentement,
          // refonte du site) : pas de conclusion sur les absences.
          const complete = reads.every((r) => r.complete) && !(known && reads.every((r) => r.links === 0));
          const t = now();
          const seen = new Set();
          for (const card of reads.flatMap((r) => r.cards)) {
            const id = idOf(source, card.url);
            seen.add(id);
            const l = listings.get(id);
            if (l) {
              l.lastSeen = t;
              l.missed = 0;
              l.removedAt = null;
              if (card.price && card.price !== l.price) {
                l.prices.push({ at: t, price: card.price });
                l.price = card.price;
              }
            } else {
              listings.set(id, { id, source: source.id, url: card.url, insee: commune.code, type: card.type, title: card.title, price: card.price, prices: card.price ? [{ at: t, price: card.price }] : [], firstSeen: t, lastSeen: t, missed: 0, removedAt: null, detail: false });
              if (!queued.has(id)) {
                queue.push({ insee: commune.code, id, url: card.url });
                queued.add(id);
              }
              summary.added++;
            }
          }
          if (complete) {
            for (const l of listings.values()) {
              if (l.source !== source.id || l.removedAt || seen.has(l.id)) continue;
              l.missed = (l.missed || 0) + 1;
              if (l.missed >= 2) {
                l.removedAt = t;
                summary.removed++;
              }
            }
          }
          const failures = blocked ? (m.failures || 0) + 1 : 0;
          meta[source.id] = { lastRun: t, failures, paused: failures >= 2, complete };
          if (failures >= 2) summary.paused.push(source.id);
        })
      );
      // Enregistré dès la fin des pages de résultats de la commune.
      const kept = [...listings.values()].filter((l) => !l.removedAt || start - l.removedAt < KEEP_MS);
      await saveListings(redis, commune.code, kept);
      await saveSourceMeta(redis, commune.code, meta);
    })
  );
  // File écrite une fois les pages de résultats lues (une annonce oubliée par un passage
  // coupé est de toute façon remise en file au passage suivant).
  await writeQueue(redis, queue);

  // Pages des nouvelles annonces, une seule fois chacune, dans le temps restant : un site
  // à la fois par file (le robot poli impose 5 s entre deux pages d'un même site).
  const remaining = [];
  const refusedSources = new Set();
  const byHost = new Map();
  for (const item of queue) {
    const host = new URL(item.url).host;
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(item);
  }
  await Promise.all(
    [...byHost.values()].map(async (items) => {
      for (const item of items) {
        if (now() >= detailsDeadline) {
          remaining.push(item);
          continue;
        }
        const listings = await listingsFor(item.insee);
        const l = listings.get(item.id);
        if (!l || l.detail) continue;
        const res = await fetcher.get(item.url, { deadline: detailsDeadline });
        if (res.late) {
          remaining.push(item);
          continue;
        }
        if (!res.ok) {
          if (res.blocked) {
            // Refus : on garde l'annonce pour plus tard et la source compte un échec.
            refusedSources.add(l.source);
            remaining.push(item);
          } else if ((item.tries || 0) < 2 && !res.disallowed) remaining.push({ ...item, tries: (item.tries || 0) + 1 });
          else l.detail = true;
          if (l.detail) await saveListings(redis, item.insee, [l]);
          continue;
        }
        try {
          const d = readListingImpl(res.html, item.url);
          for (const f of DETAIL_FIELDS) if (d[f] != null && d[f] !== '') l[f] = d[f];
          if (d.title) l.title = d.title;
          if (d.buildingType) l.type = d.buildingType;
          if (l.price == null && d.price) {
            l.price = d.price;
            l.prices = [{ at: now(), price: d.price }];
          }
          if (lookup && now() < detailsDeadline) Object.assign(l, (await withTimeout(lookup(l), LOOKUP_MS)) || {});
          summary.details++;
        } catch (err) {
          console.error('[scan] page d’annonce illisible', item.url, err && err.message);
        }
        // Lue (ou illisible) : jamais redemandée ; enregistrée tout de suite.
        l.detail = true;
        await saveListings(redis, item.insee, [l]);
      }
    })
  );
  await writeQueue(redis, remaining);

  // Refus pendant les pages d'annonce : un échec de plus pour la source, si ses pages de
  // résultats n'ont pas déjà été comptées pendant ce passage.
  for (const [insee, meta] of metas) {
    let changed = false;
    for (const id of refusedSources) {
      const m = meta[id] || { lastRun: 0, failures: 0, paused: false };
      if (m.lastRun >= start) continue;
      const failures = (m.failures || 0) + 1;
      meta[id] = { ...m, failures, paused: failures >= 2 };
      if (failures >= 2 && !summary.paused.includes(id)) summary.paused.push(id);
      changed = true;
    }
    if (changed) await saveSourceMeta(redis, insee, meta);
  }
  return summary;
}

export { runScan, readList, idOf };
