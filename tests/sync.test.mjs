import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSync, PUSH_SCRIPT, HttpError } from '../api/sync.js';
import { createSync, mergeSighting, hashOf, keyFromHash, pairUrl, newKey, SYNC_STATE_KEY } from '../src/common/sync.js';
import { ZONES_KEY, TRACKING_KEY } from '../src/common/zones.js';
import { SIGHTINGS_KEY } from '../src/common/properties.js';
import { HISTORY_KEY } from '../src/common/history.js';

// Faux Upstash : les commandes utilisées par api/sync.js, et le script d'écriture rejoué en JS.
function fakeRedis() {
  let hashes = new Map();
  let zsets = new Map();
  let strings = new Map();
  const h = (k) => hashes.get(k) || hashes.set(k, new Map()).get(k);
  const z = (k) => zsets.get(k) || zsets.set(k, new Map()).get(k);
  const exec = ([cmd, ...a]) => {
    if (cmd === 'HLEN') return h(a[0]).size;
    if (cmd === 'HMGET') return a.slice(1).map((f) => h(a[0]).get(f) ?? null);
    if (cmd === 'GET') return strings.get(a[0]) ?? null;
    if (cmd === 'ZRANGEBYSCORE') {
      const lo = Number(a[1].replace('(', ''));
      const limit = Number(a[a.indexOf('LIMIT') + 2]);
      return [...z(a[0])]
        .filter(([, s]) => s > lo)
        .sort((x, y) => x[1] - y[1])
        .slice(0, limit)
        .flatMap(([f, s]) => [f, String(s)]);
    }
    if (cmd === 'EVAL') {
      assert.equal(a[0], PUSH_SCRIPT);
      const n = Number(a[1]);
      const [items, ts, log, rev] = a.slice(2, 2 + n);
      const argv = a.slice(2 + n);
      const out = [];
      for (let i = 0; i < argv.length; i += 3) {
        if (Number(argv[i + 1]) > Number(h(ts).get(argv[i]) ?? -1)) {
          const r = Number(strings.get(rev) || 0) + 1;
          strings.set(rev, String(r));
          h(items).set(argv[i], argv[i + 2]);
          h(ts).set(argv[i], argv[i + 1]);
          z(log).set(argv[i], r);
          out.push(argv[i], r);
        }
      }
      return out;
    }
    throw new Error(`commande inattendue ${cmd}`);
  };
  return {
    command: async (args) => exec(args),
    pipeline: async (cmds) => cmds.map(exec),
    wipe() {
      hashes = new Map();
      zsets = new Map();
      strings = new Map();
    },
  };
}

function fakeServer() {
  const redis = fakeRedis();
  let calls = 0;
  const fetchImpl = async (url, opts) => {
    calls++;
    try {
      const body = await handleSync({ syncKey: opts.headers.Authorization.replace('Bearer ', ''), body: JSON.parse(opts.body), redis });
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
    } catch (e) {
      return { ok: false, status: e.status || 500, json: async () => ({ ok: false, error: e.message }) };
    }
  };
  return { redis, fetchImpl, calls: () => calls };
}

// Équivalent de chrome.storage.local : copies JSON, comme le vrai.
function memArea(initial = {}) {
  let data = JSON.parse(JSON.stringify(initial));
  return {
    async get(keys) {
      const list = typeof keys === 'string' ? [keys] : keys;
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, JSON.parse(JSON.stringify(data[k]))]));
    },
    async set(obj) {
      data = { ...data, ...JSON.parse(JSON.stringify(obj)) };
    },
    dump: () => data,
  };
}

let clock = Date.now() - 60 * 60 * 1000;
const tick = () => (clock += 1000);
const device = (server, initial) => {
  const storage = memArea(initial);
  return { storage, sync: createSync({ storage, fetchImpl: server.fetchImpl, now: tick }) };
};

const zone = (id, name, updatedAt) => ({ id, name, communes: [], type: null, surfaceMin: null, surfaceMax: null, createdAt: updatedAt, updatedAt, lastVisit: null });
const sighting = (url, prices, lastSeen) => ({ url, site: 'agence.fr', title: 'Maison', fp: { postal: '74320', surface: 95 }, firstSeen: prices[0].at, lastSeen, prices });

test('un téléphone qui rejoint l’espace reçoit les données de l’extension', async () => {
  const server = fakeServer();
  const t = clock;
  const pc = device(server, {
    [ZONES_KEY]: [{ ...zone('z1', 'Sévrier', t), lastVisit: t }],
    [TRACKING_KEY]: { 'https://a.fr/1': { status: 'favori', note: 'vue mer', updatedAt: t } },
    [SIGHTINGS_KEY]: [sighting('https://a.fr/1', [{ price: 650000, at: t }], t)],
    [HISTORY_KEY]: [{ id: 'h1', key: 'https://a.fr/1#dpe|74320', createdAt: t, kind: 'dpe', payload: {}, result: null, page: null }],
  });
  const { pairUrl: link } = await pc.sync.enable();
  assert.equal((await pc.sync.sync()).sent, 4);

  const phone = device(server);
  await phone.sync.enable(keyFromHash(new URL(link).hash));
  const r = await phone.sync.sync();
  assert.equal(r.ok, true);
  assert.equal(r.applied, 4);
  assert.equal(r.sent, 0);
  const got = phone.storage.dump();
  assert.equal(got[ZONES_KEY][0].name, 'Sévrier');
  assert.equal(got[ZONES_KEY][0].lastVisit, null, 'la dernière visite reste sur l’ordinateur');
  assert.equal(got[TRACKING_KEY]['https://a.fr/1'].note, 'vue mer');
  assert.equal(got[SIGHTINGS_KEY][0].prices[0].price, 650000);
  assert.equal(got[HISTORY_KEY][0].id, 'h1');
  // Rien n'a changé : la synchro suivante n'envoie rien.
  assert.equal((await phone.sync.sync()).sent, 0);
  assert.equal((await pc.sync.sync()).sent, 0);
});

test('modification et suppression passent d’un appareil à l’autre', async () => {
  const server = fakeServer();
  const z1 = zone('z1', 'Sévrier', clock);
  const pc = device(server, { [ZONES_KEY]: [z1, zone('z2', 'Duingt', clock)] });
  const { pairUrl: link } = await pc.sync.enable();
  await pc.sync.sync();
  const phone = device(server);
  await phone.sync.enable(keyFromHash(new URL(link).hash));
  await phone.sync.sync();

  // Note prise sur le téléphone après une visite.
  await phone.storage.set({ [TRACKING_KEY]: { 'https://a.fr/1': { status: 'visite', note: 'humidité au sous-sol', updatedAt: tick() } } });
  assert.equal((await phone.sync.sync()).sent, 1);
  // Zone supprimée sur l'ordinateur.
  await pc.storage.set({ [ZONES_KEY]: [z1] });
  const r = await pc.sync.sync();
  assert.equal(r.applied, 1);
  assert.equal(r.sent, 1);
  assert.equal(pc.storage.dump()[TRACKING_KEY]['https://a.fr/1'].note, 'humidité au sous-sol');

  await phone.sync.sync();
  assert.deepEqual(phone.storage.dump()[ZONES_KEY].map((z) => z.id), ['z1']);
});

test('une même annonce vue sur les deux appareils : prix réunis, puis plus rien à envoyer', async () => {
  const server = fakeServer();
  const t = clock;
  const pc = device(server, { [SIGHTINGS_KEY]: [sighting('https://a.fr/1', [{ price: 700000, at: t }], t)] });
  const { pairUrl: link } = await pc.sync.enable();
  const phone = device(server, { [SIGHTINGS_KEY]: [sighting('https://a.fr/1', [{ price: 690000, at: t + 5000 }], t + 5000)] });
  await phone.sync.enable(keyFromHash(new URL(link).hash));

  await pc.sync.sync();
  await phone.sync.sync();
  await pc.sync.sync();
  const prices = (dev) => dev.storage.dump()[SIGHTINGS_KEY][0].prices.map((p) => p.price);
  assert.deepEqual(prices(pc), [700000, 690000]);
  assert.deepEqual(prices(phone), [700000, 690000]);
  assert.equal(pc.storage.dump()[SIGHTINGS_KEY][0].firstSeen, t);
  assert.equal((await phone.sync.sync()).sent, 0);
  assert.equal((await pc.sync.sync()).sent, 0);
});

test('conflit : la modification la plus récente gagne, même faite hors connexion', async () => {
  const server = fakeServer();
  const pc = device(server);
  const { pairUrl: link } = await pc.sync.enable();
  const phone = device(server);
  await phone.sync.enable(keyFromHash(new URL(link).hash));
  const url = 'https://a.fr/1';

  await pc.storage.set({ [TRACKING_KEY]: { [url]: { status: 'a-voir', note: 'ordinateur', updatedAt: tick() } } });
  // Le téléphone modifie après, sans réseau ; l'ordinateur synchronise avant lui.
  await phone.storage.set({ [TRACKING_KEY]: { [url]: { status: 'ecarte', note: 'téléphone', updatedAt: tick() } } });
  await pc.sync.sync();
  await phone.sync.sync();
  await pc.sync.sync();
  assert.equal(pc.storage.dump()[TRACKING_KEY][url].note, 'téléphone');
  assert.equal(phone.storage.dump()[TRACKING_KEY][url].note, 'téléphone');
});

test('serveur vidé : l’appareil s’en aperçoit et renvoie tout', async () => {
  const server = fakeServer();
  const pc = device(server, { [ZONES_KEY]: [zone('z1', 'Sévrier', clock)] });
  await pc.sync.enable();
  await pc.sync.sync();
  await pc.storage.set({ [ZONES_KEY]: [zone('z1', 'Sévrier', clock), zone('z2', 'Duingt', tick())] });
  await pc.sync.sync();
  server.redis.wipe();
  const r = await pc.sync.sync();
  assert.equal(r.ok, true);
  assert.equal(r.sent, 2);
});

test('synchro non activée : aucun appel au serveur ; options de déclenchement', async () => {
  const server = fakeServer();
  const pc = device(server, { [ZONES_KEY]: [zone('z1', 'Sévrier', clock)] });
  assert.deepEqual(await pc.sync.sync(), { ok: false, paired: false });
  assert.equal(server.calls(), 0);
  await pc.sync.enable();
  await pc.sync.sync();
  const before = server.calls();
  assert.equal((await pc.sync.sync({ ifLocalChanges: true })).skipped, true);
  assert.equal((await pc.sync.sync({ minAgeMs: 60_000 })).skipped, true);
  assert.equal(server.calls(), before);
  await pc.sync.disable();
  assert.equal((await pc.sync.status()).paired, false);
  assert.ok(pc.storage.dump()[ZONES_KEY], 'les données restent après l’arrêt');
});

test('erreur réseau : message lisible, état gardé pour la fois suivante', async () => {
  const storage = memArea();
  const sync = createSync({ storage, fetchImpl: async () => Promise.reject(new TypeError('Failed to fetch')) });
  await sync.enable();
  const r = await sync.sync();
  assert.equal(r.ok, false);
  assert.equal(r.error, 'pas de connexion au serveur');
  assert.equal((await sync.status()).lastError, 'pas de connexion au serveur');
  assert.ok(storage.dump()[SYNC_STATE_KEY].key);
});

test('fusion d’annonces indépendante de l’ordre', () => {
  const a = { ...sighting('u', [{ price: 1, at: 1 }], 10), dpeId: 'X' };
  const b = { ...sighting('u', [{ price: 2, at: 5 }], 20), fp: { postal: '74320', surface: 95, energyClass: 'C' } };
  assert.equal(hashOf(mergeSighting(a, b)), hashOf(mergeSighting(b, a)));
  const m = mergeSighting(a, b);
  assert.equal(m.dpeId, 'X');
  assert.equal(m.fp.energyClass, 'C');
  assert.equal(m.lastSeen, 20);
  assert.equal(hashOf(mergeSighting(a, a)), hashOf(a), 'fusionner une annonce avec elle-même ne la change pas');
});

test('lien d’appairage et clé', () => {
  const key = newKey();
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(keyFromHash(new URL(pairUrl(key)).hash), key);
  assert.equal(keyFromHash('#zone=z1'), null);
});

test('serveur : clé, type et taille des lots contrôlés', async () => {
  const redis = fakeRedis();
  const key = newKey();
  await assert.rejects(handleSync({ syncKey: 'court', body: {}, redis }), (e) => e instanceof HttpError && e.status === 401);
  await assert.rejects(handleSync({ syncKey: key, body: { items: [{ kind: 'autre', key: 'x', updated_at: 1 }] }, redis }), (e) => e.status === 400);
  await assert.rejects(handleSync({ syncKey: key, body: { items: [{ kind: 'zone', key: 'x', updated_at: Date.now() + 3 * 864e5 }] }, redis }), (e) => e.status === 400);
  const many = Array.from({ length: 201 }, (_, i) => ({ kind: 'zone', key: `z${i}`, data: {}, updated_at: 1 }));
  await assert.rejects(handleSync({ syncKey: key, body: { items: many }, redis }), (e) => e.status === 413);
});
