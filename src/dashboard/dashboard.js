// « Mes recherches » : chaque recherche (communes et critères) a trois vues, le Fil
// (annonces vues, Bientôt en vente ?), la Carte et les Ventes passées, avec une carte.
// Page de l'extension ouverte dans un onglet, ou appli téléphone ; aucune donnée ne quitte
// le navigateur en dehors des API publiques et de la synchro.
// Dans le code, une recherche garde le nom historique de « zone » (clé de stockage, synchro).
import { createZoneStore } from '../common/zones.js';
import { searchCommunes, communeContour, communeSections, dvfStats, marketOf, priceBreaks, priceClass } from '../common/zone-data.js';
import { renderFeed } from './feed.js';

const UI = window.__immodexUI;
const { el, icon, num } = UI;
const store = createZoneStore(chrome.storage.local);

const side = document.getElementById('side');
const zoneTabs = document.getElementById('zone-tabs');
const subtitle = document.getElementById('subtitle');
document.getElementById('logo').appendChild(icon('layers', 17));

// Du moins cher (clair) au plus cher (foncé).
const PRICE_COLORS = ['#dbeafe', '#93c5fd', '#3b82f6', '#1d4ed8', '#1e3a8a'];
const TYPE_PLURAL = { appartement: 'appartements', maison: 'maisons' };
const VIEWS = [
  ['fil', 'Fil'],
  ['carte', 'Carte'],
  ['ventes', 'Ventes passées'],
];

// ─── Carte ───

const map = L.map('map', { zoomControl: true }).setView([50.6292, 3.0573], 11);
const baseLayers = window.__immodexTiles.addBaseLayers(map);
// Sections colorées sous les points : sinon elles masqueraient les DPE et capteraient les clics.
map.createPane('prices').style.zIndex = 350;
const layers = {
  prices: L.layerGroup().addTo(map),
  contours: L.layerGroup().addTo(map),
  dpe: L.layerGroup().addTo(map),
  biens: L.layerGroup().addTo(map),
};
L.control
  // Sur un écran de téléphone, la liste des couches cacherait la moitié de la carte : repliée.
  .layers(baseLayers, { 'Prix au m² par section': layers.prices, Communes: layers.contours, 'Bientôt en vente ? (DPE)': layers.dpe, 'Annonces vues': layers.biens }, { collapsed: matchMedia('(max-width: 600px)').matches })
  .addTo(map);
// Marqueurs par identifiant, pour centrer la carte depuis la liste.
const markers = new Map();

function clearMap() {
  Object.values(layers).forEach((l) => l.clearLayers());
  markers.clear();
}

function focusMarker(id) {
  const marker = markers.get(id);
  if (!marker) return;
  map.setView(marker.getLatLng(), Math.max(map.getZoom(), 17));
  marker.openPopup();
}

// Contenu de bulle qui grandit (ventes passées) : Leaflet recadre la bulle.
function bindGrowingPopup(marker, build) {
  marker.bindPopup(() => build(() => marker.getPopup() && marker.getPopup().update()), { maxWidth: 340, maxHeight: 440 });
}

// Réponses déjà chargées (contours, sections, prix) : changer de période ne les redemande pas.
const memo = new Map();
function once(key, load) {
  if (!memo.has(key)) memo.set(key, load().catch((e) => {
    memo.delete(key);
    throw e;
  }));
  return memo.get(key);
}

// ─── État ───

let zones = [];
let current = null;
let days = 30;
// DPE déjà vus avant cette visite, par zone (null : première visite, rien n'est « nouveau »).
const baseline = new Map();
// Chaque affichage reçoit un numéro : une réponse arrivée après un changement de zone est ignorée.
let renderToken = 0;

// Vue affichée : gardée dans l'adresse avec la recherche (#zone=…&vue=carte).
let view = (location.hash.match(/vue=(fil|carte|ventes)/) || [])[1] || 'fil';

function setHash(id) {
  history.replaceState(null, '', id ? `#zone=${id}&vue=${view}` : location.pathname);
}

// Les trois vues sont construites ensemble ; changer de vue ne fait que les montrer ou cacher.
function showView(next, id) {
  view = next;
  for (const [key] of VIEWS) document.body.classList.toggle(`view-${key}`, key === view);
  document.querySelectorAll('.imx-views button').forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
  if (id) setHash(id);
  // Sur un téléphone, la carte n'est visible que dans la vue Carte : Leaflet doit se recaler.
  setTimeout(() => map.invalidateSize(), 0);
}

function hashZone() {
  const m = location.hash.match(/zone=([\w-]+)/);
  return m ? m[1] : null;
}

function panel(title, ...children) {
  const head = el('div', { class: 'imx-section-head' }, el('div', { class: 'imx-label' }, title));
  return { node: el('section', { class: 'imx-panel' }, head, ...children), head };
}

function renderTabs() {
  const tabs = zones.map((z) => {
    const b = el('button', { type: 'button', class: `imx-zone-tab${current && current.id === z.id ? ' is-active' : ''}` }, z.name);
    b.addEventListener('click', () => openZone(z.id));
    return b;
  });
  const add = el('button', { type: 'button', class: 'imx-btn imx-btn-sm' }, icon('plus', 14), 'Nouvelle recherche');
  add.addEventListener('click', () => showEditor(null));
  zoneTabs.replaceChildren(...tabs, add);
}

// ─── Édition d'une recherche ───

function showEditor(zone) {
  renderToken++;
  current = zone;
  clearMap();
  renderTabs();
  setHash(zone ? zone.id : null);
  subtitle.textContent = zone ? `Modifier « ${zone.name} »` : 'Nouvelle recherche';
  const communes = zone ? [...zone.communes] : [];

  const name = el('input', { class: 'imx-input', type: 'text', maxlength: '80', placeholder: 'ex. Lille sud et Lambersart', value: zone ? zone.name : null });
  const search = el('input', { class: 'imx-input', type: 'search', placeholder: 'Nom de commune ou code postal', autocomplete: 'off' });
  const suggestions = el('div', { class: 'imx-suggest imx-hidden' });
  const chips = el('div', { class: 'imx-chips' });
  const type = el(
    'select',
    { class: 'imx-select' },
    el('option', { value: '' }, 'Indifférent'),
    el('option', { value: 'appartement', selected: zone && zone.type === 'appartement' }, 'Appartement'),
    el('option', { value: 'maison', selected: zone && zone.type === 'maison' }, 'Maison')
  );
  // Champs chiffrés de la recherche, repérés par leur nom (celui du champ enregistré).
  const numberField = (field, placeholder, max, step = '1') =>
    el('input', { class: 'imx-input', type: 'number', name: field, min: '0', max, step, placeholder, value: zone && zone[field] ? zone[field] : null });
  const fields = {
    budgetMin: numberField('budgetMin', 'mini', '100000000', '1000'),
    budgetMax: numberField('budgetMax', 'maxi', '100000000', '1000'),
    surfaceMin: numberField('surfaceMin', 'mini', '2000'),
    surfaceMax: numberField('surfaceMax', 'maxi', '2000'),
    terrainMin: numberField('terrainMin', 'mini', '1000000'),
    terrainMax: numberField('terrainMax', 'maxi', '1000000'),
    piecesMin: numberField('piecesMin', 'mini', '50'),
    chambresMin: numberField('chambresMin', 'mini', '50'),
  };
  const pair = (label, min, max) => el('div', { class: 'imx-grid' }, el('label', { class: 'imx-field' }, el('span', null, `${label} mini`), min), el('label', { class: 'imx-field' }, el('span', null, 'maxi'), max));
  const single = (label, input) => el('label', { class: 'imx-field' }, el('span', null, label), input);
  const error = el('div', { class: 'imx-error', role: 'alert' });

  const renderChips = () => {
    chips.replaceChildren(
      ...communes.map((c) => {
        const remove = el('button', { type: 'button', class: 'imx-chip-remove', 'aria-label': `Retirer ${c.nom}` }, '×');
        remove.addEventListener('click', () => {
          communes.splice(communes.indexOf(c), 1);
          renderChips();
        });
        return el('span', { class: 'imx-chip' }, icon('pin', 13), `${c.nom} (${c.codesPostaux.slice(0, 3).join(', ')}${c.codesPostaux.length > 3 ? '…' : ''})`, remove);
      })
    );
  };
  renderChips();

  let searchTimer = null;
  let searchSeq = 0;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    error.textContent = '';
    searchTimer = setTimeout(async () => {
      const seq = ++searchSeq;
      // Une seconde tentative avant d'afficher un échec : l'API répond parfois lentement au premier appel.
      let found = [];
      let failed = false;
      try {
        found = await searchCommunes(search.value);
      } catch {
        try {
          found = await searchCommunes(search.value);
        } catch {
          failed = true;
        }
      }
      if (seq !== searchSeq) return;
      if (failed) error.textContent = 'Recherche de communes indisponible pour le moment, réessaie dans un instant.';
      else if (!found.length && search.value.trim().length >= 2) error.textContent = 'Aucune commune trouvée.';
      const fresh = found.filter((c) => !communes.some((x) => x.code === c.code)).slice(0, 8);
      suggestions.classList.toggle('imx-hidden', !fresh.length);
      suggestions.replaceChildren(
        ...fresh.map((c) => {
          const b = el('button', { type: 'button' }, `${c.nom} · ${(c.codesPostaux || []).slice(0, 3).join(', ')}${c.population ? ` · ${num(c.population)} hab.` : ''}`);
          b.addEventListener('click', () => {
            communes.push(c);
            renderChips();
            search.value = '';
            suggestions.classList.add('imx-hidden');
            search.focus();
          });
          return b;
        })
      );
    }, 250);
  });

  const save = el('button', { type: 'submit', class: 'imx-btn imx-btn-primary' }, icon('check', 15), zone ? 'Enregistrer' : 'Créer la recherche');
  const cancel = zones.length ? el('button', { type: 'button', class: 'imx-btn' }, 'Annuler') : null;
  if (cancel) cancel.addEventListener('click', () => (zone ? openZone(zone.id) : openZone(zones[0].id)));
  // Suppression en deux clics, sans boîte de dialogue.
  const remove = zone ? el('button', { type: 'button', class: 'imx-btn imx-btn-ghost' }, icon('trash', 14), 'Supprimer') : null;
  if (remove) {
    remove.addEventListener('click', async () => {
      if (remove.dataset.armed !== '1') {
        remove.dataset.armed = '1';
        remove.replaceChildren(icon('trash', 14), 'Confirmer la suppression');
        return;
      }
      await store.remove(zone.id);
      zones = await store.list();
      if (zones.length) openZone(zones[0].id);
      else showEditor(null);
    });
  }

  const form = el(
    'form',
    { class: 'imx-form', autocomplete: 'off' },
    el('label', { class: 'imx-field' }, el('span', null, 'Communes'), search),
    suggestions,
    chips,
    el('label', { class: 'imx-field' }, el('span', null, 'Nom de la recherche'), name, el('small', null, 'Facultatif : par défaut, les noms des communes.')),
    el('div', { class: 'imx-grid' }, single('Type de bien', type), pair('Budget (€)', fields.budgetMin, fields.budgetMax)),
    el('div', { class: 'imx-grid' }, pair('Surface (m²)', fields.surfaceMin, fields.surfaceMax), pair('Terrain (m²)', fields.terrainMin, fields.terrainMax)),
    el('div', { class: 'imx-grid' }, single('Pièces mini', fields.piecesMin), single('Chambres mini', fields.chambresMin)),
    error,
    el('div', { class: 'imx-form-actions' }, save, cancel, remove)
  );
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!communes.length) {
      error.textContent = 'Ajoute au moins une commune.';
      search.focus();
      return;
    }
    const values = Object.fromEntries(Object.entries(fields).map(([k, input]) => [k, input.value]));
    const saved = await store.save({ id: zone ? zone.id : undefined, name: name.value, communes, type: type.value, ...values });
    zones = await store.list();
    openZone(saved.id);
  });

  const intro = zone
    ? null
    : UI.notice(
        zones.length
          ? 'Nouvelle recherche : choisis ses communes et tes critères.'
          : 'Choisis les communes où tu cherches et tes critères. Chaque recherche a son fil (annonces vues, nouveaux DPE souvent annonciateurs d’une vente), sa carte et ses ventes passées.'
      );
  side.replaceChildren(...[intro, panel(zone ? 'Modifier la recherche' : 'Nouvelle recherche', form).node].filter(Boolean));
  setTimeout(() => search.focus(), 30);
}

// ─── Vue d'une recherche ───

async function openZone(id) {
  const zone = zones.find((z) => z.id === id);
  if (!zone) return showEditor(null);
  const token = ++renderToken;
  current = zone;
  renderTabs();
  setHash(zone.id);
  clearMap();

  const previousVisit = baseline.has(`visit:${zone.id}`) ? baseline.get(`visit:${zone.id}`) : await store.markVisited(zone.id);
  baseline.set(`visit:${zone.id}`, previousVisit);
  // « 300 000 à 450 000 € », « jusqu'à 450 000 € », « 200 m² et plus ».
  const range = (min, max, unit, fmt = num) =>
    min && max ? `${fmt(min)} à ${fmt(max)} ${unit}` : max ? `jusqu'à ${fmt(max)} ${unit}` : min ? `${fmt(min)} ${unit} et plus` : null;
  const criteria = [
    zone.type ? (zone.type === 'maison' ? 'Maisons' : 'Appartements') : 'Maisons et appartements',
    range(zone.budgetMin, zone.budgetMax, '€'),
    range(zone.surfaceMin, zone.surfaceMax, 'm²'),
    zone.terrainMin || zone.terrainMax ? `terrain ${range(zone.terrainMin, zone.terrainMax, 'm²')}` : null,
    zone.piecesMin ? `${zone.piecesMin} pièces et plus` : null,
    zone.chambresMin ? `${zone.chambresMin} chambres et plus` : null,
    `${zone.communes.length} commune${zone.communes.length > 1 ? 's' : ''}`,
  ]
    .filter(Boolean)
    .join(' · ');
  subtitle.textContent = criteria;

  const edit = el('button', { type: 'button', class: 'imx-btn imx-btn-sm' }, icon('edit', 14), 'Modifier');
  edit.addEventListener('click', () => showEditor(zone));
  const head = el(
    'section',
    { class: 'imx-panel' },
    el('div', { class: 'imx-section-head' }, el('div', { class: 'imx-history-address' }, zone.name), edit),
    el('div', { class: 'imx-chips' }, zone.communes.map((c) => el('span', { class: 'imx-chip' }, icon('pin', 13), c.nom))),
    el('div', { class: 'imx-meta' }, previousVisit ? `Dernière visite : ${UI.formatDateTime(previousVisit)}` : 'Première visite de cette recherche.')
  );

  const kpi = (value, label) => el('div', { class: 'imx-kpi' }, el('strong', null, value), el('span', null, label));
  const kpis = el('div', { class: 'imx-kpis' }, kpi('…', 'nouveaux DPE'), kpi('…', 'annonces vues'), kpi('…', 'médiane €/m²'));
  const setKpi = (i, value, label) => kpis.replaceChild(kpi(value, label), kpis.children[i]);

  const switcher = el(
    'div',
    { class: 'imx-seg imx-views', role: 'tablist', 'aria-label': 'Vues de la recherche' },
    VIEWS.map(([key, label]) => {
      const b = el('button', { type: 'button', role: 'tab', 'data-view': key }, label);
      b.addEventListener('click', () => showView(key, zone.id));
      return b;
    })
  );
  const feedView = el('div', { class: 'imx-view imx-view-fil' });
  const marketBody = el('div', null, UI.loading('Lecture des prix du marché…'));
  const mapView = el('div', { class: 'imx-view imx-view-carte' }, panel('Prix du marché', marketBody).node);
  const salesView = el('div', { class: 'imx-view imx-view-ventes' }, UI.empty('Ventes passées : en cours de chargement.'));

  side.replaceChildren(head, kpis, switcher, feedView, mapView, salesView);
  showView(view, zone.id);

  const isCurrent = () => token === renderToken;
  drawContours(zone, token);
  renderFeed({
    search: zone,
    isCurrent,
    body: feedView,
    panel,
    layers,
    markers,
    focus: focusMarker,
    bindGrowingPopup,
    store,
    baseline,
    days,
    onDays: (d) => {
      days = d;
      openZone(zone.id);
    },
    setKpi,
  });
  loadMarket(zone, token, marketBody, (m) => setKpi(2, m ? num(m.median) : 'n.c.', `médiane €/m² ${TYPE_PLURAL[zone.type] || 'logements'}`));
}

async function drawContours(zone, token) {
  const shapes = await Promise.all(zone.communes.map((c) => once(`contour:${c.code}`, () => communeContour(c.code)).catch(() => null)));
  if (token !== renderToken) return;
  const group = L.geoJSON(shapes.filter(Boolean), { style: { color: '#0f172a', weight: 2, dashArray: '6 4', fill: false }, interactive: false });
  layers.contours.addLayer(group);
  const bounds = group.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.05));
}

// ─── Prix du marché ───

async function loadMarket(zone, token, body, setKpi) {
  const perCommune = await Promise.all(
    zone.communes.map(async (c) => {
      try {
        const [stats, shapes] = await Promise.all([once(`dvf:${c.code}`, () => dvfStats(c.code)), once(`sections:${c.code}`, () => communeSections(c.code)).catch(() => null)]);
        return { commune: c, stats, shapes };
      } catch {
        return { commune: c, stats: null, shapes: null };
      }
    })
  );
  if (token !== renderToken) return;

  const sectionMarket = new Map();
  for (const { stats } of perCommune) {
    for (const row of (stats && stats.sections) || []) {
      const m = marketOf(row, zone.type);
      if (m) sectionMarket.set(row.code_geo, m);
    }
  }
  const breaks = priceBreaks([...sectionMarket.values()].map((m) => m.median));

  for (const { shapes } of perCommune) {
    if (!shapes) continue;
    layers.prices.addLayer(
      L.geoJSON(shapes, {
        pane: 'prices',
        style: (f) => {
          const m = sectionMarket.get(f.properties.id);
          return m
            ? { color: '#ffffff', weight: 0.6, fillColor: PRICE_COLORS[priceClass(m.median, breaks)], fillOpacity: 0.5 }
            : { color: '#94a3b8', weight: 0.4, fillOpacity: 0 };
        },
        onEachFeature: (f, layer) => {
          const m = sectionMarket.get(f.properties.id);
          layer.bindTooltip(
            m ? `Section ${f.properties.code} · ${num(m.median)} €/m² (${num(m.count)} vente${m.count > 1 ? 's' : ''})` : `Section ${f.properties.code} · pas assez de ventes`,
            { sticky: true }
          );
        },
      })
    );
  }
  const rows = perCommune.map(({ commune, stats }) => {
    const m = stats && marketOf(stats.commune, zone.type);
    return el(
      'div',
      { class: 'imx-site' },
      el('span', null, commune.nom),
      el('strong', null, m ? `${num(m.median)} €/m²` : stats ? 'pas assez de ventes' : 'indisponible'),
      m ? el('span', { class: 'imx-meta' }, `${num(m.count)} ventes`) : null
    );
  });
  const weighted = perCommune
    .map(({ stats }) => stats && marketOf(stats.commune, zone.type))
    .filter(Boolean)
    .reduce((acc, m) => ({ sum: acc.sum + m.median * m.count, count: acc.count + m.count }), { sum: 0, count: 0 });
  setKpi(weighted.count ? { median: Math.round(weighted.sum / weighted.count), count: weighted.count } : null);

  const labels = breaks.length
    ? PRICE_COLORS.slice(0, breaks.length + 1).map((color, i) =>
        el(
          'span',
          null,
          el('span', { class: 'imx-swatch', style: `background:${color}` }),
          i === 0 ? `moins de ${num(breaks[0])}` : i === breaks.length ? `${num(breaks[i - 1])} et plus` : `${num(breaks[i - 1])} à ${num(breaks[i])}`
        )
      )
    : [];
  body.replaceChildren(
    ...[
      el('div', { class: 'imx-sites' }, rows),
      labels.length ? el('div', { class: 'imx-legend' }, el('span', null, 'Carte, €/m² :'), labels) : null,
      el(
        'small',
        { class: 'imx-meta' },
        `Prix médian au m² des ${TYPE_PLURAL[zone.type] || 'maisons et appartements'} vendus ces 5 dernières années, ventes d'un seul bien (Statistiques DVF, data.gouv.fr). Survole une section de la carte pour son prix.`
      ),
    ].filter(Boolean)
  );
}

// ─── Démarrage ───

(async function start() {
  zones = await store.list();
  const wanted = hashZone();
  if (wanted && zones.some((z) => z.id === wanted)) openZone(wanted);
  else if (zones.length) openZone(zones[0].id);
  else {
    renderTabs();
    showEditor(null);
  }
})();
