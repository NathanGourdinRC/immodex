// Construit l'appli téléphone (dist-web/) pour Vercel : les pages de web/ plus les modules
// partagés avec l'extension (src/common), copiés tels quels, sans dépendance.
//
// Usage :  node scripts/build-web.mjs
// Sortie : dist-web/
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}dist-web`;

rmSync(out, { recursive: true, force: true });
cpSync(`${root}web`, out, { recursive: true });
cpSync(`${root}src/common`, `${out}/common`, { recursive: true });
cpSync(`${root}icons`, `${out}/icons`, { recursive: true });
console.log('✓ dist-web/ prêt');
