// Robot poli du scan : il dit qui il est, lit et respecte robots.txt, ne demande jamais deux
// pages d'un même site à moins de 5 secondes d'écart, et repère un refus ou un anti-robot
// (la source est alors mise en pause, jamais contournée).

const UA = 'ImmodexPlus/1.0 (+https://immodex.vercel.app ; usage personnel)';
const BLOCK_MARKS = /captcha-delivery|datadome|cf-chl|just a moment/i;

// Règle de robots.txt en expression régulière : « * » n'importe quoi, « $ » fin d'adresse.
function ruleRegex(path) {
  const escaped = path.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped.endsWith('\\$') ? `${escaped.slice(0, -2)}$` : escaped}`);
}

// Groupe « ImmodexPlus » s'il existe, sinon « * » ; la règle la plus longue gagne, Allow à égalité.
function robotsAllows(txt, pathAndQuery) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && value) current.rules.push({ allow: key === 'allow', path: value });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a === 'immodexplus' || a.startsWith('immodexplus/')));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  let best = null;
  for (const r of rules) {
    if (!ruleRegex(r.path).test(pathAndQuery)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

function createPoliteFetcher({ fetchImpl = fetch, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), delayMs = 5000, userAgent = UA, timeoutMs = 20000 } = {}) {
  const hosts = new Map(); // hôte → { queue, lastAt }
  const robots = new Map(); // origine → promesse du texte de robots.txt

  // Une requête à la fois par hôte, avec la pause imposée depuis la précédente.
  function onHost(host, task) {
    const h = hosts.get(host) || { queue: Promise.resolve(), lastAt: null };
    hosts.set(host, h);
    const run = h.queue.then(async () => {
      if (h.lastAt != null) {
        const wait = h.lastAt + delayMs - now();
        if (wait > 0) await sleep(wait);
      }
      try {
        return await task();
      } finally {
        h.lastAt = now();
      }
    });
    h.queue = run.catch(() => {});
    return run;
  }

  async function raw(url) {
    try {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': userAgent, 'Accept-Language': 'fr-FR,fr;q=0.9' },
        redirect: 'follow',
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
      });
      return { ok: res.ok, status: res.status, html: await res.text() };
    } catch {
      return { ok: false, status: 0, html: '' };
    }
  }

  function robotsOf(u) {
    if (!robots.has(u.origin)) robots.set(u.origin, onHost(u.host, () => raw(`${u.origin}/robots.txt`)).then((r) => (r.ok ? r.html : '')));
    return robots.get(u.origin);
  }

  async function get(url) {
    const u = new URL(url);
    if (!robotsAllows(await robotsOf(u), u.pathname + u.search)) return { ok: false, status: 0, html: '', blocked: false, disallowed: true };
    const r = await onHost(u.host, () => raw(url));
    const blocked = r.status === 403 || r.status === 429 || BLOCK_MARKS.test(r.html.slice(0, 20000));
    return { ...r, ok: r.ok && !blocked, blocked, disallowed: false };
  }

  return { get };
}

export { UA, createPoliteFetcher, robotsAllows };
