// Fil : « Annonces en vente », les annonces des sites lues par le robot (api/scan.js) pour les
// communes de la recherche. Un même bien publié par plusieurs sources forme une seule carte ;
// étiquettes Nouveau, Prix baissé, Retiré ; Garder et Écarter comme pour les annonces vues.
// Un bien sans adresse retrouvée montre ses pistes d'adresse, que Nathan vérifie (leads.js).
import { checkCriteria, trackingKey, STATUSES } from '../common/zones.js';
import { groupListings, listingFacts, statusOf, trackingKeyOf, urlKey, saleOf, negotiation, negotiationText, placeOf, needsPlace, SOURCE_LABELS } from '../common/listings.js';
import { nearestSales, isComparable } from '../common/sectors.js';
import { loadSearchSales } from './sector-layer.js';
import { classLine } from '../common/energy-text.js';
import { placeListing } from './pins.js';
import { leadsBlock, placedLine } from './leads.js';

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

// `where` : point du bien (placeOf), commune de l'annonce et choix d'adresse (onPlace).
function annonceRow(g, key, f, st, track, unknown, onStatus, now, where) {
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
      [
        where.place && where.place.by === 'registre' ? where.place.address : where.place ? null : f.address || where.communeName,
        !where.place && st.status !== 'retire' && !(track.place && track.place.none) ? 'adresse non retrouvée, pas de point sur la carte' : null,
        days ? `en ligne depuis ${days} jour${days > 1 ? 's' : ''}` : 'vu aujourd’hui',
        g.listings.length > 1 ? `${g.listings.length} sources` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    ),
    track.place && ((track.place.none && !where.place) || (where.place && where.place.by !== 'registre')) ? placedLine(track.place, where.onPlace) : null,
    unknown.length ? el('div', { class: 'imx-meta imx-unknown' }, unknown.join(' · ')) : null,
    soldLine(g),
    el('div', { class: 'imx-meta imx-nearby imx-hidden' }),
    el('div', { class: 'imx-meta imx-energy imx-hidden' }),
    where.toPlace ? leadsBlock({ leads: f.leads, hasDpe: f.hasDpe, pending: f.leadsPending, address: f.address, insee: g.listings[0].insee, communeName: where.communeName, onPlace: where.onPlace }) : null,
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

// Ligne d'état : passage du robot, annonces qu'il n'a pas encore lues et sources en pause.
function robotLine(data, groups = [], unread = 0) {
  const nego = negotiation(groups);
  const paused = new Set();
  for (const perSource of Object.values(data.sources || {})) for (const [id, m] of Object.entries(perSource)) if (m && m.paused) paused.add(SOURCE_LABELS[id] || id);
  return el(
    'div',
    { class: 'imx-meta', style: 'margin:0 0 6px' },
    data.lastRun ? `Dernier passage du robot : ${UI.formatDateTime(data.lastRun)}.` : 'Le robot n’est pas encore passé pour ces communes : il lit les sites chaque nuit.',
    unread > 1 ? ` ${unread} autres annonces attendent qu’il lise leur page (prochaines nuits) : celles qui passent tes critères arriveront ici.` : '',
    unread === 1 ? ' 1 autre annonce attend qu’il lise sa page (prochaine nuit) : si elle passe tes critères, elle arrivera ici.' : '',
    paused.size ? ` ${[...paused].join(', ')} en pause : le site refuse le robot, nouvel essai dans une semaine.` : '',
    nego ? el('div', { class: 'imx-nego' }, negotiationText(nego)) : null
  );
}

async function loadAnnonces(ctx, body) {
  const { search, isCurrent, store, layers, markers, focus, previousVisit } = ctx;
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
  const passing = groupListings(data.listings || [])
    .map((g) => {
      const f = listingFacts(g);
      return { g, f, st: statusOf(g, previousVisit, now), check: checkCriteria(f, search) };
    })
    .filter((x) => x.check.ok);
  // Biens dont le robot n'a lu aucune page : comptés, pas montrés (surface et chambres inconnues).
  const unread = passing.filter((x) => x.f.unread).length;
  const groups = passing.filter((x) => !x.f.unread);
  groups.sort((a, b) => ORDER[a.st.status] - ORDER[b.st.status] || b.f.firstSeen - a.f.firstSeen);

  if (!groups.length) {
    body.replaceChildren(robotLine(data, [], unread), UI.empty('Aucune annonce en vente qui passe tes critères pour le moment.'));
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
    // Bien écarté puis gardé (ou l'inverse) : sa carte gagne ou perd le bloc des pistes.
    for (const x of groups) {
      if (keyOf.get(x.g) !== key) continue;
      const want = needsPlace(x.f, trackOf(key), x.st);
      if (want !== !!rows.get(x.g).querySelector('.imx-leads')) redraw(x);
    }
    refreshDropped();
    refreshToPlace();
  };
  const communeOf = (x) => (search.communes.find((c) => c.code === x.g.listings[0].insee) || {}).nom || x.f.city || '';
  const placeFor = (x) => placeOf(x.f, trackOf(keyOf.get(x.g)));
  let sales = null; // ventes DVF de la recherche, une fois chargées (repères de prix)

  // Carte du Fil d'un bien ; reconstruite quand Nathan choisit (ou annule) son adresse.
  const rows = new Map();
  const build = (x) => {
    const key = keyOf.get(x.g);
    const track = trackOf(key);
    const where = { place: placeFor(x), toPlace: needsPlace(x.f, track, x.st), communeName: communeOf(x), onPlace: (place) => setPlace(x, place) };
    const row = annonceRow(x.g, key, x.f, x.st, track, x.check.unknown, onStatus, now, where);
    rows.set(x.g, row);
    return row;
  };

  // Point du bien sur la carte : adresse du registre ou choisie à la main, prix sur le point.
  const pin = (x) => {
    const key = keyOf.get(x.g);
    const id = `annonce:${key}`;
    if (markers.has(id)) {
      layers.biens.removeLayer(markers.get(id));
      markers.delete(id);
    }
    const place = placeFor(x);
    if (!place || x.st.status === 'retire') return;
    const { g, f, st } = x;
    const status = trackOf(key).status || '';
    placeListing({
      layer: layers.biens,
      markers,
      id,
      lat: place.lat,
      lon: place.lon,
      price: f.price,
      status,
      title: place.address || f.title || '',
      row: rows.get(g),
      focus,
      popup: el(
        'div',
        { class: 'imx-pin-popup' },
        f.photo ? el('img', { class: 'imx-pin-photo', src: f.photo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
        el('div', { class: 'imx-candidate-address' }, f.price ? UI.priceText(f.price) : 'Prix non précisé', f.price && f.surface ? el('span', { class: 'imx-ppm' }, ` · ${num(Math.round(f.price / f.surface))} €/m²`) : null),
        el('div', { class: 'imx-meta' }, [factsLine(f), place.address, place.by === 'registre' ? null : 'adresse choisie par toi', STATUSES[status] || null].filter(Boolean).join(' · ')),
        tagOf(st),
        el('div', { class: 'imx-actions' }, g.listings.map((l) => UI.linkButton(l.url, SOURCE_LABELS[l.source] || l.source, { iconName: 'external' })))
      ),
    });
  };

  // Repères de prix d'une carte : classe énergie du bien dans sa commune, ventes les plus proches.
  const fillLines = (x) => {
    if (!sales) return;
    const { g, f } = x;
    const row = rows.get(g);
    const insee = g.listings[0].insee;
    const text = classLine(f.energyClass, insee, sales.energy, communeOf(x), num);
    const energy = row.querySelector('.imx-energy');
    if (text && energy) {
      energy.textContent = text;
      energy.classList.remove('imx-hidden');
    }
    const place = placeFor(x);
    const near = place ? nearestSales(sales.sales, { lat: place.lat, lon: place.lon }) : null;
    const line = row.querySelector('.imx-nearby');
    if (!near || !line) return;
    const comparable = near.sales.filter((v) => isComparable(v, search)).length;
    line.textContent = `Ventes proches : ${num(near.p25)} à ${num(near.p75)} €/m² (${near.sales.length} ventes dans un rayon de ${num(near.radius)} m, dont ${comparable} comparables)${sales.partial ? ', données DVF partielles' : ''}`;
    line.classList.remove('imx-hidden');
  };

  // Alerte en tête du Fil : biens sans point, avec un filtre qui ne garde qu'eux.
  let onlyToPlace = false;
  const alertBox = el('div', { class: 'imx-notice imx-to-place imx-hidden' });
  const refreshToPlace = () => {
    const todo = groups.filter((x) => needsPlace(x.f, trackOf(keyOf.get(x.g)), x.st));
    for (const x of groups) rows.get(x.g).classList.toggle('is-to-place', todo.includes(x));
    if (!todo.length) {
      onlyToPlace = false;
      for (const row of rows.values()) row.classList.remove('is-just-placed');
    }
    list.classList.toggle('only-to-place', onlyToPlace);
    alertBox.classList.toggle('imx-hidden', !todo.length);
    if (!todo.length) return;
    const button = el('button', { type: 'button', class: 'imx-btn imx-btn-sm' }, onlyToPlace ? 'Tout le Fil' : 'Les placer');
    button.addEventListener('click', () => {
      onlyToPlace = !onlyToPlace;
      // Biens à placer : pistes dépliées, cartes déjà placées pendant la vérification gardées.
      for (const x of todo) rows.get(x.g).querySelector('.imx-leads')?.toggleAttribute('open', onlyToPlace);
      if (!onlyToPlace) for (const row of rows.values()) row.classList.remove('is-just-placed');
      refreshToPlace();
      if (onlyToPlace) list.scrollIntoView({ block: 'start' });
    });
    const n = todo.length;
    alertBox.replaceChildren(
      icon('pin', 16),
      el('div', null, `${n} annonce${n > 1 ? 's' : ''} sans point sur la carte. Vérifie les adresses possibles sur Street View, ou saisis la bonne.`),
      button
    );
  };

  // Carte du Fil reconstruite et point replacé (choix d'adresse, bien écarté puis gardé).
  const redraw = (x) => {
    const old = rows.get(x.g);
    const row = build(x);
    if (onlyToPlace) row.classList.add('is-just-placed');
    old.replaceWith(row);
    pin(x);
    fillLines(x);
  };
  const setPlace = async (x, place) => {
    // Autre recherche ouverte entre-temps (adresse saisie lente) : rien ne change sur sa carte.
    if (!isCurrent()) return;
    const key = keyOf.get(x.g);
    const next = await store.setTracking(key, { place });
    if (next) tracking[key] = next;
    else delete tracking[key];
    if (!isCurrent()) return;
    redraw(x);
    refreshDropped();
    refreshToPlace();
  };

  for (const x of groups) build(x);
  list.replaceChildren(...rows.values());
  refreshDropped();
  refreshToPlace();
  body.replaceChildren(robotLine(data, groups.map((x) => x.g), unread), alertBox, list, toggle);
  for (const x of groups) pin(x);

  sales = await loadSearchSales(search).catch(() => null);
  if (!sales || !isCurrent()) {
    sales = null;
    return;
  }
  for (const x of groups) fillLines(x);
}

export { loadAnnonces };
