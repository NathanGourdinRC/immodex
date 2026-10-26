// Outil de mise au point : montre quels éléments d'une page portent une lettre
// de classe (identifiants, classes CSS, attributs, images), pour comprendre d'où
// vient une classe lue. Usage : node tests/helpers/labels-debug.mjs page.html
import { readFileSync } from 'node:fs';
import { loadPage } from './dom.mjs';

const win = loadPage(readFileSync(process.argv[2], 'utf8'));
const doc = win.document;
const show = (label, nodes) => {
  for (const n of nodes) console.log(label, '|', n.tagName, '|', `id=${n.id}`, '|', `class=${n.getAttribute('class')}`, '|', (n.textContent || '').trim().slice(0, 40));
};
show('id', [...doc.querySelectorAll('[id]')].filter((n) => /^(?:dpe|energie|energy|conso|ges|climat|co2)[_-]?[a-g]$/i.test(n.id)));
show('classe', [...doc.querySelectorAll('[class]')].filter((n) => /dpe|energ|conso|ges\b|ges[-_]|climat|diagnostic|co2/i.test(n.getAttribute('class')) && n.getAttribute('class').split(/\s+/).some((t) => /^(?:(?:number|lettre|letter|classe|class|note|grade|niveau|level|rank)[-_]?)?[a-g]$/i.test(t))));
show('actif', [...doc.querySelectorAll('[class*="active"], [class*="selected"], [class*="current"], [aria-current], [class*="highlight"]')].filter((n) => /^[A-G](\b|\s|$)/.test((n.textContent || '').trim()) && (n.textContent || '').trim().length <= 40));
show('data', [...doc.querySelectorAll('[data-energetic-class], [data-energy-class], [data-dpe-class], [data-classe-energie], [data-lettre], [data-letter]')]);
for (const img of doc.querySelectorAll('img')) {
  const file = (img.getAttribute('src') || '').split('?')[0].split('/').pop();
  if (/(dpe|energie|energy|conso|ges|climat|co2)/i.test(file + (img.getAttribute('alt') || ''))) console.log('img |', file, '|', img.getAttribute('alt'));
}
