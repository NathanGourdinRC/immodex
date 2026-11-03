// Ventes DVF d'une commune, allégées et mises en cache par Vercel : les fichiers annuels par
// commune d'Etalab (geo-dvf, 5 ans) au lieu de centaines d'appels par section cadastrale.
// Annecy passe ainsi d'environ 60 Mo téléchargés par le téléphone à quelques centaines de Ko.
// Données publiques ; l'en-tête noindex de vercel.json s'applique aussi à cette adresse.
import { slimRow, groupMutations } from '../src/common/dvf.js';
import { toSales } from '../src/common/sales.js';
import { linkSalesToDpe, energyStats } from '../src/common/dpe-link.js';
import { communeDpe } from './_lib/dpe-commune.js';

const GEO_DVF = 'https://files.data.gouv.fr/geo-dvf/latest/csv';
const INSEE = /^(\d{5}|2[AB]\d{3})$/;
const YEARS_BACK = 6;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// CSV d'Etalab : virgules, champs entre guillemets quand ils contiennent une virgule.
function parseCsv(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter(Boolean);
  if (!lines.length) return [];
  const split = (line) => {
    const cells = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = !quoted;
      } else if (ch === ',' && !quoted) {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    return cells;
  };
  const cols = split(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = split(line);
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
  });
}

// Dossier départemental du fichier : 2 caractères (59, 2A), 3 outre-mer (974).
const depOf = (insee) => (insee.startsWith('97') ? insee.slice(0, 3) : insee.slice(0, 2));

async function handleDvf({ insee, type = null, fetchImpl = fetch, now = Date.now() }) {
  if (!INSEE.test(String(insee || ''))) throw new HttpError(400, 'bad-insee');
  const wanted = type === 'maison' || type === 'appartement' ? type : null;
  const last = new Date(now).getUTCFullYear();
  const years = Array.from({ length: YEARS_BACK + 1 }, (_, i) => last - i);
  const files = await Promise.all(
    years.map(async (year) => {
      const res = await fetchImpl(`${GEO_DVF}/${year}/communes/${depOf(insee)}/${insee}.csv`);
      if (res.status === 404) return null;
      if (!res.ok) throw new HttpError(502, `geo-dvf ${year} ${res.status}`);
      return { year, rows: parseCsv(await res.text()) };
    })
  );
  const found = files.filter(Boolean);
  const sales = toSales(groupMutations(found.flatMap((f) => f.rows).map(slimRow)), wanted);
  const dates = sales.map((s) => s.date).filter(Boolean).sort();
  // Classe énergie de chaque vente et statistiques de la commune (DPE reliés par l'adresse).
  let energy = null;
  const dpe = await communeDpe(insee, wanted, { fetchImpl });
  if (dpe) {
    const links = linkSalesToDpe(sales, dpe);
    for (const v of sales) {
      const l = links.get(v.id);
      if (l) Object.assign(v, { energyClass: l.energyClass, dpeDate: l.dpeDate, dpeDays: l.days });
    }
    energy = energyStats(sales, links);
  }
  return { insee, type: wanted, sales, energy, lastDate: dates.length ? dates[dates.length - 1] : null, years: found.map((f) => f.year).sort() };
}

const CORS = { 'Access-Control-Allow-Origin': '*' };

export async function GET(request) {
  const url = new URL(request.url);
  try {
    const data = await handleDvf({ insee: url.searchParams.get('insee'), type: url.searchParams.get('type') });
    return new Response(JSON.stringify(data), {
      status: 200,
      // Une semaine en cache chez Vercel : DVF n'est mis à jour que deux fois par an.
      // Registre des DPE injoignable : réponse incomplète gardée une heure seulement.
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': data.energy ? 'public, max-age=3600, s-maxage=604800, stale-while-revalidate=604800' : 'public, max-age=600, s-maxage=3600' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: e.status || 500,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}

export { handleDvf, parseCsv, HttpError };
