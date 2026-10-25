// Lecture générique d'une annonce immobilière, sur n'importe quel site.
// Utilisée par le bouton « Analyser cette page » du popup et par le bouton
// flottant des sites d'agences. Chaque information est cherchée dans plusieurs
// sources, de la plus fiable à la moins fiable :
//   1. extracteur dédié du site s'il existe (Leboncoin, Bienici, SeLoger) ;
//   2. données structurées JSON-LD (schema.org) ;
//   3. texte visible de l'annonce (libellés « Classe énergie : D », « 85 m² »…) ;
//   4. étiquettes DPE dessinées (lettre mise en avant, images) ;
//   5. JSON embarqué dans les scripts de la page.
(function () {
  'use strict';

  const ex = window.__immodexExtract;
  const LETTER = /^[A-G]$/;

  // Seuils du DPE 2021 (logements de 40 m² et plus) : la classe énergie est la
  // moins bonne des deux lettres (consommation, émissions).
  const EP_THRESHOLDS = [70, 110, 180, 250, 330, 420];
  const GES_THRESHOLDS = [6, 11, 30, 50, 70, 100];

  function letterFor(value, thresholds) {
    const i = thresholds.findIndex((t) => value <= t);
    return 'ABCDEFG'[i === -1 ? 6 : i];
  }

  function deriveClasses(ep, ges, surface) {
    if (ep == null || ges == null) return null;
    // Sous 40 m², des seuils ajustés s'appliquent depuis 2024 : on ne devine pas.
    if (surface != null && surface < 40) return null;
    const gesClass = letterFor(ges, GES_THRESHOLDS);
    const epClass = letterFor(ep, EP_THRESHOLDS);
    return { energyClass: epClass > gesClass ? epClass : gesClass, gesClass };
  }

  function cleanText(s) {
    return String(s || '')
      .replace(/[   ]/g, ' ')
      .replace(/[ \t]+/g, ' ');
  }

  function parseNumber(s) {
    if (s == null) return null;
    const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  // Une lettre de classe n'est retenue qu'en majuscule dans le texte d'origine :
  // évite de prendre « a » ou « à » pour une classe A.
  function firstLetter(text, patterns) {
    for (const re of patterns) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let m;
      while ((m = g.exec(text))) {
        if (!LETTER.test(m[1])) continue;
        // « DPE : A venir », « Classe énergie : en cours » ne sont pas des classes.
        const after = text.slice(m.index + m[0].length, m.index + m[0].length + 12);
        if (/^\s*(venir|vierge|en cours|non\b)/i.test(after)) continue;
        return m[1];
      }
    }
    return null;
  }

  // « 1 200 », « 1.200 » : séparateurs de milliers, pas une virgule décimale.
  function parseLandNumber(s) {
    const t = String(s).trim();
    if (/^\d{1,3}(?:[ .]\d{3})+$/.test(t)) return parseInt(t.replace(/[ .]/g, ''), 10);
    return parseNumber(t);
  }

  function firstNumber(text, patterns, { min = 0, max = Infinity } = {}) {
    for (const re of patterns) {
      const m = text.match(re);
      if (m) {
        const n = parseNumber(m[1]);
        if (n != null && n >= min && n <= max) return n;
      }
    }
    return null;
  }

  // ─── Sources ───

  function readJsonLd(doc) {
    const out = [];
    for (const node of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(node.textContent);
        const stack = [data];
        while (stack.length) {
          const cur = stack.pop();
          if (Array.isArray(cur)) stack.push(...cur);
          else if (cur && typeof cur === 'object') {
            out.push(cur);
            for (const v of Object.values(cur)) if (v && typeof v === 'object') stack.push(v);
          }
        }
      } catch {
        // JSON-LD mal formé : ignoré
      }
    }
    return out;
  }

  function fromJsonLd(objects) {
    const r = {};
    for (const o of objects) {
      const types = [].concat(o['@type'] || []).map(String);
      if (!r.postal && o.postalCode) r.postal = ex.normalizePostal(o.postalCode);
      if (!r.city && o.addressLocality && typeof o.addressLocality === 'string') r.city = o.addressLocality;
      if (!r.surface && o.floorSize) {
        const fs = typeof o.floorSize === 'object' ? o.floorSize.value : o.floorSize;
        r.surface = ex.normalizeSurface(fs);
      }
      if (!r.buildingType) {
        if (types.some((t) => /House|SingleFamilyResidence/i.test(t))) r.buildingType = 'maison';
        else if (types.some((t) => /Apartment/i.test(t))) r.buildingType = 'appartement';
      }
      if (!r.text && typeof o.description === 'string') r.text = o.description;
    }
    return r;
  }

  // Bloc principal de l'annonce si la page en déclare un, sinon toute la page.
  function mainText(doc) {
    const main = doc.querySelector('main, [role="main"], article');
    const body = doc.body;
    const pick = main && (main.innerText || main.textContent || '').length > 400 ? main : body;
    if (!pick) return '';
    return cleanText(pick.innerText != null && pick.innerText !== '' ? pick.innerText : pick.textContent);
  }

  function headline(doc) {
    const parts = [
      doc.querySelector('h1')?.textContent,
      doc.querySelector('meta[property="og:title"]')?.getAttribute('content'),
      doc.title,
    ];
    return cleanText(parts.filter(Boolean).join(' | '));
  }

  const ENERGY_PATTERNS = [
    /(?:classe|[ée]tiquette|lettre)\s+(?:de\s+)?(?:l['’])?(?:[ée]nergie|[ée]nerg[ée]tique|dpe|consommation)\s*(?:\(dpe\))?\s*[:\-–]?\s*\(?([A-Ga-g])\b/i,
    /(?:diagnostic\s+de\s+performance\s+[ée]nerg[ée]tique|performance\s+[ée]nerg[ée]tique|consommations?\s+[ée]nerg[ée]tiques?)\s*(?:\(dpe\))?\s*(?:classe)?\s*[:\-–]?\s*([A-Ga-g])\b/i,
    /\bDPE\s*(?:classe)?\s*[:\-–]?\s*([A-G])\b/,
  ];
  const GES_PATTERNS = [
    /(?:classe|[ée]tiquette|lettre)\s+(?:de\s+)?(?:ges|climat|co2|gaz\s+[àa]\s+effet\s+de\s+serre|[ée]missions?)\s*(?:\(ges\))?\s*[:\-–]?\s*\(?([A-Ga-g])\b/i,
    /(?:[ée]missions?\s+de\s+gaz\s+[àa]\s+effet\s+de\s+serre|gaz\s+[àa]\s+effet\s+de\s+serre)\s*(?:\(ges\))?\s*(?:classe)?\s*[:\-–]?\s*([A-Ga-g])\b/i,
    /\bGES\s*(?:classe)?\s*[:\-–]?\s*([A-G])\b/,
  ];
  const EP_PATTERNS = [
    /(\d{1,4}(?:[.,]\d+)?)\s*kWh\s*(?:ep|e\.p\.)?\s*(?:\/|par)\s*m\s*[²2]\s*(?:\/|\.|par|\s)?\s*an/i,
    /consommation[^\d\n]{0,40}(\d{1,4}(?:[.,]\d+)?)\s*kWh/i,
  ];
  const GES_VALUE_PATTERNS = [
    /(\d{1,4}(?:[.,]\d+)?)\s*kg\s*(?:[ée]q\.?|eq\.?)?\s*(?:de\s+)?CO\s*[2₂]\s*(?:eq)?\s*(?:\/|par)\s*m\s*[²2]/i,
    /[ée]missions?[^\d\n]{0,40}(\d{1,4}(?:[.,]\d+)?)\s*kg/i,
  ];
  const SURFACE_PATTERNS = [
    /surface\s+(?:habitable|hab\.?|loi\s+carrez|carrez|totale\s+habitable)\s*[:\-–]?\s*(?:de\s+)?(?:env(?:iron|\.)?\s*)?(\d{1,4}(?:[.,]\d{1,2})?)\s*m\s*[²2]/i,
    /(\d{1,4}(?:[.,]\d{1,2})?)\s*m\s*[²2]\s*(?:habitables?|carrez)/i,
    /(?:^|\n)\s*surface\s*[:\-–]?\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*m\s*[²2]/i,
  ];
  const LAND_PATTERNS = [
    /(?:surface\s+(?:du\s+)?terrain|terrain|parcelle)\s*(?:de|d['’]environ|d['’]une\s+surface\s+de|[:\-–])?\s*(?:env(?:iron|\.)?\s*)?(\d{1,3}(?:[ .]\d{3})+|\d{2,7})\s*m\s*[²2]/i,
  ];
  const HECTARE_PATTERN = /(?:terrain|parcelle)[^\n\d]{0,30}(\d+(?:[.,]\d+)?)\s*(?:ha|hectares?)\b/i;

  function surfaceFromHeadline(text) {
    const m = text.match(/(\d{1,4}(?:[.,]\d{1,2})?)\s*m\s*[²2]/i);
    return m ? ex.normalizeSurface(m[1]) : null;
  }

  // Nom de commune : mots à majuscule, reliés par des espaces, des tirets ou
  // « d' » (« Villeneuve d'Ascq », « Marcq-en-Barœul », « La Madeleine »).
  const WORD = "[A-ZÀ-ÝŒ][A-Za-zÀ-ÿœŒ'’\\-]+";
  const CITY = `${WORD}(?:\\s+(?:d['’]|l['’])?${WORD}){0,3}`;
  const CITY_THEN_POSTAL_PAREN = new RegExp(`(${CITY})\\s*\\(\\s*(\\d{5})\\s*\\)`);
  const POSTAL_THEN_CITY = new RegExp(`\\b(\\d{5})\\s+(${CITY})`);
  const CITY_THEN_POSTAL = new RegExp(`(${CITY})\\s+(\\d{5})\\b`);
  const CITY_THEN_DEPT = new RegExp(`(${CITY})\\s*\\(\\s*(\\d{2}|2[AB])\\s*\\)`);
  const LEADING_WORDS = /^(?:(?:Vente|Achat|Location|Appartement|Maison|Terrain|Studio|Duplex|Loft|Villa|Immeuble|Bien|Proche|Centre|Quartier)\s+)+/i;

  function cleanCity(raw) {
    const city = raw.replace(LEADING_WORDS, '').trim();
    return city || raw.trim();
  }

  // « Lille (59000) », « 59000 Lille », « Lille 59000 ».
  function postalAndCity(text) {
    let m = text.match(CITY_THEN_POSTAL_PAREN);
    if (m) return { postal: m[2], city: cleanCity(m[1]) };
    m = text.match(POSTAL_THEN_CITY);
    if (m) return { postal: m[1], city: cleanCity(m[2]) };
    m = text.match(CITY_THEN_POSTAL);
    if (m) return { postal: m[2], city: cleanCity(m[1]) };
    return null;
  }

  // Ville seule avec département : « Lille (59) ».
  function cityWithDepartment(text) {
    const m = text.match(CITY_THEN_DEPT);
    return m ? { city: cleanCity(m[1]), department: m[2] } : null;
  }

  function buildingTypeFrom(text) {
    if (/\b(maison|villa|pavillon|long[èe]re|fermette|corps de ferme)\b/i.test(text)) return 'maison';
    if (/\b(appartement|studio|duplex|triplex|loft|[TF][1-6]\b)/i.test(text)) return 'appartement';
    return null;
  }

  function isLandListing(head) {
    if (buildingTypeFrom(head)) return false;
    return /\bterrains?\b/i.test(head);
  }

  // Étiquette DPE dessinée : la lettre « active » dans un bloc dont la classe ou
  // l'id évoque l'énergie ou le climat, ou une image dont le nom porte la lettre.
  function fromLabels(doc) {
    const r = {};
    const actives = doc.querySelectorAll(
      '[class*="active"], [class*="selected"], [class*="current"], [aria-current], [class*="highlight"]'
    );
    for (const node of actives) {
      const t = (node.textContent || '').trim();
      const letter = t.match(/^([A-G])(?:\b|\s|$)/);
      if (!letter || t.length > 40) continue;
      const scope = node.closest('[class*="dpe" i], [class*="energ" i], [id*="dpe" i], [id*="energ" i], [class*="ges" i], [class*="climat" i], [id*="ges" i]');
      if (!scope) continue;
      const tag = `${scope.className || ''} ${scope.id || ''}`.toLowerCase();
      if (/ges|climat|co2|gaz/.test(tag)) r.gesClass = r.gesClass || letter[1];
      else r.energyClass = r.energyClass || letter[1];
    }
    for (const img of doc.querySelectorAll('img')) {
      const label = `${img.getAttribute('alt') || ''} ${img.getAttribute('title') || ''}`;
      const file = (img.getAttribute('src') || '').split('?')[0].split('/').pop() || '';
      let m = label.match(/\b(?:dpe|[ée]nergie|consommation)\b[^A-Za-z]{0,10}([A-G])\b/i) || file.match(/(?:dpe|energie|energy|conso)[-_ ]?([a-g])(?:[-_.]|$)/i);
      if (m && !r.energyClass) r.energyClass = m[1].toUpperCase();
      m = label.match(/\b(?:ges|climat|co2)\b[^A-Za-z]{0,10}([A-G])\b/i) || file.match(/(?:ges|climat|co2)[-_ ]?([a-g])(?:[-_.]|$)/i);
      if (m && !r.gesClass) r.gesClass = m[1].toUpperCase();
    }
    return r;
  }

  // JSON embarqué (Next.js, Nuxt, dataLayer…) : on cherche des clés connues par
  // expression régulière, sans dépendre de la structure exacte du site.
  function fromScripts(doc) {
    // Plafond de 3 Mo : certaines pages embarquent des dizaines d'annonces similaires.
    let blob = '';
    for (const s of doc.querySelectorAll('script:not([src])')) {
      if (blob.length > 3000000) break;
      blob += (s.textContent || '') + '\n';
    }
    const key = (names) => `["']?(?:${names})["']?\\s*[:=]\\s*["']?`;
    const pick = (names, valueRe) => {
      const m = blob.match(new RegExp(key(names) + valueRe, 'i'));
      return m ? m[1] : null;
    };
    const r = {};
    const energy = pick('energyClass|energy_class|classeEnergie|classe_energie|dpeLetter|dpe_letter|etiquetteDpe|etiquette_dpe|dpeClass|dpe_class|energyClassification|lettreDpe', '([A-G])["\']');
    const ges = pick('gesClass|ges_class|classeGes|classe_ges|gesLetter|ges_letter|etiquetteGes|etiquette_ges|greenhouseGasClass|greenhouseGasEmissionClassification|lettreGes', '([A-G])["\']');
    if (energy) r.energyClass = energy;
    if (ges) r.gesClass = ges;
    const ep = pick('energyConsumption|energy_consumption|consoEnergie|conso_energie|dpeValue|dpe_value|valeurDpe|consommationEnergie|energyValue', '(\\d{1,4}(?:\\.\\d+)?)');
    const gesV = pick('gesValue|ges_value|valeurGes|emissionGes|emission_ges|greenhouseGasValue|greenhouseGasEmission', '(\\d{1,4}(?:\\.\\d+)?)');
    if (ep) r.energyConsumption = parseNumber(ep);
    if (gesV) r.gesEmission = parseNumber(gesV);
    const postal = pick('postalCode|postal_code|zipCode|zipcode|zip_code|codePostal|code_postal', '(\\d{5})');
    if (postal) r.postal = postal;
    const surface = pick('livingArea|living_area|surfaceHabitable|surface_habitable|habitableSurface|livingSurface', '(\\d{1,4}(?:\\.\\d+)?)');
    if (surface) r.surface = ex.normalizeSurface(surface);
    return r;
  }

  // ─── Assemblage ───

  function extractFromDocument(doc) {
    const found = {};
    const set = (target, field, value, source) => {
      if (value == null || value === '' || target[field] != null) return;
      target[field] = value;
      found[field] = source;
    };

    const head = headline(doc);
    const text = mainText(doc);
    const ld = fromJsonLd(readJsonLd(doc));
    const labels = fromLabels(doc);
    const scripts = fromScripts(doc);
    const r = {};

    // Localisation
    set(r, 'postal', ld.postal, 'json-ld');
    set(r, 'city', ld.city, 'json-ld');
    const pcHead = postalAndCity(head);
    if (pcHead) {
      set(r, 'postal', pcHead.postal, 'titre');
      set(r, 'city', pcHead.city, 'titre');
    }
    const crumbs = cleanText(Array.from(doc.querySelectorAll('nav, [class*="breadcrumb" i], [class*="ariane" i]')).map((n) => n.textContent).join(' | '));
    const pcCrumbs = postalAndCity(crumbs);
    if (pcCrumbs) {
      set(r, 'postal', pcCrumbs.postal, 'fil d’Ariane');
      set(r, 'city', pcCrumbs.city, 'fil d’Ariane');
    }
    if (!r.postal) {
      const pcText = postalAndCity(text);
      if (pcText) {
        set(r, 'postal', pcText.postal, 'texte');
        set(r, 'city', pcText.city, 'texte');
      }
    }
    set(r, 'postal', scripts.postal, 'script');
    if (!r.postal) {
      const cd = cityWithDepartment(head) || cityWithDepartment(crumbs) || cityWithDepartment(text);
      if (cd) {
        set(r, 'city', cd.city, 'titre');
        r.department = cd.department;
      }
    }

    const kind = isLandListing(head) ? 'land' : 'dpe';

    if (kind === 'land') {
      let land = null;
      for (const re of LAND_PATTERNS) {
        const m = text.match(re);
        if (m) land = parseLandNumber(m[1]);
        if (land != null) break;
      }
      if (land == null) {
        const ha = text.match(HECTARE_PATTERN);
        if (ha) land = Math.round(parseNumber(ha[1]) * 10000);
      }
      if (land == null) land = surfaceFromHeadline(head);
      const surface = ex.normalizeLandSurface(land);
      const result = {
        kind: 'land',
        postal: r.postal || null,
        city: r.city || null,
        department: r.department || null,
        surface,
        section: ex.normalizeSection(text),
        source: 'generic',
        found: { ...found, surface: surface ? 'texte' : undefined },
      };
      result.missing = ['postal', 'surface'].filter((k) => !result[k] && !(k === 'postal' && result.city));
      return result;
    }

    // Surface habitable
    set(r, 'surface', ld.surface, 'json-ld');
    set(r, 'surface', ex.normalizeSurface(firstNumber(text, SURFACE_PATTERNS, { min: 5, max: 2000 })), 'texte');
    set(r, 'surface', surfaceFromHeadline(head), 'titre');
    set(r, 'surface', scripts.surface, 'script');

    // DPE
    set(r, 'energyClass', firstLetter(text, ENERGY_PATTERNS), 'texte');
    set(r, 'energyClass', labels.energyClass, 'étiquette');
    set(r, 'energyClass', scripts.energyClass, 'script');
    set(r, 'gesClass', firstLetter(text, GES_PATTERNS), 'texte');
    set(r, 'gesClass', labels.gesClass, 'étiquette');
    set(r, 'gesClass', scripts.gesClass, 'script');
    set(r, 'energyConsumption', firstNumber(text, EP_PATTERNS, { min: 1, max: 1500 }), 'texte');
    set(r, 'energyConsumption', scripts.energyConsumption, 'script');
    set(r, 'gesEmission', firstNumber(text, GES_VALUE_PATTERNS, { min: 0, max: 400 }), 'texte');
    set(r, 'gesEmission', scripts.gesEmission, 'script');

    if (!r.energyClass || !r.gesClass) {
      const derived = deriveClasses(r.energyConsumption, r.gesEmission, r.surface);
      if (derived) {
        set(r, 'energyClass', derived.energyClass, 'calculée');
        set(r, 'gesClass', derived.gesClass, 'calculée');
      }
    }

    set(r, 'buildingType', buildingTypeFrom(head), 'titre');
    set(r, 'buildingType', ld.buildingType, 'json-ld');

    const dateParsed = ex.extractDateFromText(text);
    const result = {
      kind: 'dpe',
      postal: r.postal || null,
      city: r.city || null,
      department: r.department || null,
      surface: r.surface || null,
      energyClass: r.energyClass || null,
      gesClass: r.gesClass || null,
      energyConsumption: r.energyConsumption != null ? Math.round(r.energyConsumption) : null,
      gesEmission: r.gesEmission != null ? Math.round(r.gesEmission) : null,
      buildingType: r.buildingType || null,
      dateRange: ex.parseDateRange(dateParsed),
      // « neuf » dans la description vaut souvent « remis à neuf » : on ne regarde que le titre.
      isNewBuild: /\b(VEFA|programme neuf|logement neuf|appartement neuf|maison neuve)\b/i.test(head),
      source: 'generic',
      found,
    };
    result.missing = ['postal', 'surface', 'energyClass'].filter((k) => !result[k] && !(k === 'postal' && result.city));
    return result;
  }

  // Point d'entrée : l'extracteur dédié du site passe en premier quand il existe.
  function extractPage() {
    if (typeof window.__immodexSiteExtract === 'function') {
      try {
        const site = window.__immodexSiteExtract();
        if (site && site.surface && site.postal) return { ...site, found: { tout: site.source || 'site' }, missing: [] };
      } catch (e) {
        console.warn('[immodex] site extractor failed, falling back to generic:', e);
      }
    }
    return extractFromDocument(document);
  }

  window.__immodexGeneric = { extractPage, extractFromDocument, deriveClasses, postalAndCity };
})();
