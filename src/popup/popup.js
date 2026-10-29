const UI = window.__immodexUI;
const { el, icon } = UI;

const ENERGY_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
// Dernier résultat affiché : Chrome détruit le popup dès qu'il perd le focus,
// on le réaffiche à la réouverture s'il a moins d'une heure.
const POPUP_STATE_KEY = 'immodex.popup.state.v1';
const POPUP_STATE_TTL_MS = 60 * 60 * 1000;
// Scripts du bouton automatique, injectés sur les sites ajoutés depuis l'onglet Sites.
const CONTENT_JS = ['src/common/extract.js', 'src/common/generic-extract.js', 'src/ui/styles.js', 'src/ui/components.js', 'src/ui/overlay.js', 'src/content/generic.js', 'src/content/tracker.js'];
const SITE_SCRIPT_PREFIX = 'site-';

const dpeForm = document.getElementById('dpe-form');
const landForm = document.getElementById('land-form');
const tabs = {
  dpe: document.getElementById('mode-dpe'),
  land: document.getElementById('mode-land'),
  history: document.getElementById('mode-history'),
  biens: document.getElementById('mode-biens'),
  sites: document.getElementById('mode-sites'),
};
const biensView = document.getElementById('biens-view');
const analyzeBtn = document.getElementById('analyze-btn');
const siteBar = document.getElementById('site-bar');
const historyView = document.getElementById('history-view');
const historyList = document.getElementById('history-list');
const historyClearBtn = document.getElementById('history-clear');
const sitesView = document.getElementById('sites-view');
const entryBar = document.getElementById('entry-bar');
const statusBox = document.getElementById('status');
const resultsBox = document.getElementById('results');

document.getElementById('logo').appendChild(icon('pin', 17));
document.getElementById('analyze-icon').appendChild(icon('scan', 18));
document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;

// Tableau de bord des zones de recherche, dans un onglet (déjà ouvert : on le réutilise).
const dashboardBtn = document.getElementById('dashboard-btn');
dashboardBtn.append(icon('layers', 14), 'Tableau de bord');
dashboardBtn.addEventListener('click', async () => {
  const url = chrome.runtime.getURL('src/dashboard/dashboard.html');
  const [open] = await chrome.tabs.query({ url: `${url}*` }).catch(() => []);
  if (open) await chrome.tabs.update(open.id, { active: true });
  else await chrome.tabs.create({ url });
  window.close();
});

// Sélecteurs de lettres : ils renseignent les champs cachés lus par readDpeForm.
const energyPicker = UI.letterPicker('dpe', '', (v) => (dpeForm.elements.namedItem('energyClass').value = v));
const gesPicker = UI.letterPicker('ges', '', (v) => (dpeForm.elements.namedItem('gesClass').value = v));
document.getElementById('energy-picker').appendChild(energyPicker.node);
document.getElementById('ges-picker').appendChild(gesPicker.node);

let mode = 'dpe';
// Page d'origine de la recherche en cours (remplie par « Analyser la page ouverte »),
// enregistrée avec le résultat pour retrouver l'annonce depuis l'historique.
let currentPage = null;

// ─── Lecture des champs ───

function normalizePostal(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D+/g, '');
  if (digits.length === 4) return '0' + digits;
  if (digits.length === 5) return digits;
  return null;
}

function normalizeSurface(value) {
  if (!value) return null;
  const n = parseInt(String(value).replace(/\D+/g, ''), 10);
  return isFinite(n) && n > 0 ? n : null;
}

function normalizeNumber(value) {
  if (value == null || value === '') return null;
  const n = parseFloat(String(value).replace(',', '.'));
  return isFinite(n) && n >= 0 ? n : null;
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

const pad2 = (n) => (n < 10 ? '0' + n : String(n));

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
  energyPicker.value = payload.energyClass || '';
  gesPicker.value = payload.gesClass || '';
  setField(dpeForm, 'energyConsumption', payload.energyConsumption);
  setField(dpeForm, 'gesEmission', payload.gesEmission);
  setField(dpeForm, 'buildingType', payload.buildingType);
  setField(dpeForm, 'date', UI.formatRangeInput(payload.dateRange));
  setField(dpeForm, 'isNewBuild', payload.isNewBuild ? '1' : '');
}

// ─── Affichage ───

// kind : 'info' | 'error' | 'loading' ; message vide = masquer.
function setStatus(kind, message) {
  if (!message) {
    statusBox.classList.add('imx-hidden');
    statusBox.replaceChildren();
    return;
  }
  const node = kind === 'error' ? UI.alert(message) : kind === 'loading' ? UI.loading(message) : UI.notice(message);
  if (kind === 'info') node.querySelector('svg')?.replaceWith(icon('info', 16));
  statusBox.replaceChildren(node);
  statusBox.classList.remove('imx-hidden');
}

function setEntryBar(children) {
  entryBar.replaceChildren(...(children || []).filter(Boolean));
  entryBar.classList.toggle('imx-hidden', !children || !children.length);
}

function setMode(next) {
  mode = next;
  for (const [name, tab] of Object.entries(tabs)) tab.classList.toggle('is-active', name === mode);
  dpeForm.classList.toggle('imx-hidden', mode !== 'dpe');
  landForm.classList.toggle('imx-hidden', mode !== 'land');
  const listMode = mode === 'history' || mode === 'biens' || mode === 'sites' || mode === 'sync';
  analyzeBtn.classList.toggle('imx-hidden', listMode);
  siteBar.classList.toggle('imx-hidden', listMode || !siteBar.childElementCount);
  historyView.classList.toggle('imx-hidden', mode !== 'history');
  biensView.classList.toggle('imx-hidden', mode !== 'biens');
  sitesView.classList.toggle('imx-hidden', mode !== 'sites');
  syncView.classList.toggle('imx-hidden', mode !== 'sync');
  phoneBtn.classList.toggle('is-active', mode === 'sync');
  setStatus(null, '');
  setEntryBar(null);
  resultsBox.replaceChildren();
  if (mode === 'history') loadHistory();
  if (mode === 'biens') renderBiens();
  if (mode === 'sites') renderSites();
  if (mode === 'sync') renderSync();
}

// ─── Synchro avec le téléphone ───
// Même panneau dans l'extension (qui crée l'espace et affiche le QR code) et dans l'appli
// téléphone (qui le rejoint en scannant ce code).

const syncView = document.getElementById('sync-view');
const phoneBtn = document.getElementById('phone-btn');
const isWebApp = document.documentElement.classList.contains('imx-web');
phoneBtn.appendChild(icon('phone', 15));
phoneBtn.addEventListener('click', () => {
  currentPage = null;
  setMode(mode === 'sync' ? 'dpe' : 'sync');
});

function sinceText(ts) {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  return `le ${UI.formatDateTime(ts)}`;
}

// QR code en SVG : un carré par module sombre, dans un seul tracé.
function qrNode(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `-3 -3 ${n + 6} ${n + 6}`);
  svg.setAttribute('class', 'imx-qr');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code d’appairage du téléphone');
  const bg = document.createElementNS(ns, 'rect');
  Object.entries({ x: -3, y: -3, width: n + 6, height: n + 6, fill: '#fff' }).forEach(([k, v]) => bg.setAttribute(k, v));
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#0f172a');
  svg.append(bg, path);
  return svg;
}

async function syncRequest(message) {
  try {
    const res = await chrome.runtime.sendMessage(message);
    return res && res.ok ? res : { ok: false, error: (res && res.error) || 'Erreur inconnue' };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

async function renderSync(status) {
  if (!status) {
    syncView.replaceChildren(UI.loading('Lecture de la synchro…'));
    const res = await syncRequest({ type: 'SYNC_STATUS' });
    if (!res.ok) return syncView.replaceChildren(UI.alert(res.error));
    status = res.status;
  }
  if (mode !== 'sync') return;
  const what = 'zones, annonces suivies avec leur statut et leurs notes, recherches des 7 derniers jours';

  if (!status.paired) {
    if (isWebApp) {
      syncView.replaceChildren(
        el('div', { class: 'imx-label' }, 'Relier ce téléphone'),
        el('p', { class: 'imx-meta' }, `Ce téléphone n'est pas encore relié à l'extension. Sur l'ordinateur, ouvre Immodex+ dans Chrome, touche le bouton téléphone, puis scanne le QR code avec l'appareil photo.`),
        el('p', { class: 'imx-meta' }, `Tu retrouveras ici : ${what}.`)
      );
      return;
    }
    const start = el('button', { type: 'button', class: 'imx-btn imx-btn-primary imx-btn-block' }, icon('phone', 15), 'Relier mon téléphone');
    start.addEventListener('click', async () => {
      start.disabled = true;
      const res = await syncRequest({ type: 'SYNC_ENABLE' });
      if (!res.ok) {
        start.disabled = false;
        return syncView.append(UI.alert(res.error));
      }
      renderSync(res.status);
    });
    syncView.replaceChildren(
      el('div', { class: 'imx-label' }, 'Appli téléphone'),
      el('p', { class: 'imx-meta' }, `Retrouve sur ton téléphone : ${what}. Les modifications faites d'un côté arrivent de l'autre.`),
      el('p', { class: 'imx-meta' }, 'Les données passent par immodex.vercel.app, rangées sous une clé que seuls tes appareils connaissent.'),
      start
    );
    return;
  }

  const line = status.lastError
    ? UI.alert(`Dernière synchro impossible : ${status.lastError}.`)
    : UI.notice(status.lastSync ? `Synchro active · dernière ${sinceText(status.lastSync)}` : 'Synchro active · première synchro en cours');
  const now = el('button', { type: 'button', class: 'imx-btn imx-btn-sm' }, icon('refresh', 14), 'Synchroniser maintenant');
  now.addEventListener('click', async () => {
    now.disabled = true;
    const res = await syncRequest({ type: 'SYNC_NOW' });
    if (!res.ok) return syncView.prepend(UI.alert(res.error));
    renderSync(res.status);
  });
  const stop = el('button', { type: 'button', class: 'imx-btn imx-btn-sm' }, isWebApp ? 'Délier ce téléphone' : 'Arrêter la synchro');
  stop.addEventListener('click', async () => {
    const question = isWebApp
      ? 'Délier ce téléphone ? Ses données restent ici, mais il ne recevra plus celles de l’ordinateur.'
      : 'Arrêter la synchro dans ce Chrome ? Les données restent ici. Pour relier à nouveau, il faudra rescanner un nouveau QR code sur le téléphone.';
    if (!confirm(question)) return;
    const res = await syncRequest({ type: 'SYNC_DISABLE' });
    renderSync(res.ok ? res.status : null);
  });
  const copy = el('button', { type: 'button', class: 'imx-btn imx-btn-sm' }, icon('copy', 14), 'Copier le lien');
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(status.pairUrl).catch(() => {});
    copy.replaceChildren(icon('check', 14), 'Lien copié');
  });

  syncView.replaceChildren(
    el('div', { class: 'imx-label' }, isWebApp ? 'Synchro avec l’extension' : 'Appli téléphone'),
    line,
    el(
      'div',
      { class: 'imx-qr-box' },
      qrNode(status.pairUrl),
      el(
        'p',
        { class: 'imx-meta' },
        isWebApp
          ? 'Pour relier un autre appareil, scanne ce code avec lui.'
          : "Scanne ce code avec l'appareil photo du téléphone : il ouvre l'appli, déjà reliée. Puis, dans le menu de Chrome du téléphone, choisis « Ajouter à l'écran d'accueil » pour la garder."
      )
    ),
    el('p', { class: 'imx-meta' }, 'Ce code donne accès à tes données : ne le partage avec personne.'),
    el('div', { class: 'imx-actions' }, now, copy, stop)
  );
}

function renderResult(kind, result, payload) {
  const meta =
    kind === 'land'
      ? `Cadastre IGN${result.tier != null ? ` · niveau ${result.tier}` : ''}${result.total != null ? ` · ${result.total} parcelle(s)` : ''}`
      : `${UI.datasetLabel(result.dataset)}${result.tier != null ? ` · niveau ${result.tier}` : ''}`;
  resultsBox.replaceChildren(
    el('div', { class: 'imx-panel' }, kind === 'land' ? UI.landResults(result, payload) : UI.dpeResults(result, payload), el('small', { class: 'imx-meta' }, meta))
  );
}

function saveState(entryId) {
  if (!entryId) return;
  chrome.storage.session.set({ [POPUP_STATE_KEY]: { entryId, at: Date.now() } }).catch(() => {});
}

async function search(payload) {
  const isLand = payload.kind === 'land';
  // Sans code postal, la ville suffit : le service worker retrouve ses codes postaux.
  if (!payload.postal && !payload.city) return setStatus('error', 'Indique un code postal ou une ville.');
  if (!payload.surface) return setStatus('error', 'Indique la surface.');
  setStatus('loading', isLand ? 'Recherche dans le cadastre IGN…' : 'Recherche dans le registre ADEME des DPE…');
  resultsBox.replaceChildren();
  try {
    const response = await chrome.runtime.sendMessage({ type: 'LOOKUP', payload, page: currentPage });
    if (!response || response.ok !== true) return setStatus('error', response?.error || 'Erreur inconnue');
    setStatus(null, '');
    renderResult(payload.kind, response.result, payload);
    saveState(response.historyId);
  } catch (err) {
    setStatus('error', String(err.message || err));
  }
}

dpeForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  search(readDpeForm());
});
landForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  search(readLandForm());
});

// ─── Analyser la page ouverte ───

const MISSING_LABELS = { postal: 'code postal', surface: 'surface', energyClass: 'classe énergie' };

async function activeTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch {
    return null;
  }
}

async function analyzeActiveTab() {
  setEntryBar(null);
  resultsBox.replaceChildren();
  const tab = await activeTab();
  if (!tab || !/^https?:/i.test(tab.url || '')) {
    setStatus('error', "Cette page ne peut pas être analysée : ouvre d'abord une annonce.");
    return;
  }
  setStatus('loading', 'Lecture de la page…');
  let payload = null;
  try {
    // activeTab donne un accès ponctuel à l'onglet ouvert : pas besoin d'autoriser chaque site.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/common/extract.js', 'src/common/generic-extract.js'] });
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__immodexGeneric.extractPageAsync() });
    payload = injection && injection.result;
  } catch (err) {
    setStatus('error', `Lecture impossible sur cette page (${err.message || err}).`);
    return;
  }
  if (!payload) {
    setStatus('error', "Aucune donnée d'annonce trouvée sur cette page. Saisis les critères à la main.");
    return;
  }
  setMode(payload.kind === 'land' ? 'land' : 'dpe');
  currentPage = { url: tab.url, title: tab.title || '' };
  fillForm(payload);
  const missing = (payload.missing || []).map((k) => MISSING_LABELS[k] || k);
  if ((!payload.postal && !payload.city) || !payload.surface) {
    setStatus('error', `Critères trouvés reportés dans le formulaire. Manquant : ${missing.join(', ')}. Complète puis lance la recherche.`);
    return;
  }
  await search(payload);
  if (missing.length && !statusBox.querySelector('.imx-alert')) {
    setStatus('info', `Non trouvé sur la page : ${missing.join(', ')}. Tu peux compléter et relancer.`);
  }
}

analyzeBtn.addEventListener('click', analyzeActiveTab);

// ─── Historique ───

function criteriaSummary(entry) {
  const p = entry.payload || {};
  if (entry.kind === 'land') return ['Terrain', p.postal || p.city, p.surface ? `${UI.num(p.surface)} m²` : null].filter(Boolean).join(' · ');
  return [p.postal || p.city, p.surface ? `${p.surface} m²` : null, [p.energyClass, p.gesClass].filter(Boolean).join('/') || null].filter(Boolean).join(' · ');
}

function topLabel(entry) {
  const c = entry.result && entry.result.candidates && entry.result.candidates[0];
  if (!c) return 'Aucun résultat';
  if (entry.kind === 'land') return c.parcel.address || c.parcel.street || c.parcel.idu || '(parcelle)';
  return c.record.address || '(adresse inconnue)';
}

async function loadHistory() {
  let entries = [];
  try {
    const res = await chrome.runtime.sendMessage({ type: 'HISTORY_LIST' });
    entries = res && res.ok ? res.entries : [];
  } catch {
    entries = [];
  }
  historyClearBtn.disabled = entries.length === 0;
  if (!entries.length) {
    historyList.replaceChildren(UI.notice('Aucune recherche enregistrée pour le moment.'));
    return;
  }
  historyList.replaceChildren(
    ...entries.map((entry) => {
      const count = entry.result && entry.result.candidates ? entry.result.candidates.length : 0;
      const top = entry.result && entry.result.candidates && entry.result.candidates[0];
      const level = top ? UI.confidence(top.score, entry.kind).level : 'low';
      const del = el('button', { type: 'button', class: 'imx-btn imx-btn-sm imx-btn-icon', title: 'Supprimer cette recherche', 'aria-label': 'Supprimer' }, icon('trash', 14));
      del.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        await chrome.runtime.sendMessage({ type: 'HISTORY_DELETE', id: entry.id });
        loadHistory();
      });
      const item = el(
        'div',
        { class: 'imx-history-item', role: 'button', tabindex: '0' },
        el('div', { class: 'imx-history-head' }, el('span', null, `${UI.formatDateTime(entry.createdAt)} · ${entry.page ? entry.page.site : 'saisie manuelle'}`), del),
        el('div', { class: 'imx-history-address' }, topLabel(entry)),
        el(
          'div',
          { class: 'imx-section-head' },
          el('span', { class: 'imx-meta' }, `${criteriaSummary(entry)} · ${count} candidat(s)`),
          top ? el('span', { class: `imx-pill is-${level}` }, `${top.score}`) : null
        )
      );
      item.addEventListener('click', () => showEntry(entry));
      item.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') showEntry(entry);
      });
      return item;
    })
  );
}

// Rouvre une recherche enregistrée : formulaire rempli (pour relancer en modifiant)
// et tous les candidats avec leurs liens.
function showEntry(entry, { fromRestore = false } = {}) {
  setMode(entry.kind === 'land' ? 'land' : 'dpe');
  fillForm(entry.payload);
  currentPage = entry.page ? { url: entry.page.url, title: entry.page.title } : null;
  setEntryBar([
    el('button', { class: 'imx-link', type: 'button', onclick: () => setMode('history') }, '← Historique'),
    el('span', { class: 'imx-meta' }, `${fromRestore ? 'Dernier résultat' : 'Enregistré'} le ${UI.formatDateTime(entry.createdAt)}`),
    entry.page ? UI.linkButton(entry.page.url, 'Annonce', { variant: 'imx-btn-ghost' }) : null,
  ]);
  renderResult(entry.kind, entry.result || { candidates: [] }, entry.payload);
  saveState(entry.id);
}

historyClearBtn.addEventListener('click', async () => {
  if (!confirm('Effacer tout l’historique des recherches ? (aussi sur les appareils reliés par la synchro)')) return;
  await chrome.runtime.sendMessage({ type: 'HISTORY_CLEAR' });
  chrome.storage.session.remove(POPUP_STATE_KEY).catch(() => {});
  loadHistory();
});

// ─── Biens suivis (republications et évolution des prix) ───

function groupTitle(g) {
  if (g.address) return g.address;
  const fp = g.fp || {};
  const type = fp.kind === 'land' ? 'Terrain' : fp.buildingType === 'maison' ? 'Maison' : fp.buildingType === 'appartement' ? 'Appartement' : 'Logement';
  return `${type} ${fp.surface ? `${UI.num(fp.surface)} m²` : ''} · ${[fp.postal, fp.city].filter(Boolean).join(' ')}`.replace(/\s+·/, ' ·');
}

function groupTrend(g) {
  if (!g.firstPrice || !g.lastPrice || g.firstPrice === g.lastPrice) return g.lastPrice ? UI.priceText(g.lastPrice) : null;
  const pct = ((g.lastPrice - g.firstPrice) / g.firstPrice) * 100;
  return `${UI.priceText(g.firstPrice)} → ${UI.priceText(g.lastPrice)} (${pct > 0 ? '+' : '−'}${UI.num(Math.abs(pct), 1)} %)`;
}

function groupCard(g) {
  const fp = g.fp || {};
  return el(
    'div',
    { class: 'imx-panel' },
    el(
      'div',
      { class: 'imx-section-head' },
      el('div', { class: 'imx-history-address' }, groupTitle(g)),
      g.count > 1 ? el('span', { class: 'imx-pill is-mid' }, `${g.count} annonces`) : null
    ),
    el(
      'div',
      { class: 'imx-meta' },
      [fp.transaction === 'location' ? 'Location' : 'Vente', [fp.energyClass, fp.gesClass].filter(Boolean).join('/') || null, groupTrend(g), `vu depuis le ${UI.day(g.firstSeen)}`]
        .filter(Boolean)
        .join(' · ')
    ),
    el(
      'div',
      { class: 'imx-candidates' },
      g.sightings.map((s) =>
        el(
          'div',
          { class: 'imx-candidate' },
          el('div', { class: 'imx-candidate-head' }, el('span', null, `${UI.day(s.firstSeen)} · ${s.site || 'annonce'}`), el('span', { class: 'imx-meta' }, UI.priceText((s.prices || []).slice(-1)[0]?.price))),
          el('div', { class: 'imx-actions' }, UI.linkButton(s.url, 'Voir l’annonce', { iconName: 'external' }), UI.castorusButton(s.url))
        )
      )
    )
  );
}

async function renderBiens() {
  let groups = [];
  try {
    const res = await chrome.runtime.sendMessage({ type: 'SIGHTINGS_GROUPS' });
    groups = res && res.ok ? res.groups : [];
  } catch {
    groups = [];
  }
  const total = groups.reduce((n, g) => n + g.count, 0);
  const repeated = groups.filter((g) => g.count > 1);
  const singles = groups.filter((g) => g.count === 1);
  const clear = el('button', { type: 'button', class: 'imx-btn imx-btn-sm' }, 'Tout effacer');
  clear.addEventListener('click', async () => {
    if (!confirm('Effacer le suivi de toutes les annonces vues ? (aussi sur les appareils reliés par la synchro)')) return;
    await chrome.runtime.sendMessage({ type: 'SIGHTINGS_CLEAR' });
    renderBiens();
  });
  // replaceChildren écrirait « null » pour une partie absente : on filtre.
  const parts = [
    total
      ? UI.notice(`${total} annonce${total > 1 ? 's' : ''} vue${total > 1 ? 's' : ''} · ${repeated.length} bien${repeated.length > 1 ? 's' : ''} retrouvé${repeated.length > 1 ? 's' : ''} dans plusieurs annonces`)
      : UI.notice('Aucune annonce suivie pour le moment : chaque annonce ouverte sur un site couvert est enregistrée automatiquement.'),
    repeated.length ? el('div', { class: 'imx-label' }, 'Biens vus dans plusieurs annonces') : null,
    ...repeated.map(groupCard),
    singles.length ? el('div', { class: 'imx-label' }, `Annonces vues une fois (${singles.length})`) : null,
    ...singles.slice(0, 30).map(groupCard),
    total ? el('div', { class: 'imx-section-head' }, el('small', { class: 'imx-meta' }, 'Gardé 12 mois, sur cet appareil et ceux reliés par la synchro.'), clear) : null,
  ];
  biensView.replaceChildren(...parts.filter(Boolean));
}

// ─── Sites couverts ───

// Sites du manifest (bouton automatique livré avec l'extension).
function builtInPatterns() {
  return (chrome.runtime.getManifest().content_scripts || []).flatMap((c) => c.matches || []);
}

function hostOf(pattern) {
  const m = String(pattern).match(/^[a-z*]+:\/\/([^/]+)/i);
  return m ? m[1] : null;
}

function matchesPattern(url, pattern) {
  const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return re.test(url);
}

async function addedSites() {
  try {
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    return scripts.filter((s) => s.id.startsWith(SITE_SCRIPT_PREFIX));
  } catch {
    return [];
  }
}

async function removeSite(script) {
  await chrome.scripting.unregisterContentScripts({ ids: [script.id] });
  await chrome.permissions.remove({ origins: script.matches }).catch(() => {});
  renderSites();
  checkSiteCoverage();
}

async function renderSites() {
  const builtIn = [...new Set(builtInPatterns().map(hostOf).filter(Boolean))].map((h) => h.replace(/^www\./, '')).sort();
  const added = await addedSites();
  sitesView.replaceChildren(
    el('div', { class: 'imx-label' }, `Sites ajoutés par toi (${added.length})`),
    added.length
      ? el(
          'div',
          { class: 'imx-sites' },
          added.map((s) =>
            el('div', { class: 'imx-site' }, el('span', null, hostOf(s.matches[0]).replace(/^www\./, '')), el('button', { class: 'imx-btn imx-btn-sm', type: 'button', onclick: () => removeSite(s) }, 'Retirer'))
          )
        )
      : el('small', { class: 'imx-meta' }, 'Ouvre une annonce d’une agence non couverte puis le popup : un bandeau propose d’y activer le bouton automatique.'),
    el('div', { class: 'imx-label' }, `Sites intégrés (${builtIn.length})`),
    el('small', { class: 'imx-meta' }, builtIn.join(' · ')),
    el('small', { class: 'imx-meta' }, 'Sur tout autre site, « Analyser la page ouverte » fonctionne sans rien activer.')
  );
}

// Bandeau « Activer sur ce site » : proposé quand la page ouverte n'est couverte
// ni par les sites intégrés, ni par un site déjà ajouté.
async function checkSiteCoverage() {
  siteBar.replaceChildren();
  siteBar.classList.add('imx-hidden');
  const tab = await activeTab();
  if (!tab || !/^https?:\/\//i.test(tab.url || '')) return;
  const url = new URL(tab.url);
  const origin = url.origin;
  const covered =
    builtInPatterns().some((p) => hostOf(p) === url.host) || (await addedSites()).some((s) => s.matches.some((m) => matchesPattern(tab.url, m)));
  if (covered) return;
  const btn = el('button', { class: 'imx-btn imx-btn-sm imx-btn-primary', type: 'button' }, icon('plus', 14), 'Activer');
  // chrome.permissions.request doit partir directement du clic (geste de l'utilisateur).
  btn.addEventListener('click', () => {
    chrome.permissions.request({ origins: [`${origin}/*`] }).then(async (granted) => {
      if (!granted) {
        setStatus('info', 'Autorisation refusée : le bouton automatique ne sera pas ajouté sur ce site.');
        return;
      }
      try {
        await chrome.scripting.registerContentScripts([
          { id: `${SITE_SCRIPT_PREFIX}${url.host}`, matches: [`${origin}/*`], js: CONTENT_JS, runAt: 'document_idle', persistAcrossSessions: true },
        ]);
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_JS });
        siteBar.replaceChildren(icon('check', 16), el('span', null, el('strong', null, url.host.replace(/^www\./, '')), ' : bouton automatique activé.'));
      } catch (err) {
        setStatus('error', `Activation impossible (${err.message || err}).`);
      }
    });
  });
  siteBar.replaceChildren(el('span', null, 'Pas de bouton automatique sur ', el('strong', null, url.host.replace(/^www\./, '')), '.'), btn);
  siteBar.classList.toggle('imx-hidden', mode === 'history' || mode === 'sites');
}

// ─── Onglets et ouverture ───

for (const [name, tab] of Object.entries(tabs)) {
  // Un changement d'onglet à la main repart d'une saisie libre, sans lien avec l'annonce analysée.
  tab.addEventListener('click', () => {
    currentPage = null;
    setMode(name);
  });
}

async function init() {
  checkSiteCoverage();
  // Récupère ce que le téléphone a changé depuis la dernière fois (au plus une fois par minute).
  syncRequest({ type: 'SYNC_NOW', minAgeMs: 60 * 1000 }).then((res) => {
    if (res.ok && res.result && res.result.applied && (mode === 'biens' || mode === 'history')) setMode(mode);
  });
  // 1. Critères envoyés par « Modifier » depuis une annonce.
  try {
    const res = await chrome.runtime.sendMessage({ type: 'PREFILL_GET' });
    if (res && res.ok && res.payload) {
      setMode(res.payload.kind === 'land' ? 'land' : 'dpe');
      fillForm(res.payload);
      setStatus('info', "Critères repris de l'annonce : modifie-les puis relance la recherche.");
      return;
    }
  } catch {
    // service worker indisponible : popup vide
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

init();
