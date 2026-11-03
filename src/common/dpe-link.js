// Ventes DVF et diagnostics énergie (DPE de l'ADEME) reliés par l'adresse : classe énergie de
// chaque maison vendue et délai entre son DPE et l'acte de vente. Le DPE est obligatoire avant
// une mise en vente ; un DPE établi après la vente concerne le nouveau propriétaire.
import { parseAddress, sameStreet, median } from './dvf.js';

const DAY = 24 * 3600 * 1000;
const MIN_CLASS_SALES = 10;
const MIN_DELAY_SALES = 10;
const MIN_CLASS_GAP = 0.05;

// Parmi les DPE qui conviennent (du plus récent au plus ancien) : s'ils donnent tous la même
// classe, le plus récent. Sinon la surface départage (5 % près). Sinon une maison dont les DPE
// ont la même surface a été diagnostiquée deux fois : le plus récent. Sinon (logements voisins
// d'un immeuble qu'on ne sait pas distinguer), pas de lien.
function pick(fits, v) {
  const oneClass = (list) => list.length > 0 && list.every(({ d }) => d.energyClass === list[0].d.energyClass);
  if (oneClass(fits)) return fits[0];
  const tight = v.surface ? fits.filter(({ d }) => d.surface && Math.abs(d.surface - v.surface) <= 0.05 * v.surface) : [];
  if (oneClass(tight)) return tight[0];
  const surfaces = fits.map(({ d }) => d.surface).filter(Boolean);
  const sameDwelling = surfaces.length === fits.length && Math.max(...surfaces) <= 1.05 * Math.min(...surfaces);
  return v.type === 'Maison' && sameDwelling ? fits[0] : null;
}

// Même numéro, même suffixe (bis, ter), même rue, DPE au plus `maxDays` avant la vente, surface
// à `surfaceTolerance` près quand les deux sont connues (maisons jumelles), puis `pick`.
function linkSalesToDpe(sales, dpeRecords, { maxDays = 730, surfaceTolerance = 0.15 } = {}) {
  const byNumber = new Map();
  for (const d of dpeRecords || []) {
    if (!d || !d.address || !d.date || !d.energyClass) continue;
    const a = parseAddress(d.address);
    if (a.number == null) continue;
    if (!byNumber.has(a.number)) byNumber.set(a.number, []);
    byNumber.get(a.number).push({ d, a });
  }
  const links = new Map();
  for (const v of sales || []) {
    if (!v || !v.address || !v.date) continue;
    const a = parseAddress(v.address);
    if (a.number == null) continue;
    const t = Date.parse(v.date);
    const fits = (byNumber.get(a.number) || [])
      .filter(({ d, a: da }) => {
        if ((da.suffix || null) !== (a.suffix || null) || !sameStreet(da.street, a.street)) return false;
        const days = (t - Date.parse(d.date)) / DAY;
        if (!(days >= 0 && days <= maxDays)) return false;
        return !(d.surface && v.surface && Math.abs(d.surface - v.surface) > surfaceTolerance * v.surface);
      })
      .sort((x, y) => (x.d.date < y.d.date ? 1 : -1));
    const best = pick(fits, v);
    if (best) links.set(v.id, { energyClass: best.d.energyClass, dpeDate: best.d.date, days: Math.round((t - Date.parse(best.d.date)) / DAY) });
  }
  return links;
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

// Prix au m² par classe (10 ventes au moins : médiane et moitié centrale des ventes) et délai
// DPE → vente (10 ventes au moins). Le prix par classe n'est gardé que s'il dit quelque chose
// (spec §7.6) : il baisse de la meilleure classe à la moins bonne, de 5 % au moins en tout.
function energyStats(sales, links) {
  const byClass = {};
  const days = [];
  for (const v of sales || []) {
    const l = links.get(v.id);
    if (!l) continue;
    days.push(l.days);
    if (v.pricePerM2) (byClass[l.energyClass] = byClass[l.energyClass] || []).push(v.pricePerM2);
  }
  const ranked = Object.entries(byClass)
    .filter(([, list]) => list.length >= MIN_CLASS_SALES)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([c, list]) => {
      const s = [...list].sort((a, b) => a - b);
      return [c, { count: s.length, median: median(s), p25: percentile(s, 0.25), p75: percentile(s, 0.75) }];
    });
  const medians = ranked.map(([, st]) => st.median);
  const useful = ranked.length >= 2 && medians.every((m, i) => i === 0 || m <= medians[i - 1]) && medians[0] - medians[medians.length - 1] >= MIN_CLASS_GAP * medians[0];
  const classes = useful ? Object.fromEntries(ranked) : {};
  const sorted = days.sort((a, b) => a - b);
  const delay = sorted.length >= MIN_DELAY_SALES ? { count: sorted.length, median: median(sorted), p25: percentile(sorted, 0.25), p75: percentile(sorted, 0.75) } : null;
  return { byClass: classes, delay };
}

export { linkSalesToDpe, energyStats, MIN_CLASS_SALES, MIN_DELAY_SALES };
