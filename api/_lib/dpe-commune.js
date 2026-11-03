// Diagnostics énergie (DPE) d'une commune entière, registre de l'ADEME « dpe03existant »
// (depuis juillet 2021), du plus ancien au plus récent, pages de 10 000 lignes suivies par leur
// lien `next`, champs utiles seuls.
const ADEME = 'https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines';
const SELECT = ['numero_dpe', 'date_etablissement_dpe', 'surface_habitable_logement', 'adresse_ban', 'etiquette_dpe', 'type_batiment'].join(',');

// Une page qui ne répond pas en `ms` est abandonnée (le registre de l'ADEME ralentit parfois).
function timed(run, ms) {
  const ctrl = new AbortController();
  let timer;
  const late = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new Error('registre trop lent'));
    }, ms);
  });
  return Promise.race([run(ctrl.signal), late]).finally(() => clearTimeout(timer));
}

// `{ records, until }` : `until` vaut null quand tout le registre de la commune a été lu ;
// sinon (plus de `maxPages` pages, délai total dépassé, page en erreur après la première),
// c'est la date du dernier DPE lu, jusqu'à laquelle la liste est complète.
// `null` si le registre est injoignable dès la première page : ventes servies sans classe.
async function communeDpe(insee, type, { fetchImpl = fetch, maxPages = 5, pageMs = 8000, deadlineMs = 25000, now = Date.now } = {}) {
  const params = new URLSearchParams({ size: '10000', select: SELECT, sort: 'date_etablissement_dpe', code_insee_ban_eq: insee });
  if (type === 'maison' || type === 'appartement') params.set('type_batiment_eq', type);
  else params.set('type_batiment_in', 'maison,appartement');
  let url = `${ADEME}?${params}`;
  const records = [];
  const start = now();
  for (let page = 0; url && page < maxPages; page++) {
    if (page > 0 && now() - start >= deadlineMs) break;
    let data = null;
    try {
      data = await timed((signal) => fetchImpl(url, { signal }).then((res) => (res.ok ? res.json() : null)), pageMs);
    } catch {
      data = null;
    }
    if (!data) {
      if (page === 0) return null;
      break;
    }
    for (const r of data.results || []) {
      records.push({
        id: r.numero_dpe || null,
        date: r.date_etablissement_dpe || null,
        surface: r.surface_habitable_logement != null ? Number(r.surface_habitable_logement) : null,
        address: r.adresse_ban || null,
        energyClass: r.etiquette_dpe || null,
      });
    }
    url = data.next || null;
  }
  const until = url ? records.reduce((last, r) => (r.date && r.date > last ? r.date : last), '') || null : null;
  return { records, until };
}

export { communeDpe };
