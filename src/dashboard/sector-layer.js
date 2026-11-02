// Carte d'une recherche : les ventes DVF des communes regroupées en secteurs d'environ 400 m,
// en 3 niveaux par rapport à la médiane de la commune, avec le nombre de ventes de chaque
// secteur. Moins de 10 ventes : pas de niveau, secteur en pointillés.
import { createSearchSales } from '../common/sales.js';
import { buildSectors, MIN_SALES, LEVEL_GAP } from '../common/sectors.js';

const UI = window.__immodexUI;
const { el, num } = UI;

const LEVELS = {
  moins: { label: 'moins cher', color: '#16a34a' },
  moyenne: { label: 'dans la moyenne', color: '#eab308' },
  plus: { label: 'plus cher', color: '#dc2626' },
};
const FEW = { label: `moins de ${MIN_SALES} ventes`, color: '#94a3b8' };
const POPUP_SALES = 20;

// Ventes de la recherche, gardées pendant la vie de la page (la vue Ventes passées et le Fil
// les réutilisent) ; un chargement en échec n'est pas gardé.
const loadSearchSales = createSearchSales();

// Ce qu'il faut savoir des données chargées : fraîcheur, carte partielle, communes absentes.
function salesNotes(data) {
  return [
    data.lastDate ? `Ventes connues jusqu’au ${UI.formatDate(data.lastDate)} (DVF, mis à jour deux fois par an avec 6 à 12 mois de retard).` : null,
    data.failedSections
      ? `${data.failedSections} section${data.failedSections > 1 ? 's' : ''} cadastrale${data.failedSections > 1 ? 's' : ''} injoignable${data.failedSections > 1 ? 's' : ''} : données partielles, réessaie plus tard.`
      : data.partial
        ? 'Commune trop grande : données partielles, une partie des sections cadastrales seulement.'
        : null,
    data.empty.length ? `Pas de données DVF pour ${data.empty.join(', ')} (l’Alsace, la Moselle et Mayotte n’y figurent pas).` : null,
    data.failed.length ? `Ventes injoignables pour ${data.failed.join(', ')} : réessaie plus tard.` : null,
  ].filter(Boolean);
}

const levelOf = (s) => (s.level ? LEVELS[s.level] : FEW);

function saleLine(v) {
  return [
    v.date ? UI.formatDate(v.date) : null,
    v.address || null,
    `${num(v.pricePerM2)} €/m²`,
    v.terrain ? `terrain ${num(v.terrain)} m²` : null,
    v.dependances ? 'dépendance' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function sectorPopup(s, communeMedian) {
  const recent = [...s.sales].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, POPUP_SALES);
  return el(
    'div',
    { style: 'display:grid;gap:6px' },
    el('div', { class: 'imx-candidate-address' }, s.level ? `Secteur ${LEVELS[s.level].label}` : 'Secteur avec trop peu de ventes'),
    el(
      'div',
      { class: 'imx-meta' },
      s.median
        ? `Médiane ${num(s.median)} €/m² sur ${num(s.count)} ventes (commune : ${num(communeMedian)} €/m²)`
        : `${num(s.count)} vente${s.count > 1 ? 's' : ''} : pas assez pour un niveau de prix`
    ),
    el('div', { class: 'imx-sector-sales' }, recent.map((v) => el('div', { class: 'imx-meta' }, saleLine(v)))),
    s.count > POPUP_SALES ? el('small', { class: 'imx-meta' }, `Les ${POPUP_SALES} plus récentes. Toutes sont dans « Ventes passées ».`) : null
  );
}

function legend() {
  const swatch = (lvl, extra = '') => el('span', null, el('span', { class: `imx-swatch${extra}`, style: `background:${lvl.color}` }), lvl.label);
  return el(
    'div',
    { class: 'imx-legend' },
    el('span', null, 'Secteurs :'),
    swatch(LEVELS.moins),
    swatch(LEVELS.moyenne),
    swatch(LEVELS.plus),
    swatch(FEW, ' is-few')
  );
}

async function renderSectors({ search, isCurrent, layer, body, panel, setKpi, onBounds }) {
  const dataBody = el('div', null, UI.loading('Lecture des ventes DVF…'));
  body.replaceChildren(
    panel(
      'Secteurs de la carte',
      legend(),
      el(
        'small',
        { class: 'imx-meta' },
        `Secteurs d’environ 400 m. Couleur : prix au m² médian du secteur comparé à celui de sa commune (${Math.round(LEVEL_GAP * 100)} % d’écart ou plus), seulement à partir de ${MIN_SALES} ventes. Le chiffre est le nombre de ventes. Deux maisons voisines diffèrent souvent de 15 % : le niveau d’un secteur est un repère, pas un prix.`
      )
    ).node,
    panel('Ventes DVF', dataBody).node
  );

  let data;
  try {
    data = await loadSearchSales(search);
  } catch {
    if (isCurrent()) dataBody.replaceChildren(UI.alert('Ventes DVF injoignables pour le moment.'));
    return;
  }
  if (!isCurrent()) return;

  const { sectors, communeMedians } = buildSectors(data.sales);
  const all = data.sales.map((v) => v.pricePerM2).sort((a, b) => a - b);
  setKpi(2, all.length ? num(all[Math.floor(all.length / 2)]) : 'n.c.', `médiane €/m² · ${num(all.length)} ventes`);

  for (const s of sectors) {
    const lvl = levelOf(s);
    const polygon = L.polygon(s.polygon, {
      pane: 'sectors',
      className: `imx-sector is-${s.level || 'peu'}`,
      color: s.level ? '#ffffff' : '#64748b',
      weight: s.level ? 1 : 0.8,
      dashArray: s.level ? null : '4 3',
      fillColor: lvl.color,
      fillOpacity: s.level ? 0.38 : 0.06,
    });
    polygon.bindPopup(() => sectorPopup(s, communeMedians[s.commune]), { maxWidth: 360, maxHeight: 420 });
    layer.addLayer(polygon);
    layer.addLayer(
      L.marker(s.center, {
        pane: 'sectors',
        interactive: false,
        icon: L.divIcon({ className: `imx-sector-count${s.level ? '' : ' is-few'}`, html: String(s.count), iconSize: [28, 16], iconAnchor: [14, 8] }),
      })
    );
  }

  if (onBounds && sectors.length) onBounds(L.latLngBounds(sectors.flatMap((s) => s.polygon)));

  const rows = data.perCommune.map(({ commune, count }) =>
    el(
      'div',
      { class: 'imx-site' },
      el('span', null, commune.nom),
      el('strong', null, communeMedians[commune.code] ? `${num(communeMedians[commune.code])} €/m²` : 'pas de ventes'),
      el('span', { class: 'imx-meta' }, `${num(count)} ventes`)
    )
  );
  const notes = salesNotes(data);
  dataBody.replaceChildren(el('div', { class: 'imx-sites' }, rows), ...notes.map((t) => el('p', { class: 'imx-meta', style: 'margin:6px 0 0' }, t)));
}

export { loadSearchSales, salesNotes, renderSectors };
