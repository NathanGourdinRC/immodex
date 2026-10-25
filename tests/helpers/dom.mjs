// Charge une page HTML dans jsdom puis y exécute les scripts d'extraction de
// l'extension, comme Chrome le fait quand « Analyser cette page » est cliqué.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPTS = ['src/common/extract.js', 'src/common/generic-extract.js'].map((p) => readFileSync(root + p, 'utf8'));

export function loadPage(html, url = 'https://www.agence-exemple.fr/annonce/123') {
  // Les erreurs CSS ou de scripts de la page enregistrée ne concernent pas le test.
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', virtualConsole });
  // jsdom ne fournit pas TextDecoder (Chrome oui) : on prête celui de Node.
  dom.window.TextDecoder = TextDecoder;
  for (const code of SCRIPTS) dom.window.eval(code);
  return dom.window;
}

export function extract(html, url) {
  const win = loadPage(html, url);
  return win.__immodexGeneric.extractFromDocument(win.document);
}

export function fixture(name) {
  return readFileSync(root + 'tests/fixtures/' + name, 'utf8');
}
