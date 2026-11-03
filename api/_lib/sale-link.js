// Lien entre une annonce retirée par le robot et sa vente DVF (spec §7.5). L'adresse probable
// de l'annonce vient de son DPE ; sans elle, aucun lien. Sûr : une seule vente à cette adresse,
// du même type et de surface à 15 % près (un immeuble a plusieurs logements). Probable : une
// seule vente dans la même rue, de même type, de surface à 5 % près et de terrain proche,
// 1 à 12 mois après le retrait. Jamais présenté comme certain quand il est probable ; aucun
// lien en cas de doute.
import { parseAddress, sameStreet } from '../../src/common/dvf.js';

const DAY = 24 * 3600 * 1000;
const MIN_DAYS = 30;
const MAX_DAYS = 365;
const TYPES = { maison: 'Maison', appartement: 'Appartement' };

const close = (a, b, ratio) => a == null || b == null || Math.abs(a - b) <= ratio * Math.max(a, b);

function sameAddress(a, b) {
  return a.number != null && a.number === b.number && (a.suffix || null) === (b.suffix || null) && sameStreet(a.street, b.street);
}

function matchSale(listing, sales) {
  if (!listing || !listing.removedAt || !listing.address) return null;
  const at = parseAddress(listing.address);
  if (!at.street.length) return null;
  const wanted = TYPES[listing.type];
  const inWindow = (sales || []).filter((v) => {
    if (!v.date || v.commune !== listing.insee || (wanted && v.type !== wanted)) return false;
    const days = (Date.parse(v.date) - listing.removedAt) / DAY;
    return days >= MIN_DAYS && days <= MAX_DAYS;
  });
  const result = (v, how) => ({ id: v.id, date: v.date, price: v.price, pricePerM2: v.pricePerM2, how });
  const withAddress = inWindow.map((v) => ({ v, a: parseAddress(v.address) }));
  const sure = withAddress.filter(({ v, a }) => sameAddress(at, a) && close(listing.surface, v.surface, 0.15));
  if (sure.length === 1) return result(sure[0].v, 'sure');
  const probable = withAddress.filter(({ v, a }) => sameStreet(at.street, a.street) && listing.surface && v.surface && close(listing.surface, v.surface, 0.05) && close(listing.terrain, v.terrain, 0.15));
  return probable.length === 1 ? result(probable[0].v, 'probable') : null;
}

export { matchSale };
