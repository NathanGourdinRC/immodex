// Tableau de bord : une zone de recherche (communes et critères) avec les nouveaux DPE
// de la zone, les annonces déjà vues et le prix du marché, le tout sur une carte.
// Page de l'extension ouverte dans un onglet ; aucune donnée ne quitte le navigateur.
import { createZoneStore, groupsInZone, trackingKey, STATUSES } from '../common/zones.js';
import { searchCommunes, communeContour, communeSections, fetchNewDpe, dvfStats, marketOf, priceBreaks, priceClass } from '../common/zone-data.js';

const UI = window.__immodexUI;
const { el, icon, num } = UI;
const store = createZoneStore(chrome.storage.local);

const side = document.getElementById('side');
const zoneTabs = document.getElementById('zone-tabs');
const subtitle = document.getElementById('subtitle');
document.getElementById('logo').appendChild(icon('layers', 17));

// Du moins cher (clair) au plus cher (foncé).
const PRICE_COLORS = ['#dbeafe', '#93c5fd', '#3b82f6', '#1d4ed8', '#1e3a8a'];
const PAGE = 25;
const TYPE_PLURAL = { appartement: 'appartements', maison: 'maisons' };
const STATUS_ORDER = { favori: 0, 'a-voir': 1, '': 2, visite: 3, ecarte: 4 };

// ─── Carte ───

const map = L.map('map', { zoomControl: true }).setView([50.6292, 3.0573], 11);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; contributeurs OpenStreetMap' }).addTo(map);
// Sections colorées sous les points : sinon elles masqueraient les DPE et capteraient les clics.
map.createPane('prices').style.zIndex = 350;
const layers = {
  prices: L.layerGroup().addTo(map),
  contours: L.layerGroup().addTo(map),
  dpe: L.layerGroup().addTo(map),
  biens: L.layerGroup().addTo(map),
};
L.control
  .layers(null, { 'Prix au m² par section': layers.prices, Communes: layers.contours, 'Nouveaux DPE': layers.dpe, 'Annonces vues': layers.biens }, { collapsed: false })
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

function setHash(id) {
  history.replaceState(null, '', id ? `#zone=${id}` : location.pathname);
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
  const add = el('button', { type: 'button', class: 'imx-btn imx-btn-sm' }, icon('plus', 14), 'Nouvelle zone');
  add.addEventListener('click', () => showEditor(null));
  zoneTabs.replaceChildren(...tabs, add);
}

// ─── Édition d'une zone ───

function showEditor(zone) {
  renderToken++;
  current = zone;
  clearMap();
  renderTabs();
  setHash(zone ? zone.id : null);
  subtitle.textContent = zone ? `Modifier « ${zone.name} »` : 'Nouvelle zone de recherche';
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
  const surfaceMin = el('input', { class: 'imx-input', type: 'number', min: '1', max: '2000', placeholder: 'mini', value: zone && zone.surfaceMin ? zone.surfaceMin : null });
  const surfaceMax = el('input', { class: 'imx-input', type: 'number', min: '1', max: '2000', placeholder: 'maxi', value: zone && zone.surfaceMax ? zone.surfaceMax : null });
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

  const save = el('button', { type: 'submit', class: 'imx-btn imx-btn-primary' }, icon('check', 15), zone ? 'Enregistrer' : 'Créer la zone');
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
    el('label', { class: 'imx-field' }, el('span', null, 'Nom de la zone'), name, el('small', null, 'Facultatif : par défaut, les noms des communes.')),
    el('div', { class: 'imx-grid' }, el('label', { class: 'imx-field' }, el('span', null, 'Type de logement'), type), el('div', { class: 'imx-grid' }, el('label', { class: 'imx-field' }, el('span', null, 'Surface mini'), surfaceMin), el('label', { class: 'imx-field' }, el('span', null, 'maxi (m²)'), surfaceMax))),
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
    const saved = await store.save({ id: zone ? zone.id : undefined, name: name.value, communes, type: type.value, surfaceMin: surfaceMin.value, surfaceMax: surfaceMax.value });
    zones = await store.list();
    openZone(saved.id);
  });

  const intro = zone
    ? null
    : UI.notice(
        zones.length
          ? 'Nouvelle zone : choisis ses communes et tes critères.'
          : 'Choisis les communes où tu cherches. Le tableau de bord suivra les nouveaux DPE de la zone (souvent une annonce en préparation), tes annonces vues et les prix du marché.'
      );
  side.replaceChildren(...[intro, panel(zone ? 'Modifier la zone' : 'Nouvelle zone', form).node].filter(Boolean));
  setTimeout(() => search.focus(), 30);
}

// ─── Vue d'une zone ───

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
  const criteria = [
    zone.type ? (zone.type === 'maison' ? 'Maisons' : 'Appartements') : 'Maisons et appartements',
    zone.surfaceMin || zone.surfaceMax ? `${zone.surfaceMin ? `${zone.surfaceMin}` : '0'} à ${zone.surfaceMax ? `${zone.surfaceMax} m²` : '… m²'}` : null,
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
    el('div', { class: 'imx-meta' }, previousVisit ? `Dernière visite : ${UI.formatDateTime(previousVisit)}` : 'Première visite de cette zone.')
  );

  const kpi = (value, label) => el('div', { class: 'imx-kpi' }, el('strong', null, value), el('span', null, label));
  const kpis = el('div', { class: 'imx-kpis' }, kpi('…', 'nouveaux DPE'), kpi('…', 'annonces vues'), kpi('…', 'médiane €/m²'));
  const setKpi = (i, value, label) => kpis.replaceChild(kpi(value, label), kpis.children[i]);

  const dpeBody = el('div', null, UI.loading('Recherche des nouveaux DPE…'));
  const dpePanel = panel('Nouveaux DPE', dpeBody);
  const periods = el(
    'div',
    { class: 'imx-seg', role: 'group', 'aria-label': 'Période' },
    [15, 30, 90].map((d) => {
      const b = el('button', { type: 'button', class: d === days ? 'is-active' : '' }, `${d} j`);
      b.addEventListener('click', () => {
        days = d;
        openZone(zone.id);
      });
      return b;
    })
  );
  dpePanel.head.appendChild(periods);
  const biensBody = el('div', null, UI.loading('Lecture des annonces vues…'));
  const marketBody = el('div', null, UI.loading('Lecture des prix du marché…'));

  side.replaceChildren(
    head,
    kpis,
    dpePanel.node,
    panel('Annonces vues dans la zone', biensBody).node,
    panel('Prix du marché', marketBody).node
  );

  drawContours(zone, token);
  loadDpe(zone, token, dpeBody, (n, fresh) => setKpi(0, num(n), fresh ? `nouveaux DPE · ${fresh} depuis ta visite` : `nouveaux DPE (${days} j)`));
  loadBiens(zone, token, biensBody, (n, fav) => setKpi(1, num(n), fav ? `annonces vues · ${fav} favori${fav > 1 ? 's' : ''}` : 'annonces vues'));
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

// ─── Nouveaux DPE ───

function dpeMeta(r) {
  return [r.buildingType ? (r.buildingType === 'maison' ? 'Maison' : 'Appartement') : null, r.surface != null ? `${num(r.surface, 1)} m²` : null, r.constructionYear ? `construit en ${r.constructionYear}` : null, r.date ? `DPE du ${UI.formatDate(r.date)}` : null]
    .filter(Boolean)
    .join(' · ');
}

function dpeBadges(r) {
  const b = [UI.badge(r.energyClass, 'dpe'), UI.badge(r.gesClass, 'ges')].filter(Boolean);
  return b.length ? el('span', { style: 'display:inline-flex;gap:4px;vertical-align:middle;margin-left:6px' }, b) : null;
}

const hasCoords = (r) => r.lat != null && r.lon != null && isFinite(r.lat) && isFinite(r.lon);

function dpeActions(r, sales) {
  return el(
    'div',
    { class: 'imx-actions' },
    r.address ? UI.linkButton(UI.links.gmaps(r.address), 'Maps', { iconName: 'map' }) : null,
    hasCoords(r) ? UI.linkButton(UI.links.streetView(r.lat, r.lon), 'Street View', { iconName: 'eye' }) : null,
    r.id ? UI.linkButton(UI.links.ademe(r.id), 'ADEME', { variant: 'imx-btn-ghost', iconName: 'file' }) : null,
    sales ? sales.button : null
  );
}

// La surface du DPE sert de repère : une vente passée de même surface est souvent le même logement.
const salesFor = (r, onChange) =>
  hasCoords(r) ? UI.salesBlock({ lat: r.lat, lon: r.lon, address: r.address, type: r.buildingType }, { kind: 'dpe', surface: r.surface }, { ghost: true, onChange }) : null;

function dpeRow(r, isNew) {
  const sales = salesFor(r);
  const title = el('button', { type: 'button', class: 'imx-row-title', title: 'Voir sur la carte' }, r.address || '(adresse inconnue)');
  title.addEventListener('click', () => focusMarker(r.id));
  return el(
    'div',
    { class: 'imx-row' },
    el('div', { class: 'imx-row-head' }, title, isNew ? el('span', { class: 'imx-tag is-new' }, 'Nouveau') : null),
    el('div', { class: 'imx-meta' }, dpeMeta(r), dpeBadges(r)),
    dpeActions(r, sales),
    sales ? sales.panel : null
  );
}

async function loadDpe(zone, token, body, setKpi) {
  let res;
  try {
    res = await fetchNewDpe(zone, days);
  } catch (e) {
    if (token === renderToken) body.replaceChildren(UI.alert('Registre ADEME injoignable pour le moment.'));
    return;
  }
  if (token !== renderToken) return;
  const ids = res.records.map((r) => r.id).filter(Boolean);
  if (!baseline.has(zone.id)) baseline.set(zone.id, await store.swapSeenDpe(zone.id, ids));
  else await store.swapSeenDpe(zone.id, ids);
  const seen = baseline.get(zone.id);
  const isNew = (r) => !!seen && !!r.id && !seen.includes(r.id);
  const fresh = res.records.filter(isNew).length;
  setKpi(res.total, fresh);

  for (const r of res.records) {
    if (!hasCoords(r)) continue;
    const marker = L.circleMarker([r.lat, r.lon], { radius: 6, color: '#ffffff', weight: 1.5, fillColor: isNew(r) ? '#f79009' : '#0d9488', fillOpacity: 0.9 });
    bindGrowingPopup(marker, (onChange) => {
      const sales = salesFor(r, onChange);
      return el(
        'div',
        { style: 'display:grid;gap:8px' },
        el('div', { class: 'imx-candidate-address' }, r.address || '(adresse inconnue)'),
        el('div', { class: 'imx-meta' }, dpeMeta(r), dpeBadges(r)),
        isNew(r) ? el('span', { class: 'imx-tag is-new' }, 'Nouveau depuis ta dernière visite') : null,
        dpeActions(r, sales),
        sales ? sales.panel : null
      );
    });
    layers.dpe.addLayer(marker);
    if (r.id) markers.set(r.id, marker);
  }

  // Les nouveaux d'abord, puis du plus récent au plus ancien.
  const sorted = [...res.records].sort((a, b) => Number(isNew(b)) - Number(isNew(a)) || String(b.date).localeCompare(String(a.date)));
  const list = el('div', null);
  const more = el('button', { type: 'button', class: 'imx-btn imx-btn-block' });
  let shown = 0;
  const showMore = () => {
    sorted.slice(shown, shown + PAGE).forEach((r) => list.appendChild(dpeRow(r, isNew(r))));
    shown = Math.min(sorted.length, shown + PAGE);
    more.textContent = `Afficher ${Math.min(PAGE, sorted.length - shown)} de plus (${sorted.length - shown} restants)`;
    more.classList.toggle('imx-hidden', shown >= sorted.length);
  };
  more.addEventListener('click', showMore);
  showMore();
  const capped = res.total > res.records.length ? ` Les ${res.records.length} plus récents sont affichés.` : '';
  body.replaceChildren(
    ...[
      sorted.length
        ? el('p', { class: 'imx-meta', style: 'margin:0 0 6px' }, `${num(res.total)} DPE établis ces ${days} derniers jours. Un DPE est obligatoire avant une mise en vente ou en location : c'est souvent une annonce en préparation.${capped}`)
        : UI.empty(`Aucun DPE établi ces ${days} derniers jours avec ces critères.`),
      list,
      more,
    ].filter(Boolean)
  );
}

// ─── Annonces vues ───

const geocodeCache = new Map();

async function geocode(address) {
  if (geocodeCache.has(address)) return geocodeCache.get(address);
  let point = null;
  try {
    const res = await fetch(`https://api-adresse.data.gouv.fr/search/?limit=1&q=${encodeURIComponent(address)}`);
    const data = await res.json();
    const f = data.features && data.features[0];
    if (f && f.properties.score > 0.5) point = { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
  } catch {
    point = null;
  }
  geocodeCache.set(address, point);
  return point;
}

function priceLine(g) {
  if (!g.lastPrice) return 'prix non lu';
  if (!g.firstPrice || g.firstPrice === g.lastPrice) return UI.priceText(g.lastPrice);
  const pct = ((g.lastPrice - g.firstPrice) / g.firstPrice) * 100;
  return `${UI.priceText(g.lastPrice)} (${pct > 0 ? '+' : '−'}${num(Math.abs(pct), 1)} % depuis ${UI.priceText(g.firstPrice)})`;
}

function bienRow(g, track, onStatus) {
  const key = trackingKey(g);
  const last = g.sightings[g.sightings.length - 1];
  const fp = g.fp || {};
  const status = el(
    'select',
    { class: 'imx-status', 'aria-label': 'Statut' },
    el('option', { value: '' }, 'Sans statut'),
    Object.entries(STATUSES).map(([value, label]) => el('option', { value, selected: track.status === value }, label))
  );
  const note = el('textarea', { class: 'imx-note', placeholder: 'Note : visite, défauts, contact…', maxlength: '1000' }, track.note || '');
  const row = el(
    'div',
    { class: `imx-row${track.status === 'ecarte' ? ' is-ecarte' : ''}` },
    el('div', { class: 'imx-row-head' }, el('div', { class: 'imx-candidate-address' }, g.address || last.title || 'Annonce'), status),
    el(
      'div',
      { class: 'imx-meta' },
      [priceLine(g), fp.surface ? `${num(fp.surface)} m²` : null, fp.postal || fp.city || null, g.count > 1 ? `${g.count} annonces` : last.site, `vue le ${UI.day(g.lastSeen)}`].filter(Boolean).join(' · ')
    ),
    note,
    el(
      'div',
      { class: 'imx-actions' },
      g.sightings.map((s) => UI.linkButton(s.url, g.count > 1 ? s.site || 'Annonce' : 'Ouvrir l’annonce', { iconName: 'external' })),
      UI.castorusButton(last.url)
    )
  );
  status.addEventListener('change', async () => {
    await store.setTracking(key, { status: status.value || null });
    row.classList.toggle('is-ecarte', status.value === 'ecarte');
    onStatus();
  });
  note.addEventListener('change', () => store.setTracking(key, { note: note.value }));
  return row;
}

async function loadBiens(zone, token, body, setKpi) {
  let groups = [];
  try {
    const res = await chrome.runtime.sendMessage({ type: 'SIGHTINGS_GROUPS' });
    groups = res && res.ok ? res.groups : [];
  } catch {
    groups = [];
  }
  const tracking = await store.tracking();
  if (token !== renderToken) return;
  const inZone = groupsInZone(groups, zone);
  const trackOf = (g) => tracking[trackingKey(g)] || {};
  inZone.sort((a, b) => STATUS_ORDER[trackOf(a).status || ''] - STATUS_ORDER[trackOf(b).status || ''] || b.lastSeen - a.lastSeen);
  const favorites = () => inZone.filter((g) => (tracking[trackingKey(g)] || {}).status === 'favori').length;
  setKpi(inZone.length, favorites());

  if (!inZone.length) {
    body.replaceChildren(UI.empty('Aucune annonce vue dans cette zone pour le moment. Chaque annonce ouverte sur un site couvert est ajoutée ici automatiquement.'));
    return;
  }
  body.replaceChildren(
    ...inZone.map((g) =>
      bienRow(g, trackOf(g), async () => {
        Object.assign(tracking, await store.tracking());
        setKpi(inZone.length, favorites());
      })
    )
  );

  // Sur la carte : les biens dont l'adresse a été retrouvée avec une confiance élevée.
  for (const g of inZone.filter((x) => x.address)) {
    const point = await geocode(g.address);
    if (token !== renderToken || !point) continue;
    const st = trackOf(g).status || '';
    const marker = L.marker([point.lat, point.lon], {
      icon: L.divIcon({ className: '', html: `<div class="imx-bien-pin is-${st}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] }),
      title: g.address,
    });
    marker.bindPopup(
      el(
        'div',
        { style: 'display:grid;gap:8px' },
        el('div', { class: 'imx-candidate-address' }, g.address),
        el('div', { class: 'imx-meta' }, [priceLine(g), STATUSES[st] || null].filter(Boolean).join(' · ')),
        el('div', { class: 'imx-actions' }, UI.linkButton(g.sightings[g.sightings.length - 1].url, 'Ouvrir l’annonce', { iconName: 'external' }))
      )
    );
    layers.biens.addLayer(marker);
  }
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
