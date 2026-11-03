// Fil : « Annonces en vente », les annonces des sites lues par le robot (api/scan.js) pour les
// communes de la recherche. Un même bien publié par plusieurs sources forme une seule carte ;
// étiquettes Nouveau, Prix baissé, Retiré ; Garder et Écarter comme pour les annonces vues.
import { checkCriteria, trackingKey, STATUSES } from '../common/zones.js';
import { groupListings, listingFacts, statusOf, trackingKeyOf, urlKey, saleOf, negotiation, negotiationText, SOURCE_LABELS } from '../common/listings.js';
import { nearestSales, isComparable } from '../common/sectors.js';
import { loadSearchSales } from './sector-layer.js';
import { classLine } from '../common/energy-text.js';

const UI = window.__immodexUI;
const { el, icon, num } = UI;

const ORDER = { nouveau: 0, baisse: 1, null: 2, retire: 3 };
const DAY = 24 * 3600 * 1000;

function tagOf(st) {
  if (st.status === 'nouveau') return el('span', { class: 'imx-tag is-new' }, 'Nouveau');
  if (st.status === 'baisse') return el('span', { class: 'imx-tag is-drop' }, `Prix baissé de ${UI.priceText(st.drop)}`);
  if (st.status === 'retire') return el('span', { class: 'imx-tag is-gone' }, 'Retiré');
  return null;
}

function factsLine(f) {
  const type = f.type === 'appartement' ? 'Appartement' : f.type === 'maison' ? 'Maison' : null;
  return [type, f.pieces ? `${f.pieces} pièces` : null, f.chambres ? `${f.chambres} ch.` : null, f.surface ? `${num(f.surface)} m²` : null, f.terrain ? `terrain ${num(f.terrain)} m²` : null, f.garage ? 'garage mentionné' : null]
    .filter(Boolean)
    .join(' · ');
}

// Bien retiré relié à sa vente DVF : prix signé et écart au premier prix relevé par le robot.
function soldLine(g) {
  const sale = saleOf(g);
  if (!sale) return null;
  const gap = sale.margin == null ? '' : sale.margin >= 0 ? `, ${sale.margin} % sous le premier prix relevé` : `, ${-sale.margin} % au-dessus du premier prix relevé`;
  return el('div', { class: 'imx-meta imx-sold' }, `Vendue ${UI.priceText(sale.price)} le ${UI.formatDate(sale.date)}${gap} (${sale.how === 'sure' ? 'lien sûr, même adresse' : 'lien probable'})`);
}

function annonceRow(g, key, f, st, track, unknown, onStatus, now) {
  const keep = el('button', { type: 'button', class: 'imx-btn imx-btn-sm' }, icon('check', 14), 'Garder');
  const drop = el('button', { type: 'button', class: 'imx-btn imx-btn-sm imx-btn-ghost' }, icon('trash', 14), 'Écarter');
  const note = el('textarea', { class: 'imx-note', placeholder: 'Note : visite, défauts, contact…', maxlength: '1000' }, track.note || '');
  const days = Math.max(0, Math.round((now - f.firstSeen) / DAY));
  const row = el(
    'div',
    { class: `imx-row imx-annonce${st.status === 'retire' ? ' is-gone' : ''}` },
    el(
      'div',
      { class: 'imx-row-head' },
      el('div', null, el('div', { class: 'imx-candidate-address' }, f.price ? UI.priceText(f.price) : 'Prix non précisé', f.price && f.surface ? el('span', { class: 'imx-ppm' }, ` · ${num(Math.round(f.price / f.surface))} €/m²`) : null), el('div', { class: 'imx-meta' }, factsLine(f) || f.title || 'Annonce')),
      f.photo ? el('img', { class: 'imx-annonce-photo', src: f.photo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null
    ),
    el('div', { class: 'imx-tags' }, tagOf(st), g.probable ? el('span', { class: 'imx-tag' }, 'même bien probable') : null),
    el(
      'div',
      { class: 'imx-meta' },
      [f.address || f.city || null, days ? `en ligne depuis ${days} jour${days > 1 ? 's' : ''}` : 'vu aujourd’hui', g.listings.length > 1 ? `${g.listings.length} sources` : null].filter(Boolean).join(' · ')
    ),
    unknown.length ? el('div', { class: 'imx-meta imx-unknown' }, unknown.join(' · ')) : null,
    soldLine(g),
    el('div', { class: 'imx-meta imx-nearby imx-hidden' }),
    el('div', { class: 'imx-meta imx-energy imx-hidden' }),
    el('div', { class: 'imx-actions' }, keep, drop),
    note,
    el(
      'div',
      { class: 'imx-actions' },
      g.listings.map((l) => UI.linkButton(l.url, SOURCE_LABELS[l.source] || l.source, { iconName: 'external' }))
    )
  );
  const apply = (value) => {
    row.classList.toggle('is-ecarte', value === 'ecarte');
    keep.classList.toggle('is-active', value === 'favori');
    keep.lastChild.textContent = value === 'favori' ? 'Gardé' : 'Garder';
  };
  apply(track.status || '');
  let current = track.status || null;
  const setStatus = async (value) => {
    current = value;
    apply(value);
    await onStatus(key, value);
  };
  keep.addEventListener('click', () => setStatus(current === 'favori' ? null : 'favori'));
  drop.addEventListener('click', () => setStatus('ecarte'));
  note.addEventListener('change', () => onStatus(key, undefined, note.value));
  return row;
}

// Ligne d'état : passage du robot et sources en pause.
function robotLine(data, groups = []) {
  const nego = negotiation(groups);
  const paused = new Set();
  for (const perSource of Object.values(data.sources || {})) for (const [id, m] of Object.entries(perSource)) if (m && m.paused) paused.add(SOURCE_LABELS[id] || id);
  return el(
    'div',
    { class: 'imx-meta', style: 'margin:0 0 6px' },
    data.lastRun ? `Dernier passage du robot : ${UI.formatDateTime(data.lastRun)}.` : 'Le robot n’est pas encore passé pour ces communes : il lit les sites chaque nuit.',
    paused.size ? ` ${[...paused].join(', ')} en pause : le site refuse le robot, nouvel essai dans une semaine.` : '',
    nego ? el('div', { class: 'imx-nego' }, negotiationText(nego)) : null
  );
}

async function loadAnnonces(ctx, body) {
  const { search, isCurrent, store, layers, previousVisit } = ctx;
  let data;
  try {
    data = await ctx.listings;
  } catch {
    data = null;
  }
  if (!isCurrent()) return;
  if (!data) {
    body.replaceChildren(UI.alert('Annonces du robot injoignables pour le moment.'));
    return;
  }
  const now = Date.now();
  const tracking = await store.tracking();
  // Annonces vues dans le navigateur : leur clé de suivi, par adresse d'annonce.
  const seenByUrl = new Map();
  try {
    const res = await chrome.runtime.sendMessage({ type: 'SIGHTINGS_GROUPS' });
    for (const sg of (res && res.ok && res.groups) || []) for (const s of sg.sightings || []) seenByUrl.set(urlKey(s.url), trackingKey(sg));
  } catch {
    // Pas d'annonces vues : les clés des annonces du robot suffisent.
  }
  if (!isCurrent()) return;
  const groups = groupListings(data.listings || [])
    .map((g) => {
      const f = listingFacts(g);
      return { g, f, st: statusOf(g, previousVisit, now), check: checkCriteria(f, search) };
    })
    .filter((x) => x.check.ok && !(search.type && x.f.type && x.f.type !== search.type));
  groups.sort((a, b) => ORDER[a.st.status] - ORDER[b.st.status] || b.f.firstSeen - a.f.firstSeen);

  if (!groups.length) {
    body.replaceChildren(robotLine(data), UI.empty('Aucune annonce en vente qui passe tes critères pour le moment.'));
    return;
  }
  let showDropped = false;
  const keyOf = new Map(groups.map((x) => [x.g, trackingKeyOf(x.g, tracking, seenByUrl)]));
  const trackOf = (key) => tracking[key] || {};
  const toggle = el('button', { type: 'button', class: 'imx-btn imx-btn-sm imx-btn-ghost' });
  const list = el('div', { class: 'imx-bien-list' });
  const refreshDropped = () => {
    const n = groups.filter((x) => trackOf(keyOf.get(x.g)).status === 'ecarte').length;
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
    refreshDropped();
  };
  const rows = new Map(groups.map((x) => [x.g, annonceRow(x.g, keyOf.get(x.g), x.f, x.st, trackOf(keyOf.get(x.g)), x.check.unknown, onStatus, now)]));
  list.replaceChildren(...rows.values());
  refreshDropped();
  body.replaceChildren(robotLine(data, groups.map((x) => x.g)), list, toggle);

  // Sur la carte : les biens dont l'adresse a été retrouvée par leur DPE.
  const placed = groups.filter((x) => x.f.lat != null && x.f.lon != null && x.st.status !== 'retire');
  for (const { g, f, st } of placed) {
    const status = trackOf(keyOf.get(g)).status || '';
    const marker = L.marker([f.lat, f.lon], {
      icon: L.divIcon({ className: '', html: `<div class="imx-bien-pin is-${status} is-annonce"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] }),
      title: f.address || f.title || '',
    });
    marker.bindPopup(
      el(
        'div',
        { style: 'display:grid;gap:8px' },
        el('div', { class: 'imx-candidate-address' }, f.price ? UI.priceText(f.price) : 'Prix non précisé', f.price && f.surface ? el('span', { class: 'imx-ppm' }, ` · ${num(Math.round(f.price / f.surface))} €/m²`) : null),
        el('div', { class: 'imx-meta' }, [factsLine(f), f.address, STATUSES[status] || null].filter(Boolean).join(' · ')),
        tagOf(st),
        el('div', { class: 'imx-actions' }, g.listings.map((l) => UI.linkButton(l.url, SOURCE_LABELS[l.source] || l.source, { iconName: 'external' })))
      )
    );
    layers.biens.addLayer(marker);
  }

  // Repères de prix : classe énergie du bien dans sa commune, 15 ventes les plus proches.
  if (!placed.length && !groups.some((x) => x.f.energyClass)) return;
  const sales = await loadSearchSales(search).catch(() => null);
  if (!sales || !isCurrent()) return;
  for (const { g, f } of groups) {
    const insee = g.listings[0].insee;
    const name = (search.communes.find((c) => c.code === insee) || {}).nom;
    const text = classLine(f.energyClass, insee, sales.energy, name, num);
    const line = rows.get(g).querySelector('.imx-energy');
    if (!text || !line) continue;
    line.textContent = text;
    line.classList.remove('imx-hidden');
  }
  for (const { g, f } of placed) {
    const near = nearestSales(sales.sales, { lat: f.lat, lon: f.lon });
    const line = rows.get(g).querySelector('.imx-nearby');
    if (!near || !line) continue;
    const comparable = near.sales.filter((v) => isComparable(v, search)).length;
    line.textContent = `Ventes proches : ${num(near.p25)} à ${num(near.p75)} €/m² (${near.sales.length} ventes dans un rayon de ${num(near.radius)} m, dont ${comparable} comparables)${sales.partial ? ', données DVF partielles' : ''}`;
    line.classList.remove('imx-hidden');
  }
}

export { loadAnnonces };
