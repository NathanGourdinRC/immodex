// Outil de mise au point : lance la lecture générique sur des pages HTML
// enregistrées et affiche ce qui est trouvé. Usage : node tests/helpers/run-on-file.mjs fichier.html [...]
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { extract } from './dom.mjs';

for (const file of process.argv.slice(2)) {
  const r = extract(readFileSync(file, 'utf8'));
  const { found, ...fields } = r;
  console.log(`\n# ${basename(file)}`);
  console.log(JSON.stringify(fields));
  console.log('sources:', JSON.stringify(found));
}
