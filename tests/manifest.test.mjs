import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const annecy = JSON.parse(readFileSync(new URL('../docs/agences-annecy.json', import.meta.url), 'utf8'));
const patterns = manifest.content_scripts.flatMap((c) => c.matches);

// Motif Chrome → expression régulière (« https://*.agence.fr/* » couvre agence.fr et www.agence.fr).
function matches(pattern, url) {
  const m = pattern.match(/^(https?|\*):\/\/(\*|\*\.[^/]+|[^/*]+)(\/.*)$/);
  if (!m) return false;
  const u = new URL(url);
  if (m[1] !== '*' && `${m[1]}:` !== u.protocol) return false;
  const host = m[2];
  const hostOk = host === '*' || (host.startsWith('*.') ? u.hostname === host.slice(2) || u.hostname.endsWith(host.slice(1)) : u.hostname === host);
  const path = new RegExp(`^${m[3].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return hostOk && path.test(u.pathname + u.search);
}

test('manifeste : motifs valides et sans doublon', () => {
  for (const p of patterns) assert.match(p, /^(https?|\*):\/\/(\*|\*\.[^/*]+|[^/*]+)\/.*$/, p);
  const generic = manifest.content_scripts[manifest.content_scripts.length - 1].matches;
  assert.equal(new Set(generic).size, generic.length);
});

test('agences du lac d’Annecy : chaque site retenu a le bouton, avec ou sans « www »', () => {
  assert.ok(annecy.retenus.length >= 80);
  for (const a of annecy.retenus) {
    for (const url of [`https://${a.domaine}/annonce/1`, `https://www.${a.domaine}/annonce/1`]) {
      assert.ok(patterns.some((p) => matches(p, url)), `${a.nom} : ${url}`);
    }
    if (a.exemple) assert.ok(patterns.some((p) => matches(p, a.exemple)), `${a.nom} : ${a.exemple}`);
  }
});

test('sites écartés (anti-robot, injoignables, hors sujet) absents du manifeste', () => {
  for (const e of annecy.ecartes) {
    assert.ok(!patterns.some((p) => matches(p, `https://www.${e.domaine}/annonce/1`)), e.domaine);
  }
});
