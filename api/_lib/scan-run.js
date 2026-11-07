// Un passage du scan (spec §6.2 et §6.3) : pour chaque commune suivie et chaque source,
// les pages de résultats (au plus tous les 46 h, 5 pages au plus), puis les pages des
// nouvelles annonces, une seule fois chacune, dans le temps imparti. Nouveautés, baisses de
// prix et retraits sont déduits en comparant les passages. Tout est enregistré au fil de
// l'eau : une fonction coupée par Vercel ne perd que la page en cours.
import { SOURCES, readResults } from './sources.js';
import { readListing } from './page.js';
import { keys, listingsOf, saveListings, sourceMetaOf, saveSourceMeta, readQueue, writeQueue, activeCommunes } from './scan-store.js';
import { matchSale } from './sale-link.js';

// Ventes DVF d'une commune (maisons et appartements), chargées seulement quand il le faut, sans
// le registre des DPE : relier une annonce à sa vente n'en a pas besoin, et un registre lent
// ferait perdre les ventes au délai de 20 s.
const defaultLoadSales = async (insee, type, options = {}) => (await (await import('../dvf.js')).handleDvf({ insee, type, withEnergy: false, ...options })).sales;

const HOUR = 3600 * 1000;
// Verrou d'un passage : empêche deux robots simultanés (Vercel coupe un passage à 5 min) et
// impose 20 min entre deux départs, quel que soit l'appelant. Plusieurs passages par nuit
// (voir vercel.json) vident plus vite la file des pages d'annonce ; les pages de résultats
// restent espacées de 46 h par site quel que soit le nombre de passages.
const LOCK_MS = 20 * 60 * 1000;
const RESULTS_EVERY = 46 * HOUR; // pages de résultats d'une source relues tous les 2 jours
const RETRY_PAUSED = 7 * 24 * HOUR; // source en pause : nouvel essai une semaine plus tard
const MAX_PAGES = 5; // par source et par commune, toutes adresses de liste confondues
const LOOKUP_MS = 8000; // recherche d'adresse ADEME : au-delà, abandonnée
const KEEP_MS = 3 * 365 * 24 * HOUR;
const DAY = 24 * HOUR;
const SALES_CHECK_MS = 30 * DAY; // ventes des annonces retirées : une vérification par mois
const DETAIL_FIELDS = ['surface', 'pieces', 'chambres', 'terrain', 'garage', 'photo', 'postal', 'city', 'energyClass', 'gesClass', 'energyConsumption', 'gesEmission', 'dateRange'];
// Version du lecteur de pages d'annonce : une annonce lue par une version plus ancienne (qui
// prenait par exemple le terrain d'un bien similaire en bas de page) est relue une fois.
// Version 3 : DPE des pages Maes (lettre, valeurs, date) et date du DPE pour l'adresse.
const READER_VERSION = 3;
const needsReading = (l) => !l.removedAt && (!l.detail || (l.readerVersion || 1) < READER_VERSION);
// Version de la recherche d'adresse : une annonce lue, sans adresse sûre, cherchée par une
// version plus ancienne est cherchée de nouveau dans le registre des DPE, sans relire sa page.
// Version 2 : pistes d'adresse gardées (vérifiées par Nathan) et adresse sûre par immeuble.
const LOOKUP_VERSION = 2;
const needsLookup = (l) => !l.removedAt && l.detail && !l.address && (l.lookupVersion || 1) < LOOKUP_VERSION;
const LOOKUP_TRIES = 3; // registre muet (délai, panne) trois passages de suite : abandon

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

async function runScan({ redis, fetcher, now = Date.now, budgetMs = 240000, sources = SOURCES, readListingImpl = readListing, lookup = null, loadSales = defaultLoadSales }) {
  const start = now();
  // Verrou atomique : deux appels simultanés ne lancent jamais deux robots.
  const locked = await redis.command(['SET', keys.lock, String(start), 'NX', 'PX', String(LOCK_MS)]);
  if (locked !== 'OK') {
    // Verrou d'un passage trop ancien resté en place (horloge, base sans expiration) : repris.
    const held = Number(await redis.command(['GET', keys.lock])) || 0;
    if (start - held < LOCK_MS) return { skipped: 'recent' };
    await redis.command(['SET', keys.lock, String(start), 'PX', String(LOCK_MS)]);
  }
  const communes = await activeCommunes(redis, start);
  const summary = { communes: communes.length, results: 0, added: 0, details: 0, removed: 0, paused: [] };
  // Rien à suivre (aucun appareil synchronisé récemment) : le verrou est rendu, pour que le
  // passage suivant ne soit pas sauté.
  const pending = Number(await redis.command(['LLEN', keys.queue])) || 0;
  if (!communes.length && !pending) {
    await redis.command(['DEL', keys.lock]);
    return summary;
  }
  await redis.command(['SET', keys.last, String(start)]);
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
  // Page sans code postal (Maes) : l'adresse est cherchée dans la commune où le robot a vu
  // l'annonce (son code postal s'il n'y en a qu'un), la ville lue sur la page pouvant être fausse.
  const forLookup = (l, insee) => {
    const c = communes.find((x) => x.code === insee);
    if (l.postal || !c) return l;
    return { ...l, postal: c.codesPostaux && c.codesPostaux.length === 1 ? c.codesPostaux[0] : null, city: c.nom };
  };

  // Recherche d'adresse, une fois par passage et par annonce. Sans réponse (délai, registre
  // injoignable), l'annonce garde sa version et sera cherchée de nouveau au passage suivant,
  // trois fois au plus : une recherche toujours trop lente ne bloque pas les autres.
  const lookedUp = new Set();
  const lookUp = async (l, insee) => {
    lookedUp.add(l.id);
    const found = await withTimeout(lookup(forLookup(l, insee)), LOOKUP_MS);
    if (found) {
      Object.assign(l, found);
      delete l.lookupTries;
    } else {
      l.lookupTries = (l.lookupTries || 0) + 1;
      if (l.lookupTries < LOOKUP_TRIES) return;
      l.leads = null;
    }
    l.lookupVersion = LOOKUP_VERSION;
  };

  const queue = await readQueue(redis);
  const queued = new Set(queue.map((q) => q.id));

  await Promise.all(
    communes.map(async (commune) => {
      const listings = await listingsFor(commune.code);
      const meta = await sourceMetaOf(redis, commune.code);
      metas.set(commune.code, meta);
      // Annonce restée sans page lue et absente de la file (passage coupé) : remise en file.
      for (const l of listings.values()) {
        if (needsReading(l) && !queued.has(l.id)) {
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
          // Liste d'agence longue triée du plus récent au plus ancien : sa propre limite (`maxPages`).
          const budget = { pages: source.maxPages || MAX_PAGES };
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
              // De nouveau en vente : la vente qui lui avait été reliée n'était pas la sienne.
              delete l.sale;
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
        if (!l || !needsReading(l)) continue;
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
          else {
            // Abandonnée : jamais redemandée, même par une version plus récente du lecteur.
            if (!l.detail) l.readAt = now();
            l.detail = true;
            l.readerVersion = READER_VERSION;
          }
          if (l.detail) await saveListings(redis, item.insee, [l]);
          continue;
        }
        try {
          const d = readListingImpl(res.html, item.url);
          // Site dont la page donne le code postal de l'agence, pas celui du bien (`pagePlace`) :
          // la commune de la liste fait foi, la recherche d'adresse prend son code postal.
          const src = sources.find((s) => s.id === l.source);
          if (src && src.pagePlace === false) Object.assign(d, { postal: null, city: null });
          // Ce que la page ne dit pas est effacé : une valeur d'une lecture plus ancienne était fausse.
          for (const f of DETAIL_FIELDS) l[f] = d[f] != null && d[f] !== '' ? d[f] : null;
          l.readerVersion = READER_VERSION;
          if (d.title) l.title = d.title;
          if (d.buildingType) l.type = d.buildingType;
          if (l.price == null && d.price) {
            l.price = d.price;
            l.prices = [{ at: now(), price: d.price }];
          }
          if (lookup && now() < detailsDeadline) await lookUp(l, item.insee);
          summary.details++;
        } catch (err) {
          console.error('[scan] page d’annonce illisible', item.url, err && err.message);
        }
        // Lue (ou illisible) : jamais redemandée ; enregistrée tout de suite. La date de la
        // première lecture est celle de l'arrivée du bien dans le Fil (badge « nouveau »).
        if (!l.detail) l.readAt = now();
        l.detail = true;
        l.readerVersion = READER_VERSION;
        await saveListings(redis, item.insee, [l]);
      }
    })
  );
  await writeQueue(redis, remaining);

  // Ventes DVF des annonces retirées depuis 1 à 18 mois : une vérification par mois et par
  // commune (DVF paraît deux fois par an, avec 6 à 12 mois de retard). Un lien probable est
  // revu à chaque vérification : une vente publiée plus tard peut le rendre douteux.
  for (const commune of communes) {
    if (now() - start >= budgetMs) break;
    const meta = metas.get(commune.code) || {};
    if (start - ((meta._sales && meta._sales.lastCheck) || 0) < SALES_CHECK_MS) continue;
    const listings = await listingsFor(commune.code);
    const isSure = (l) => l.sale && l.sale.how === 'sure';
    const waiting = [...listings.values()].filter((l) => l.removedAt && !isSure(l) && start - l.removedAt >= 30 * DAY && start - l.removedAt <= 18 * 30 * DAY);
    if (!waiting.length) continue;
    let sales;
    try {
      sales = await withTimeout(loadSales(commune.code, null), 20000);
    } catch (err) {
      console.error('[scan] ventes DVF injoignables', commune.code, err && err.message);
    }
    if (!sales) continue;
    const found = new Map(waiting.map((l) => [l, matchSale(l, sales)]));
    // Adresses des biens qui réclament chaque vente (liens sûrs déjà posés compris). Deux
    // annonces du même bien (deux sites) ont la même adresse ; deux adresses : doute.
    const claims = new Map();
    const claim = (sale, l) => {
      if (!claims.has(sale.id)) claims.set(sale.id, new Set());
      claims.get(sale.id).add(String(l.address).toLowerCase());
    };
    for (const l of listings.values()) if (isSure(l) && l.sale.id) claim(l.sale, l);
    for (const [l, sale] of found) if (sale) claim(sale, l);
    for (const [l, sale] of found) {
      const keep = sale && (sale.how === 'sure' || claims.get(sale.id).size === 1) ? sale : null;
      if (JSON.stringify(keep) === JSON.stringify(l.sale || null)) continue;
      if (keep) l.sale = keep;
      else delete l.sale;
      await saveListings(redis, commune.code, [l]);
      if (keep) summary.sold = (summary.sold || 0) + 1;
    }
    meta._sales = { lastCheck: start };
    await saveSourceMeta(redis, commune.code, meta);
  }

  // Annonces déjà lues dont l'adresse a été cherchée par une version plus ancienne : de
  // nouveau, dans le temps restant (registre des DPE seulement, aucune page d'agence), après
  // les ventes DVF pour ne pas leur prendre leur temps.
  for (const commune of lookup ? communes : []) {
    const listings = await listingsFor(commune.code);
    for (const l of listings.values()) {
      if (now() >= detailsDeadline) break;
      if (!needsLookup(l) || lookedUp.has(l.id)) continue;
      await lookUp(l, commune.code);
      await saveListings(redis, commune.code, [l]);
    }
  }

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

export { defaultLoadSales, runScan, readList, idOf };
