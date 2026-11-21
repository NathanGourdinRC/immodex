(function () {
  'use strict';

  const ex = window.__immodexExtract;
  const ui = window.__immodexOverlay;
  const STATE = { lastPayload: null, injectedFor: null };

  function readNextData() {
    const node = document.getElementById('__NEXT_DATA__');
    if (!node || !node.textContent) return null;
    try {
      return JSON.parse(node.textContent);
    } catch {
      return null;
    }
  }

  function findAd(nextData) {
    if (!nextData) return null;
    const direct = ex.getNestedValue(nextData, [
      ['props', 'pageProps', 'ad'],
      ['props', 'pageProps', 'data', 'ad'],
    ]);
    if (direct) return direct;
    return ex.deepFind(nextData, (n) => n && typeof n === 'object' && (n.attributes || n.list_id) && (n.subject || n.title));
  }

  // Annonce du bloc de données, si c'est bien celle de l'adresse affichée. Après une navigation
  // interne du site, le bloc reste celui de la première annonce ouverte.
  function currentAd() {
    const ad = findAd(readNextData());
    if (ad && ad.list_id && !location.pathname.includes(String(ad.list_id))) return null;
    return ad;
  }

  function attributesToMap(attributes) {
    const map = {};
    if (!Array.isArray(attributes)) return map;
    for (const attr of attributes) {
      if (attr && attr.key) map[attr.key] = attr;
    }
    return map;
  }

  function extractFromAd(ad) {
    if (!ad) return null;
    const attrMap = attributesToMap(ad.attributes);
    const get = (key) => {
      const a = attrMap[key];
      if (!a) return null;
      return a.value_label || a.value || null;
    };

    const location = ad.location || {};
    const postal = ex.normalizePostal(location.zipcode || location.zip_code);
    const city = location.city || null;

    const kind = ex.detectListingKind({
      category: ad.category_name,
      propertyType: get('real_estate_type'),
      title: ad.subject,
    });

    if (kind === 'land') {
      const landSurfaceRaw = get('land_plot_surface') || get('square');
      const surface = ex.normalizeLandSurface(landSurfaceRaw);
      const section = ex.normalizeSection([ad.subject, ad.body, ad.description].filter(Boolean).join(' '));
      return {
        kind: 'land',
        postal,
        city,
        surface,
        section,
        source: 'leboncoin-json',
      };
    }

    const energy = ex.normalizeClass(get('energy_rate'));
    const ges = ex.normalizeClass(get('ges'));
    const surfaceRaw = get('square') || get('surface') || get('size');
    const surface = ex.normalizeSurface(surfaceRaw);

    let buildingType = ex.normalizePropertyType(get('real_estate_type'));
    if (!buildingType) buildingType = ex.normalizePropertyType(ad.category_name);

    const text = [ad.subject, ad.body, ad.description].filter(Boolean).join('\n');
    const dateParsed = ex.extractDateFromText(text);
    const dateRange = ex.parseDateRange(dateParsed);

    const isNewBuild = /neuf|vefa|programme\s+neuf/i.test(text || '');

    return {
      kind: 'dpe',
      postal,
      city,
      surface,
      energyClass: energy,
      gesClass: ges,
      buildingType,
      dateRange,
      isNewBuild,
      source: 'leboncoin-json',
    };
  }

  function extractFromDom() {
    const energyEl =
      document.querySelector('[data-qa-id="criteria_item_energy_rate"]') ||
      document.querySelector('[data-qa-id="adview_energy_rate"]') ||
      document.querySelector('[data-testid="energy-rate"]');
    const gesEl =
      document.querySelector('[data-qa-id="criteria_item_ges"]') ||
      document.querySelector('[data-qa-id="adview_ges"]') ||
      document.querySelector('[data-testid="ges"]');
    const surfaceEl =
      document.querySelector('[data-qa-id="criteria_item_square"]') ||
      document.querySelector('[data-qa-id="adview_square"]') ||
      document.querySelector('[data-testid="square"]');
    const cityEl =
      document.querySelector('[data-qa-id="adview_location_informations"]') ||
      document.querySelector('a[href*="#map"]');
    const descEl =
      document.querySelector('[data-qa-id="adview_description_container"]') ||
      document.querySelector('#readme-content') ||
      document.querySelector('[data-testid="description"]');

    const energy = ex.normalizeClass(energyEl?.textContent);
    const ges = ex.normalizeClass(gesEl?.textContent);
    const surface = ex.normalizeSurface(surfaceEl?.textContent);
    let postal = null;
    let city = null;
    if (cityEl?.textContent) {
      const m = cityEl.textContent.match(/\b(\d{5})\b/);
      if (m) postal = m[1];
      const cm = cityEl.textContent.replace(/\d{5}/, '').trim();
      if (cm) city = cm.replace(/[•|·]/g, '').trim();
    }
    const descText = descEl?.textContent || document.body.innerText || '';
    const title = document.querySelector('h1')?.textContent || document.title || '';
    const isLand =
      /\bterrain[s]?\b/i.test(title) ||
      /\bterrain[s]?\b/i.test(descText) ||
      /\/terrain[s]?\b/i.test(location.pathname);

    if (isLand) {
      let landSurface = ex.normalizeLandSurface(surfaceEl?.textContent);
      if (!landSurface) {
        const sources = [title, descText, document.title || ''];
        for (const src of sources) {
          const m = src.match(/(\d{1,6})\s*m(?:²|2)\b/i);
          if (m) {
            landSurface = ex.normalizeLandSurface(m[1]);
            if (landSurface) break;
          }
        }
      }
      const section = ex.normalizeSection(descText + ' ' + title);
      if (!landSurface && !postal) return null;
      return {
        kind: 'land',
        postal,
        city,
        surface: landSurface,
        section,
        source: 'leboncoin-dom',
      };
    }

    const dateParsed = ex.extractDateFromText(descText);
    const dateRange = ex.parseDateRange(dateParsed);
    const isNewBuild = /neuf|vefa|programme\s+neuf/i.test(descText || '');

    if (!surface && !energy && !postal) return null;
    return {
      kind: 'dpe',
      postal,
      city,
      surface,
      energyClass: energy,
      gesClass: ges,
      buildingType: null,
      dateRange,
      isNewBuild,
      source: 'leboncoin-dom',
    };
  }

  function locateAnchor() {
    for (const h2 of document.querySelectorAll('h2')) {
      if (/diagnostic/i.test(h2.textContent || '')) {
        return h2.parentElement || h2;
      }
    }
    const energyRow =
      document.querySelector('[data-qa-id="criteria_item_energy_rate"]') ||
      document.querySelector('[data-qa-id="criteria_item_ges"]');
    if (energyRow && energyRow.parentElement) return energyRow.parentElement;

    const legacy =
      document.querySelector('[data-qa-id="adview_energy_rate"]') ||
      document.querySelector('[data-qa-id="adview_ges"]') ||
      document.querySelector('[data-qa-id="adview_criterias"]') ||
      document.querySelector('[data-testid="energy-rate"]');
    if (legacy) {
      const parent = legacy.parentElement?.parentElement || legacy.parentElement;
      if (parent) return parent;
    }
    return null;
  }

  // ─── Envoi au Fil ───
  // Les pages de résultats (lecture guidée) ne donnent que les lettres du DPE : quatre maisons de
  // 102 m² en D/D restent à égalité dans le registre, et le bien n'a pas de point sur la carte.
  // La page de l'annonce sait souvent plus : la date du DPE (description, ou saisie par Nathan) et
  // parfois ses chiffres. Elle est envoyée au Fil, qui cherche aussitôt l'adresse (api/_lib/ingest.js),
  // comme les pages SeLoger. Rien n'est demandé au site : seule la page affichée est lue.
  const LBC_TYPES = { 1: 'maison', 2: 'appartement' };
  const sentToFil = new Set();
  // `ad` : bloc de données de la page (__NEXT_DATA__) s'il existe. Sans lui (page servie
  // autrement), l'annonce est construite avec ce que la page affiche, comme la recherche Immodex
  // qui relit alors les étiquettes : sans ce repli, rien ne partait, sans aucun message.
  function cardForFil(ad, payload) {
    if (!payload || payload.kind !== 'dpe') return null;
    if (!payload.dateRange && payload.energyConsumption == null) return null;
    // Annonce de vente seulement : une location n'a rien à faire dans le Fil.
    const m = location.pathname.match(/^\/ad\/ventes_immobilieres\/(\d+)/);
    if (!m) return null;
    // Navigation interne du site : le bloc de données peut encore être celui de l'annonce d'avant.
    if (ad && ad.list_id && String(ad.list_id) !== m[1]) ad = null;
    const attr = (key) => (ad && Array.isArray(ad.attributes) ? ad.attributes.find((x) => x.key === key)?.value : null);
    if (ad && ad.category_id != null && String(ad.category_id) !== '9') return null;
    const title = (ad && ad.subject) || document.querySelector('h1')?.textContent?.trim() || document.title || '';
    const type = LBC_TYPES[attr('real_estate_type')] || (payload.buildingType === 'maison' || payload.buildingType === 'appartement' ? payload.buildingType : null) || (/\bmaison\b/i.test(title) ? 'maison' : /\bappartement\b/i.test(title) ? 'appartement' : null);
    if (!type) return null;
    const number = (v) => {
      const n = Number(String(Array.isArray(v) ? v[0] : v ?? '').replace(/[^\d.]/g, ''));
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    let price = ad ? number(ad.price) : null;
    if (!price) {
      try {
        price = window.__immodexGeneric?.extractPrice(document, 'vente') || null;
      } catch {
        price = null;
      }
    }
    return {
      url: `${location.origin}${m[0]}`,
      price,
      title: title.slice(0, 160) || null,
      type,
      detail: {
        surface: payload.surface ?? number(attr('square')),
        pieces: number(attr('rooms')),
        chambres: number(attr('bedrooms')),
        terrain: number(attr('land_plot_surface')),
        photo: (ad && ad.images?.urls?.[0]) || null,
        postal: payload.postal || null,
        city: payload.city || null,
        energyClass: payload.energyClass || null,
        gesClass: payload.gesClass || null,
        energyConsumption: payload.energyConsumption ?? null,
        gesEmission: payload.gesEmission ?? null,
        dateRange: payload.dateRange || null,
      },
    };
  }
  function sendToFil(payload) {
    try {
      const card = cardForFil(currentAd(), payload);
      if (!card) return;
      // Une fois par annonce et par date : la même page rechargée ne renvoie rien.
      const once = `${card.url}|${JSON.stringify(card.detail.dateRange)}|${card.detail.energyConsumption}`;
      if (sentToFil.has(once)) return;
      sentToFil.add(once);
      // Trace dans la console de la page (F12) : l'envoi ne se voit pas autrement.
      chrome.runtime
        .sendMessage({ type: 'LIST_CARDS', source: 'leboncoin', cards: [card] })
        .then((res) => console.log('[immodex] annonce envoyée au Fil', res && res.ok ? `(reçue, ${res.added ? 'nouvelle' : 'déjà connue'})` : `: refus, ${(res && res.error) || 'sans réponse'}`, card.detail.dateRange))
        .catch((err) => console.warn('[immodex] envoi au Fil impossible :', String((err && err.message) || err)));
    } catch {
      // Extension rechargée pendant la visite, ou page sans bloc de données : rien à envoyer.
    }
  }

  async function runLookup(payload) {
    STATE.lastPayload = payload;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'LOOKUP', payload });
      if (!response || response.ok !== true) {
        ui.showError(response?.error || 'Erreur inconnue', payload);
        return;
      }
      // Date saisie par Nathan (ou lue dans la description) : le Fil en profite aussi.
      sendToFil(payload);
      if (payload.kind === 'land' || response.result?.kind === 'land') {
        ui.showLandResult(payload, response.result, () => openOverride(payload));
      } else {
        ui.showResult(payload, response.result, () => openOverride(payload));
      }
    } catch (err) {
      ui.showError(String(err.message || err), payload);
    }
  }

  function openOverride(payload) {
    ui.openOverride(payload);
  }

  function onButtonClick() {
    try {
      console.log('[immodex] button clicked');
      const nextData = readNextData();
      console.log('[immodex] nextData present:', !!nextData);
      const ad = findAd(nextData);
      console.log('[immodex] ad found:', !!ad, ad && ad.list_id);
      let payload = ad ? extractFromAd(ad) : null;
      console.log('[immodex] payload from JSON:', payload);
      if (!payload || (!payload.surface && !payload.energyClass)) {
        const fallback = extractFromDom();
        console.log('[immodex] payload from DOM fallback:', fallback);
        if (fallback) payload = { ...(payload || {}), ...fallback };
      }
      if (!payload) {
        ui.showError("Impossible d'extraire les données DPE de cette page.", null);
        return;
      }

      if (payload.kind === 'land') {
        if (!payload.surface || !payload.postal) {
          ui.showError("Impossible d'extraire la surface ou le code postal de ce terrain.", payload);
          return;
        }
        ui.showLoading(payload);
        runLookup(payload);
        return;
      }

      if (!payload.dateRange) {
        ui.showDatePrompt(payload, (updated) => {
          ui.showLoading(updated);
          runLookup(updated);
        });
        return;
      }

      ui.showLoading(payload);
      runLookup(payload);
    } catch (err) {
      console.error('[immodex] click handler error:', err);
      ui.showError('Erreur: ' + (err.message || String(err)), null);
    }
  }

  // Extracteur exposé à « Analyser cette page » (lecture générique) du popup, et lecture envoyée
  // au Fil. Bloc de données d'une autre annonce (navigation interne du site) : ignoré, la page
  // affichée fait foi.
  window.__immodexSiteExtract = () => {
    const ad = currentAd();
    let payload = ad ? extractFromAd(ad) : null;
    if (!payload || (!payload.surface && !payload.energyClass)) {
      const fallback = extractFromDom();
      if (fallback) payload = { ...(payload || {}), ...fallback };
    }
    return payload;
  };

  // Description qui donne la date du DPE : envoyée au Fil dès l'ouverture de la page, sans clic.
  // Relancé toutes les 2 s (ensureButton) tant que la page n'est pas lisible : une page qui se
  // dessine après coup est lue dès que la surface ou la lettre du DPE apparaît.
  let autoSentFor = null;
  function autoSend() {
    if (autoSentFor === location.href) return;
    let payload = null;
    try {
      payload = window.__immodexSiteExtract();
    } catch {
      payload = null;
    }
    if (!payload || (!payload.surface && !payload.energyClass)) return;
    autoSentFor = location.href;
    sendToFil(payload);
  }

  function ensureButton() {
    ui.mountListingButton(onButtonClick);
    autoSend();
  }

  function init() {
    ensureButton();
    setInterval(ensureButton, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  ui.onNavigate(() => {
    console.log('[immodex] SPA nav, reset');
    STATE.lastPayload = null;
    STATE.injectedFor = null;
    ui.closeCard();
    ui.resetFloatingButton();
    setTimeout(init, 200);
  });
})();
