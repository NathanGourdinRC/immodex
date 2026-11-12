// Fil : « Annonces en vente », les annonces des sites lues par le robot (api/scan.js) pour les
// communes de la recherche. Un même bien publié par plusieurs sources forme une seule carte ;
// étiquettes Nouveau, Prix baissé, Retiré ; Garder et Écarter, dans la carte du Fil comme dans la
// bulle du point (verdict.js). Une annonce apportée par le robot reste jaune (carte et point)
// jusqu'au premier clic dessus ; ce clic est rangé avec le suivi, donc synchronisé.
// Un bien sans adresse retrouvée montre ses pistes d'adresse, que Nathan vérifie (leads.js).
// S'il lui manque un critère demandé par la recherche, il est masqué : un bouton le remontre.
import { checkCriteria, trackingKey, returnedByPrice } from '../common/zones.js';
import { groupListings, listingFacts, statusOf, isUnopened, trackingKeyOf, urlKey, saleOf, negotiation, negotiationText, placeOf, needsPlace, isIncomplete, SOURCE_LABELS } from '../common/listings.js';
import { nearestSales, isComparable } from '../common/sectors.js';
import { loadSearchSales } from './sector-layer.js';
import { classLine } from '../common/energy-text.js';
import { placeListing, setPinState } from './pins.js';
import { leadsBlock, placedLine } from './leads.js';
import { verdictButtons, droppedChanged, droppedToggle } from './verdict.js';
import { lbcTourLine } from './lbc-tour-line.js';
import { selogerTourLine } from './seloger-tour-line.js';

const UI = window.__immodexUI;
const { el, num } = UI;

const ORDER = { nouveau: 0, baisse: 1, null: 2, retire: 3 };
const DAY = 24 * 3600 * 1000;

// Verdict d'un suivi pour les boutons : « écarté, trop cher » se distingue d'« écarté, pas pertinent ».
const verdictOf = (track) => (track.status === 'ecarte' && track.reason === 'prix' ? 'ecarte-prix' : track.status || null);

// Bien refusé « trop cher » dont le prix a baissé (zones.js, returnedByPrice) : dit d'un coup d'œil
// pourquoi il est revenu et de combien.
const backText = (back) => `Revenu, prix baissé de ${UI.priceText(back.drop)} depuis ton refus (${UI.priceText(back.was)} → ${UI.priceText(back.now)}, −${num(back.percent)} %)`;

// Étiquettes d'un bien. « Nouveau » (jaune) : annonce du robot pas encore ouverte.
function tagsOf(st, fresh, back) {
  return [
    back ? el('span', { class: 'imx-tag is-back' }, backText(back)) : null,
    fresh ? el('span', { class: 'imx-tag is-fresh' }, 'Nouveau') : null,
    st.status === 'baisse' ? el('span', { class: 'imx-tag is-drop' }, `Prix baissé de ${UI.priceText(st.drop)}`) : null,
    st.status === 'retire' ? el('span', { class: 'imx-tag is-gone' }, 'Retiré') : null,
  ].filter(Boolean);
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

// `was` : prix du refus « trop cher », barré à côté du prix actuel quand le bien est revenu.
const priceHead = (f, back) =>
  el(
    'div',
    { class: 'imx-candidate-address' },
    f.price ? UI.priceText(f.price) : 'Prix non précisé',
    el('s', { class: `imx-was${back ? '' : ' imx-hidden'}` }, back ? UI.priceText(back.was) : ''),
    f.price && f.surface ? el('span', { class: 'imx-ppm' }, ` · ${num(Math.round(f.price / f.surface))} €/m²`) : null
  );
const sourceLinks = (g) => el('div', { class: 'imx-actions' }, g.listings.map((l) => UI.linkButton(l.url, SOURCE_LABELS[l.source] || l.source, { iconName: 'external' })));

// Carte du Fil d'un bien. `where` : point du bien (placeOf), commune de l'annonce et choix
// d'adresse (onPlace). Rend la carte et la fonction qui remet ses boutons Garder / Écarter à jour.
function annonceRow(g, key, f, st, track, unknown, onStatus, now, where) {
  // « Trop cher » garde le prix du jour : le bien revient quand il baisse de 2 % (zones.js).
  const verdict = verdictButtons((value, reason) => onStatus(key, value, undefined, reason ? { reason, priceAt: f.price } : undefined), { price: !!f.price });
  const note = el('textarea', { class: 'imx-note', placeholder: 'Note : visite, défauts, contact…', maxlength: '1000' }, track.note || '');
  const days = Math.max(0, Math.round((now - f.firstSeen) / DAY));
  const row = el(
    'div',
    { class: `imx-row imx-annonce${st.status === 'retire' ? ' is-gone' : ''}` },
    el('div', { class: 'imx-row-head' }, el('div', null, priceHead(f, track.back), el('div', { class: 'imx-meta' }, factsLine(f) || f.title || 'Annonce')), f.photo ? el('img', { class: 'imx-annonce-photo', src: f.photo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null),
    el('div', { class: 'imx-tags' }),
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
    verdict.node,
    note,
    sourceLinks(g)
  );
  note.addEventListener('change', () => onStatus(key, undefined, note.value));
  return { row, apply: verdict.apply };
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

  if (!groups.length) {
    body.replaceChildren(robotLine(data, [], unread), lbcTourLine(), selogerTourLine(), UI.empty('Aucune annonce en vente qui passe tes critères pour le moment.'));
    return;
  }
  for (const x of groups) x.key = trackingKeyOf(x.g, tracking, seenByUrl);
  // Suivi d'un bien tel que le Fil le voit : refusé « trop cher » et son prix a baissé de 2 % →
  // il n'est plus écarté (`status` nul) et porte `back` (ancien prix, nouveau prix, écart).
  // Refusé « pas pertinent » : jamais de retour. `tracking` garde le suivi tel qu'enregistré.
  const priceOfKey = new Map(groups.map((x) => [x.key, x.f.price]));
  const trackOf = (key) => {
    const t = tracking[key] || {};
    const back = returnedByPrice(t, priceOfKey.get(key));
    return back ? { ...t, status: null, back } : t;
  };
  const isBack = (x) => !!trackOf(x.key).back;
  // Jaune : annonce du robot jamais ouverte, ni sur ce tableau de bord, ni sur le site d'origine.
  const isFresh = (x) => isUnopened(x.g, trackOf(x.key), { seenUrls: seenByUrl });
  // Biens sans adresse à qui il manque un critère : cachés tant que le bouton ne les montre pas
  // (choix non gardé, comme pour les écartées). Cachés, ils ne comptent ni comme nouveautés ni
  // comme biens à placer.
  let showIncomplete = false;
  const masked = (x) => isIncomplete(x.f, trackOf(x.key), x.check.unknown);
  const onScreen = () => groups.filter((x) => showIncomplete || !masked(x));
  // Les jaunes et les biens revenus après une baisse d'abord, puis baisses de prix, le reste, les
  // retirées ; les plus récentes en tête.
  groups.sort((a, b) => Number(isFresh(b) || isBack(b)) - Number(isFresh(a) || isBack(a)) || ORDER[a.st.status] - ORDER[b.st.status] || b.f.firstSeen - a.f.firstSeen);

  const list = el('div', { class: 'imx-bien-list' });
  const toggle = droppedToggle(() => groups.filter((x) => trackOf(x.key).status === 'ecarte').length, isCurrent);
  const keep = (key, next) => {
    if (next) tracking[key] = next;
    else delete tracking[key];
  };

  // Carte du Fil, point et bulle d'un bien remis à jour d'après son suivi (Garder, Écarter, clic).
  const refresh = (x) => {
    const track = trackOf(x.key);
    const status = track.status || null;
    const fresh = isFresh(x);
    x.row.classList.toggle('is-ecarte', status === 'ecarte');
    x.row.classList.toggle('is-kept', status === 'favori');
    x.row.classList.toggle('is-incomplete', masked(x));
    x.row.classList.toggle('is-fresh', fresh);
    x.row.classList.toggle('is-back', !!track.back);
    // Ancien prix barré à côté du prix actuel (bien revenu après une baisse).
    const was = x.row.querySelector('.imx-was');
    if (was) {
      was.textContent = track.back ? UI.priceText(track.back.was) : '';
      was.classList.toggle('imx-hidden', !track.back);
    }
    x.applyRow(verdictOf(track));
    x.row.querySelector('.imx-tags').replaceChildren(...tagsOf(x.st, fresh, track.back), ...(x.g.probable ? [el('span', { class: 'imx-tag' }, 'même bien probable')] : []));
    if (!x.marker) return;
    setPinState(x.marker, { price: x.f.price, status, fresh });
    x.applyPopup(verdictOf(track));
    x.popupTags.replaceChildren(...tagsOf(x.st, fresh, track.back));
  };

  // Bandeau des nouveautés : combien d'annonces jaunes, et les marquer toutes comme vues.
  const freshBar = el('div', { class: 'imx-fresh-bar imx-hidden' });
  const refreshFresh = () => {
    const todo = onScreen().filter(isFresh);
    freshBar.classList.toggle('imx-hidden', !todo.length);
    if (!todo.length) return;
    const all = el('button', { type: 'button', class: 'imx-btn imx-btn-sm' }, 'Tout marquer comme vu');
    all.addEventListener('click', async () => {
      const saved = await store.markOpened(todo.map((x) => x.key));
      for (const x of todo) keep(x.key, saved[x.key]);
      if (!isCurrent()) return;
      todo.forEach(refresh);
      refreshFresh();
    });
    const n = todo.length;
    freshBar.replaceChildren(el('div', null, n > 1 ? `${n} nouvelles annonces, en jaune jusqu’à ce que tu les ouvres.` : '1 nouvelle annonce, en jaune jusqu’à ce que tu l’ouvres.'), all);
  };

  // Premier clic sur une annonce jaune (carte du Fil, point, bouton) : elle redevient normale.
  const open = async (x) => {
    if (!isFresh(x)) return;
    keep(x.key, await store.setTracking(x.key, { opened: Date.now() }));
    if (!isCurrent()) return;
    refresh(x);
    refreshFresh();
  };

  // `extra` : { reason: 'prix', priceAt } pour « Trop cher » (voir verdictButtons).
  const onStatus = async (key, status, note, extra) => {
    keep(key, await store.setTracking(key, note === undefined ? { status, ...extra } : { note }));
    if (!isCurrent()) return;
    // Une note ou un verdict fait entrer le bien dans ceux que Nathan a touchés (ou l'en sort).
    if (note !== undefined) {
      for (const x of groups) if (x.key === key) refresh(x);
      refreshIncomplete();
      return;
    }
    for (const x of groups) {
      if (x.key !== key) continue;
      // Bien écarté puis gardé (ou l'inverse) : sa carte gagne ou perd le bloc des pistes.
      if (needsPlace(x.f, trackOf(key), x.st) !== !!x.row.querySelector('.imx-leads')) redraw(x);
      else refresh(x);
    }
    droppedChanged();
    refreshIncomplete();
  };
  const communeOf =(x) => (search.communes.find((c) => c.code === x.g.listings[0].insee) || {}).nom || x.f.city || '';
  const placeFor = (x) => placeOf(x.f, trackOf(x.key));
  let sales = null; // ventes DVF de la recherche, une fois chargées (repères de prix)

  // Carte du Fil d'un bien ; reconstruite quand Nathan choisit (ou annule) son adresse.
  const build = (x) => {
    const track = trackOf(x.key);
    const where = { place: placeFor(x), toPlace: needsPlace(x.f, track, x.st), communeName: communeOf(x), onPlace: (place) => setPlace(x, place) };
    const { row, apply } = annonceRow(x.g, x.key, x.f, x.st, track, x.check.unknown, onStatus, now, where);
    // Tout clic dans la carte (bouton, lien, note) compte comme une ouverture.
    row.addEventListener('click', () => open(x));
    x.row = row;
    x.applyRow = apply;
    return row;
  };

  // Point du bien sur la carte : adresse du registre ou choisie à la main, prix sur le point.
  // Sa bulle reprend Garder et Écarter : au doigt, sur la vue Carte d'un téléphone.
  const pin = (x) => {
    const id = `annonce:${x.key}`;
    if (markers.has(id)) {
      layers.biens.removeLayer(markers.get(id));
      markers.delete(id);
    }
    x.marker = null;
    const place = placeFor(x);
    if (!place || x.st.status === 'retire') return;
    const { g, f } = x;
    const status = trackOf(x.key).status || '';
    const verdict = verdictButtons((value, reason) => onStatus(x.key, value, undefined, reason ? { reason, priceAt: f.price } : undefined), { price: !!f.price });
    x.popupTags = el('div', { class: 'imx-tags' });
    x.applyPopup = verdict.apply;
    x.marker = placeListing({
      layer: layers.biens,
      markers,
      id,
      lat: place.lat,
      lon: place.lon,
      price: f.price,
      status,
      fresh: isFresh(x),
      title: place.address || f.title || '',
      row: x.row,
      focus,
      popup: el(
        'div',
        { class: 'imx-pin-popup' },
        f.photo ? el('img', { class: 'imx-pin-photo', src: f.photo, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
        priceHead(f),
        el('div', { class: 'imx-meta' }, [factsLine(f), place.address, place.by === 'registre' ? null : 'adresse choisie par toi'].filter(Boolean).join(' · ')),
        x.popupTags,
        verdict.node,
        sourceLinks(g)
      ),
    });
    x.marker.on('popupopen', () => open(x));
    refresh(x);
  };

  // Repères de prix d'une carte : classe énergie du bien dans sa commune, ventes les plus proches.
  const fillLines = (x) => {
    if (!sales) return;
    const { g, f, row } = x;
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
    const todo = onScreen().filter((x) => needsPlace(x.f, trackOf(x.key), x.st));
    for (const x of groups) x.row.classList.toggle('is-to-place', todo.includes(x));
    if (!todo.length) {
      onlyToPlace = false;
      for (const x of groups) x.row.classList.remove('is-just-placed');
    }
    list.classList.toggle('only-to-place', onlyToPlace);
    alertBox.classList.toggle('imx-hidden', !todo.length);
    if (!todo.length) return;
    const button = el('button', { type: 'button', class: 'imx-btn imx-btn-sm' }, onlyToPlace ? 'Tout le Fil' : 'Les placer');
    button.addEventListener('click', () => {
      onlyToPlace = !onlyToPlace;
      // Biens à placer : pistes dépliées, cartes déjà placées pendant la vérification gardées.
      for (const x of todo) x.row.querySelector('.imx-leads')?.toggleAttribute('open', onlyToPlace);
      if (!onlyToPlace) for (const x of groups) x.row.classList.remove('is-just-placed');
      refreshToPlace();
      if (onlyToPlace) list.scrollIntoView({ block: 'start' });
    });
    const n = todo.length;
    alertBox.replaceChildren(
      UI.icon('pin', 16),
      el('div', null, `${n} annonce${n > 1 ? 's' : ''} sans point sur la carte. Vérifie les adresses possibles sur Street View, ou saisis la bonne.`),
      button
    );
  };

  // Ligne des biens masqués : combien, et le bouton qui les montre ou les cache. Le nombre change
  // avec le suivi (Garder, note, adresse choisie), et avec lui les nouveautés et les biens à placer.
  const incompleteBar = el('div', { class: 'imx-incomplete-bar imx-hidden' });
  const refreshIncomplete = () => {
    const n = groups.filter(masked).length;
    list.classList.toggle('show-incomplete', showIncomplete);
    incompleteBar.classList.toggle('imx-hidden', !n);
    refreshToPlace();
    refreshFresh();
    refreshKept();
    if (!n) return;
    const button = el('button', { type: 'button', class: 'imx-btn imx-btn-sm imx-btn-ghost' }, showIncomplete ? 'Masquer' : 'Afficher');
    button.addEventListener('click', () => {
      showIncomplete = !showIncomplete;
      refreshIncomplete();
    });
    const what = n > 1 ? `${n} annonces sans adresse ${showIncomplete ? 'affichées' : 'masquées'} : il leur manque` : `1 annonce sans adresse ${showIncomplete ? 'affichée' : 'masquée'} : il lui manque`;
    incompleteBar.replaceChildren(el('div', null, `${what} une information demandée par ta recherche.`), button);
  };

  // Barre « Mon tri », en haut du Fil : retrouver d'un geste les biens gardés (liste réduite à eux)
  // et les écartés (bouton déplacé ici, il était tout en bas d'une longue liste). Les écartées
  // sont cachées à chaque ouverture ; sans cette barre, le tri fait comme s'il avait disparu.
  let onlyKept = false;
  const triBar = el('div', { class: 'imx-tri-bar imx-hidden' });
  const refreshKept = () => {
    const n = groups.filter((x) => trackOf(x.key).status === 'favori').length;
    if (!n) onlyKept = false;
    list.classList.toggle('only-kept', onlyKept);
    const kept = el('button', { type: 'button', class: 'imx-btn imx-btn-sm imx-btn-ghost' }, onlyKept ? 'Tout le Fil' : `Mes gardées (${n})`);
    kept.classList.toggle('imx-hidden', !n);
    kept.setAttribute('aria-pressed', String(onlyKept));
    kept.addEventListener('click', () => {
      onlyKept = !onlyKept;
      refreshKept();
    });
    triBar.replaceChildren(el('span', { class: 'imx-meta' }, 'Mon tri'), kept, toggle);
    // Rien de trié (ni gardée, ni écartée) : pas de barre.
    triBar.classList.toggle('imx-hidden', !n && toggle.classList.contains('imx-hidden'));
  };

  // Carte du Fil reconstruite et point replacé (choix d'adresse, bien écarté puis gardé).
  const redraw = (x) => {
    const old = x.row;
    const row = build(x);
    if (onlyToPlace) row.classList.add('is-just-placed');
    old.replaceWith(row);
    pin(x);
    if (!x.marker) refresh(x);
    fillLines(x);
  };
  const setPlace = async (x, place) => {
    // Autre recherche ouverte entre-temps (adresse saisie lente) : rien ne change sur sa carte.
    if (!isCurrent()) return;
    keep(x.key, await store.setTracking(x.key, { place }));
    if (!isCurrent()) return;
    redraw(x);
    droppedChanged();
    refreshIncomplete();
  };

  for (const x of groups) build(x);
  list.replaceChildren(...groups.map((x) => x.row));
  for (const x of groups) refresh(x);
  refreshIncomplete();
  body.replaceChildren(robotLine(data, groups.map((x) => x.g), unread), lbcTourLine(), selogerTourLine(), triBar, freshBar, alertBox, incompleteBar, list);
  for (const x of groups) pin(x);
  droppedChanged();

  sales = await loadSearchSales(search).catch(() => null);
  if (!sales || !isCurrent()) {
    sales = null;
    return;
  }
  for (const x of groups) fillLines(x);
}

export { loadAnnonces };
