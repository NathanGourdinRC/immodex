// Icônes PNG de l'appli téléphone (192 et 512 px), tirées de icons/icon-large.svg :
// Chrome Android en a besoin pour proposer « Ajouter à l'écran d'accueil ».
//
// Usage :  node scripts/make-app-icons.mjs   (à relancer seulement si l'icône change)
// Sortie : icons/192.png, icons/512.png
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const svg = readFileSync(`${root}icons/icon-large.svg`, 'utf8');

const browser = await chromium.launch({ channel: 'chromium' });
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: `${root}icons/${size}.png`, omitBackground: true });
  await page.close();
}
await browser.close();
console.log('✓ icons/192.png, icons/512.png');
