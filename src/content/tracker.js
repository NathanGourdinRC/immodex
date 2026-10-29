// Suivi des biens : à l'ouverture d'une annonce, son empreinte (ville, surface, DPE,
// prix…) est enregistrée sans lancer de recherche. Le service worker répond avec les
// autres annonces du même bien déjà vues, affichées sur le bouton et dans la carte.
(function () {
  'use strict';
  // Une seule fois par page, même si le popup réinjecte les scripts.
  if (window.__immodexTrackerLoaded) return;
  window.__immodexTrackerLoaded = true;

  const gen = window.__immodexGeneric;
  const ui = window.__immodexOverlay;
  if (!gen || !ui) return;

  let recordedFor = null;

  // Mêmes critères que le bouton des sites génériques : surface et DPE sur la page.
  function looksLikeListing() {
    const text = (document.body && (document.body.innerText || document.body.textContent)) || '';
    return /\d\s*m\s*[²2]/i.test(text) && /(dpe|[ée]nerg[ée]tique|classe\s+[ée]nergie|kwh|diagnostic|terrain)/i.test(text);
  }

  async function record() {
    const url = location.href;
    if (recordedFor === url || !looksLikeListing()) return;
    let payload = null;
    try {
      payload = gen.extractPage();
    } catch (err) {
      console.warn('[immodex tracker] extraction error:', err);
      return;
    }
    if (!payload || !payload.surface || !(payload.postal || payload.city)) return;
    recordedFor = url;
    const transaction = gen.detectTransaction(document);
    const fp = gen.fingerprint(payload, transaction);
    let price = null;
    try {
      price = gen.extractPrice(document, transaction);
    } catch {
      price = null;
    }
    try {
      const res = await chrome.runtime.sendMessage({ type: 'SIGHTING_RECORD', page: { url, title: document.title }, fp, price });
      if (res && res.ok && location.href === url) ui.setSightings(res);
    } catch {
      // extension rechargée pendant la visite : rien à faire
    }
  }

  // Laisse le temps aux sites dessinés en JavaScript d'afficher l'annonce.
  const schedule = (delay) => setTimeout(record, delay);
  if (document.readyState === 'complete') schedule(1500);
  else window.addEventListener('load', () => schedule(1500));

  ui.onNavigate(() => {
    recordedFor = null;
    ui.setSightings(null);
    schedule(2000);
  });
})();
