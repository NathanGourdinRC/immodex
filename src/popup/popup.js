const ENERGY_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
// Dernier résultat affiché : Chrome détruit le popup dès qu'il perd le focus,
// on le réaffiche à la réouverture s'il a moins d'une heure.
const POPUP_STATE_KEY = 'immodex.popup.state.v1';
const POPUP_STATE_TTL_MS = 60 * 60 * 1000;

const dpeForm = document.getElementById('dpe-form');
const landForm = document.getElementById('land-form');
const modeBtnDpe = document.getElementById('mode-dpe');
const modeBtnLand = document.getElementById('mode-land');
const modeBtnHistory = document.getElementById('mode-history');
const analyzeBar = document.getElementById('analyze-bar');
const analyzeBtn = document.getElementById('analyze-btn');
const historyView = document.getElementById('history-view');
const historyList = document.getElementById('history-list');
const historyClearBtn = document.getElementById('history-clear');
const entryBar = document.getElementById('entry-bar');
const statusBox = document.getElementById('status');
const resultsBox = document.getElementById('results');

let mode = 'dpe';

function normalizePostal(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D+/g, '');
  if (digits.length === 4) return '0' + digits;
  if (digits.length === 5) return digits;
  return null;
}

function normalizeSurface(value) {
  if (!value) return null;
  const num = parseInt(String(value).replace(/\D+/g, ''), 10);
  if (!isFinite(num) || num <= 0) return null;
  return num;
}

function normalizeNumber(value) {
  if (value == null || value === '') return null;
  const num = parseFloat(String(value).replace(',', '.'));
  return isFinite(num) && num >= 0 ? num : null;
}

function normalizeClass(value) {
  if (!value) return null;
  const letter = String(value).trim().toUpperCase().charAt(0);
  return ENERGY_CLASSES.includes(letter) ? letter : null;
}

function normalizeSection(value) {
  if (!value) return null;
  const m = String(value).trim().toUpperCase().match(/^[A-Z]{1,2}$/);
  return m ? m[0] : null;
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function parseUserDate(input) {
  if (!input) return null;
  const t = String(input).trim();
  let m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return { year: +m[3], month: +m[2], day: +m[1] };
  m = t.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) return { year: +m[1], month: +m[2], day: +m[3] };
  m = t.match(/^(\d{1,2})[\/\-.](\d{4})$/);
  if (m) return { year: +m[2], month: +m[1], day: null };
  m = t.match(/^(\d{4})$/);
  if (m) return { year: +m[1], month: null, day: null };
  return null;
}

function parseDateRange(parsed) {
  if (!parsed) return null;
  const { year, month, day } = parsed;
  if (year && month && day) {
    const iso = `${year}-${pad2(month)}-${pad2(day)}`;
    return { gte: iso, lte: iso, precision: 'day' };
  }
  if (year && month) {
    const last = new Date(year, month, 0).getDate();
    return { gte: `${year}-${pad2(month)}-01`, lte: `${year}-${pad2(month)}-${pad2(last)}`, precision: 'month' };
  }
  if (year) return { gte: `${year}-01-01`, lte: `${year}-12-31`, precision: 'year' };
  return null;
}

// Inverse de parseDateRange : réécrit une plage de dates dans le format du champ « Date DPE ».
function formatDateRange(range) {
  if (!range || !range.gte) return '';
  const [y, m, d] = range.gte.split('-');
  if (range.precision === 'day') return `${d}/${m}/${y}`;
  if (range.precision === 'month') return `${m}/${y}`;
  return y;
}

function formatDateTime(ts) {
  const d = new Date(ts);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}h${pad2(d.getMinutes())}`;
}

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  }
  return node;
}

function link(href, label) {
  return el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label);
}

function setStatus(message, isError = false) {
  if (!message) {
    statusBox.classList.add('hidden');
    statusBox.textContent = '';
    return;
  }
  statusBox.classList.remove('hidden');
  statusBox.classList.toggle('error', isError);
  statusBox.textContent = message;
}

function setEntryBar(children) {
  entryBar.innerHTML = '';
  if (!children || children.length === 0) {
    entryBar.classList.add('hidden');
    return;
  }
  for (const c of children) if (c) entryBar.appendChild(c);
  entryBar.classList.remove('hidden');
}

function setMode(next) {
  mode = next;
  modeBtnDpe.classList.toggle('active', mode === 'dpe');
  modeBtnLand.classList.toggle('active', mode === 'land');
  modeBtnHistory.classList.toggle('active', mode === 'history');
  dpeForm.classList.toggle('hidden', mode !== 'dpe');
  landForm.classList.toggle('hidden', mode !== 'land');
  analyzeBar.classList.toggle('hidden', mode === 'history');
  historyView.classList.toggle('hidden', mode !== 'history');
  setStatus('');
  setEntryBar(null);
  resultsBox.innerHTML = '';
  if (mode === 'history') loadHistory();
}

function gmapsLink(address, postal, city) {
  const q = encodeURIComponent([address, postal, city].filter(Boolean).join(', '));
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function ademeLink(id) {
  return `https://observatoire-dpe-audit.ademe.fr/afficher-dpe/${encodeURIComponent(id)}`;
}

function coordLinks(centroid) {
  if (!Array.isArray(centroid)) return [];
  const [lon, lat] = centroid;
  return [
    link(`https://www.google.com/maps?q=${lat.toFixed(6)},${lon.toFixed(6)}`, 'Google Maps'),
    link(
      `https://www.geoportail.gouv.fr/carte?c=${lon.toFixed(6)},${lat.toFixed(6)}&z=19&l0=CADASTRALPARCELS.PARCELLAIRE_EXPRESS::GEOPORTAIL:OGC:WMTS(1)&permalink=yes`,
      'Géoportail'
    ),
  ];
}

function confidenceClass(score) {
  if (score >= 80) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

function landConfidenceClass(score) {
  if (score >= 70) return 'green';
  if (score >= 40) return 'yellow';
  return 'red';
}

function recordMeta(record, score) {
  return [
    record.postal,
    record.city,
    record.surface != null ? `${record.surface} m²` : null,
    record.energyConsumption != null ? `${Math.round(Number(record.energyConsumption))} kWh` : null,
    record.date ? String(record.date).slice(0, 10) : null,
    score != null ? `score ${score}` : null,
  ]
    .filter(Boolean)
    .join(' • ');
}

function renderDpeResult(result) {
  resultsBox.innerHTML = '';
  if (!result.candidates || result.candidates.length === 0) {
    resultsBox.appendChild(el('div', { class: 'empty' }, 'Aucune correspondance dans le registre ADEME.'));
    return;
  }
  const top = result.candidates[0];
  const conf = confidenceClass(top.score);
  const box = el('div', { class: `result-top ${conf}` });
  box.appendChild(el('div', { class: 'result-address' }, top.record.address || '(adresse inconnue)'));
  box.appendChild(el('div', { class: 'result-meta' }, recordMeta(top.record)));
  box.appendChild(el('div', { class: 'result-meta' }, `Score ${top.score}/100`));
  const links = el('div', { class: 'result-links' }, link(gmapsLink(top.record.address, top.record.postal, top.record.city), 'Google Maps'));
  if (top.record.id) links.appendChild(link(ademeLink(top.record.id), 'Fiche ADEME'));
  box.appendChild(links);
  resultsBox.appendChild(box);

  const alts = result.candidates.slice(1);
  if (alts.length > 0) {
    const list = el('div', { class: 'result-alt' });
    list.appendChild(el('div', { class: 'result-meta' }, `${alts.length} autre(s) candidat(s)`));
    for (const alt of alts) {
      // Chaque candidat a ses propres liens : c'est ce qui permet de les vérifier un par un sur Maps.
      const altLinks = el('div', { class: 'result-links' }, link(gmapsLink(alt.record.address, alt.record.postal, alt.record.city), 'Google Maps'));
      if (alt.record.id) altLinks.appendChild(link(ademeLink(alt.record.id), 'Fiche ADEME'));
      list.appendChild(
        el(
          'div',
          { class: 'alt-row' },
          el('div', null, alt.record.address || '(adresse inconnue)'),
          el('div', { class: 'result-meta' }, recordMeta(alt.record, alt.score)),
          altLinks
        )
      );
    }
    resultsBox.appendChild(list);
  }
}

function renderLandResult(result) {
  resultsBox.innerHTML = '';
  if (!result.candidates || result.candidates.length === 0) {
    resultsBox.appendChild(el('div', { class: 'empty' }, 'Aucune parcelle trouvée dans le cadastre IGN.'));
    return;
  }
  const top = result.candidates[0];
  const parcel = top.parcel;
  const conf = landConfidenceClass(top.score);
  const box = el('div', { class: `result-top ${conf}` });
  box.appendChild(el('div', { class: 'result-address' }, parcel.address || parcel.street || '(adresse approximative)'));
  const metaParts = [parcel.nom_com, parcel.codeInsee ? `INSEE ${parcel.codeInsee}` : null, parcel.contenance != null ? `${parcel.contenance} m²` : null].filter(Boolean);
  box.appendChild(el('div', { class: 'result-meta' }, metaParts.join(' • ')));
  const idParts = [parcel.idu, parcel.section ? `section ${parcel.section}` : null, parcel.numero ? `n°${parcel.numero}` : null].filter(Boolean);
  if (idParts.length) box.appendChild(el('div', { class: 'result-meta parcel-id' }, idParts.join(' · ')));
  box.appendChild(el('div', { class: 'result-meta' }, `Score ${top.score}/100`));
  const topLinks = coordLinks(parcel.centroid);
  if (topLinks.length) box.appendChild(el('div', { class: 'result-links' }, ...topLinks));
  resultsBox.appendChild(box);

  const alts = result.candidates.slice(1);
  if (alts.length > 0) {
    const list = el('div', { class: 'result-alt' });
    list.appendChild(el('div', { class: 'result-meta' }, `${alts.length} autre(s) parcelle(s)`));
    for (const alt of alts) {
      const ap = alt.parcel;
      const altLinks = coordLinks(ap.centroid);
      list.appendChild(
        el(
          'div',
          { class: 'alt-row' },
          el('div', null, ap.address || ap.street || ap.idu || '(parcelle)'),
          el(
            'div',
            { class: 'result-meta' },
            [
              ap.nom_com,
              ap.contenance != null ? `${ap.contenance} m²` : null,
              ap.section ? `section ${ap.section}` : null,
              ap.numero ? `n°${ap.numero}` : null,
              `score ${alt.score}`,
            ]
              .filter(Boolean)
              .join(' • ')
          ),
          altLinks.length ? el('div', { class: 'result-links' }, ...altLinks) : null
        )
      );
    }
    resultsBox.appendChild(list);
  }
}

function renderResult(kind, result) {
  if (kind === 'land') renderLandResult(result);
  else renderDpeResult(result);
}

// ─── Formulaires ───

function setField(form, name, value) {
  const field = form.elements.namedItem(name);
  if (field) field.value = value == null ? '' : String(value);
}

function fillForm(payload) {
  if (!payload) return;
  if (payload.kind === 'land') {
    setField(landForm, 'postal', payload.postal);
    setField(landForm, 'surface', payload.surface);
    setField(landForm, 'city', payload.city);
    setField(landForm, 'section', payload.section);
    return;
  }
  setField(dpeForm, 'postal', payload.postal);
  setField(dpeForm, 'city', payload.city);
  setField(dpeForm, 'department', payload.department);
  setField(dpeForm, 'surface', payload.surface);
  setField(dpeForm, 'energyClass', payload.energyClass);
  setField(dpeForm, 'gesClass', payload.gesClass);
  setField(dpeForm, 'energyConsumption', payload.energyConsumption);
  setField(dpeForm, 'gesEmission', payload.gesEmission);
  setField(dpeForm, 'buildingType', payload.buildingType);
  setField(dpeForm, 'date', formatDateRange(payload.dateRange));
  setField(dpeForm, 'isNewBuild', payload.isNewBuild ? '1' : '');
}

function readDpeForm() {
  const data = new FormData(dpeForm);
  return {
    kind: 'dpe',
    postal: normalizePostal(data.get('postal')),
    city: (data.get('city') || '').toString().trim() || null,
    department: (data.get('department') || '').toString() || null,
    surface: normalizeSurface(data.get('surface')),
    energyClass: normalizeClass(data.get('energyClass')),
    gesClass: normalizeClass(data.get('gesClass')),
    energyConsumption: normalizeNumber(data.get('energyConsumption')),
    gesEmission: normalizeNumber(data.get('gesEmission')),
    buildingType: data.get('buildingType') || null,
    dateRange: parseDateRange(parseUserDate(data.get('date'))),
    isNewBuild: data.get('isNewBuild') === '1',
  };
}

function readLandForm() {
  const data = new FormData(landForm);
  return {
    kind: 'land',
    postal: normalizePostal(data.get('postal')),
    surface: normalizeSurface(data.get('surface')),
    city: (data.get('city') || '').toString().trim() || null,
    section: normalizeSection(data.get('section')),
  };
}

// Page d'origine de la recherche en cours (remplie par « Analyser cette page »),
// enregistrée avec le résultat pour retrouver l'annonce depuis l'historique.
let currentPage = null;

function saveState(entryId) {
  if (!entryId) return;
  chrome.storage.session.set({ [POPUP_STATE_KEY]: { entryId, at: Date.now() } }).catch(() => {});
}

async function search(payload) {
  const isLand = payload.kind === 'land';
  // Sans code postal, la ville suffit : le service worker retrouve ses codes postaux.
  if (!payload.postal && !payload.city) return setStatus('Indique un code postal ou une ville.', true);
  if (!payload.surface) return setStatus('Surface invalide.', true);
  setStatus(isLand ? 'Recherche cadastrale…' : 'Recherche…');
  resultsBox.innerHTML = '';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'LOOKUP', payload, page: currentPage });
    if (!response || response.ok !== true) return setStatus(response?.error || 'Erreur inconnue', true);
    const r = response.result;
    if (r.cached) setStatus('Cache');
    else if (isLand) setStatus(`OK (tier ${r.tier}, ${r.total ?? 0} candidat(s))`);
    else setStatus(`OK (dataset ${r.dataset}, tier ${r.tier})`);
    renderResult(payload.kind, r);
    saveState(response.historyId);
  } catch (err) {
    setStatus(String(err.message || err), true);
  }
}

function onDpeSubmit(ev) {
  ev.preventDefault();
  search(readDpeForm());
}

function onLandSubmit(ev) {
  ev.preventDefault();
  search(readLandForm());
}

// ─── Analyser cette page ───

const MISSING_LABELS = { postal: 'code postal', surface: 'surface', energyClass: 'classe énergie' };

async function analyzeActiveTab() {
  setEntryBar(null);
  resultsBox.innerHTML = '';
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    tab = null;
  }
  if (!tab || !/^https?:/i.test(tab.url || '')) {
    setStatus("Cette page ne peut pas être analysée : ouvre d'abord une annonce.", true);
    return;
  }
  setStatus('Lecture de la page…');
  let payload = null;
  try {
    // activeTab donne un accès ponctuel à l'onglet ouvert : pas besoin d'autoriser chaque site.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/common/extract.js', 'src/common/generic-extract.js'],
    });
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.__immodexGeneric.extractPage(),
    });
    payload = injection && injection.result;
  } catch (err) {
    setStatus(`Lecture impossible sur cette page (${err.message || err}).`, true);
    return;
  }
  if (!payload) {
    setStatus("Aucune donnée d'annonce trouvée sur cette page. Saisis les critères à la main.", true);
    return;
  }
  setMode(payload.kind === 'land' ? 'land' : 'dpe');
  currentPage = { url: tab.url, title: tab.title || '' };
  fillForm(payload);
  const missing = (payload.missing || []).map((k) => MISSING_LABELS[k] || k);
  if ((!payload.postal && !payload.city) || !payload.surface) {
    setStatus(`Champs trouvés reportés dans le formulaire. Manquant : ${missing.join(', ')}. Complète puis lance la recherche.`, true);
    return;
  }
  await search(payload);
  if (missing.length && !statusBox.classList.contains('error')) {
    setStatus(`${statusBox.textContent} · non trouvé sur la page : ${missing.join(', ')}`);
  }
}

// ─── Historique ───

function criteriaSummary(entry) {
  const p = entry.payload || {};
  if (entry.kind === 'land') {
    return ['Terrain', p.postal, p.city, p.surface ? `${p.surface} m²` : null].filter(Boolean).join(' · ');
  }
  const classes = [p.energyClass, p.gesClass].filter(Boolean).join('/');
  return [p.postal, p.surface ? `${p.surface} m²` : null, classes || null, p.buildingType].filter(Boolean).join(' · ');
}

function topLabel(entry) {
  const c = entry.result && entry.result.candidates && entry.result.candidates[0];
  if (!c) return 'Aucun résultat';
  if (entry.kind === 'land') return c.parcel.address || c.parcel.street || c.parcel.idu || '(parcelle)';
  return c.record.address || '(adresse inconnue)';
}

async function loadHistory() {
  historyList.innerHTML = '';
  let entries = [];
  try {
    const res = await chrome.runtime.sendMessage({ type: 'HISTORY_LIST' });
    entries = res && res.ok ? res.entries : [];
  } catch {
    entries = [];
  }
  if (entries.length === 0) {
    historyList.appendChild(el('div', { class: 'empty' }, 'Aucune recherche enregistrée pour le moment.'));
    historyClearBtn.disabled = true;
    return;
  }
  historyClearBtn.disabled = false;
  for (const entry of entries) {
    const count = entry.result && entry.result.candidates ? entry.result.candidates.length : 0;
    const del = el('button', { type: 'button', class: 'history-del', title: 'Supprimer cette recherche', 'aria-label': 'Supprimer' }, '×');
    del.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      await chrome.runtime.sendMessage({ type: 'HISTORY_DELETE', id: entry.id });
      loadHistory();
    });
    const item = el(
      'div',
      { class: 'history-item', role: 'button', tabindex: '0' },
      el(
        'div',
        { class: 'history-head' },
        el('span', null, `${formatDateTime(entry.createdAt)} · ${entry.page ? entry.page.site : 'saisie manuelle'}`),
        del
      ),
      el('div', { class: 'history-top' }, topLabel(entry)),
      el('div', { class: 'result-meta' }, `${criteriaSummary(entry)} · ${count} candidat(s)`)
    );
    item.addEventListener('click', () => showEntry(entry));
    item.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') showEntry(entry);
    });
    historyList.appendChild(item);
  }
}

// Affiche une recherche enregistrée comme si elle venait d'être faite :
// formulaire rempli (pour relancer en modifiant) et tous les candidats avec leurs liens.
function showEntry(entry, { fromRestore = false } = {}) {
  setMode(entry.kind === 'land' ? 'land' : 'dpe');
  fillForm(entry.payload);
  currentPage = entry.page ? { url: entry.page.url, title: entry.page.title } : null;
  const back = el('a', { class: 'entry-back' }, '← Historique');
  back.addEventListener('click', () => setMode('history'));
  setEntryBar([
    back,
    el('span', null, `${fromRestore ? 'Dernier résultat' : 'Enregistré'} le ${formatDateTime(entry.createdAt)}`),
    entry.page ? link(entry.page.url, "Ouvrir l'annonce") : null,
  ]);
  renderResult(entry.kind, entry.result || { candidates: [] });
  saveState(entry.id);
}

async function clearHistory() {
  if (!confirm('Effacer tout l’historique des recherches ?')) return;
  await chrome.runtime.sendMessage({ type: 'HISTORY_CLEAR' });
  chrome.storage.session.remove(POPUP_STATE_KEY).catch(() => {});
  loadHistory();
}

// ─── Ouverture du popup ───

async function init() {
  // 1. Critères envoyés par « Modifier les champs » depuis une annonce.
  try {
    const res = await chrome.runtime.sendMessage({ type: 'PREFILL_GET' });
    if (res && res.ok && res.payload) {
      setMode(res.payload.kind === 'land' ? 'land' : 'dpe');
      fillForm(res.payload);
      setStatus("Critères repris de l'annonce : modifie-les puis relance la recherche.");
      return;
    }
  } catch {
    // service worker indisponible : on ouvre le popup vide
  }
  // 2. Sinon, le dernier résultat consulté.
  try {
    const stored = await chrome.storage.session.get(POPUP_STATE_KEY);
    const state = stored[POPUP_STATE_KEY];
    if (!state || Date.now() - state.at > POPUP_STATE_TTL_MS) return;
    const res = await chrome.runtime.sendMessage({ type: 'HISTORY_GET', id: state.entryId });
    if (res && res.ok && res.entry) showEntry(res.entry, { fromRestore: true });
  } catch {
    // rien à restaurer
  }
}

dpeForm.addEventListener('submit', onDpeSubmit);
landForm.addEventListener('submit', onLandSubmit);
// Un changement d'onglet à la main repart d'une saisie libre, sans lien avec l'annonce analysée.
for (const [btn, m] of [[modeBtnDpe, 'dpe'], [modeBtnLand, 'land'], [modeBtnHistory, 'history']]) {
  btn.addEventListener('click', () => {
    currentPage = null;
    setMode(m);
  });
}
analyzeBtn.addEventListener('click', analyzeActiveTab);
historyClearBtn.addEventListener('click', clearHistory);
init();
