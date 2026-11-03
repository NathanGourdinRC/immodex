// Adresse probable d'une annonce scannée : la même recherche dans le registre des DPE de
// l'ADEME que l'extension (valeurs du diagnostic, surface, code postal). L'adresse est posée
// seulement quand une adresse ressort nettement (confiance haute) ; plusieurs appartements d'un
// même immeuble donnent une seule adresse. Sinon, les adresses hésitantes sont gardées comme
// pistes, que Nathan vérifie lui-même (Street View) dans le Fil.
import { runLookup } from '../../src/common/match.js';
import { addressKey } from '../../src/common/listings.js';

const MAX_LEADS = 4;
const SHOWN = 5; // candidats rendus par runLookup (les mieux notés)


// Une piste par adresse (meilleure correspondance d'abord) ; `count` : logements candidats à
// cette adresse.
function leadsOf(candidates) {
  const byAddress = new Map();
  for (const c of candidates || []) {
    const r = c && c.record;
    if (!r || !r.address) continue;
    const k = addressKey(r.address);
    const lead = byAddress.get(k);
    if (lead) {
      lead.count++;
      continue;
    }
    byAddress.set(k, { address: r.address, lat: r.lat ?? null, lon: r.lon ?? null, score: c.score ?? 0, count: 1, surface: r.surface ?? null, date: r.date || null, dpeId: r.id || null, diffs: (c.diffs || []).slice(0, 3) });
  }
  return [...byAddress.values()].sort((a, b) => b.score - a.score);
}

async function addressLookup(listing, { run = runLookup } = {}) {
  // Rien à chercher : réponse définitive, le robot ne recommence pas à chaque passage.
  if (!listing || (!listing.postal && !listing.city)) return { leads: null };
  if (listing.energyConsumption == null && !listing.energyClass) return { leads: null };
  const payload = {
    kind: 'dpe',
    postal: listing.postal || null,
    city: listing.city || null,
    surface: listing.surface ?? null,
    energyClass: listing.energyClass || null,
    gesClass: listing.gesClass || null,
    energyConsumption: listing.energyConsumption ?? null,
    gesEmission: listing.gesEmission ?? null,
    dateRange: listing.dateRange || null,
    buildingType: listing.type === 'appartement' ? 'appartement' : listing.type === 'maison' ? 'maison' : null,
  };
  let r;
  try {
    r = await run(payload);
  } catch {
    // Registre injoignable : pas de réponse, nouvel essai au passage suivant.
    return null;
  }
  const candidates = (r && r.candidates) || [];
  // runLookup avale les erreurs du registre : aucun candidat avec une requête en erreur (ou un
  // code postal non retrouvé) n'est pas une réponse. Nouvel essai au passage suivant.
  if (!candidates.length && r && (r.note === 'code postal introuvable' || (r.tried || []).some((t) => t.error))) return null;
  const leads = leadsOf(candidates);
  const [top, second] = leads;
  // Plusieurs logements d'un même immeuble : mêmes seuils que la recherche (80 points, 20
  // d'avance), comptés par adresse. Seulement pour une adresse avec numéro (des maisons d'une
  // même rue sans numéro ne sont pas un immeuble), et quand une autre adresse a pu être vue :
  // cinq logements du même immeuble remplissent la liste, un sixième ailleurs vaudrait autant.
  const seenOthers = leads.length >= 2 || candidates.length < SHOWN;
  const building = top && /^\d/.test(top.address) && seenOthers && top.score >= 80 && (!second || top.score - second.score >= 20);
  if (top && (r.highConfidence || building)) {
    // Immeuble sûr, logement incertain : pas de DPE attribué au bien.
    const sure = !!r.highConfidence;
    return { address: top.address, lat: top.lat, lon: top.lon, dpeId: sure ? top.dpeId : null, addressConfidence: sure ? 'haute' : 'immeuble', leads: null };
  }
  // Une adresse sans coordonnées ne se vérifie pas sur Street View : pas de piste.
  const kept = leads.filter((l) => l.lat != null && l.lon != null).slice(0, MAX_LEADS);
  return { leads: kept.length ? kept : null };
}

export { addressLookup, leadsOf };
