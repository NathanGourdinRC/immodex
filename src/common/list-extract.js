// Lecture d'une page de résultats ouverte par Nathan dans son navigateur (Leboncoin, PAP, Bien'ici,
// SeLoger) : chaque annonce affichée devient une carte envoyée au Fil. Ces sites refusent le robot ;
// ici rien n'est demandé au site, seule la page déjà affichée est lue.
(function () {
  'use strict';

  const norm = (s) => String(s || '').replace(/[\s  ]+/g, ' ').trim();
  const num = (s) => {
    const n = Number(String(s == null ? '' : s).replace(/[\s  ]/g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const letter = (s) => {
    const v = String(s || '').trim().toUpperCase();
    return /^[A-G]$/.test(v) ? v : null;
  };
  const titleOf = (type, surface, city) => norm(`${type} ${surface ? `${surface} m²` : ''} ${city || ''}`);

  // ─── Leboncoin ───
  const LBC_TYPES = { 1: 'maison', 2: 'appartement', 3: 'terrain' };
  function leboncoinFromData(data) {
    const cards = [];
    for (const ad of data) {
      const type = LBC_TYPES[(ad.attributes || []).find((x) => x.key === 'real_estate_type')?.value];
      // Ventes immobilières (catégorie 9) en ligne, sans les parkings et les autres biens.
      if (!type || String(ad.category_id) !== '9' || ad.status !== 'active' || !ad.url) continue;
      const attr = (key) => (ad.attributes || []).find((x) => x.key === key)?.value;
      const city = ad.location?.city || null;
      const surface = num(attr('square'));
      cards.push({
        url: ad.url,
        price: num(Array.isArray(ad.price) ? ad.price[0] : ad.price),
        title: ad.subject || titleOf(type, surface, city),
        type,
        detail: {
          surface,
          pieces: num(attr('rooms')),
          chambres: num(attr('bedrooms')),
          terrain: num(attr('land_plot_surface')),
          photo: ad.images?.urls?.[0] || null,
          postal: ad.location?.zipcode || null,
          city,
          energyClass: letter(attr('energy_rate')),
          gesClass: letter(attr('ges')),
        },
      });
    }
    return cards;
  }
  // Carte dessinée : « 742 000 € … Maison · 167m² … Située à Marcq-en-Baroeul 59700 ».
  function leboncoinFromPage(doc) {
    const cards = [];
    for (const box of doc.querySelectorAll('article[data-test-id="ad"], [data-qa-id="aditem_container"]')) {
      const link = box.querySelector('a[href*="/ad/ventes_immobilieres/"]') || box.closest('a[href*="/ad/ventes_immobilieres/"]');
      if (!link) continue;
      const text = norm(box.textContent);
      const kind = text.match(/\b(Maison|Appartement|Terrain)\s*·\s*(\d+)\s*m²/i);
      const place = text.match(/Située? à (.+?) (\d{5})\b/);
      if (!kind || !place) continue;
      const type = kind[1].toLowerCase();
      const surface = num(kind[2]);
      cards.push({
        url: new URL(link.getAttribute('href'), doc.location.href).href.split('?')[0],
        price: num((text.match(/(\d[\d\s]*)\s*€/) || [])[1]),
        title: titleOf(kind[1], surface, place[1]),
        type,
        detail: { surface, photo: box.querySelector('img')?.src || null, postal: place[2], city: place[1] },
      });
    }
    return cards;
  }
  function leboncoin(doc) {
    const fromPage = leboncoinFromPage(doc);
    let ads = [];
    try {
      ads = JSON.parse(doc.getElementById('__NEXT_DATA__')?.textContent || '{}').props?.pageProps?.searchData?.ads || [];
    } catch {
      ads = [];
    }
    // Page suivante ouverte sans recharger : le bloc de données est resté celui de la première.
    const idOf = (u) => (String(u).match(/(\d+)\/?$/) || [])[1];
    const current = fromPage[0] && !ads.some((a) => idOf(a.url) === idOf(fromPage[0].url));
    return current || !ads.length ? fromPage : leboncoinFromData(ads);
  }

  // ─── Bien'ici : « Maison 5 pièces 100 m² 59700 Marcq-en-Barœul 495 000 € 4 800 €/m² » ───
  function bienici(doc) {
    const cards = [];
    for (const box of doc.querySelectorAll('article.ad-overview')) {
      const link = box.querySelector('a[href*="/annonce/vente/"]');
      if (!link) continue;
      const path = new URL(link.getAttribute('href'), doc.location.href);
      const type = (path.pathname.match(/\/annonce\/vente\/[^/]+\/(maison|appartement|terrain)\//) || [])[1];
      if (!type) continue;
      const text = norm(box.textContent);
      const place = text.match(/\b(\d{5}) (\D+?)(?= \d| Prix|$)/);
      const surface = num((text.match(/(\d+(?:,\d+)?) m²/) || [])[1]);
      cards.push({
        url: `${path.origin}${path.pathname}`,
        price: num((text.match(/(\d[\d\s]*)\s*€(?!\s*\/)/) || [])[1]),
        title: titleOf(type === 'maison' ? 'Maison' : type === 'appartement' ? 'Appartement' : 'Terrain', surface, place && place[2]),
        type,
        detail: {
          surface: surface ? Math.round(surface) : null,
          pieces: num((text.match(/(\d+) pièces?/) || [])[1]),
          photo: box.querySelector('img')?.src || null,
          postal: place ? place[1] : null,
          city: place ? place[2] : null,
        },
      });
    }
    return cards;
  }

  // ─── PAP : ville dans un morceau de texte à part, « Pussay (91740) », type dans l'adresse ───
  function pap(doc) {
    const cards = [];
    for (const box of doc.querySelectorAll('.search-list-item-alt')) {
      const link = box.querySelector('a[href*="/annonces/"]');
      if (!link) continue;
      const path = new URL(link.getAttribute('href'), doc.location.href);
      const type = (path.pathname.match(/^\/annonces\/(maison|appartement|terrain)-/) || [])[1];
      if (!type) continue;
      const title = box.querySelector('.item-title') || box;
      let place = null;
      const walker = doc.createTreeWalker(title, 4);
      for (let node = walker.nextNode(); node && !place; node = walker.nextNode()) place = norm(node.nodeValue).match(/^(.+?) \((\d{5})\)/);
      const text = norm(title.textContent);
      const surface = num((text.match(/(\d+) m²/) || [])[1]);
      const price = (box.querySelector('.item-price')?.textContent || '').replace(/[^\d]/g, '');
      cards.push({
        url: `${path.origin}${path.pathname}`,
        price: num(price),
        title: titleOf(type === 'maison' ? 'Maison' : type === 'appartement' ? 'Appartement' : 'Terrain', surface, place && place[1]),
        type,
        detail: {
          surface,
          pieces: num((text.match(/(\d+) pièces?/) || [])[1]),
          chambres: num((text.match(/(\d+) chambres?/) || [])[1]),
          photo: box.querySelector('img')?.src || null,
          postal: place ? place[2] : null,
          city: place ? place[1] : null,
        },
      });
    }
    return cards;
  }

  // ─── SeLoger : bloc de données de la page (même lecture que le robot, api/_lib/sources.js) ───
  const SELOGER_TYPES = { HOUSE: 'maison', APARTMENT: 'appartement', LAND: 'terrain' };
  function seloger(doc) {
    let ads = [];
    for (const s of doc.querySelectorAll('script')) {
      const m = (s.textContent || '').match(/window\["__UFRN_FETCHER__"\]=JSON\.parse\("((?:[^"\\]|\\.)*)"\)/);
      if (!m) continue;
      const walk = (o) => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) return o.forEach(walk);
        if (o.hardFacts && o.url) ads.push(o);
        Object.values(o).forEach(walk);
      };
      try {
        walk(JSON.parse(JSON.parse(`"${m[1]}"`)));
      } catch {
        ads = [];
      }
      break;
    }
    const cards = [];
    for (const ad of ads) {
      const type = SELOGER_TYPES[ad.rawData?.propertyType];
      if (!type || ad.status !== 'Published') continue;
      const fact = (name) => {
        const n = num(ad.hardFacts.facts?.find((f) => f.type === name)?.splitValue);
        return n ? Math.round(n) : null;
      };
      const place = ad.location?.address || {};
      const surface = fact('livingSpace');
      cards.push({
        url: ad.url,
        price: num(ad.rawData.price),
        title: titleOf(type === 'maison' ? 'Maison' : type === 'appartement' ? 'Appartement' : 'Terrain', surface, place.city),
        type,
        detail: {
          surface,
          pieces: fact('numberOfRooms'),
          chambres: fact('numberOfBedrooms'),
          terrain: fact('plotSpace'),
          photo: ad.gallery?.images?.[0]?.url || null,
          postal: place.zipCode || null,
          city: place.city || null,
          energyClass: letter(ad.energyClass),
        },
      });
    }
    return cards;
  }

  const SITES = [
    { source: 'leboncoin', host: /(^|\.)leboncoin\.fr$/, read: leboncoin },
    { source: 'bienici', host: /(^|\.)bienici\.com$/, read: bienici },
    { source: 'pap', host: /(^|\.)pap\.fr$/, read: pap },
    { source: 'seloger', host: /(^|\.)seloger\.com$/, read: seloger },
  ];

  // Carte d'identité d'une page de résultats : la source et ses annonces, ou rien.
  function extractList(doc) {
    const site = SITES.find((s) => s.host.test(doc.location.hostname));
    if (!site) return null;
    const seen = new Set();
    // Adresse absolue : certains sites les donnent à partir de la racine (« /annonces/... »).
    const cards = site
      .read(doc)
      .map((c) => ({ ...c, url: new URL(c.url, doc.location.href).href }))
      .filter((c) => !seen.has(c.url) && seen.add(c.url));
    return cards.length ? { source: site.source, cards } : null;
  }

  window.__immodexListExtract = { extractList };
})();
