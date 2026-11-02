// Fil d'une recherche : les annonces vues qui passent ses critères (Garder, Écarter) et
// « Bientôt en vente ? », les nouveaux DPE de la recherche (un DPE est obligatoire avant une
// mise en vente : c'est souvent une annonce en préparation).
import { groupsInZone, trackingKey, checkCriteria, STATUSES } from '../common/zones.js';
import { fetchNewDpe } from '../common/zone-data.js';

const UI = window.__immodexUI;
const { el, icon, num } = UI;

const PAGE = 25;
const STATUS_ORDER = { favori: 0, 'a-voir': 1, '': 2, visite: 3, ecarte: 4 };
const SOON_PREF = 'immodex.hideSoon';

// Préférence propre à l'appareil ; le stockage peut être refusé (navigation privée).
function readPref(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Préférence perdue au rechargement, sans gravité.
  }
}

const hasCoords = (r) => r.lat != null && r.lon != null && isFinite(r.lat) && isFinite(r.lon);

// ─── Bientôt en vente ? (nouveaux DPE) ───

function dpeMeta(r) {
  return [r.buildingType ? (r.buildingType === 'maison' ? 'Maison' : 'Appartement') : null, r.surface != null ? `${num(r.surface, 1)} m²` : null, r.constructionYear ? `construit en ${r.constructionYear}` : null, r.date ? `DPE du ${UI.formatDate(r.date)}` : null]
    .filter(Boolean)
    .join(' · ');
}

function dpeBadges(r) {
  const b = [UI.badge(r.energyClass, 'dpe'), UI.badge(r.gesClass, 'ges')].filter(Boolean);
  return b.length ? el('span', { style: 'display:inline-flex;gap:4px;vertical-align:middle;margin-left:6px' }, b) : null;
}

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

function dpeRow(r, isNew, focus) {
  const sales = salesFor(r);
  const title = el('button', { type: 'button', class: 'imx-row-title', title: 'Voir sur la carte' }, r.address || '(adresse inconnue)');
  title.addEventListener('click', () => focus(r.id));
  return el(
    'div',
    { class: 'imx-row' },
    el('div', { class: 'imx-row-head' }, title, isNew ? el('span', { class: 'imx-tag is-new' }, 'Nouveau') : null),
    el('div', { class: 'imx-meta' }, dpeMeta(r), dpeBadges(r)),
    dpeActions(r, sales),
    sales ? sales.panel : null
  );
}

async function loadSoon(ctx, body) {
  const { search, isCurrent, store, baseline, days, layers, markers, bindGrowingPopup, setKpi } = ctx;
  let res;
  try {
    res = await fetchNewDpe(search, days);
  } catch {
    if (isCurrent()) body.replaceChildren(UI.alert('Registre ADEME injoignable pour le moment.'));
    return;
  }
  if (!isCurrent()) return;
  const ids = res.records.map((r) => r.id).filter(Boolean);
  if (!baseline.has(search.id)) baseline.set(search.id, await store.swapSeenDpe(search.id, ids));
  else await store.swapSeenDpe(search.id, ids);
  const seen = baseline.get(search.id);
  const isNew = (r) => !!seen && !!r.id && !seen.includes(r.id);
  const fresh = res.records.filter(isNew).length;
  setKpi(0, num(res.total), fresh ? `nouveaux DPE · ${fresh} depuis ta visite` : `nouveaux DPE (${days} j)`);

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
    sorted.slice(shown, shown + PAGE).forEach((r) => list.appendChild(dpeRow(r, isNew(r), ctx.focus)));
    shown = Math.min(sorted.length, shown + PAGE);
    more.textContent = `Afficher ${Math.min(PAGE, sorted.length - shown)} de plus (${sorted.length - shown} restants)`;
    more.classList.toggle('imx-hidden', shown >= sorted.length);
  };
  more.addEventListener('click', showMore);
  showMore();
  const capped = res.total > res.records.length ? ` Les ${res.records.length} plus récents sont affichés.` : '';
  body.replaceChildren(
    sorted.length
      ? el('p', { class: 'imx-meta', style: 'margin:0 0 6px' }, `${num(res.total)} DPE établis ces ${days} derniers jours. Un DPE est obligatoire avant une mise en vente ou en location : c'est souvent une annonce en préparation.${capped}`)
      : UI.empty(`Aucun DPE établi ces ${days} derniers jours avec ces critères.`),
    list,
    more
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

// Ce que l'annonce dit des critères de la recherche : seuls le prix et la surface sont lus aujourd'hui.
const listingOf = (g) => ({ price: g.lastPrice || null, surface: (g.fp || {}).surface ?? null, terrain: null, pieces: null, chambres: null });

function bienRow(g, track, unknown, onStatus) {
  const key = trackingKey(g);
  const last = g.sightings[g.sightings.length - 1];
  const fp = g.fp || {};
  const status = el(
    'select',
    { class: 'imx-status', 'aria-label': 'Statut' },
    el('option', { value: '' }, 'Sans statut'),
    Object.entries(STATUSES).map(([value, label]) => el('option', { value, selected: track.status === value }, label))
  );
  const keep = el('button', { type: 'button', class: 'imx-btn imx-btn-sm' }, icon('check', 14), 'Garder');
  const drop = el('button', { type: 'button', class: 'imx-btn imx-btn-sm imx-btn-ghost' }, icon('trash', 14), 'Écarter');
  const note = el('textarea', { class: 'imx-note', placeholder: 'Note : visite, défauts, contact…', maxlength: '1000' }, track.note || '');
  const row = el(
    'div',
    { class: 'imx-row imx-bien' },
    el('div', { class: 'imx-row-head' }, el('div', { class: 'imx-candidate-address' }, g.address || last.title || 'Annonce'), status),
    el(
      'div',
      { class: 'imx-meta' },
      [priceLine(g), fp.surface ? `${num(fp.surface)} m²` : null, fp.postal || fp.city || null, g.count > 1 ? `${g.count} annonces` : last.site, `vue le ${UI.day(g.lastSeen)}`].filter(Boolean).join(' · ')
    ),
    unknown.length ? el('div', { class: 'imx-meta imx-unknown' }, unknown.join(' · ')) : null,
    el('div', { class: 'imx-actions' }, keep, drop),
    note,
    el(
      'div',
      { class: 'imx-actions' },
      g.sightings.map((s) => UI.linkButton(s.url, g.count > 1 ? s.site || 'Annonce' : 'Ouvrir l’annonce', { iconName: 'external' })),
      UI.castorusButton(last.url)
    )
  );
  const apply = (value) => {
    status.value = value || '';
    row.classList.toggle('is-ecarte', value === 'ecarte');
    keep.classList.toggle('is-active', value === 'favori');
    keep.lastChild.textContent = value === 'favori' ? 'Gardé' : 'Garder';
  };
  apply(track.status || '');
  // La ligne change d'abord, puis le compteur des écartées : jamais l'inverse à l'écran.
  const setStatus = async (value) => {
    apply(value);
    await onStatus(key, value);
  };
  status.addEventListener('change', () => setStatus(status.value || null));
  keep.addEventListener('click', () => setStatus(status.value === 'favori' ? null : 'favori'));
  drop.addEventListener('click', () => setStatus('ecarte'));
  note.addEventListener('change', () => onStatus(key, undefined, note.value));
  return row;
}

async function loadBiens(ctx, body) {
  const { search, isCurrent, store, layers, setKpi } = ctx;
  let groups = [];
  try {
    const res = await chrome.runtime.sendMessage({ type: 'SIGHTINGS_GROUPS' });
    groups = res && res.ok ? res.groups : [];
  } catch {
    groups = [];
  }
  const tracking = await store.tracking();
  if (!isCurrent()) return;
  const trackOf = (g) => tracking[trackingKey(g)] || {};
  const inSearch = groupsInZone(groups, search)
    .map((g) => ({ g, check: checkCriteria(listingOf(g), search) }))
    .filter((x) => x.check.ok);
  inSearch.sort((a, b) => STATUS_ORDER[trackOf(a.g).status || ''] - STATUS_ORDER[trackOf(b.g).status || ''] || b.g.lastSeen - a.g.lastSeen);

  const count = (status) => inSearch.filter((x) => trackOf(x.g).status === status).length;
  const refreshKpi = () => {
    const fav = count('favori');
    setKpi(1, num(inSearch.length), fav ? `annonces vues · ${fav} favori${fav > 1 ? 's' : ''}` : 'annonces vues');
  };
  refreshKpi();

  if (!inSearch.length) {
    body.replaceChildren(UI.empty('Aucune annonce vue dans cette recherche pour le moment. Chaque annonce ouverte sur un site couvert est ajoutée ici automatiquement, si elle passe les critères.'));
    return;
  }

  // Les annonces écartées sortent du fil ; un bouton permet de les revoir.
  let showDropped = false;
  const toggle = el('button', { type: 'button', class: 'imx-btn imx-btn-sm imx-btn-ghost' });
  const list = el('div', { class: 'imx-bien-list' });
  const refreshDropped = () => {
    const n = count('ecarte');
    list.classList.toggle('hide-ecarte', !showDropped);
    toggle.textContent = showDropped ? 'Masquer les écartées' : `Afficher les écartées (${n})`;
    toggle.classList.toggle('imx-hidden', !n && !showDropped);
  };
  toggle.addEventListener('click', () => {
    showDropped = !showDropped;
    refreshDropped();
  });
  const onStatus = async (key, status, note) => {
    const next = await store.setTracking(key, note === undefined ? { status } : { note });
    if (next) tracking[key] = next;
    else delete tracking[key];
    refreshKpi();
    refreshDropped();
  };
  list.replaceChildren(...inSearch.map(({ g, check }) => bienRow(g, trackOf(g), check.unknown, onStatus)));
  refreshDropped();
  body.replaceChildren(list, toggle);

  // Sur la carte : les biens dont l'adresse a été retrouvée avec une confiance élevée.
  for (const { g } of inSearch.filter((x) => x.g.address)) {
    const point = await geocode(g.address);
    if (!isCurrent() || !point) continue;
    g.point = point;
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

// ─── Fil ───

function renderFeed(ctx) {
  const { body, panel } = ctx;
  const biensBody = el('div', null, UI.loading('Lecture des annonces vues…'));
  const soonBody = el('div', null, UI.loading('Recherche des nouveaux DPE…'));
  const soon = panel('Bientôt en vente ?', soonBody);
  const periods = el(
    'div',
    { class: 'imx-seg', role: 'group', 'aria-label': 'Période' },
    [15, 30, 90].map((d) => {
      const b = el('button', { type: 'button', class: d === ctx.days ? 'is-active' : '' }, `${d} j`);
      b.addEventListener('click', () => ctx.onDays(d));
      return b;
    })
  );
  const hide = el('button', { type: 'button', class: 'imx-btn imx-btn-sm imx-btn-ghost' });
  const applyHidden = () => {
    const hidden = readPref(SOON_PREF) === '1';
    soonBody.classList.toggle('imx-hidden', hidden);
    periods.classList.toggle('imx-hidden', hidden);
    hide.textContent = hidden ? 'Afficher' : 'Masquer';
    hide.title = hidden ? 'Afficher « Bientôt en vente ? »' : 'Masquer « Bientôt en vente ? »';
  };
  hide.addEventListener('click', () => {
    writePref(SOON_PREF, readPref(SOON_PREF) === '1' ? null : '1');
    applyHidden();
  });
  applyHidden();
  soon.head.append(periods, hide);
  body.replaceChildren(panel('Annonces vues', biensBody).node, soon.node);
  loadBiens(ctx, biensBody);
  loadSoon(ctx, soonBody);
}

export { renderFeed };
