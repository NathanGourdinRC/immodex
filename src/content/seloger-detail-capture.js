// Page d'annonce SeLoger ouverte dans le navigateur : la consommation, les émissions et l'année de
// construction qu'elle affiche sont envoyées au Fil, qui en tire l'adresse du bien dans le registre
// des DPE. Ce script ne clique sur rien et n'ouvre aucune page. Deux cas :
//  - Nathan visite l'annonce : la lecture part d'elle-même (message SELOGER_DETAIL_SEEN) ;
//  - la tournée quotidienne (src/background/seloger-tour-runner.js) a ouvert la page dans sa fenêtre
//    réduite et réclame la lecture (message SELOGER_TOUR_READ) ; elle l'envoie elle-même.
(function () {
  'use strict';
  if (window.__immodexSelogerCaptureLoaded) return;
  window.__immodexSelogerCaptureLoaded = true;

  const reader = window.__immodexSelogerDetail;
  if (!reader) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Le bloc de données est dans le HTML reçu : il est là dès le chargement. Un court délai laisse
  // le temps à une page lente, sans attendre indéfiniment une page qui n'en a pas (annonce retirée,
  // défi anti-robot).
  async function readWhenReady() {
    for (let i = 0; i < 8; i++) {
      const found = reader.readDetail(document);
      if (found) return found;
      if (i >= 2 && reader.isChallenge(document)) break;
      await sleep(500);
    }
    return { hasData: false, challenge: reader.isChallenge(document) };
  }

  let pending = null;
  const capture = () => (pending = pending || readWhenReady());

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'SELOGER_TOUR_READ') return false;
    capture().then(sendResponse);
    return true;
  });

  // Visite de Nathan : envoyée seulement si la page apporte des chiffres que les cartes de liste
  // n'ont pas. Le service worker ignore l'onglet de la tournée (c'est elle qui envoie).
  capture().then((found) => {
    if (!found.hasData || found.card.detail.energyConsumption == null) return;
    try {
      chrome.runtime.sendMessage({ type: 'SELOGER_DETAIL_SEEN', card: found.card }).catch(() => {});
    } catch {
      // extension rechargée pendant la visite : rien à faire
    }
  });
})();
