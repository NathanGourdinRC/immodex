// Lien entre une annonce retirée par le robot et sa vente DVF (spec §7.5) : sûr si l'adresse
// probable de l'annonce (retrouvée par son DPE) est celle de la vente ; probable si une seule
// vente de même type, de surface à 5 % près et de terrain proche paraît 1 à 12 mois après le
// retrait. Jamais présenté comme certain quand il est probable ; aucun lien en cas de doute.
import { parseAddress, sameStreet } from '../../src/common/dvf.js';

const DAY = 24 * 3600 * 1000;
const MIN_DAYS = 30;
const MAX_DAYS = 365;
const TYPES = { maison: 'Maison', appartement: 'Appartement' };

const close = (a, b, ratio) => a == null || b == null || Math.abs(a - b) <= ratio * Math.max(a, b);

function sameAddress(listingAddress, saleAddress) {
  if (!listingAddress || !saleAddress) return false;
  const a = parseAddress(listingAddress);
  const b = parseAddress(saleAddress);
  return a.number != null && a.number === b.number && (a.suffix || null) === (b.suffix || null) && sameStreet(a.street, b.street);
}

function matchSale(listing, sales) {
  if (!listing || !listing.removedAt) return null;
  const inWindow = (sales || []).filter((v) => {
    if (!v.date || v.commune !== listing.insee) return false;
    const days = (Date.parse(v.date) - listing.removedAt) / DAY;
    return days >= MIN_DAYS && days <= MAX_DAYS;
  });
  const result = (v, how) => ({ date: v.date, price: v.price, pricePerM2: v.pricePerM2, how });
  const sure = inWindow.find((v) => sameAddress(listing.address, v.address));
  if (sure) return result(sure, 'sure');
  const wanted = TYPES[listing.type];
  const probable = inWindow.filter((v) => (!wanted || v.type === wanted) && listing.surface && v.surface && close(listing.surface, v.surface, 0.05) && close(listing.terrain, v.terrain, 0.15));
  return probable.length === 1 ? result(probable[0], 'probable') : null;
}

export { matchSale };
