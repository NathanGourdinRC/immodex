// Adresse probable d'une annonce scannée : la même recherche dans le registre des DPE de
// l'ADEME que l'extension (valeurs du diagnostic, surface, code postal), gardée seulement
// quand un logement ressort nettement (confiance haute). Sinon, pas d'adresse.
import { runLookup } from '../../src/common/match.js';

async function addressLookup(listing, { run = runLookup } = {}) {
  if (!listing || (!listing.postal && !listing.city)) return null;
  if (listing.energyConsumption == null && !listing.energyClass) return null;
  const payload = {
    kind: 'dpe',
    postal: listing.postal || null,
    city: listing.city || null,
    surface: listing.surface ?? null,
    energyClass: listing.energyClass || null,
    gesClass: listing.gesClass || null,
    energyConsumption: listing.energyConsumption ?? null,
    gesEmission: listing.gesEmission ?? null,
    buildingType: listing.type === 'appartement' ? 'appartement' : listing.type === 'maison' ? 'maison' : null,
  };
  try {
    const r = await run(payload);
    const best = r && r.highConfidence && r.candidates && r.candidates[0] ? r.candidates[0].record : null;
    if (!best || !best.address) return null;
    return { address: best.address, lat: best.lat ?? null, lon: best.lon ?? null, dpeId: best.id || null, addressConfidence: 'haute' };
  } catch {
    return null;
  }
}

export { addressLookup };
