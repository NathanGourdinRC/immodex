// Envoi des annonces au Fil depuis l'extension (src/background/ingest-client.js) : coupure réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendCards } from '../src/background/ingest-client.js';

// Faux Chrome (clé de synchro présente) et faux fetch qui suit une liste de réponses :
// 'coupure' lève comme un vrai « Failed to fetch », un objet est renvoyé comme réponse du serveur.
function setup(replies) {
  globalThis.chrome = { storage: { local: { get: async () => ({ 'immodex.sync.v1': { key: 'k' } }) } } };
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const next = replies.shift();
    if (next === 'coupure') throw new TypeError('Failed to fetch');
    return { ok: next.status === 200, status: next.status, json: async () => next.body };
  };
  return calls;
}
const OK = { status: 200, body: { ok: true, seen: 3, added: 1 } };
const NO_WAIT = { delays: [0, 0] };

test('une coupure réseau passagère : l’envoi est retenté et réussit', async () => {
  const calls = setup(['coupure', OK]);
  const res = await sendCards({ source: 'leboncoin', cards: [{ url: 'u' }] }, NO_WAIT);
  assert.deepEqual(res, { seen: 3, added: 1, addressed: 0, ignored: 0 });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.body, calls[0].init.body);
});

test('serveur injoignable à chaque essai : message en français, trois essais en tout', async () => {
  const calls = setup(['coupure', 'coupure', 'coupure']);
  await assert.rejects(sendCards({ source: 'leboncoin', cards: [] }, NO_WAIT), /serveur du Fil injoignable/);
  assert.equal(calls.length, 3);
});

test('le serveur répond une erreur : pas de nouvel essai, son message est gardé', async () => {
  const calls = setup([{ status: 401, body: { ok: false, error: 'clé inconnue' } }]);
  await assert.rejects(sendCards({ source: 'leboncoin', cards: [] }, NO_WAIT), /clé inconnue/);
  assert.equal(calls.length, 1);
});
