// Page de résultats ouverte dans le navigateur (Leboncoin, PAP, Bien'ici, SeLoger) : les annonces
// affichées sont envoyées au Fil, une fois par page. Ce script ne clique sur rien et n'ouvre aucune
// page : seule la tournée quotidienne de Leboncoin (src/background/lbc-tour-runner.js) ouvre des
// recherches, et c'est elle qui réclame le résultat ci-dessous. Un petit message confirme ce qui a
// été lu.
(function () {
  'use strict';
  if (window.__immodexListCaptureLoaded) return;
  window.__immodexListCaptureLoaded = true;

  const reader = window.__immodexListExtract;
  if (!reader) return;

  let sent = new Set(); // adresses déjà envoyées depuis l'ouverture de l'onglet

  function toast(text) {
    const box = document.createElement('div');
    box.textContent = text;
    box.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;background:#1f2937;color:#fff;padding:8px 12px;border-radius:8px;font:13px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);';
    document.documentElement.appendChild(box);
    setTimeout(() => box.remove(), 4000);
  }

  // Lire la page a un coût (gros bloc de données chez SeLoger) : seulement si elle a changé.
  // Le résultat de la dernière lecture est gardé : la tournée quotidienne de Leboncoin (service
  // worker) le réclame sans relire ni renvoyer la page une seconde fois.
  let signature = '';
  let last = null;
  let running = null;

  // Ce que la page montre quand rien n'est lisible : sert à savoir, dans la ligne du Fil, si le site a
  // renvoyé un défi anti-robot, une page vide ou autre chose (la tournée s'arrête dans tous les cas).
  function diagnose() {
    const captcha = !!document.querySelector('iframe[src*="captcha-delivery"], iframe[src*="datadome"], script[src*="captcha-delivery"]');
    const data = !!document.getElementById('__NEXT_DATA__') || !!document.getElementById('__UFRN_FETCHER__');
    return `page « ${String(document.title || '').slice(0, 60)} », données dans la page : ${data ? 'oui' : 'non'}, défi anti-robot : ${captcha ? 'oui' : 'non'}, fenêtre : ${document.visibilityState}`;
  }

  async function read() {
    const info = reader.searchInfo ? reader.searchInfo(document) : null;
    let list = null;
    try {
      list = reader.extractList(document);
    } catch (err) {
      console.warn('[immodex liste] lecture impossible :', err);
      return { hasData: false, count: 0, postalCounts: {}, error: 'lecture impossible', diag: diagnose() };
    }
    const result = {
      hasData: !!(list || (info && info.hasData)),
      total: info ? info.total : null,
      maxPages: info ? info.maxPages : null,
      count: list ? list.cards.length : 0,
      postalCounts: {},
    };
    if (!result.hasData) result.diag = diagnose();
    for (const c of list ? list.cards : []) {
      const postal = c.detail && c.detail.postal;
      if (postal) result.postalCounts[postal] = (result.postalCounts[postal] || 0) + 1;
    }
    if (!list) return result;
    const cards = list.cards.filter((c) => !sent.has(c.url));
    if (!cards.length) return result;
    for (const c of cards) sent.add(c.url);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'LIST_CARDS', source: list.source, cards });
      if (res && res.ok) {
        result.seen = res.seen || 0;
        result.added = res.added || 0;
        if (res.seen) toast(`Immodex+ : ${res.seen} annonce${res.seen > 1 ? 's' : ''} de vos communes lue${res.seen > 1 ? 's' : ''}, ${res.added} nouvelle${res.added > 1 ? 's' : ''}`);
      } else {
        // Pas envoyé (synchro non activée, réseau) : réessayé au prochain changement de la page.
        for (const c of cards) sent.delete(c.url);
        result.error = (res && res.error) || 'envoi refusé';
        if (res && res.error) console.warn('[immodex liste]', res.error);
      }
    } catch {
      // extension rechargée pendant la visite : rien à faire
      result.error = 'extension rechargée';
    }
    return result;
  }

  function capture() {
    const now = `${location.href}|${document.getElementsByTagName('a').length}`;
    if (now === signature) return running || Promise.resolve(last);
    signature = now;
    running = read().then((r) => {
      last = r;
      running = null;
      return r;
    });
    return running;
  }

  // Tournée quotidienne : le service worker ouvre la recherche dans une fenêtre réduite (où le
  // minuteur ci-dessous ne lit pas) et réclame ce qui a été lu et envoyé.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'LBC_TOUR_READ') return false;
    capture().then((r) => sendResponse(r || { hasData: false, count: 0, postalCounts: {} }));
    return true;
  });

  // Les sites dessinés en JavaScript affichent leurs annonces après le chargement, et changent de
  // page de résultats sans recharger : l'adresse et le contenu sont regardés de temps en temps,
  // seulement tant que l'onglet est visible.
  let lastUrl = location.href;
  setInterval(() => {
    if (document.hidden) return;
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      sent = new Set();
    }
    capture();
  }, 5000);
  setTimeout(capture, 2000);
})();
