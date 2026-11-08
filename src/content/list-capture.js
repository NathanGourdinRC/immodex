// Page de résultats ouverte dans le navigateur (Leboncoin, PAP, Bien'ici, SeLoger) : les annonces
// affichées sont envoyées au Fil, une fois par page. Rien n'est demandé au site : pas de clic, pas
// de page suivante ouverte toute seule. Un petit message confirme ce qui a été lu.
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
  let signature = '';
  async function capture() {
    const now = `${location.href}|${document.getElementsByTagName('a').length}`;
    if (now === signature) return;
    signature = now;
    let list = null;
    try {
      list = reader.extractList(document);
    } catch (err) {
      console.warn('[immodex liste] lecture impossible :', err);
      return;
    }
    if (!list) return;
    const cards = list.cards.filter((c) => !sent.has(c.url));
    if (!cards.length) return;
    for (const c of cards) sent.add(c.url);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'LIST_CARDS', source: list.source, cards });
      if (res && res.ok) {
        if (res.seen) toast(`Immodex+ : ${res.seen} annonce${res.seen > 1 ? 's' : ''} de vos communes lue${res.seen > 1 ? 's' : ''}, ${res.added} nouvelle${res.added > 1 ? 's' : ''}`);
      } else {
        // Pas envoyé (synchro non activée, réseau) : réessayé au prochain changement de la page.
        for (const c of cards) sent.delete(c.url);
        if (res && res.error) console.warn('[immodex liste]', res.error);
      }
    } catch {
      // extension rechargée pendant la visite : rien à faire
    }
  }

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
