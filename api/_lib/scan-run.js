// Un passage du scan (spec §6.2 et §6.3) : pour chaque commune suivie et chaque source,
// les pages de résultats (au plus tous les 46 h), puis les pages des nouvelles annonces,
// une seule fois chacune, dans le temps imparti. Nouveautés, baisses de prix et retraits
// sont déduits en comparant les passages.
import { SOURCES, readResults } from './sources.js';
import { readListing } from './page.js';
import { keys, listingsOf, saveListings, sourceMetaOf, saveSourceMeta, readQueue, writeQueue, activeCommunes } from './scan-store.js';

const HOUR = 3600 * 1000;
const MIN_GAP = 20 * HOUR; // un passage au plus toutes les 20 h
const RESULTS_EVERY = 46 * HOUR; // pages de résultats d'une source relues tous les 2 jours
const RETRY_PAUSED = 7 * 24 * HOUR; // source en pause : nouvel essai une semaine plus tard
const MAX_PAGES = 5;
const KEEP_MS = 3 * 365 * 24 * HOUR;
const DETAIL_FIELDS = ['surface', 'pieces', 'chambres', 'terrain', 'garage', 'photo', 'postal', 'city', 'energyClass', 'gesClass', 'energyConsumption', 'gesEmission'];

const idOf = (source, url) => `${source.id}:${new URL(url).pathname}`;

// Pages de résultats d'une adresse de liste : on suit les pages tant qu'elles sont pleines
// et apportent du nouveau. `complete` : toute la liste a été lue sans erreur. `late` : le
// temps du passage est écoulé, la liste sera relue au passage suivant.
async function readList(fetchPage, source, listUrl, commune, late = () => false) {
  const cards = new Map();
  let complete = true;
  let blocked = false;
  for (let n = 1; n <= MAX_PAGES; n++) {
    const url = n === 1 ? listUrl : source.pageUrl(listUrl, n);
    if (!url) break;
    if (late()) return { cards: [], complete: false, blocked: false, aborted: true };
    const res = await fetchPage(url);
    if (!res.ok) {
      complete = false;
      blocked = blocked || res.blocked;
      break;
    }
    const { cards: found, full } = readResults(res.html, url, source, commune);
    const before = cards.size;
    for (const c of found) if (!cards.has(c.url)) cards.set(c.url, c);
    if (!full || (n > 1 && cards.size === before)) break;
    if (n === MAX_PAGES) complete = false;
  }
  return { cards: [...cards.values()], complete, blocked };
}

async function runScan({ redis, fetcher, now = Date.now, budgetMs = 240000, sources = SOURCES, readListingImpl = readListing, lookup = null }) {
  const start = now();
  const last = Number(await redis.command(['GET', keys.last])) || 0;
  if (start - last < MIN_GAP) return { skipped: 'recent', last };
  await redis.command(['SET', keys.last, String(start)]);

  const communes = await activeCommunes(redis, start);
  const summary = { communes: communes.length, results: 0, added: 0, details: 0, removed: 0, paused: [] };
  // Les pages de résultats prennent au plus 60 % du temps ; le reste va aux pages d'annonce.
  const late = () => now() - start >= budgetMs * 0.6;
  // Une même page (liste d'une agence, toutes communes) n'est demandée qu'une fois par passage.
  const pageMemo = new Map();
  const fetchPage = (url) => {
    if (!pageMemo.has(url)) {
      summary.results++;
      pageMemo.set(url, fetcher.get(url));
    }
    return pageMemo.get(url);
  };

  const queue = await readQueue(redis);
  const byCommune = new Map();
  await Promise.all(
    communes.map(async (commune) => {
      const listings = await listingsOf(redis, commune.code);
      const meta = await sourceMetaOf(redis, commune.code);
      byCommune.set(commune.code, listings);
      const types = commune.types.has(null) ? [null] : [...commune.types];
      await Promise.all(
        sources.map(async (source) => {
          if (source.departments && !source.departments.some((d) => commune.code.startsWith(d))) return;
          const m = meta[source.id] || { lastRun: 0, failures: 0, paused: false };
          if (start - (m.lastRun || 0) < RESULTS_EVERY) return;
          if (m.paused && start - (m.lastRun || 0) < RETRY_PAUSED) return;
          const urls = [...new Set(types.flatMap((t) => source.listUrls(commune, t)))];
          const reads = [];
          for (const url of urls) reads.push(await readList(fetchPage, source, url, commune, late));
          // Temps écoulé : rien n'est enregistré pour cette source, elle reste à faire.
          if (reads.some((r) => r.aborted)) return;
          const complete = reads.every((r) => r.complete);
          const blocked = reads.some((r) => r.blocked);
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
              queue.push({ insee: commune.code, id, url: card.url });
              summary.added++;
            }
          }
          // Absences comptées seulement si toute la liste a été lue.
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
      await saveSourceMeta(redis, commune.code, meta);
    })
  );

  // Pages des nouvelles annonces, une seule fois chacune, dans le temps restant : un site
  // à la fois par file (le robot poli impose 5 s entre deux pages d'un même site).
  const remaining = [];
  const byHost = new Map();
  for (const item of queue) {
    const host = new URL(item.url).host;
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(item);
  }
  await Promise.all(
    [...byHost.values()].map(async (items) => {
      for (const item of items) {
        if (now() - start >= budgetMs) {
          remaining.push(item);
          continue;
        }
        if (!byCommune.has(item.insee)) byCommune.set(item.insee, await listingsOf(redis, item.insee));
        const l = byCommune.get(item.insee).get(item.id);
        if (!l || l.detail) continue;
        const res = await fetcher.get(item.url);
        if (!res.ok) {
          // Échec passager : nouvel essai au passage suivant, trois fois au plus.
          if ((item.tries || 0) < 2 && !res.blocked && !res.disallowed) remaining.push({ ...item, tries: (item.tries || 0) + 1 });
          else l.detail = true;
          continue;
        }
        const d = readListingImpl(res.html, item.url);
        for (const f of DETAIL_FIELDS) if (d[f] != null && d[f] !== '') l[f] = d[f];
        if (d.title) l.title = d.title;
        if (d.buildingType) l.type = d.buildingType;
        if (l.price == null && d.price) {
          l.price = d.price;
          l.prices = [{ at: now(), price: d.price }];
        }
        if (lookup) Object.assign(l, (await lookup(l)) || {});
        l.detail = true;
        summary.details++;
      }
    })
  );

  for (const [insee, listings] of byCommune) {
    // Annonces retirées depuis plus de 3 ans : oubliées.
    const kept = [...listings.values()].filter((l) => !l.removedAt || start - l.removedAt < KEEP_MS);
    await saveListings(redis, insee, kept);
  }
  await writeQueue(redis, remaining);
  return summary;
}

export { runScan, readList, idOf };
