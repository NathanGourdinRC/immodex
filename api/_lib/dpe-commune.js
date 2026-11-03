// Diagnostics énergie (DPE) d'une commune entière, registre de l'ADEME « dpe03existant »
// (depuis juillet 2021), pages de 1 000 lignes suivies par leur lien `next`, champs utiles seuls.
const ADEME = 'https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines';
const SELECT = ['numero_dpe', 'date_etablissement_dpe', 'surface_habitable_logement', 'adresse_ban', 'etiquette_dpe', 'type_batiment'].join(',');

// `null` si le registre est injoignable : les ventes sont alors servies sans classe énergie.
async function communeDpe(insee, type, { fetchImpl = fetch, maxPages = 5 } = {}) {
  const params = new URLSearchParams({ size: '1000', select: SELECT, sort: 'date_etablissement_dpe', code_insee_ban_eq: insee });
  if (type === 'maison' || type === 'appartement') params.set('type_batiment_eq', type);
  else params.set('type_batiment_in', 'maison,appartement');
  let url = `${ADEME}?${params}`;
  const records = [];
  try {
    for (let page = 0; url && page < maxPages; page++) {
      const res = await fetchImpl(url);
      if (!res.ok) return null;
      const data = await res.json();
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
  } catch {
    return null;
  }
  return records;
}

export { communeDpe };
