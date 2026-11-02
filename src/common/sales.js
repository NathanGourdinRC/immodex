// Ventes passées d'une commune entière (DVF d'Etalab, 5 dernières années) : toutes les
// sections cadastrales de la commune, puis une liste de ventes d'un seul logement avec
// prix au m², terrain, dépendances et position. Sert à la carte en secteurs et à l'onglet
// « Ventes passées » d'une recherche.
import { communeSections } from './zone-data.js';
import { groupMutations, sectionKeyFromId, sectionRows } from './dvf.js';

// Annecy, commune fusionnée, compte 211 sections : le plafond ne sert qu'aux très grandes villes.
const MAX_SECTIONS = 250;
const PARALLEL = 4;
const TYPES = { maison: ['Maison'], appartement: ['Appartement'] };

// Ventes d'un seul logement du type voulu, prix au m² plausible (mêmes bornes que market()).
function toSales(mutations, type) {
  const wanted = TYPES[type] || ['Maison', 'Appartement'];
  return mutations
    .filter((m) => m.nature === 'Vente' && m.main.length === 1 && wanted.includes(m.main[0].type))
    .filter((m) => m.pricePerM2 && m.pricePerM2 >= 300 && m.pricePerM2 <= 30000)
    .map((m) => ({
      id: m.id,
      date: m.date,
      commune: m.commune,
      address: m.address,
      price: m.price,
      type: m.main[0].type,
      surface: m.main[0].surface,
      pieces: m.main[0].pieces,
      terrain: m.terrain,
      dependances: m.dependances,
      pricePerM2: m.pricePerM2,
      lon: m.lon,
      lat: m.lat,
    }));
}

// Charge au plus `limit` tâches à la fois, dans l'ordre.
async function inBatches(items, limit, run) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await run(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function communeSales(insee, { type = null, fetchSections = communeSections, fetchRows = sectionRows, maxSections = MAX_SECTIONS } = {}) {
  const shapes = await fetchSections(insee);
  const keys = [...new Set(((shapes && shapes.features) || []).map((f) => sectionKeyFromId(f.properties && f.properties.id)).filter(Boolean))];
  const wanted = keys.slice(0, maxSections);
  // Une section injoignable ne fait pas perdre les autres : la commune est seulement partielle.
  let failedSections = 0;
  const rows = (
    await inBatches(wanted, PARALLEL, (key) =>
      fetchRows(key).catch(() => {
        failedSections++;
        return [];
      })
    )
  ).flat();
  const sales = toSales(groupMutations(rows), type);
  const dates = sales.map((s) => s.date).filter(Boolean).sort();
  return {
    sales,
    sections: keys.length,
    loaded: wanted.length,
    failedSections,
    partial: keys.length > wanted.length || failedSections > 0,
    lastDate: dates.length ? dates[dates.length - 1] : null,
  };
}

// Ventes de toutes les communes d'une recherche, gardées pendant la vie de la page. Un
// résultat incomplet à cause d'un échec (commune ou section injoignable) n'est pas gardé :
// la prochaine ouverture de la recherche réessaie.
function createSearchSales({ load = communeSales } = {}) {
  const cache = new Map();
  return function searchSales(search) {
    const key = `${search.type || 'tous'}|${search.communes.map((c) => c.code).join(',')}`;
    if (cache.has(key)) return cache.get(key);
    const pending = Promise.all(
      search.communes.map((c) =>
        load(c.code, { type: search.type || null })
          .then((r) => ({ commune: c, ...r }))
          .catch(() => ({ commune: c, failed: true, sales: [], partial: false, failedSections: 0, lastDate: null }))
      )
    ).then((parts) => {
      const dates = parts.map((p) => p.lastDate).filter(Boolean).sort();
      const result = {
        sales: parts.flatMap((p) => p.sales),
        partial: parts.some((p) => p.partial),
        lastDate: dates.length ? dates[dates.length - 1] : null,
        failed: parts.filter((p) => p.failed).map((p) => p.commune.nom),
        failedSections: parts.reduce((n, p) => n + (p.failedSections || 0), 0),
        empty: parts.filter((p) => !p.failed && !p.failedSections && !p.sales.length).map((p) => p.commune.nom),
        perCommune: parts.map((p) => ({ commune: p.commune, count: p.sales.length })),
      };
      if (result.failed.length || result.failedSections) cache.delete(key);
      return result;
    });
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
    return pending;
  };
}

export { communeSales, createSearchSales, toSales, MAX_SECTIONS };
