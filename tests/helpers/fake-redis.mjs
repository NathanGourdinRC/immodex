// Faux Upstash pour les tests du scan : les commandes Redis utilisées par api/_lib/scan-*.js.
export function fakeRedis() {
  const strings = new Map();
  const hashes = new Map();
  const zsets = new Map();
  const lists = new Map();
  const h = (k) => hashes.get(k) || hashes.set(k, new Map()).get(k);
  const z = (k) => zsets.get(k) || zsets.set(k, new Map()).get(k);
  const l = (k) => lists.get(k) || lists.set(k, []).get(k);
  const glob = (pattern) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  const exec = ([cmd, ...a]) => {
    switch (cmd) {
      case 'GET':
        return strings.get(a[0]) ?? null;
      case 'SET':
        strings.set(a[0], String(a[1]));
        return 'OK';
      case 'DEL':
        return a.reduce((n, k) => n + [strings, hashes, zsets, lists].filter((m) => m.delete(k)).length, 0);
      case 'HGET':
        return h(a[0]).get(a[1]) ?? null;
      case 'HSET': {
        for (let i = 1; i < a.length; i += 2) h(a[0]).set(a[i], String(a[i + 1]));
        return (a.length - 1) / 2;
      }
      case 'HGETALL':
        return [...h(a[0])].flat();
      case 'HMGET':
        return a.slice(1).map((f) => h(a[0]).get(f) ?? null);
      case 'HSCAN': {
        const match = a.indexOf('MATCH') >= 0 ? glob(a[a.indexOf('MATCH') + 1]) : /.*/;
        return ['0', [...h(a[0])].filter(([f]) => match.test(f)).flat()];
      }
      case 'ZADD':
        z(a[0]).set(a[2], Number(a[1]));
        return 1;
      case 'ZRANGEBYSCORE': {
        const lo = a[1] === '-inf' ? -Infinity : Number(String(a[1]).replace('(', ''));
        const hi = a[2] === '+inf' ? Infinity : Number(a[2]);
        const rows = [...z(a[0])].filter(([, s]) => s >= lo && s <= hi).sort((x, y) => x[1] - y[1]);
        return a.includes('WITHSCORES') ? rows.flatMap(([f, s]) => [f, String(s)]) : rows.map(([f]) => f);
      }
      case 'RPUSH':
        l(a[0]).push(...a.slice(1));
        return l(a[0]).length;
      case 'LRANGE': {
        const list = l(a[0]);
        const end = Number(a[2]) < 0 ? list.length + Number(a[2]) : Number(a[2]);
        return list.slice(Number(a[1]), end + 1);
      }
      case 'LLEN':
        return l(a[0]).length;
      default:
        throw new Error(`commande inattendue ${cmd}`);
    }
  };
  return {
    command: async (args) => exec(args),
    pipeline: async (cmds) => cmds.map(exec),
    peek: { strings, hashes, zsets, lists },
  };
}
