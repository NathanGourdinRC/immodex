// Ventes DVF et diagnostics énergie (DPE de l'ADEME) reliés par l'adresse : classe énergie de
// chaque maison vendue et délai entre son DPE et l'acte de vente. Le DPE est obligatoire avant
// une mise en vente ; un DPE établi après la vente concerne le nouveau propriétaire.
import { parseAddress, sameStreet, median } from './dvf.js';

const DAY = 24 * 3600 * 1000;
const MIN_CLASS_SALES = 5;
const MIN_DELAY_SALES = 10;

// Même numéro, même suffixe (bis, ter), même rue, DPE au plus `maxDays` avant la vente, surface
// à `surfaceTolerance` près quand les deux sont connues (maisons jumelles) ; le plus récent gagne.
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
    if (fits[0]) links.set(v.id, { energyClass: fits[0].d.energyClass, dpeDate: fits[0].d.date, days: Math.round((t - Date.parse(fits[0].d.date)) / DAY) });
  }
  return links;
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

// Prix au m² médian par classe (5 ventes au moins) et délai DPE → vente (10 ventes au moins).
function energyStats(sales, links) {
  const byClass = {};
  const days = [];
  for (const v of sales || []) {
    const l = links.get(v.id);
    if (!l) continue;
    days.push(l.days);
    if (v.pricePerM2) (byClass[l.energyClass] = byClass[l.energyClass] || []).push(v.pricePerM2);
  }
  const classes = Object.fromEntries(
    Object.entries(byClass)
      .filter(([, list]) => list.length >= MIN_CLASS_SALES)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([c, list]) => [c, { count: list.length, median: median(list) }])
  );
  const sorted = days.sort((a, b) => a - b);
  const delay = sorted.length >= MIN_DELAY_SALES ? { count: sorted.length, median: median(sorted), p25: percentile(sorted, 0.25), p75: percentile(sorted, 0.75) } : null;
  return { byClass: classes, delay };
}

export { linkSalesToDpe, energyStats, MIN_CLASS_SALES, MIN_DELAY_SALES };
