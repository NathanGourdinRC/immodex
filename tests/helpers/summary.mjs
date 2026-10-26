// Outil de mise au point : lit toutes les pages HTML d'un ou plusieurs dossiers
// et affiche une ligne par page (code postal, ville, surface, classes, valeurs, date).
// Usage : node tests/helpers/summary.mjs <dossier> [<dossier> ...]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extract } from './dom.mjs';

const pad = (v, n) => String(v ?? '·').slice(0, n).padEnd(n);
let complete = 0;
let total = 0;
for (const dir of process.argv.slice(2)) {
  // Adresse réelle de chaque annonce (agences.json des recherches), pour lire la ville dans l'URL.
  const urls = {};
  try {
    for (const a of JSON.parse(readFileSync(join(dir, 'agences.json'), 'utf8'))) urls[a.domaine] = a.urlAnnonce;
  } catch {
    // pas de liste : adresse par défaut
  }
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.html')).sort()) {
    let r;
    try {
      // Les pages ImmoFacile sont en ISO-8859-1 : on suit le charset déclaré.
      const buf = readFileSync(join(dir, f));
      const head = buf.subarray(0, 3000).toString('latin1');
      const latin = /charset=["']?(iso-8859-1|windows-1252)/i.test(head);
      r = extract(buf.toString(latin ? 'latin1' : 'utf8'), urls[f.replace(/\.html$/, '')]);
    } catch (e) {
      console.log(`${pad(f.replace(/\.html$/, ''), 38)} ERREUR ${e.message}`);
      continue;
    }
    total++;
    const ok = (r.postal || r.city) && r.surface && (r.energyClass || r.energyConsumption);
    if (ok) complete++;
    const date = r.dateRange ? r.dateRange.gte : null;
    console.log(
      `${ok ? '✓' : '·'} ${pad(f.replace(/\.html$/, ''), 36)} ${pad(r.postal, 5)} ${pad(r.city, 16)} ${pad(r.surface, 4)} ${pad(r.energyClass, 1)}/${pad(r.gesClass, 1)} ${pad(r.energyConsumption, 4)} ${pad(r.gesEmission, 3)} ${pad(date, 10)}`
    );
  }
}
console.log(`\n${complete}/${total} lectures complètes (localisation + surface + classe ou consommation)`);
