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

// Bulle d'un secteur : en-tête (niveau, médiane, nombre de ventes, repère de la commune) puis
// le tableau de toutes ses ventes, les plus récentes d'abord, qui défile dans la bulle.
// `compact` (téléphone) : date, adresse, prix au m² et terrain seulement.
function sectorPopup(s, communeMedian, communeName, compact = false) {
  const sales = [...s.sales].sort((x, y) => String(y.date).localeCompare(String(x.date)));
  const lvl = levelOf(s);
  const stat = (value, label) => el('div', { class: 'imx-sector-stat' }, el('strong', null, value), el('span', null, label));
  const cell = (value, cls) => el('td', cls ? { class: cls } : null, value);
  const head = (label, cls) => el('th', cls ? { class: cls } : null, label);
  return el(
    'div',
    { class: `imx-sector-popup${compact ? ' is-compact' : ''}` },
    el(
      'div',
      { class: 'imx-sector-title' },
      el('span', { class: 'imx-sector-dot', style: `background:${lvl.color}` }),
      s.level ? `Secteur ${LEVELS[s.level].label}` : 'Secteur avec trop peu de ventes pour un niveau de prix'
    ),
    compact
      ? el('div', { class: 'imx-meta' }, [s.median ? `Médiane ${num(s.median)} €/m²` : null, `${num(s.count)} vente${s.count > 1 ? 's' : ''}`, communeMedian ? `${communeName || 'commune'} ${num(communeMedian)} €/m²` : null].filter(Boolean).join(' · '))
      : el(
          'div',
          { class: 'imx-sector-stats' },
          stat(s.median ? `${num(s.median)} €/m²` : 'n.c.', 'médiane du secteur'),
          stat(num(s.count), `vente${s.count > 1 ? 's' : ''} de maisons`),
          stat(communeMedian ? `${num(communeMedian)} €/m²` : 'n.c.', `médiane de ${communeName || 'la commune'}`)
        ),
    el(
      'div',
      { class: 'imx-sector-scroll' },
      el(
        'table',
        { class: 'imx-sector-table' },
        el('thead', null, el('tr', null, head('Date'), head('Adresse'), head('Prix', 'is-num col-full'), head('Surface', 'is-num col-full'), head('€/m²', 'is-num'), head('Terrain', 'is-num'), head('Dép.', 'col-full'))),
        el(
          'tbody',
          null,
          sales.map((v) =>
            el(
              'tr',
              null,
              cell(v.date ? UI.formatDate(v.date) : ''),
              cell(v.address || ''),
              cell(v.price ? UI.priceText(v.price) : '', 'is-num col-full'),
              cell(v.surface ? `${num(v.surface)} m²` : '', 'is-num col-full'),
              cell(el('strong', null, num(v.pricePerM2)), 'is-num'),
              cell(v.terrain ? `${num(v.terrain)} m²` : '', 'is-num'),
              cell(v.dependances ? 'oui' : '', 'col-full')
            )
          )
        )
      )
    ),
    compact ? null : el('small', { class: 'imx-meta' }, 'Dép. : garage, cave ou abri vendu avec le bien (un garage intégré n’apparaît souvent pas).')
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
    // Bulle large (tableau), réduite à la largeur de la carte sur un téléphone.
    polygon.on('click', (e) => {
      const map = e.target._map;
      const { x: w, y: h } = map.getSize();
      const compact = w < 560;
      const name = (search.communes.find((c) => c.code === s.commune) || {}).nom;
      L.popup({
        // Téléphone : la bulle tient dans la carte, sous les boutons de zoom.
        maxWidth: compact ? w - 60 : Math.min(680, w - 230),
        minWidth: compact ? w - 60 : Math.min(580, w - 230),
        maxHeight: Math.max(220, h - (compact ? 110 : 40)),
        className: 'imx-sector-leaflet',
        // À droite, la place du menu des couches : la bulle ne passe pas dessous.
        autoPanPaddingTopLeft: L.point(12, compact ? 90 : 12),
        autoPanPaddingBottomRight: L.point(compact ? 12 : 210, 12),
      })
        .setLatLng(e.latlng)
        .setContent(sectorPopup(s, communeMedians[s.commune], name, compact))
        .openOn(map);
    });
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
