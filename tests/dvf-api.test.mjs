import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleDvf, parseCsv } from '../api/dvf.js';

const HEAD = 'id_mutation,date_mutation,numero_disposition,nature_mutation,valeur_fonciere,adresse_numero,adresse_suffixe,adresse_nom_voie,adresse_code_voie,code_postal,code_commune,nom_commune,code_departement,ancien_code_commune,ancien_nom_commune,id_parcelle,ancien_id_parcelle,numero_volume,lot1_numero,lot1_surface_carrez,lot2_numero,lot2_surface_carrez,lot3_numero,lot3_surface_carrez,lot4_numero,lot4_surface_carrez,lot5_numero,lot5_surface_carrez,nombre_lots,code_type_local,type_local,surface_reelle_bati,nombre_pieces_principales,code_nature_culture,nature_culture,code_nature_culture_speciale,nature_culture_speciale,surface_terrain,longitude,latitude';
const line = (o) =>
  [o.id, o.date, '1', 'Vente', o.price, '12', '', o.voie || 'RUE DE QUESNOY', '0001', '59118', '59636', 'Wambrechies', '59', '', '', o.parcelle || '596360000B0001', '', '', '', '', '', '', '', '', '', '', '', '', '0', o.code || '1', o.type, o.surface ?? '', o.pieces ?? '', 'S', 'sols', '', '', o.terrain ?? '', '3.05', '50.68'].join(',');
const CSV_2025 = [
  HEAD,
  line({ id: '2025-1', date: '2025-12-30', price: '330000', type: 'Maison', surface: '100', pieces: '5', terrain: '200' }),
  line({ id: '2025-1', date: '2025-12-30', price: '330000', type: 'Dépendance', code: '3' }),
  // Adresse avec une virgule, entre guillemets comme dans le fichier d'Etalab.
  line({ id: '2025-2', date: '2025-06-01', price: '250000', type: 'Appartement', code: '2', surface: '70', pieces: '3', voie: '"RUE DU MOULIN, BAT A"' }),
].join('\n');

function fakeFetch(files) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const year = (url.match(/csv\/(\d{4})\//) || [])[1];
    if (files[year] === 500) return { ok: false, status: 500, text: async () => '' };
    if (!files[year]) return { ok: false, status: 404, text: async () => 'absent' };
    return { ok: true, status: 200, text: async () => files[year] };
  };
  return { impl, calls };
}

test('CSV d’Etalab : champs entre guillemets avec virgule', () => {
  const rows = parseCsv(CSV_2025);
  assert.equal(rows.length, 3);
  assert.equal(rows[2].adresse_nom_voie, 'RUE DU MOULIN, BAT A');
  assert.equal(rows[0].longitude, '3.05');
});

test('ventes allégées d’une commune : 5 ans de fichiers annuels, maisons seules', async () => {
  const { impl, calls } = fakeFetch({ 2025: CSV_2025 });
  const r = await handleDvf({ insee: '59636', type: 'maison', fetchImpl: impl, now: Date.parse('2026-11-02') });
  assert.equal(r.sales.length, 1);
  assert.equal(r.sales[0].pricePerM2, 3300);
  assert.equal(r.sales[0].terrain, 200);
  assert.equal(r.sales[0].dependances, 1);
  assert.deepEqual([r.sales[0].lon, r.sales[0].lat], [3.05, 50.68]);
  assert.equal(r.lastDate, '2025-12-30');
  assert.deepEqual(r.years, [2025]);
  // Fichiers DVF de la commune, plus le registre des DPE (ici injoignable : réponse sans classes).
  assert.ok(calls.filter((u) => !u.startsWith('https://data.ademe.fr/')).every((u) => u.startsWith('https://files.data.gouv.fr/geo-dvf/latest/csv/') && u.endsWith('/communes/59/59636.csv')));
  const all = await handleDvf({ insee: '59636', type: null, fetchImpl: impl, now: Date.parse('2026-11-02') });
  assert.equal(all.sales.length, 2);
});

test('commune invalide refusée, fichier en erreur signalé', async () => {
  await assert.rejects(handleDvf({ insee: '5963', type: null, fetchImpl: fakeFetch({}).impl }), (e) => e.status === 400);
  await assert.rejects(handleDvf({ insee: '59636', type: null, fetchImpl: fakeFetch({ 2024: 500 }).impl, now: Date.parse('2026-11-02') }), (e) => e.status === 502);
});

test('Corse et outre-mer : bon dossier départemental', async () => {
  const a = fakeFetch({});
  await handleDvf({ insee: '2A004', type: null, fetchImpl: a.impl, now: Date.parse('2026-11-02') });
  assert.ok(a.calls[0].includes('/communes/2A/2A004.csv'));
  const b = fakeFetch({});
  await handleDvf({ insee: '97411', type: null, fetchImpl: b.impl, now: Date.parse('2026-11-02') });
  assert.ok(b.calls[0].includes('/communes/974/97411.csv'));
});

// Faux registre ADEME : deux pages reliées par `next`.
function withAdeme(files, pages) {
  const geo = fakeFetch(files);
  const calls = [];
  const impl = async (url) => {
    if (!url.startsWith('https://data.ademe.fr/')) return geo.impl(url);
    calls.push(url);
    if (pages === 'DOWN') return { ok: false, status: 503, json: async () => ({}) };
    const i = url.includes('page=2') ? 1 : 0;
    return { ok: true, status: 200, json: async () => pages[i] };
  };
  return { impl, calls };
}
const row = (id, date, adresse, surface, etiquette) => ({ numero_dpe: id, date_etablissement_dpe: date, adresse_ban: adresse, surface_habitable_logement: surface, etiquette_dpe: etiquette, type_batiment: 'maison' });

test('ventes avec classe énergie : DPE de la commune sur deux pages, reliés par l’adresse', async () => {
  const pages = [
    { results: [row('d0', '2025-02-01', '99 Rue Ailleurs 59118 Wambrechies', 100, 'B')], next: 'https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines?page=2' },
    { results: [row('d1', '2025-08-01', '12 Rue de Quesnoy 59118 Wambrechies', 100, 'D')] },
  ];
  const { impl, calls } = withAdeme({ 2025: CSV_2025 }, pages);
  const r = await handleDvf({ insee: '59636', type: 'maison', fetchImpl: impl, now: Date.parse('2026-11-02') });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes('code_insee_ban_eq=59636') && calls[0].includes('type_batiment_eq=maison'));
  assert.equal(r.sales[0].energyClass, 'D');
  assert.equal(r.sales[0].dpeDays, 151);
  assert.deepEqual(r.energy, { byClass: {}, delay: null });
});

test('registre ADEME injoignable : ventes servies sans classes ni statistiques', async () => {
  const { impl } = withAdeme({ 2025: CSV_2025 }, 'DOWN');
  const r = await handleDvf({ insee: '59636', type: 'maison', fetchImpl: impl, now: Date.parse('2026-11-02') });
  assert.equal(r.sales.length, 1);
  assert.equal(r.sales[0].energyClass, undefined);
  assert.equal(r.energy, null);
});
