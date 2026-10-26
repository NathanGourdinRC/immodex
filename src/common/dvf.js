// Ventes passées (DVF, « demandes de valeurs foncières ») à l'adresse d'un candidat :
// coordonnées → parcelle cadastrale (IGN apicarto) → ventes de sa section cadastrale
// (API publique d'Etalab, celle de app.dvf.etalab.gouv.fr) → ventes de la parcelle ou
// de l'adresse, plus le prix médian au m² de la rue et de la section comme repères.

const APICARTO_PARCEL = 'https://apicarto.ign.fr/api/cadastre/parcelle';
const DVF_SECTION = 'https://app.dvf.etalab.gouv.fr/api/mutations3';
const SECTION_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SECTIONS = 40;
// Demi-côté du carré de recherche quand le point tombe sur la voirie (environ 20 m à Lille).
const NEAR_LAT = 0.00018;
const NEAR_LON = 0.00027;

const sectionCache = new Map();

// L'API renvoie les valeurs absentes en texte (« nan », « None »).
function clean(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' || s === 'nan' || s === 'None' ? null : s;
}

function num(v) {
  const n = parseFloat(clean(v));
  return isFinite(n) ? n : null;
}

// Identifiant de parcelle : code INSEE (5) + préfixe (3) + section (2) + numéro (4).
function splitIdu(idu) {
  // Les communes corses ont un code INSEE en 2A / 2B.
  const m = String(idu || '').match(/^(\d{5}|2[AB]\d{3})(\d{3})([0-9A-Z]{2})(\d{4})$/);
  return m ? { codeInsee: m[1], prefixe: m[2], section: m[3], numero: m[4] } : null;
}

const sectionKey = (idu) => {
  const p = splitIdu(idu);
  return p ? `${p.codeInsee}/${p.prefixe}${p.section}` : null;
};

async function parcelsIn(geom) {
  const res = await fetch(`${APICARTO_PARCEL}?geom=${encodeURIComponent(JSON.stringify(geom))}`);
  if (!res.ok) throw new Error(`cadastre ${res.status}`);
  const data = await res.json();
  return ((data && data.features) || []).map((f) => f.properties && f.properties.idu).filter(Boolean);
}

// Parcelle sous le point ; sinon (point posé sur la rue), sections des parcelles voisines.
async function parcelsNear(lon, lat) {
  const [exact] = await parcelsIn({ type: 'Point', coordinates: [lon, lat] });
  if (exact) return { exact, sections: [sectionKey(exact)] };
  const ring = [
    [lon - NEAR_LON, lat - NEAR_LAT],
    [lon + NEAR_LON, lat - NEAR_LAT],
    [lon + NEAR_LON, lat + NEAR_LAT],
    [lon - NEAR_LON, lat + NEAR_LAT],
    [lon - NEAR_LON, lat - NEAR_LAT],
  ];
  const near = await parcelsIn({ type: 'Polygon', coordinates: [ring] });
  const counts = new Map();
  for (const idu of near) {
    const key = sectionKey(idu);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const sections = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
  return { exact: null, sections: sections.slice(0, 2) };
}

// Champs utiles seulement : une section compte souvent plusieurs centaines de lignes.
function slimRow(r) {
  return {
    id: r.id_mutation,
    date: r.date_mutation,
    nature: clean(r.nature_mutation),
    price: num(r.valeur_fonciere),
    numero: clean(r.adresse_numero),
    suffixe: clean(r.adresse_suffixe),
    voie: clean(r.adresse_nom_voie),
    parcelle: r.id_parcelle,
    type: clean(r.type_local),
    surface: num(r.surface_reelle_bati),
    pieces: num(r.nombre_pieces_principales),
    carrez: num(r.lot1_surface_carrez),
    terrain: num(r.surface_terrain),
  };
}

async function sectionRows(key) {
  const cached = sectionCache.get(key);
  if (cached && Date.now() - cached.at < SECTION_TTL_MS) return cached.rows;
  const res = await fetch(`${DVF_SECTION}/${key}`);
  if (!res.ok) throw new Error(`DVF ${res.status}`);
  const data = await res.json();
  const rows = (data && Array.isArray(data.mutations) ? data.mutations : []).map(slimRow);
  sectionCache.set(key, { at: Date.now(), rows });
  while (sectionCache.size > MAX_SECTIONS) sectionCache.delete(sectionCache.keys().next().value);
  return rows;
}

// ─── Adresses ───
// Le registre DPE écrit « 7 Rue Jules Verne 59130 Lambersart », DVF « 7 · RUE JULES VERNE »
// avec les abréviations du fichier des voies (AV, BD, ST, GAL…) : on compare des noms réduits.

const STREET_TYPES = new Set(
  'RUE R AVENUE AV AVE BOULEVARD BD BLVD PLACE PL ALLEE ALL IMPASSE IMP CHEMIN CHE CH ROUTE RTE QUAI QUA COURS CRS SQUARE SQ PASSAGE PAS PASS RESIDENCE RES CITE CTE SENTIER SEN VOIE PARVIS PRV PROMENADE PROM HAMEAU HAM LOTISSEMENT LOT CLOS CARREFOUR CAR ESPLANADE ESP FAUBOURG FG VILLA VLA MAIL TERRASSE TSSE DOMAINE DOM RUELLE RLE PONT PORTE PTE'.split(' ')
);
const STOP_WORDS = new Set('DE DU DES LA LE LES L D ET AU AUX A'.split(' '));
const ABBREVIATIONS = { SAINT: 'ST', SAINTE: 'STE', GENERAL: 'GAL', MARECHAL: 'MAL', PRESIDENT: 'PDT', DOCTEUR: 'DR', COMMANDANT: 'CDT', PROFESSEUR: 'PROF', LIEUTENANT: 'LT', CAPITAINE: 'CAP', NOTRE: 'NOTRE', DAME: 'DAME' };
const SUFFIXES = { BIS: 'B', TER: 'T', QUATER: 'Q', QUINQUIES: 'C' };

function streetTokens(name) {
  const tokens = String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((t) => ABBREVIATIONS[t] || t);
  if (tokens.length > 1 && STREET_TYPES.has(tokens[0])) tokens.shift();
  return tokens.filter((t) => !STOP_WORDS.has(t));
}

function sameStreet(a, b) {
  if (!a.length || !b.length) return false;
  if (a.join(' ') === b.join(' ')) return true;
  if (a[a.length - 1] !== b[b.length - 1]) return false;
  const setB = new Set(b);
  const shared = a.filter((t) => setB.has(t)).length;
  return shared / new Set([...a, ...b]).size >= 0.5;
}

// « 7BIS Rue de la Caserne Saint-Ruth 59800 Lille » → numéro 7, suffixe B, voie réduite.
// Le registre ajoute parfois la commune entre parenthèses : « 30 Rue Racine (Lille) 59000 Lille ».
function parseAddress(address) {
  const s = String(address || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+\d{5}\b.*$/, '')
    .trim();
  const m = s.match(/^(\d{1,5})\s*(BIS|TER|QUATER|[A-Z])?\b\s*,?\s*(.+)$/i);
  if (!m) return { number: null, suffix: null, street: streetTokens(s) };
  const suffix = m[2] ? m[2].toUpperCase() : null;
  return { number: Number(m[1]), suffix: suffix ? SUFFIXES[suffix] || suffix : null, street: streetTokens(m[3]) };
}

// ─── Ventes ───

// Une vente (mutation) compte une ligne par local : appartement, dépendances, terrain…
function groupMutations(rows) {
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.id)) {
      byId.set(r.id, { id: r.id, date: r.date, nature: r.nature, price: r.price, parcels: new Set(), locals: [], numero: null, suffixe: null, voie: null, terrain: 0 });
    }
    const m = byId.get(r.id);
    m.parcels.add(r.parcelle);
    if (!m.voie && r.voie) Object.assign(m, { numero: r.numero, suffixe: r.suffixe, voie: r.voie });
    if (r.type) m.locals.push({ type: r.type, surface: r.surface, pieces: r.pieces, carrez: r.carrez });
    if (r.terrain) m.terrain = Math.max(m.terrain, r.terrain);
  }
  return [...byId.values()].map((m) => {
    const main = m.locals.filter((l) => l.type === 'Appartement' || l.type === 'Maison');
    // Prix au m² seulement pour une vente d'un seul logement (une vente groupée fausserait le calcul).
    const single = main.length === 1 && main[0].surface ? main[0] : null;
    const number = m.numero ? parseInt(m.numero, 10) : null;
    return {
      id: m.id,
      date: m.date,
      nature: m.nature,
      price: m.price,
      parcels: [...m.parcels],
      address: [number, m.suffixe, m.voie].filter((v) => v != null && v !== '').join(' ') || null,
      number: isFinite(number) ? number : null,
      suffix: m.suffixe ? SUFFIXES[m.suffixe.toUpperCase()] || m.suffixe.toUpperCase() : null,
      street: streetTokens(m.voie),
      main,
      lots: m.locals.length,
      dependances: m.locals.filter((l) => l.type === 'Dépendance').length,
      locaux: m.locals.filter((l) => l.type && l.type.startsWith('Local')).length,
      terrain: m.terrain || null,
      pricePerM2: single && m.price ? Math.round(m.price / single.surface) : null,
    };
  });
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

// Prix médian au m² des ventes d'un seul logement du type voulu (bornes contre les erreurs de saisie).
function market(mutations, type) {
  const ppm = mutations
    .filter((m) => m.nature === 'Vente' && m.pricePerM2 && m.main.length === 1 && (!type || m.main[0].type === type))
    .map((m) => m.pricePerM2)
    .filter((v) => v >= 300 && v <= 30000);
  return ppm.length ? { median: median(ppm), count: ppm.length } : null;
}

function atAddress(m, target, exactIdu) {
  if (exactIdu && m.parcels.includes(exactIdu)) return true;
  if (target.number == null || m.number !== target.number) return false;
  if ((target.suffix || null) !== (m.suffix || null)) return false;
  return sameStreet(target.street, m.street);
}

function summarize(mutations, { exactIdu, address, type }) {
  const target = parseAddress(address);
  const sales = mutations.filter((m) => atAddress(m, target, exactIdu)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const wanted = type === 'maison' ? 'Maison' : type === 'appartement' ? 'Appartement' : (sales[0] && sales[0].main[0] && sales[0].main[0].type) || null;
  const street = target.street.length ? mutations.filter((m) => sameStreet(target.street, m.street)) : [];
  const dates = mutations.map((m) => m.date).filter(Boolean).sort();
  return {
    sales,
    type: wanted,
    street: market(street, wanted),
    section: market(mutations, wanted),
    period: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
  };
}

async function salesAt({ lat, lon, idu, address, type }) {
  let exactIdu = idu || null;
  let sections = idu ? [sectionKey(idu)] : [];
  if (!idu && isFinite(lat) && isFinite(lon) && lat != null && lon != null) {
    const near = await parcelsNear(Number(lon), Number(lat));
    exactIdu = near.exact;
    sections = near.sections;
  }
  sections = sections.filter(Boolean);
  if (!sections.length) return { parcel: null, sections: [], sales: [], street: null, section: null, period: null };
  const rows = (await Promise.all(sections.map(sectionRows))).flat();
  return { parcel: exactIdu, sections, ...summarize(groupMutations(rows), { exactIdu, address, type }) };
}

export { salesAt, summarize, groupMutations, market, parseAddress, streetTokens, sameStreet, splitIdu, slimRow, median };
