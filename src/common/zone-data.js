// Données publiques d'une zone de recherche : communes, nouveaux DPE (ADEME),
// prix médian au m² par commune et par section cadastrale (Statistiques DVF),
// contours pour la carte. Aucune donnée n'est collectée sur les portails d'annonces.
import { DATASETS, queryAdeme } from './ademe.js';

const GEO_API = 'https://geo.api.gouv.fr/communes';
const DVF_STATS = 'https://tabular-api.data.gouv.fr/api/resources/851d342f-9c96-41c1-924a-11a7a7aae8a6/data/';
const SECTIONS = (insee) => `https://cadastre.data.gouv.fr/bundler/cadastre-etalab/communes/${insee}/geojson/sections`;
const COMMUNE_FIELDS = 'nom,code,codesPostaux,centre,population';

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return res.json();
}

// « Lambersart », « 59130 » ou « lille » → communes candidates, les plus peuplées d'abord.
async function searchCommunes(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const url = /^\d{5}$/.test(q)
    ? `${GEO_API}?codePostal=${q}&fields=${COMMUNE_FIELDS}`
    : `${GEO_API}?nom=${encodeURIComponent(q)}&fields=${COMMUNE_FIELDS}&boost=population&limit=8`;
  const list = await getJson(url);
  return (Array.isArray(list) ? list : []).sort((a, b) => (b.population || 0) - (a.population || 0));
}

async function communeContour(insee) {
  return getJson(`${GEO_API}/${insee}?fields=nom,code&format=geojson&geometry=contour`);
}

async function communeSections(insee) {
  return getJson(SECTIONS(insee));
}

// ─── Nouveaux DPE ───

function isoDaysAgo(days, now = Date.now()) {
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Filtres du registre ADEME pour la zone : communes, période, type et surface.
function zoneDpeFilters(zone, sinceIso) {
  const filters = { eq: [], gte: [], lte: [], in: [] };
  filters.in.push(['code_insee_ban', zone.communes.map((c) => c.code).join(',')]);
  filters.gte.push(['date_etablissement_dpe', sinceIso]);
  if (zone.type) filters.eq.push(['type_batiment', zone.type]);
  else filters.in.push(['type_batiment', 'maison,appartement']);
  if (zone.surfaceMin) filters.gte.push(['surface_habitable_logement', Math.max(0, zone.surfaceMin - 3)]);
  if (zone.surfaceMax) filters.lte.push(['surface_habitable_logement', zone.surfaceMax + 3]);
  return filters;
}

async function fetchNewDpe(zone, days = 30, now = Date.now()) {
  if (!zone.communes.length) return { total: 0, records: [] };
  const { total, records } = await queryAdeme({
    dataset: DATASETS.existing,
    filters: zoneDpeFilters(zone, isoDaysAgo(days, now)),
    size: 200,
    sort: '-date_etablissement_dpe',
  });
  return { total, records: records.map(({ raw, ...r }) => r) };
}

// ─── Prix du marché (Statistiques DVF, 5 dernières années) ───

// Colonnes du jeu de données selon le type cherché.
function priceColumns(type) {
  const suffix = type === 'maison' ? 'maison' : type === 'appartement' ? 'appartement' : 'apt_maison';
  return { median: `med_prix_m2_whole_${suffix}`, count: `nb_ventes_whole_${suffix}` };
}

async function tabularRows(filter) {
  const rows = [];
  let url = `${DVF_STATS}?${filter}&page_size=200`;
  for (let page = 0; url && page < 10; page++) {
    const data = await getJson(url);
    rows.push(...(data.data || []));
    url = data.links && data.links.next ? data.links.next : null;
  }
  return rows;
}

// Médianes d'une commune et de chacune de ses sections cadastrales.
async function dvfStats(insee) {
  const [commune, sections] = await Promise.all([tabularRows(`code_geo__exact=${insee}`), tabularRows(`code_parent__exact=${insee}`)]);
  return { commune: commune[0] || null, sections: sections.filter((r) => r.echelle_geo === 'section') };
}

// Médiane et nombre de ventes d'une ligne de statistiques pour le type cherché.
function marketOf(row, type) {
  if (!row) return null;
  const cols = priceColumns(type);
  const median = row[cols.median];
  const count = row[cols.count];
  return median != null && count ? { median: Number(median), count: Number(count) } : null;
}

// Seuils de couleur de la carte des prix : quantiles, arrondis à la centaine.
function priceBreaks(values, classes = 5) {
  const sorted = values.filter((v) => isFinite(v) && v > 0).sort((a, b) => a - b);
  if (sorted.length < 2) return [];
  const breaks = [];
  for (let i = 1; i < classes; i++) {
    const v = Math.round(sorted[Math.min(sorted.length - 1, Math.floor((i * sorted.length) / classes))] / 100) * 100;
    if (!breaks.length || v > breaks[breaks.length - 1]) breaks.push(v);
  }
  return breaks;
}

function priceClass(value, breaks) {
  let i = 0;
  while (i < breaks.length && value >= breaks[i]) i++;
  return i;
}

export {
  searchCommunes,
  communeContour,
  communeSections,
  isoDaysAgo,
  zoneDpeFilters,
  fetchNewDpe,
  priceColumns,
  dvfStats,
  marketOf,
  priceBreaks,
  priceClass,
};
