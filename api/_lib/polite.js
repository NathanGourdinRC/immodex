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

function createPoliteFetcher({ fetchImpl = fetch, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), delayMs = 5000, hostDelays = {}, userAgent = UA, timeoutMs = 15000 } = {}) {
  const hosts = new Map(); // hôte → { queue, lastAt }
  const robots = new Map(); // origine → promesse de { status, text } de robots.txt
  const refused = new Set(); // hôtes qui ont refusé le robot pendant ce passage

  // Une requête à la fois par hôte, avec la pause imposée depuis la précédente.
  function onHost(host, task) {
    const h = hosts.get(host) || { queue: Promise.resolve(), lastAt: null };
    hosts.set(host, h);
    const run = h.queue.then(async () => {
      if (h.lastAt != null) {
        const wait = h.lastAt + (hostDelays[host] || delayMs) - now();
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
    if (!robots.has(u.origin)) robots.set(u.origin, onHost(u.host, () => raw(`${u.origin}/robots.txt`)));
    return robots.get(u.origin);
  }

  // Règles de robots.txt (RFC 9309) : fichier absent (4xx) = tout permis ; site injoignable
  // ou en erreur (5xx, délai dépassé) = rien n'est lu sur ce site pendant ce passage.
  function robotsVerdict(r, u) {
    if (r.ok) return robotsAllows(r.html, u.pathname + u.search);
    return r.status >= 400 && r.status < 500;
  }

  const refusal = { ok: false, status: 0, html: '', blocked: true, disallowed: false };

  // `deadline` : au-delà, la page n'est pas demandée (elle attendait peut-être son tour).
  async function get(url, { deadline = null } = {}) {
    const u = new URL(url);
    if (refused.has(u.host)) return refusal;
    if (!robotsVerdict(await robotsOf(u), u)) return { ok: false, status: 0, html: '', blocked: false, disallowed: true };
    const r = await onHost(u.host, async () => {
      if (refused.has(u.host)) return null;
      if (deadline != null && now() >= deadline) return { late: true };
      return raw(url);
    });
    if (!r) return refusal;
    if (r.late) return { ok: false, status: 0, html: '', blocked: false, disallowed: false, late: true };
    const blocked = r.status === 403 || r.status === 429 || BLOCK_MARKS.test(r.html.slice(0, 20000));
    // Un refus arrête le robot sur ce site pour tout le passage.
    if (blocked) refused.add(u.host);
    return { ...r, ok: r.ok && !blocked, blocked, disallowed: false };
  }

  return { get, refusedHosts: () => [...refused] };
}

export { UA, createPoliteFetcher, robotsAllows };
