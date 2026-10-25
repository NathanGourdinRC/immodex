// Outil de mise au point : affiche le texte d'une page enregistrée autour d'un motif.
// Usage : node tests/helpers/context.mjs page.html "classe [ée]nergie|kwh" [largeur]
import { readFileSync } from 'node:fs';
import { loadPage } from './dom.mjs';

const [file, pattern, width = '160'] = process.argv.slice(2);
const win = loadPage(readFileSync(file, 'utf8'));
for (const s of win.document.querySelectorAll('script,style,noscript')) s.remove();
const text = win.document.body.textContent.replace(/\s+/g, ' ');
const re = new RegExp(pattern, 'gi');
let m;
let n = 0;
while ((m = re.exec(text)) && n < 8) {
  n++;
  console.log('…' + text.slice(Math.max(0, m.index - 60), m.index + Number(width)) + '…');
}
