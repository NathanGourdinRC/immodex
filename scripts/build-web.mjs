// Construit l'appli téléphone (dist-web/) pour Vercel : les pages de l'extension (src/, sans
// les scripts injectés dans les annonces), copiées telles quelles, plus l'adaptateur web
// (web/platform/) ajouté en tête de chaque page. Aucune dépendance, aucune compilation.
//
// Usage :  node scripts/build-web.mjs
// Sortie : dist-web/
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}dist-web`;
const { version } = JSON.parse(readFileSync(`${root}manifest.json`, 'utf8'));
const build = `${version}-${Date.now().toString(36)}`;

rmSync(out, { recursive: true, force: true });
cpSync(`${root}web`, out, { recursive: true });
cpSync(`${root}src`, `${out}/src`, { recursive: true, filter: (path) => !/[\\/]src[\\/]content([\\/]|$)/.test(path) });
cpSync(`${root}icons`, `${out}/icons`, { recursive: true });

// En tête de chaque page : réglages téléphone, pas d'indexation (DVF), adaptateur web en premier.
const head = [
  '<meta name="viewport" content="width=device-width, initial-scale=1" />',
  '<meta name="robots" content="noindex, nofollow" />',
  '<meta name="theme-color" content="#1d4ed8" />',
  `<meta name="immodex-version" content="${version}" />`,
  '<link rel="manifest" href="/manifest.webmanifest" />',
  '<link rel="icon" href="/icons/icon-small.svg" type="image/svg+xml" />',
  '<link rel="apple-touch-icon" href="/icons/192.png" />',
  '<link rel="stylesheet" href="/platform/web.css" />',
  '<script src="/platform/chrome-shim.js"></script>',
].join('\n    ');
for (const page of ['popup/popup.html', 'dashboard/dashboard.html', 'map/map.html']) {
  const file = `${out}/src/${page}`;
  const html = readFileSync(file, 'utf8');
  if (!html.includes('<meta charset="utf-8" />')) throw new Error(`${page} : balise charset introuvable`);
  writeFileSync(file, html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    ${head}`));
}

const sw = `${out}/sw.js`;
writeFileSync(sw, readFileSync(sw, 'utf8').replace("'immodex-__BUILD__'", `'immodex-${build}'`));
console.log(`✓ dist-web/ prêt (version ${build})`);
