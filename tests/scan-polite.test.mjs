import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPoliteFetcher, robotsAllows, UA } from '../api/_lib/polite.js';

// Horloge simulée : sleep avance le temps sans attendre vraiment.
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

function fakeWeb(pages, clock) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, at: clock.now(), ua: init && init.headers && init.headers['User-Agent'] });
    const page = pages[url];
    if (page == null) return { ok: false, status: 404, text: async () => '' };
    if (typeof page === 'number') return { ok: false, status: page, text: async () => '' };
    return { ok: true, status: 200, text: async () => page };
  };
  return { fetchImpl, calls };
}

test('deux pages du même site : au moins 5 s d’écart ; deux sites en parallèle', async () => {
  const clock = fakeClock();
  const web = fakeWeb({ 'https://a.fr/1': 'un', 'https://a.fr/2': 'deux', 'https://b.fr/1': 'trois' }, clock);
  const f = createPoliteFetcher({ fetchImpl: web.fetchImpl, now: clock.now, sleep: clock.sleep });
  const [a1, a2, b1] = await Promise.all([f.get('https://a.fr/1'), f.get('https://a.fr/2'), f.get('https://b.fr/1')]);
  assert.deepEqual([a1.html, a2.html, b1.html], ['un', 'deux', 'trois']);
  const times = (host) => web.calls.filter((c) => c.url.startsWith(host)).map((c) => c.at);
  const a = times('https://a.fr');
  assert.equal(a.length, 3); // robots.txt, puis les deux pages
  for (let i = 1; i < a.length; i++) assert.ok(a[i] - a[i - 1] >= 5000, `écart ${a[i] - a[i - 1]} ms`);
  assert.ok(web.calls.every((c) => c.ua === UA));
  assert.match(UA, /^ImmodexPlus\/1\.0 \(\+https:\/\/immodex\.vercel\.app ; usage personnel\)$/);
});

test('page interdite par robots.txt : jamais demandée', async () => {
  const clock = fakeClock();
  const web = fakeWeb({ 'https://a.fr/robots.txt': 'User-agent: *\nDisallow: /prive/\nAllow: /prive/ok', 'https://a.fr/prive/x': 'secret', 'https://a.fr/prive/ok': 'ok' }, clock);
  const f = createPoliteFetcher({ fetchImpl: web.fetchImpl, now: clock.now, sleep: clock.sleep });
  const r = await f.get('https://a.fr/prive/x');
  assert.equal(r.disallowed, true);
  assert.ok(!web.calls.some((c) => c.url === 'https://a.fr/prive/x'));
  assert.equal((await f.get('https://a.fr/prive/ok')).html, 'ok');
});

test('règles de robots.txt : jokers, fin d’adresse, groupe du robot', () => {
  const txt = 'User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /annonces-immobilieres-*/*-pieces/\nAllow: /annonces-immobilieres-*/fi/*-pieces/\nDisallow: /*.pdf$';
  assert.equal(robotsAllows(txt, '/annonces-immobilieres-wambrechies/vente-maison/'), true);
  assert.equal(robotsAllows(txt, '/annonces-immobilieres-wambrechies/5-pieces/'), false);
  assert.equal(robotsAllows(txt, '/annonces-immobilieres-wambrechies/fi/5-pieces/'), true);
  assert.equal(robotsAllows(txt, '/doc.pdf'), false);
  assert.equal(robotsAllows(txt, '/doc.pdf?x=1'), true);
  assert.equal(robotsAllows('User-agent: ImmodexPlus\nDisallow: /', '/x'), false);
  assert.equal(robotsAllows('', '/x'), true);
});

test('robots.txt absent : tout est permis ; anti-robot et refus repérés', async () => {
  const clock = fakeClock();
  const web = fakeWeb({ 'https://a.fr/x': '<html>captcha-delivery.com</html>', 'https://b.fr/x': 403, 'https://c.fr/x': '<html>Annonces</html>' }, clock);
  const f = createPoliteFetcher({ fetchImpl: web.fetchImpl, now: clock.now, sleep: clock.sleep });
  assert.equal((await f.get('https://a.fr/x')).blocked, true);
  assert.equal((await f.get('https://b.fr/x')).blocked, true);
  const ok = await f.get('https://c.fr/x');
  assert.deepEqual([ok.ok, ok.blocked, ok.disallowed], [true, false, false]);
});

test('erreur réseau : réponse en échec, sans planter', async () => {
  const clock = fakeClock();
  const f = createPoliteFetcher({ fetchImpl: async () => { throw new Error('ECONNRESET'); }, now: clock.now, sleep: clock.sleep });
  const r = await f.get('https://a.fr/x');
  assert.equal(r.ok, false);
  assert.equal(r.status, 0);
});
