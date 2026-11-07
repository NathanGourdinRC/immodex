const ADEME_BASE = 'https://data.ademe.fr/data-fair/api/v1/datasets';

const DATASETS = {
  existing: 'dpe03existant',
  newBuild: 'g3cgx7jb3cmys5voxz1mrm22',
  legacy: 'dpe-france',
};

const FIELD_MAP = {
  existing: {
    id: 'numero_dpe',
    date: 'date_etablissement_dpe',
    surface: 'surface_habitable_logement',
    postal: 'code_postal_ban',
    city: 'nom_commune_ban',
    address: 'adresse_ban',
    rawAddress: 'adresse_brut',
    energyClass: 'etiquette_dpe',
    gesClass: 'etiquette_ges',
    energyConsumption: 'conso_5_usages_par_m2_ep',
    gesEmission: 'emission_ges_5_usages_par_m2',
    buildingType: 'type_batiment',
    constructionYear: 'annee_construction',
    geopoint: '_geopoint',
  },
  newBuild: {
    id: 'numero_dpe',
    date: 'date_etablissement_dpe',
    surface: 'surface_habitable_logement',
    postal: 'code_postal_ban',
    city: 'nom_commune_ban',
    address: 'adresse_ban',
    rawAddress: 'adresse_brut',
    energyClass: 'etiquette_dpe',
    gesClass: 'etiquette_ges',
    energyConsumption: 'conso_5_usages_par_m2_ep',
    gesEmission: 'emission_ges_5_usages_par_m2',
    buildingType: 'type_batiment',
    constructionYear: 'annee_construction',
    geopoint: '_geopoint',
  },
  legacy: {
    id: 'numero_dpe',
    date: 'date_etablissement_dpe',
    surface: 'surface_habitable',
    postal: 'code_postal',
    city: 'commune',
    address: 'geo_adresse',
    energyClass: 'classe_consommation_energie',
    gesClass: 'classe_estimation_ges',
    energyConsumption: 'consommation_energie',
    gesEmission: 'estimation_ges',
    buildingType: 'tr002_type_batiment_description',
    constructionYear: 'annee_construction',
    geopoint: '_geopoint',
  },
};

function buildSelect(fields) {
  return Object.values(fields).join(',');
}

function buildAdemeUrl({ dataset, filters, size = 20, sort }) {
  const fieldMap = FIELD_MAP[dataset === DATASETS.legacy ? 'legacy' : dataset === DATASETS.newBuild ? 'newBuild' : 'existing'];
  const params = new URLSearchParams();
  params.set('size', String(size));
  params.set('select', buildSelect(fieldMap));
  if (sort) params.set('sort', sort);

  for (const [op, list] of Object.entries(filters || {})) {
    for (const [field, value] of list) {
      if (value === null || value === undefined || value === '') continue;
      params.append(`${field}_${op}`, String(value));
    }
  }

  return {
    url: `${ADEME_BASE}/${dataset}/lines?${params.toString()}`,
    fieldMap,
  };
}

// « 50.6292,3.0054 » → { lat, lon } (coordonnées du logement géocodé par la BAN).
function geopoint(value) {
  const m = String(value || '').match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : { lat: null, lon: null };
}

// Les lettres accentuées et la ligature œ ramenées à leur forme simple, la ponctuation en espaces :
// « Rue du Général-Leclerc » et « rue du general leclerc » se comparent.
const fold = (s) =>
  String(s || '')
    .replace(/œ/gi, 'oe')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Numéro de rue saisi par le diagnostiqueur (« 49 F Rue du Général Leclerc »), repris quand
// l'adresse normalisée par la Base adresse nationale s'arrête à la rue faute d'avoir reconnu ce
// numéro. Seulement si le reste de la saisie est bien la même rue : une saisie approximative
// (« 49 r du gal Leclerc ») ne remplace rien. Seule la première ligne de la saisie compte (la
// suite est souvent un nom de résidence).
function withStreetNumber(address, rawAddress) {
  if (!address || /^\d/.test(String(address).trim()) || !rawAddress) return address;
  const line = String(rawAddress).split(/\r?\n/)[0].trim();
  const m = line.match(/^(\d{1,4}(?:\s?(?:bis|ter|quater|[a-z]))?)\b[\s,]+(.+)$/i);
  if (!m) return address;
  const street = fold(m[2]);
  if (street.length < 4 || !fold(address).startsWith(street)) return address;
  return `${m[1].replace(/\s+/g, ' ')} ${String(address).trim()}`;
}

function normalizeRecord(raw, fieldMap) {
  return {
    id: raw[fieldMap.id] ?? null,
    date: raw[fieldMap.date] ?? null,
    surface: raw[fieldMap.surface] != null ? Number(raw[fieldMap.surface]) : null,
    postal: raw[fieldMap.postal] ?? null,
    city: raw[fieldMap.city] ?? null,
    address: withStreetNumber(raw[fieldMap.address] ?? null, fieldMap.rawAddress ? raw[fieldMap.rawAddress] : null),
    energyClass: raw[fieldMap.energyClass] ?? null,
    gesClass: raw[fieldMap.gesClass] ?? null,
    energyConsumption: raw[fieldMap.energyConsumption] ?? null,
    gesEmission: raw[fieldMap.gesEmission] ?? null,
    buildingType: raw[fieldMap.buildingType] ?? null,
    constructionYear: raw[fieldMap.constructionYear] ?? null,
    ...geopoint(raw[fieldMap.geopoint]),
    raw,
  };
}

async function queryAdeme({ dataset, filters, size = 20, sort }) {
  const { url, fieldMap } = buildAdemeUrl({ dataset, filters, size, sort });
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`ADEME API error ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const data = await res.json();
  const rows = Array.isArray(data?.results) ? data.results : [];
  return {
    total: data?.total ?? rows.length,
    records: rows.map((r) => normalizeRecord(r, fieldMap)),
    url,
  };
}

export { ADEME_BASE, DATASETS, FIELD_MAP, buildAdemeUrl, queryAdeme, normalizeRecord, withStreetNumber };
