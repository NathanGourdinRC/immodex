// Interface d'Immodex+ sur les pages d'annonce : bouton (onglet au bord droit)
// et carte de résultats. Tout est rendu dans un Shadow DOM : les styles du site
// ne peuvent pas la déformer, et son texte n'est jamais relu comme s'il faisait
// partie de l'annonce.
(function () {
  'use strict';

  const UI = window.__immodexUI;
  const { el, icon } = UI;
  const HOST_ID = 'immodex-root';
  const LABEL_SEARCH = 'Trouver l’adresse';
  const LABEL_SAVED = 'Voir les adresses';

  let shadow = null;
  let currentCard = null;

  function ensureShadow() {
    let host = document.getElementById(HOST_ID);
    if (!host || !host.isConnected || !host.shadowRoot) {
      if (host) host.remove();
      host = document.createElement('div');
      host.id = HOST_ID;
      // Hôte neutre et sans taille : rien du site ne s'y applique.
      host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;';
      (document.body || document.documentElement).appendChild(host);
      shadow = host.attachShadow({ mode: 'open' });
      shadow.appendChild(el('style', null, window.__immodexCSS));
      currentCard = null;
    } else {
      shadow = host.shadowRoot;
    }
    return shadow;
  }

  // ─── Carte ───

  function closeCard() {
    if (currentCard) currentCard.remove();
    currentCard = null;
  }

  function header(subtitle) {
    return el(
      'div',
      { class: 'imx-header' },
      el('span', { class: 'imx-logo' }, icon('pin', 17)),
      el('div', { class: 'imx-brand' }, el('span', { class: 'imx-title' }, 'Immodex+'), el('span', { class: 'imx-subtitle' }, subtitle)),
      el('button', { class: 'imx-close', type: 'button', title: 'Fermer', 'aria-label': 'Fermer', onclick: closeCard }, icon('close', 16))
    );
  }

  function criteriaSection(payload, onModify) {
    if (!payload) return null;
    return el(
      'div',
      { class: 'imx-section' },
      el(
        'div',
        { class: 'imx-section-head' },
        el('span', { class: 'imx-label' }, 'Critères lus sur l’annonce'),
        onModify ? el('button', { class: 'imx-link', type: 'button', onclick: onModify }, 'Modifier') : null
      ),
      UI.criteria(payload)
    );
  }

  function render({ subtitle, saved = null, payload = null, onModify = null, body = [], footer = null }) {
    const root = ensureShadow();
    if (!currentCard || !currentCard.isConnected) {
      currentCard = el('section', { class: 'imx-card', role: 'dialog', 'aria-label': 'Immodex+' });
      root.appendChild(currentCard);
    }
    const savedNotice = saved
      ? UI.notice(
          `Résultat enregistré le ${UI.formatDateTime(saved.createdAt)}`,
          saved.onRerun ? el('button', { class: 'imx-link', type: 'button', onclick: saved.onRerun }, 'Relancer') : null
        )
      : null;
    // replaceChildren écrirait « null » pour un pied absent : on filtre.
    currentCard.replaceChildren(...[header(subtitle), el('div', { class: 'imx-body' }, savedNotice, criteriaSection(payload, onModify), body), footer].filter(Boolean));
    return currentCard;
  }

  function footerFor(result, kind) {
    const source =
      kind === 'land'
        ? `Cadastre IGN${result && result.tier != null ? ` · niveau ${result.tier}` : ''}`
        : `${UI.datasetLabel(result && result.dataset)}${result && result.tier != null ? ` · niveau ${result.tier}` : ''}`;
    return el('div', { class: 'imx-footer' }, el('span', null, source), result && result.cached ? el('span', null, 'depuis le cache') : null);
  }

  function showLoading(payload) {
    const land = payload && payload.kind === 'land';
    render({
      subtitle: 'Recherche en cours',
      payload: payload && (payload.postal || payload.surface) ? payload : null,
      body: UI.loading(land ? 'Recherche dans le cadastre IGN…' : 'Recherche dans le registre ADEME des DPE…'),
    });
  }

  function showError(message, payload) {
    render({ subtitle: 'Lecture de l’annonce', payload, body: UI.alert(message) });
  }

  // Question posée avant la recherche : date du DPE (affine le score) et, si la
  // page ne les donne pas (étiquette en image), les lettres énergie et GES.
  function showDatePrompt(payload, onSubmit) {
    const askClasses = !payload.energyClass || !payload.gesClass;
    const energy = UI.letterPicker('dpe', payload.energyClass);
    const ges = UI.letterPicker('ges', payload.gesClass);
    const input = el('input', {
      class: 'imx-input',
      type: 'text',
      placeholder: 'JJ/MM/AAAA, MM/AAAA ou AAAA',
      autocomplete: 'off',
      value: payload.dateRange ? UI.formatRangeInput(payload.dateRange) : null,
    });
    const error = el('div', { class: 'imx-hidden' });
    // Valeurs de l'étiquette (kWh et kg CO₂) : recopiées par l'utilisateur, elles
    // déclenchent la recherche précise, souvent décisive en ville dense.
    const numberInput = (placeholder) => el('input', { class: 'imx-input', type: 'number', min: '0', max: '2000', placeholder });
    const consoInput = numberInput('ex. 185');
    const gesInput = numberInput('ex. 40');
    const readNumber = (input) => {
      const n = parseFloat(String(input.value).replace(',', '.'));
      return isFinite(n) && n > 0 ? n : null;
    };
    const withClasses = (p) => {
      if (!askClasses) return p;
      return {
        ...p,
        energyClass: energy.value || p.energyClass || null,
        gesClass: ges.value || p.gesClass || null,
        energyConsumption: p.energyConsumption ?? readNumber(consoInput),
        gesEmission: p.gesEmission ?? readNumber(gesInput),
      };
    };

    const submit = (useDate) => {
      const raw = useDate ? input.value.trim() : '';
      if (!raw) return onSubmit(withClasses({ ...payload, dateRange: null }));
      const parsed = window.__immodexExtract.parseUserDate(raw);
      if (!parsed) {
        error.replaceChildren(UI.alert('Date non reconnue. Format attendu : 12/03/2024, 03/2024 ou 2024.'));
        error.className = '';
        return;
      }
      onSubmit(withClasses({ ...payload, dateRange: window.__immodexExtract.parseDateRange(parsed) }));
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        submit(true);
      }
    });

    const form = el(
      'div',
      { class: 'imx-form imx-prompt' },
      askClasses
        ? el(
            'div',
            { class: 'imx-section' },
            el('span', { class: 'imx-label' }, 'Étiquette DPE de l’annonce'),
            el('small', { class: 'imx-meta' }, 'La page ne donne pas les lettres en texte : lis-les sur l’étiquette (facultatif).'),
            el('div', { class: 'imx-field' }, el('span', null, 'Classe énergie'), energy.node),
            el('div', { class: 'imx-field' }, el('span', null, 'Classe GES'), ges.node),
            payload.energyConsumption == null
              ? el(
                  'div',
                  { class: 'imx-grid' },
                  el('label', { class: 'imx-field' }, el('span', null, 'kWh/m²/an'), consoInput),
                  el('label', { class: 'imx-field' }, el('span', null, 'kg CO₂/m²/an'), gesInput)
                )
              : null,
            payload.energyConsumption == null ? el('small', { class: 'imx-meta' }, 'Les chiffres de l’étiquette rendent la recherche bien plus précise.') : null
          )
        : null,
      el('label', { class: 'imx-field' }, el('span', null, 'Date du DPE (facultatif)'), input, el('small', null, 'Sans date, la recherche se fait sur la surface et les classes.')),
      error,
      el(
        'div',
        { class: 'imx-form-actions' },
        el('button', { class: 'imx-btn imx-btn-primary', type: 'button', onclick: () => submit(true) }, icon('search', 15), 'Rechercher'),
        el('button', { class: 'imx-btn imx-btn-ghost', type: 'button', onclick: () => submit(false) }, 'Sans date')
      )
    );
    render({ subtitle: 'Avant de chercher', payload, body: form });
    setTimeout(() => input.focus(), 30);
  }

  // Après un résultat, la recherche est dans l'historique : le bouton le signale.
  function showResult(payload, result, onModify, saved) {
    render({ subtitle: 'Registre ADEME des DPE', saved, payload, onModify, body: UI.dpeResults(result), footer: footerFor(result, 'dpe') });
    setLauncherState(true);
  }

  function showLandResult(payload, result, onModify, saved) {
    render({ subtitle: 'Cadastre IGN', saved, payload, onModify, body: UI.landResults(result), footer: footerFor(result, 'land') });
    setLauncherState(true);
  }

  // ─── Bouton des annonces ───

  const launcher = { label: LABEL_SEARCH, saved: false, onClick: null, observer: null };

  function buildLauncher() {
    const btn = el(
      'button',
      { class: `imx-launcher${launcher.saved ? ' is-saved' : ''}`, id: 'immodex-floating-btn', type: 'button', title: `Immodex+ : ${launcher.label}`, 'aria-label': `Immodex+ : ${launcher.label}` },
      icon(launcher.saved ? 'clock' : 'pin', 17),
      el('span', { class: 'imx-launcher-label' }, launcher.label)
    );
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (launcher.onClick) launcher.onClick(btn);
    });
    return btn;
  }

  function mountFloatingButton(label, onClick) {
    if (label) launcher.label = label;
    if (onClick) launcher.onClick = onClick;
    const root = ensureShadow();
    let btn = root.getElementById('immodex-floating-btn');
    if (!btn) {
      btn = buildLauncher();
      root.appendChild(btn);
    }
    // Certains sites redessinent toute la page et retirent notre hôte : on le remet.
    if (!launcher.observer && typeof MutationObserver !== 'undefined' && document.body) {
      launcher.observer = new MutationObserver(() => {
        const host = document.getElementById(HOST_ID);
        if (!host || !host.isConnected) mountFloatingButton();
      });
      launcher.observer.observe(document.body, { childList: true });
    }
    return btn;
  }

  function setLauncherState(saved) {
    launcher.saved = saved;
    launcher.label = saved ? LABEL_SAVED : LABEL_SEARCH;
    const root = ensureShadow();
    const old = root.getElementById('immodex-floating-btn');
    if (old) old.replaceWith(buildLauncher());
  }

  function resetFloatingButton() {
    const root = ensureShadow();
    const old = root.getElementById('immodex-floating-btn');
    if (old) old.remove();
    if (launcher.onClick) root.appendChild(buildLauncher());
  }

  // ─── Enchaînement commun aux annonces ───

  function sendMessage(message) {
    return chrome.runtime.sendMessage(message).catch((err) => ({ ok: false, error: String(err.message || err) }));
  }

  // « Modifier » : les critères partent au service worker, que le popup relit à son ouverture.
  async function openOverride(payload) {
    await sendMessage({ type: 'PREFILL_SET', payload });
    const res = await sendMessage({ type: 'OPEN_POPUP' });
    if (!res || !res.opened) {
      alert("Cliquez sur l'icône Immodex+ dans la barre d'outils : le formulaire est pré-rempli avec ces critères.");
    }
  }

  async function runLookup(payload) {
    const response = await sendMessage({ type: 'LOOKUP', payload });
    if (!response || response.ok !== true) {
      showError(response?.error || 'Erreur inconnue', payload);
      return;
    }
    if (payload.kind === 'land' || response.result?.kind === 'land') {
      showLandResult(payload, response.result, () => openOverride(payload));
    } else {
      showResult(payload, response.result, () => openOverride(payload));
    }
  }

  // Un terrain part directement au cadastre ; un logement sans date de DPE ou sans
  // classe passe d'abord par une question. Avec la consommation, la recherche
  // précise suffit : on ne demande rien.
  function startLookup(payload) {
    const needsInput = !payload.dateRange || !payload.energyClass;
    if (payload.kind !== 'land' && needsInput && payload.energyConsumption == null) {
      showDatePrompt(payload, (updated) => {
        showLoading(updated);
        runLookup(updated);
      });
      return;
    }
    showLoading(payload);
    runLookup(payload);
  }

  function showSaved(entry, onRerun) {
    const saved = { createdAt: entry.createdAt, onRerun };
    const onModify = () => openOverride(entry.payload);
    if (entry.kind === 'land') showLandResult(entry.payload, entry.result, onModify, saved);
    else showResult(entry.payload, entry.result, onModify, saved);
  }

  async function savedEntryForPage() {
    const res = await sendMessage({ type: 'HISTORY_GET_FOR_URL', url: location.href });
    return res && res.ok ? res.entry : null;
  }

  let stateCheckedFor = null;

  // Bouton des annonces : si la page a déjà été cherchée, il réaffiche le
  // résultat enregistré au lieu d'interroger de nouveau les registres.
  function mountListingButton(onClick) {
    const handler = async (btn) => {
      const entry = await savedEntryForPage();
      if (entry) showSaved(entry, () => onClick(btn));
      else onClick(btn);
    };
    const btn = mountFloatingButton(null, handler);
    if (stateCheckedFor !== location.href) {
      stateCheckedFor = location.href;
      savedEntryForPage().then((entry) => setLauncherState(!!entry));
    }
    return btn;
  }

  function onNavigate(cb) {
    let lastUrl = location.href;
    const fire = () => {
      if (location.href !== lastUrl) {
        const prev = lastUrl;
        lastUrl = location.href;
        try {
          cb(prev, lastUrl);
        } catch (e) {
          console.warn('[immodex] onNavigate cb error:', e);
        }
      }
    };
    window.addEventListener('popstate', fire);
    window.addEventListener('hashchange', fire);
    setInterval(fire, 250);
    return () => {
      window.removeEventListener('popstate', fire);
      window.removeEventListener('hashchange', fire);
    };
  }

  window.__immodexOverlay = {
    showLoading,
    showError,
    showDatePrompt,
    showResult,
    showLandResult,
    closeCard,
    mountFloatingButton,
    mountListingButton,
    resetFloatingButton,
    onNavigate,
    openOverride,
    runLookup,
    startLookup,
    showSaved,
  };
})();
