// Bouton flottant sur les sites d'annonces sans extracteur dédié (portails et
// agences du Lillois listés dans le manifest). La lecture de la page passe par
// l'extracteur générique (src/common/generic-extract.js).
(function () {
  'use strict';

  const ui = window.__immodexOverlay;
  const gen = window.__immodexGeneric;

  // Les pages de liste et d'accueil n'ont ni surface ni DPE : pas de bouton.
  function looksLikeListing() {
    const text = (document.body && (document.body.innerText || document.body.textContent)) || '';
    return /\d\s*m\s*[²2]/i.test(text) && /(dpe|classe\s+[ée]nerg|kwh|diagnostic|performance\s+[ée]nerg|terrain)/i.test(text);
  }

  function onButtonClick() {
    let payload = null;
    try {
      payload = gen.extractPage();
    } catch (err) {
      console.error('[immodex generic] extraction error:', err);
    }
    console.log('[immodex generic] payload:', payload);
    const located = payload && (payload.postal || payload.city);
    if (!payload || !located || !payload.surface) {
      // Ce qui a été lu part quand même vers le popup, pour compléter à la main.
      if (payload) chrome.runtime.sendMessage({ type: 'PREFILL_SET', payload }).catch(() => {});
      ui.showError(
        "Lecture incomplète de cette annonce (code postal ou surface introuvable). Cliquez sur l'icône Immodex+ : le formulaire est pré-rempli avec ce qui a été trouvé.",
        payload
      );
      return;
    }
    ui.startLookup(payload);
  }

  function ensureButton() {
    if (looksLikeListing()) ui.mountListingButton(onButtonClick);
  }

  // Un seul minuteur, même après plusieurs navigations internes (sites en une page).
  let timer = null;

  function init() {
    ensureButton();
    if (!timer) timer = setInterval(ensureButton, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  ui.onNavigate(() => {
    ui.closeCard();
    ui.resetFloatingButton();
    setTimeout(init, 200);
  });
})();
