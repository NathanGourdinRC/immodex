// Secteurs de la carte et voisinage d'un bien, à partir des ventes DVF (sales.js).
// Secteurs : hexagones d'environ 400 m (rayon 220 m), colorés seulement à partir de 10 ventes,
// en 3 niveaux par rapport à la médiane de la commune (±10 %). Le test fait sur Wambrechies
// (2 novembre 2026) montre ±16 % d'écart entre deux maisons voisines : un prix au m² précis
// par secteur serait une fausse précision.
import { median } from './dvf.js';

const HEX_RADIUS_M = 220;
const MIN_SALES = 10;
const LEVEL_GAP = 0.1;
const NEAREST = 15;
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320;

const located = (v) => v && v.lat != null && v.lon != null && isFinite(v.lat) && isFinite(v.lon);

// Projection plane locale (équirectangulaire), assez juste à l'échelle d'une commune.
function projector(lat0, lon0) {
  const k = Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG_LON;
  return {
    to: (lat, lon) => [(lon - lon0) * k, (lat - lat0) * M_PER_DEG_LAT],
    from: (x, y) => [lat0 + y / M_PER_DEG_LAT, lon0 + x / k],
  };
}

// Hexagone « pointe en haut » contenant le point (coordonnées axiales, arrondi cubique).
function hexOf(x, y, R) {
  const q = ((Math.sqrt(3) / 3) * x - y / 3) / R;
  const r = ((2 / 3) * y) / R;
  let rx = Math.round(q);
  let rz = Math.round(r);
  const ry = Math.round(-q - r);
  const dx = Math.abs(rx - q);
  const dz = Math.abs(rz - r);
  const dy = Math.abs(ry + q + r);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy <= dz) rz = -rx - ry;
  return [rx, rz];
}

function levelOf(value, reference, gap) {
  if (value == null || !reference) return null;
  if (value <= reference * (1 - gap)) return 'moins';
  if (value >= reference * (1 + gap)) return 'plus';
  return 'moyenne';
}

function mostFrequent(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function buildSectors(sales, { radius = HEX_RADIUS_M, minSales = MIN_SALES, gap = LEVEL_GAP } = {}) {
  const byCommune = {};
  for (const v of sales) if (v.pricePerM2) (byCommune[v.commune] = byCommune[v.commune] || []).push(v.pricePerM2);
  const communeMedians = Object.fromEntries(Object.entries(byCommune).map(([c, list]) => [c, median(list)]));

  const points = sales.filter(located);
  if (!points.length) return { sectors: [], communeMedians };
  const lat0 = points.reduce((a, v) => a + v.lat, 0) / points.length;
  const lon0 = points.reduce((a, v) => a + v.lon, 0) / points.length;
  const proj = projector(lat0, lon0);

  const cells = new Map();
  for (const v of points) {
    const [q, r] = hexOf(...proj.to(v.lat, v.lon), radius);
    const key = `${q},${r}`;
    if (!cells.has(key)) cells.set(key, { key, q, r, sales: [] });
    cells.get(key).sales.push(v);
  }

  const sectors = [...cells.values()].map(({ key, q, r, sales: list }) => {
    const cx = radius * Math.sqrt(3) * (q + r / 2);
    const cy = radius * 1.5 * r;
    const polygon = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 180) * (60 * i - 30);
      return proj.from(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
    });
    const commune = mostFrequent(list.map((v) => v.commune));
    const med = list.length >= minSales ? median(list.map((v) => v.pricePerM2)) : null;
    return { key, center: proj.from(cx, cy), polygon, count: list.length, median: med, level: levelOf(med, communeMedians[commune], gap), commune, sales: list };
  });
  return { sectors, communeMedians };
}

// Rang le plus proche dans une liste triée (p entre 0 et 1).
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

function nearestSales(sales, { lat, lon }, k = NEAREST) {
  const points = sales.filter(located);
  if (points.length < 5 || lat == null || lon == null) return null;
  const proj = projector(lat, lon);
  const near = points
    .map((v) => ({ v, d: Math.hypot(...proj.to(v.lat, v.lon)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k);
  const prices = near.map((x) => x.v.pricePerM2).sort((a, b) => a - b);
  return { sales: near.map((x) => x.v), radius: Math.round(near[near.length - 1].d), p25: percentile(prices, 0.25), median: median(prices), p75: percentile(prices, 0.75) };
}

// Vente comparable aux critères de la recherche (surface avec la marge de 3 m², pièces, terrain).
// Un critère vide de la recherche est ignoré ; une donnée absente de la vente ne le satisfait pas.
function isComparable(sale, search) {
  const within = (v, min, max, margin = 0) => {
    if (!min && !max) return true;
    if (v == null) return false;
    return (!min || v >= min - margin) && (!max || v <= max + margin);
  };
  return within(sale.surface, search.surfaceMin, search.surfaceMax, 3) && within(sale.pieces, search.piecesMin, null) && within(sale.terrain, search.terrainMin, search.terrainMax);
}

export { HEX_RADIUS_M, MIN_SALES, LEVEL_GAP, NEAREST, buildSectors, nearestSales, isComparable };
