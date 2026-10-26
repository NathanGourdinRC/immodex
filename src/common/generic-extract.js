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
      // Accents décomposés (« e » + accent combinant) ramenés à « é » pour les motifs.
      .normalize('NFC')
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
  // `evidence` garde le passage de texte retenu : il apparaît dans `found` pour
  // comprendre d'où vient une valeur (console, popup).
  let evidence = null;

  function firstLetter(text, patterns, { allowLower = false } = {}) {
    for (const re of patterns) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let m;
      while ((m = g.exec(text))) {
        if (allowLower) m[1] = m[1].toUpperCase();
        if (!LETTER.test(m[1])) continue;
        // « DPE : A venir », « Classe énergie : en cours » ne sont pas des classes.
        const after = text.slice(m.index + m[0].length, m.index + m[0].length + 12);
        if (/^\s*(venir|vierge|en cours|non\b)/i.test(after)) continue;
        // « Classe énergie A B C D E F G » : c'est la légende de l'échelle, pas la classe.
        if (/^\s*[A-G]\s+[A-G]\b/.test(after)) continue;
        evidence = m[0].slice(-60);
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
        if (n != null && n >= min && n <= max) {
          evidence = m[0].slice(-60);
          return n;
        }
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
            // L'agence (et son adresse) n'est pas le bien : son sous-arbre est ignoré
            // (Grimonprez : code postal de l'agence 59100 pour un bien à 59800).
            const types = [].concat(cur['@type'] || []).map(String);
            if (types.some((t) => /RealEstateAgent|Organization|LocalBusiness|Corporation|Person|BreadcrumbList/i.test(t))) continue;
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
  // Texte visible d'un bloc. innerText (Chrome) ignore déjà scripts et styles ;
  // sans innerText (tests sous jsdom), on les retire d'une copie avant de lire.
  // Texte d'un bloc, y compris ce qui est masqué : beaucoup de sites rangent la
  // consommation et la date du DPE dans un onglet ou un bloc replié, qu'innerText
  // ignorerait (Vacherand). On lit donc une copie sans scripts ni styles.
  const BLOCKS = new Set(['P', 'DIV', 'LI', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'TR', 'TD', 'TH', 'DT', 'DD', 'UL', 'OL', 'HEADER', 'FOOTER', 'TABLE', 'TBODY', 'FORM', 'FIGURE', 'ASIDE', 'NAV', 'MAIN']);

  function rawText(node) {
    const copy = node.cloneNode(true);
    // Formulaires de recherche (listes de villes et de codes postaux) : pas l'annonce.
    for (const s of copy.querySelectorAll('script, style, noscript, template, svg defs, select, option, datalist')) s.remove();
    // Comme innerText : un retour à la ligne après chaque bloc, une espace après
    // chaque élément en ligne, pour ne pas coller « Code postal » et « 59000 »
    // (« Code postal59000VilleLILLE ») ni « B » et « Description ».
    for (const b of copy.querySelectorAll('*')) {
      b.appendChild(b.ownerDocument.createTextNode(BLOCKS.has(b.tagName) ? '\n' : ' '));
    }
    return copy.textContent || '';
  }

  // Blocs qui parlent d'autres biens (annonces similaires, recommandations) :
  // leurs surfaces et DPE fausseraient la lecture de l'annonce.
  const OTHER_LISTINGS =
    '[class*="similar" i], [class*="similaire" i], [class*="related" i], [class*="recommend" i], [class*="suggest" i], ' +
    '[id*="similar" i], [id*="similaire" i], [class*="other-ad" i], [class*="autres-annonces" i], footer';
  // Carrousels : en général d'autres biens ou des photos, mais certains sites
  // (La Boîte Immo « sliderV2 ») y mettent toute la fiche. On les garde alors.
  const CAROUSELS = '[class*="carousel" i], [class*="slider" i], [class*="swiper" i]';
  const LISTING_MARKERS = /surface\s+habitable|consommation\s+[ée]nerg|classe\s+[ée]nerg|diagnostic|kwh/i;

  function visibleText(node, h1) {
    let text = rawText(node);
    const remove = (noise) => {
      const t = rawText(noise).trim();
      if (t.length > 20) text = text.split(t).join('\n');
    };
    for (const noise of node.querySelectorAll(OTHER_LISTINGS)) remove(noise);
    for (const noise of node.querySelectorAll(CAROUSELS)) {
      if ((h1 && noise.contains(h1)) || LISTING_MARKERS.test(noise.textContent || '')) continue;
      remove(noise);
    }
    return text;
  }

  function mainText(doc) {
    // Une balise <article> peut n'être qu'une vignette d'une autre annonce : on ne
    // la retient que si elle contient le titre principal de la page.
    const h1 = doc.querySelector('h1');
    const main = doc.querySelector('main, [role="main"]') || (h1 && h1.closest('article'));
    const body = doc.body;
    if (!body) return '';
    const mainContent = main ? visibleText(main, h1) : '';
    if (mainContent.length > 400) return cleanText(mainContent);
    // Sans bloc principal, l'annonce commence à son titre : ce qui précède (menus,
    // vignettes d'autres biens) est écarté, sauf si le titre arrive tard dans la
    // page (on garderait trop peu de texte).
    const all = cleanText(visibleText(body, h1));
    const title = h1 ? cleanText(rawText(h1)).trim() : '';
    const at = title ? all.indexOf(title) : -1;
    return at > 0 && at < all.length / 2 ? all.slice(at) : all;
  }

  function headline(doc) {
    const parts = [
      doc.querySelector('h1')?.textContent,
      doc.querySelector('meta[property="og:title"]')?.getAttribute('content'),
      doc.title,
    ];
    return cleanText(parts.filter(Boolean).join(' | '));
  }

  // Lettre qui suit une échelle complète : « A B C D E F G F Classe énergie… ».
  const AFTER_LEGEND = /A\s+B\s+C\s+D\s+E\s+F\s+G\s+([A-G])\b(?!\s+[A-G]\b)/;
  const ENERGY_PATTERNS = [
    /\bDPE\s+class[ée]e?\s+(?:en\s+)?([A-G])\b/i,
    // « (DPE) B » collé au libellé suivant : la lettre ne doit pas commencer un mot en minuscules.
    /\(DPE\)\s*:?\s*([A-G])(?![a-zà-ÿ])/,
    /\b([A-G])\s+classe\s+[ée]nergie/i,
    // « Logement à consommation énergétique excessive : classe E »
    // Sans drapeau /i : avec /i, (?![a-z]) refuserait aussi une majuscule collée (« classe EMontant »).
    /[ée]nerg[ée]tique[^.\n]{0,40}?:\s*[Cc]lasse\s+([A-G])(?![a-zà-ÿ])/,
    /(?:classe|[ée]tiquette|lettre)\s+(?:de\s+)?(?:l['’])?(?:[ée]nergie|[ée]nerg[ée]tique|dpe|consommation)(?:\s*-\s*climat)?(?:\s+actuelle)?\s*(?:\(dpe\))?\s*[:\-–]?\s*\(?([A-Ga-g])\b/i,
    /(?:diagnostic\s+de\s+performance\s+[ée]nerg[ée]tique|performance\s+[ée]nerg[ée]tique|consommations?\s+[ée]nerg[ée]tiques?)\s*(?:\(dpe\))?\s*(?:classe)?\s*[:\-–]?\s*([A-Ga-g])\b/i,
    /\bDPE\s*(?:classe)?\s*[:\-–]?\s*([A-G])\b/,
    // « DPE conso : 144, Lettre : C » (Hem Immobilier)
    /DPE\s+conso[^\n]{0,30}?lettre\s*:?\s*([A-G])\b/i,
    // « Consommation énergie primaire » puis la lettre seule (JBG Immo)
    /[Cc]onsommation\s+(?:d['’])?[ée]nergie(?:\s+primaire)?\s*[:\-–]?\s*([A-G])\b/,
  ];
  // Lettre écrite en minuscule après un libellé sans ambiguïté (« Diagnostics énergétiques: c »).
  const ENERGY_LOWER_OK = [/[Dd]iagnostics?\s+[ée]nerg[ée]tiques?\s*:\s*([a-g])\b/];
  const GES_PATTERNS = [
    /DPE\s+[ée]mi(?:ssions?)?[^\n]{0,30}?lettre\s*:?\s*([A-G])\b/i,
    /[Gg]az\s+(?:[àa]\s+)?[Ee]ffet\s+de\s+[Ss]erre\s*(?:\(GES\))?\s*[:\-–]?\s*([A-G])\b/,
    /\bGES\s+class[ée]e?\s+(?:en\s+)?([A-G])\b/i,
    /\(GES\)\s*:?\s*([A-G])(?![a-zà-ÿ])/,
    /\b([A-G])\s+(?:indice\s+d['’])?[ée]missions?\s+de\s+gaz/i,
    /(?:classe|[ée]tiquette|lettre)\s+(?:de\s+)?(?:ges|climat|co2|gaz\s+[àa]\s+effet\s+de\s+serre|[ée]missions?)(?:\s+actuelle)?\s*(?:\(ges\))?\s*[:\-–]?\s*\(?([A-Ga-g])\b/i,
    /(?:[ée]missions?\s+de\s+gaz\s+[àa]\s+effet\s+de\s+serre|gaz\s+[àa]\s+effet\s+de\s+serre)\s*(?:\(ges\))?\s*(?:classe)?\s*[:\-–]?\s*([A-Ga-g])\b/i,
    /\bGES\s*(?:classe)?\s*[:\-–]?\s*([A-G])\b/,
  ];
  const EP_PATTERNS = [
    /(\d{1,4}(?:[.,]\d+)?)\s*\*?\s*kWh\s*(?:ep|e\.p\.)?\s*(?:\/|par)\s*m\s*[²2]\s*(?:\/|\.|par|\s)?\s*(?:an|year)/i,
    /consommation[^\d\n]{0,40}(\d{1,4}(?:[.,]\d+)?)\s*kWh/i,
    /DPE\s+conso\s*:?\s*(\d{1,4}(?:[.,]\d+)?)/i,
    // « DPE: 117.1 » sans unité (Vereecke) : jamais suivi d'une date ni d'un mot.
    /\bDPE\s*:\s*(\d{2,4}(?:[.,]\d{1,2})?)(?![\d\/.,-])(?!\s*[A-Za-z%])/,
  ];
  // Émissions : « CO2 », « CO₂ » ou « Co² » selon les sites.
  const GES_VALUE_PATTERNS = [
    // « 15* kgCO₂/m².an » : l'astérisque renvoie à une note de bas de page.
    /(\d{1,4}(?:[.,]\d+)?)\s*\*?\s*kg\s*(?:[ée]q\.?|eq\.?)?\s*(?:de\s+)?CO\s*[2₂²]\s*(?:eq)?\s*(?:\/|par)\s*m\s*[²2]/i,
    /[ée]missions?[^\d\n]{0,40}(\d{1,4}(?:[.,]\d+)?)\s*kg/i,
    /DPE\s+[ée]mi(?:ssions?)?\s*:?\s*(\d{1,3}(?:[.,]\d+)?)/i,
    /\bGES\s*:\s*(\d{1,3}(?:[.,]\d{1,2})?)(?![\d\/.,-])(?!\s*[A-Za-z%])/,
  ];
  // « env. », « environ », « +/- », « ± » avant le nombre ; « (m²) » après le libellé.
  const APPROX = '(?:(?:env(?:iron|\\.)?|\\+\\s*\\/\\s*-|±)\\s*)?';
  const NUM = '(\\d{1,4}(?:[.,]\\d{1,2})?)';
  const M2 = '\\s*m\\s*[²2]';
  // Libellés sûrs : lus avant le titre de la page.
  const SURFACE_PATTERNS = [
    new RegExp(`surface\\s+(?:habitable|hab\\.?|loi\\s+carrez|carrez|totale\\s+habitable)\\s*(?:\\(m\\s*[²2]\\))?\\s*[:\\-–]?\\s*(?:de\\s+)?${APPROX}${NUM}${M2}`, 'i'),
    new RegExp(`${NUM}${M2}\\s*(?:habitables?|hab\\.?|carrez)`, 'i'),
  ];
  // Formulations ambiguës : lues seulement si ni les libellés sûrs ni le titre ne donnent la surface.
  const SURFACE_WEAK_PATTERNS = [
    // « 2 pièces - 58 m² », plutôt que la « chambre de 12 m² » de la description.
    new RegExp(`pi[eè]ces?\\s*[-–·,|]\\s*${APPROX}${NUM}${M2}`, 'i'),
    // « T3 de 49,2 m² »
    new RegExp(`\\b[TF]\\d\\s+(?:de\\s+)?${APPROX}${NUM}${M2}`),
    new RegExp(`(?:^|\\n)\\s*surface\\s*(?:\\(m\\s*[²2]\\))?\\s*[:\\-–]?\\s*${APPROX}${NUM}${M2}`, 'i'),
  ];
  const LAND_PATTERNS = [
    /(?:surface\s+(?:du\s+)?terrain|terrain|parcelle)\s*(?:de|d['’]environ|d['’]une\s+surface\s+de|[:\-–])?\s*(?:env(?:iron|\.)?\s*)?(\d{1,3}(?:[ .]\d{3})+|\d{2,7})\s*m\s*[²2]/i,
  ];
  const HECTARE_PATTERN = /(?:terrain|parcelle)[^\n\d]{0,30}(\d+(?:[.,]\d+)?)\s*(?:ha|hectares?)\b/i;

  // Date du DPE : seulement si elle est présentée comme telle (« DPE réalisé le »,
  // « Fait le », « Date du diagnostic »). Les mentions légales (« prix indexés au
  // 1er janvier 2021 », « DPE délivrés à compter du 1er juillet 2021 ») sont ignorées,
  // car une fausse date exclurait le bon logement de la recherche.
  const MONTHS = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
  const DATE_LABEL =
    '(?:(?:dpe|diagnostic(?:\\s+de\\s+performance\\s+[ée]nerg[ée]tique)?)\\s*(?:\\(dpe\\)\\s*)?(?:r[ée]alis[ée]|[ée]tabli|fait|effectu[ée])' +
    '|date\\s+(?:de\\s+r[ée]alisation\\s+|d[\'’]?\\s*[ée]tablissement\\s+)?(?:du\\s+)?(?:dpe|diagnostic)(?:\\s+[ée]nerg[ée]tique)?|fait)\\s*(?:le|en)?\\s*:?\\s*';
  const DATE_DAY = new RegExp(DATE_LABEL + '(\\d{1,2})[\\/.\\-](\\d{1,2})[\\/.\\-](\\d{4})', 'i');
  const DATE_NAMED = new RegExp(
    DATE_LABEL + '(?:(\\d{1,2})(?:er)?\\s+)?(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\\s+(\\d{4})',
    'i'
  );
  const DATE_MONTH = new RegExp(DATE_LABEL + '(\\d{1,2})[\\/.\\-](\\d{4})\\b', 'i');

  function dpeDateRange(text, now = new Date()) {
    let y;
    let mo;
    let d = null;
    let m = text.match(DATE_DAY);
    if (m) [d, mo, y] = [+m[1], +m[2], +m[3]];
    else if ((m = text.match(DATE_NAMED))) {
      y = +m[3];
      mo = MONTHS[ex.stripAccents(m[2]).toLowerCase()];
      d = m[1] ? +m[1] : null;
    } else if ((m = text.match(DATE_MONTH))) [mo, y] = [+m[1], +m[2]];
    if (!y || !mo || mo < 1 || mo > 12) return null;
    // DPE au format actuel : à partir du 1er juillet 2021, et jamais dans le futur.
    const iso = y + '-' + String(mo).padStart(2, '0') + '-' + String(d || 1).padStart(2, '0');
    if (iso < '2021-07-01' || iso > now.toISOString().slice(0, 10)) return null;
    return ex.parseDateRange({ year: y, month: mo, day: d });
  }

  function surfaceFromHeadline(text) {
    const m = text.match(/(\d{1,4}(?:[.,]\d{1,2})?)\s*m\s*[²2]/i);
    return m ? ex.normalizeSurface(m[1]) : null;
  }

  // Dernier recours : surface écrite après le type de bien (« Appartement 19 m² »,
  // « studio meublé de 18.71m² »). Les surfaces d'annexes (terrain, jardin,
  // terrasse…) juste avant le nombre sont écartées.
  function surfaceNearType(text) {
    const re = /(?:appartement|maison|studio|duplex|triplex|loft|villa|pavillon|logement)[^.\n]{0,40}?(\d{1,4}(?:[.,]\d{1,2})?)\s*m\s*[²2]/gi;
    let m;
    while ((m = re.exec(text))) {
      // Surfaces d'annexes ou de pièces (« chambre de 12 m² ») : pas la surface du logement.
      if (/(terrain|jardin|terrasse|balcon|cave|parcelle|garage|cour|chambre|s[ée]jour|salon|cuisine|salle|bureau|pi[eè]ce\s+de\s+vie|grenier|veranda|véranda)[^\d]{0,15}$/i.test(m[0].slice(0, m[0].lastIndexOf(m[1])))) continue;
      const n = ex.normalizeSurface(m[1]);
      if (n && n >= 8) return n;
    }
    return null;
  }

  // Nom de commune : mots à majuscule, reliés par des espaces, des tirets ou
  // « d' » (« Villeneuve d'Ascq », « Marcq-en-Barœul », « La Madeleine »).
  const WORD = "[A-ZÀ-ÝŒ][A-Za-zÀ-ÿœŒ'’\\-]+";
  // Espaces seulement entre les mots (pas de retour à la ligne) : sinon « LILLE »
  // déborde sur le libellé suivant (« LILLE Téléphone Siège »).
  const CITY = `${WORD}(?:[ \\t]+(?:d['’]|l['’])?${WORD}){0,3}`;
  const CITY_THEN_POSTAL_PAREN = new RegExp(`(${CITY})\\s*\\(\\s*(\\d{5})\\s*\\)`);
  // Code postal et ville sur la même ligne (« 59200, Tourcoing ») : pas de saut de
  // ligne entre les deux, sinon « Code postal: 59100\nChambres » donnerait « Chambres ».
  const POSTAL_THEN_CITY = new RegExp(`\\b(\\d{5})[ \\t]*,?[ \\t]+(${CITY})`);
  const CITY_THEN_POSTAL = new RegExp(`(${CITY})[ \\t]*,?[ \\t]+(\\d{5})\\b`);
  const CITY_THEN_DEPT = new RegExp(`(${CITY})\\s*\\(\\s*(\\d{2}|2[AB])\\s*\\)`);
  const LEADING_WORDS = /^(?:(?:Vente|Achat|Location|Appartement|Maison|Terrain|Studio|Duplex|Loft|Villa|Immeuble|Bien|Proche|Centre|Quartier|Ville|Commune|Localisation|Secteur)\s+)+/i;
  // Un nombre à 5 chiffres après « Réf. », « Mandat », « Tél. »… n'est pas un code postal.
  const POSTAL_BLOCKERS = /(?:r[ée]f(?:[ée]rence)?|mandat|n[°o]|t[ée]l(?:[ée]phone)?|siret|siren|rcs|carte\s+pro|prix|€)\.?\s*:?\s*$/i;
  // Libellés de fiche qui suivent souvent un code postal et ne sont pas des villes.
  const NOT_CITIES = /^(?:Type|Chambres?|Pi[eè]ces?|Surface|Prix|D[ée]tails?|Appeler|Contacter|Voir|R[ée]f(?:[ée]rence)?|Mandat|Description|Honoraires|Charges|Copropri[ée]t[ée]|Euros?|Ville|Commune|Agence|Contact|T[ée]l[ée]phone|Email|Mail)$/i;
  const VALID_POSTAL = /^(?:0[1-9]|[1-8]\d|9[0-5]|97|98)\d{3}$/;

  function cleanCity(raw) {
    let city = String(raw).replace(/\s*\(?\d{5}\)?\s*/g, ' ').replace(LEADING_WORDS, '').trim() || String(raw).trim();
    // « VILLEURBANNE » devient « Villeurbanne » (affichage seulement, la recherche ignore la casse).
    if (city === city.toUpperCase()) city = city.toLowerCase().replace(/(^|[\s\-'’])(\S)/g, (m0, sep, c) => sep + c.toUpperCase());
    return city;
  }

  // « Lille (59000) », « 59000 Lille », « Lille 59000 ».
  function postalAndCity(text) {
    for (const [re, pi, ci] of [[CITY_THEN_POSTAL_PAREN, 2, 1], [POSTAL_THEN_CITY, 1, 2], [CITY_THEN_POSTAL, 2, 1]]) {
      const g = new RegExp(re.source, 'g');
      let m;
      while ((m = g.exec(text))) {
        const at = m.index + m[0].indexOf(m[pi]);
        if (!VALID_POSTAL.test(m[pi]) || POSTAL_BLOCKERS.test(text.slice(Math.max(0, at - 16), at))) continue;
        const city = cleanCity(m[ci]);
        return { postal: m[pi], city: city && !NOT_CITIES.test(city) ? city : null };
      }
    }
    return null;
  }

  // Code postal et ville présentés par des libellés : « Code postal : 59000 », « Ville : LILLE ».
  const LABELED_POSTAL = /code\s*postal\s*:?\s*(\d{5})\b/i;
  const LABELED_CITY = new RegExp(`(?:^|\\n)[ \\t]*(?:[Vv]ille|VILLE|[Cc]ommune|COMMUNE)[ \\t]*:?[ \\t]*(${CITY})`);

  // Ville du titre sans code postal, sous les formes vues sur les sites d'agences :
  const HEAD_CITY_PATTERNS = [
    // « Maison à COMINES • 228 000 € », « Maison à vendre à Halluin »
    new RegExp(`(?:^|\\s)[àa][ \\t]+(${CITY})`, 'g'),
    // « Appartement à vendre Lille Réf. VA2276 », « Appartement 25m² Lille », « 3 chambre(s) - Roubaix, Alfred Mongy »
    new RegExp(`(?:vendre|louer|m\\s*[²2]|pi[eè]ces?|chambres?(?:\\(s\\))?)[ \\t]*[-–,]?[ \\t]+(${CITY})(?=[ \\t]*(?:[-–,•|:(]|R[ée]f|$))`, 'g'),
    // « MOUVAUX ST GERMAIN: Maison trois chambres »
    new RegExp(`^(${CITY})[ \\t]*:`, 'g'),
    // « centre ville de Wervicq-Sud », « proche de Lambersart » (sans drapeau /i : la
    // ville doit commencer par une majuscule, sinon « quartier prisé » donnerait « prisé »)
    new RegExp(`(?:[Cc]entre[- ][Vv]ille|[Pp]roche|[Qq]uartier|[Ss]ecteur)[ \\t]+(?:de[ \\t]+|d['’])?(${CITY})`, 'g'),
    // « Vente Maison Marcq-en-Barœul »
    new RegExp(`(?:Vente|Location|Achat)[ \\t]+(?:Maison|Appartement|Terrain|Studio|Immeuble|Loft|Duplex)[ \\t]+(${CITY})`, 'g'),
  ];
  const NOT_HEAD_CITIES = /^(?:Vendre|Louer|Saisir|Voir|Proximit[ée]|Maisons?|Appartements?|Vente|Location|Terrains?|Studio|Fermes?|Luxe|Exception|Lotissement|Neuf|Ancien)$/i;

  function headlineCity(head) {
    // Le titre est la jointure h1 | og:title | <title> : chaque partie est lue à part.
    for (const part of head.split(' | ')) {
      for (const re of HEAD_CITY_PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(part))) {
          const city = cleanCity(m[1]);
          // « … 46 m2 - Leduc Immobilier » : c'est le nom de l'agence, pas une ville.
          if (/\b(?:immobili[eè]re?|immo|agence|habitat|conseil|patrimoine|transactions?|realty|groupe)\b/i.test(city)) continue;
          if (city && !NOT_CITIES.test(city) && !NOT_HEAD_CITIES.test(city.split(/\s+/)[0])) return city;
        }
      }
    }
    return null;
  }

  // Ville tirée de l'adresse de la page : /vente/appartement/lille/123,
  // ventes-immobilieres-a-lille, maison-a-vendre-a-halluin-123. Le nom est ensuite
  // vérifié par le service worker (nom exact de commune), une erreur ne donne rien.
  const URL_STOP = new Set(
    'vente ventes location locations achat acheter louer vendre annonce annonces immobilier immobiliere bien biens detail details fiche appartement appartements maison maisons terrain terrains studio immeuble local commerce parking garage neuf ancien fr index html php de du la le les pieces piece chambres propriete property'.split(' ')
  );
  const toCity = (slug) => slug.replace(/-+/g, ' ').replace(/(^|\s)(\S)/g, (m0, sep, c) => sep + c.toUpperCase());

  function cityFromUrl(href) {
    let path;
    try {
      path = decodeURIComponent(new URL(href).pathname).toLowerCase();
    } catch {
      return null;
    }
    for (const m of path.matchAll(/-a-([a-z][a-z-]{2,40}?)(?=-\d|[/_.,]|$)/g)) {
      if (!URL_STOP.has(m[1].split('-')[0])) return toCity(m[1]);
    }
    // « vente-appartement-tourcoing,CRV… » (Immosens)
    // (s'arrête au premier chiffre : « roubaix-alfred-mongy-r-va27035 » donne « Roubaix Alfred
    // Mongy R Va », que le service worker ramène à « Roubaix », son premier mot)
    const typed = path.match(
      /(?:vente|location|achat)-(?:appartement|maison|terrain|studio|immeuble|loft|duplex|local|ferme|villa)s?(?:-(?:ferme|villa|individuelle|mitoyenne|semi-individuelle|de-ville))*-([a-z][a-z-]{2,60}?)(?=[,_./]|-?\d|$)/
    );
    if (typed && !URL_STOP.has(typed[1].split('-')[0])) return toCity(typed[1]);
    // Dernier segment fait d'un seul nom : « /fiches/4-40-26_61501648/houplines.html » (Trigone)
    const last = path.split('/').filter(Boolean).pop() || '';
    const slug = last.replace(/\.(html?|php|aspx?)$/, '');
    if (/^[a-z]+(?:-[a-z]+){0,3}$/.test(slug) && !slug.split('-').some((w) => URL_STOP.has(w))) return toCity(slug);
    const segments = path.split('/').filter(Boolean);
    const i = segments.findIndex((s) => /^(?:vente|ventes|location|locations|achat|acheter|louer)$/.test(s));
    if (i >= 0) {
      for (const s of segments.slice(i + 1)) {
        if (URL_STOP.has(s) || /\d/.test(s)) continue;
        if (/^[a-z][a-z-]{2,40}$/.test(s)) return toCity(s);
        break;
      }
    }
    return null;
  }

  const sameCity = (a, b) => {
    const n = (s) => ex.stripAccents(String(s || '')).toLowerCase().replace(/[^a-z]+/g, ' ').trim();
    const x = n(a);
    const y = n(b);
    return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x));
  };

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
  const classOf = (node) => node.getAttribute('class') || '';
  const isActive = (node) => /active|selected|current|is-on|highlight/i.test(classOf(node));
  // Échelle désignée par un nom de classe ou d'identifiant : GES, énergie, ou inconnue.
  const scaleOf = (s) => (/ges|climat|co2|gaz|emission/i.test(s) ? 'ges' : /dpe|energ|conso|dep\b|dep-/i.test(s) ? 'dpe' : null);

  // Élément situé dans la vignette d'une autre annonce (annonces similaires de Foncia :
  // carte avec son propre « dpe-number » et un lien vers une autre page d'annonce).
  function inOtherListing(node, doc) {
    if (node.closest(OTHER_LISTINGS)) return true;
    const box = node.closest('[class*="card" i], [class*="vignette" i], [class*="thumbnail" i], article, li');
    if (!box || box.querySelector('h1')) return false;
    const here = (doc.location && doc.location.pathname) || '';
    for (const a of box.querySelectorAll('a[href]')) {
      try {
        const u = new URL(a.getAttribute('href'), doc.baseURI);
        if (u.pathname !== here && /\d{3,}|annonce|vente|location|achat/i.test(u.pathname)) return true;
      } catch {
        // lien illisible : ignoré
      }
    }
    return false;
  }

  function fromLabels(doc) {
    const r = {};
    const put = (scale, letter) => {
      const key = scale === 'ges' ? 'gesClass' : 'energyClass';
      if (letter && !r[key]) r[key] = letter.toUpperCase();
    };

    // 1. Identifiants porteurs de la lettre : g#DPE_D (Laforêt), div.zone.selected#dpe_D
    //    (Spot My Place). S'il y en a une série, on prend celui qui est sélectionné.
    const idNodes = [...doc.querySelectorAll('[id]')];
    for (const [scale, re] of [['dpe', /^(?:dpe|energie|energy|conso)[_-]?([a-g])$/i], ['ges', /^(?:ges|climat|co2)[_-]?([a-g])$/i]]) {
      const nodes = idNodes.filter((n) => re.test(n.id));
      const node = nodes.find(isActive) || (nodes.length === 1 ? nodes[0] : null);
      if (node) put(scale, node.id.match(re)[1]);
    }

    // 2. Attributs de données : data-energetic-class="D" (Sotheby's), data-lettre="D" sur
    //    span#dep-svg / span#ges-svg, avec les valeurs data-dpe="172", data-ges="35".
    for (const node of doc.querySelectorAll('[data-energetic-class], [data-energy-class], [data-dpe-class], [data-classe-energie], [data-lettre], [data-letter]')) {
      const letter = ['data-energetic-class', 'data-energy-class', 'data-dpe-class', 'data-classe-energie', 'data-lettre', 'data-letter']
        .map((a) => node.getAttribute(a))
        .find((v) => v && /^[A-Ga-g]$/.test(v.trim()));
      if (!letter || inOtherListing(node, doc)) continue;
      const explicit = node.hasAttribute('data-energetic-class') || node.hasAttribute('data-energy-class') || node.hasAttribute('data-dpe-class') || node.hasAttribute('data-classe-energie');
      put(explicit ? 'dpe' : scaleOf(`${node.id} ${classOf(node)}`) || 'dpe', letter.trim());
    }
    const numAttr = (sel, attrs) => {
      for (const node of doc.querySelectorAll(sel)) {
        if (inOtherListing(node, doc)) continue;
        for (const a of attrs) {
          const n = parseNumber(node.getAttribute(a));
          if (n != null && n > 0) return n;
        }
      }
      return null;
    };
    r.energyConsumption = numAttr('[data-consumption], [data-conso], [data-dpe]', ['data-consumption', 'data-conso', 'data-dpe']);
    r.gesEmission = numAttr('[data-emissions], [data-emission], [data-ges]', ['data-emissions', 'data-emission', 'data-ges']);

    // 3. Lettre portée par une classe CSS : « dpeInfoConso e » (DRT Immo),
    //    « diagnostic-scale numberC » (Vereecke). Sans indication d'échelle, la
    //    première série est l'énergie et la seconde le GES.
    //    Une série d'au moins 3 éléments de même classe (letter-a … letter-g, Norestim)
    //    est la légende de l'échelle : seul l'élément marqué actif compte.
    const tokenCandidates = [];
    for (const node of doc.querySelectorAll('[class]')) {
      const cls = classOf(node);
      if (!/dpe|energ|conso|ges\b|ges[-_]|climat|diagnostic|co2/i.test(cls) || inOtherListing(node, doc)) continue;
      for (const t of cls.split(/\s+/)) {
        const m = t.match(/^(?:number|lettre|letter|classe|class|note|grade|niveau|level|rank)[-_]?([a-g])$/i) || t.match(/^([a-g])$/i);
        if (m) {
          tokenCandidates.push({ node, letter: m[1], template: cls.replace(t, '?'), scale: scaleOf(cls) });
          break;
        }
      }
    }
    const templateCount = {};
    for (const c of tokenCandidates) templateCount[c.template] = (templateCount[c.template] || 0) + 1;
    const unknown = [];
    for (const c of tokenCandidates) {
      const legend = templateCount[c.template] >= 3;
      if (legend && !isActive(c.node) && !(c.node.parentElement && isActive(c.node.parentElement))) continue;
      if (c.scale) put(c.scale, c.letter);
      else unknown.push(c.letter);
    }
    if (unknown[0]) put('dpe', unknown[0]);
    if (unknown[1]) put('ges', unknown[1]);

    // 3 bis. Valeurs sans unité portées par une classe explicite : <strong class="conso-index">184</strong>,
    //    <strong class="emi-index">39</strong> (Immotram). « conso-index2 » (le GES rappelé sur
    //    l'étiquette énergie) ne correspond pas : \b exige la fin du mot après « index ».
    for (const node of doc.querySelectorAll('[class]')) {
      const cls = classOf(node);
      if (node.children.length || !/(?:conso|energ|dpe|emi|ges|co2|climat)[-_]?(?:index|value|valeur|val|chiffre|number|nb|kwh|kg)\b/i.test(cls)) continue;
      if (inOtherListing(node, doc)) continue;
      const n = parseNumber((node.textContent || '').replace(/\*/g, ''));
      if (n == null || n <= 0) continue;
      if (/emi|ges|co2|climat/i.test(cls)) {
        if (r.gesEmission == null && n <= 400) r.gesEmission = n;
      } else if (r.energyConsumption == null && n <= 1500) r.energyConsumption = n;
    }

    // 4. Century 21 : étiquette SVG dont les valeurs sont dans g[data-name="chiffres"]
    //    (consommation puis émissions) ; la lettre, elle, n'est qu'un tracé.
    const chiffres = doc.querySelector('g[data-name="chiffres"]');
    if (chiffres) {
      const nums = [...chiffres.querySelectorAll('text')].map((t) => parseNumber(t.textContent)).filter((n) => n != null);
      if (nums[0] != null && r.energyConsumption == null) r.energyConsumption = nums[0];
      if (nums[1] != null && r.gesEmission == null) r.gesEmission = nums[1];
    }
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
    // 5. Images : texte alternatif (« classe énergie : C »), puis nom de fichier.
    //    Quand une échelle compte une image par lettre, la lettre retenue est celle
    //    dont le nom de fichier diffère des autres (Brique Rouge : energie-d2021.png
    //    au milieu de energie-a-v2021.png, energie-b-v2021.png…).
    const families = { dpe: [], ges: [] };
    for (const img of doc.querySelectorAll('img')) {
      const label = `${img.getAttribute('alt') || ''} ${img.getAttribute('title') || ''}`;
      // Pas de \b devant « énergie » : en JavaScript, \b ne reconnaît pas les lettres accentuées.
      // Dans le texte alternatif, la lettre doit être une majuscule isolée (« classe énergie : C »).
      let m = label.match(/(?:dpe|[ée]nergie|consommation)[^A-Za-z]{0,10}([A-G])(?![A-Za-z])/i);
      if (m && LETTER.test(m[1])) put('dpe', m[1]);
      m = label.match(/(?:ges|climat|co2)[^A-Za-z]{0,10}([A-G])(?![A-Za-z])/i);
      if (m && LETTER.test(m[1])) put('ges', m[1]);
      const file = (img.getAttribute('src') || '').split('?')[0].split('/').pop() || '';
      const f = file.match(/(dpe|energie|energy|conso|ges|climat|co2)[-_ ]?([a-g])(?=[-_.\d]|$)/i);
      if (f) families[/ges|climat|co2/i.test(f[1]) ? 'ges' : 'dpe'].push({ letter: f[2], template: file.replace(f[0], `${f[1]}?`) });
    }
    for (const [scale, imgs] of Object.entries(families)) {
      if (imgs.length === 1) put(scale, imgs[0].letter);
      else if (imgs.length >= 3) {
        const counts = {};
        for (const i of imgs) counts[i.template] = (counts[i.template] || 0) + 1;
        const odd = imgs.filter((i) => counts[i.template] === 1);
        if (odd.length === 1) put(scale, odd[0].letter);
      }
    }
    return r;
  }

  // Étiquettes DPE dessinées en SVG et intégrées comme image (data URI, logiciel
  // Apimo notamment) : leur texte contient la consommation et les émissions.
  function svgImageText(doc) {
    const parts = [];
    for (const img of doc.querySelectorAll('img[src^="data:image/svg+xml"]')) {
      try {
        const src = img.getAttribute('src');
        const comma = src.indexOf(',');
        const isBase64 = /;base64/i.test(src.slice(0, comma));
        const data = src.slice(comma + 1);
        // atob rend des octets : on les relit en UTF-8 pour garder les accents.
        const svg = isBase64 ? new TextDecoder().decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0))) : decodeURIComponent(data);
        const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].trim()).filter(Boolean);
        if (texts.length) parts.push(texts.join(' '));
      } catch {
        // image illisible : ignorée
      }
    }
    // Texte alternatif des images d'étiquette (Foncia : « Diagnostic classe énergie :
    // C indice : 150 kWhEP/m².an »).
    for (const img of doc.querySelectorAll('img[alt], img[title]')) {
      const label = `${img.getAttribute('alt') || ''} ${img.getAttribute('title') || ''}`;
      if (/kwh|co\s*[2₂]|dpe|climat/i.test(label)) parts.push(label);
    }
    // Étiquettes accessibles : Abrinor « DPE F (365) », Citya « Classe énergétique actuelle : D ».
    for (const el of doc.querySelectorAll('[aria-label]')) {
      const label = el.getAttribute('aria-label') || '';
      if (label.length < 200 && /kwh|co\s*[2₂]|dpe|ges\b|climat|[ée]nerg[ée]tique/i.test(label)) parts.push(label);
    }
    return cleanText(parts.join('\n'));
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
    // Next.js (self.__next_f.push) échappe le JSON dans des chaînes : \"dpeNote\":\"E\".
    blob = blob.replace(/\\"/g, '"');
    const key = (names) => `["']?(?:${names})["']?\\s*[:=]\\s*["']?`;
    const pick = (names, valueRe) => {
      const m = blob.match(new RegExp(key(names) + valueRe, 'i'));
      return m ? m[1] : null;
    };
    const r = {};
    const energy = pick('energyClass|energy_class|classeEnergie|classe_energie|dpeLetter|dpe_letter|dpeLettre|dpeNote|energyCategory|noteConsoEnergie|consommationClasse|etiquetteDpe|etiquette_dpe|dpeClass|dpe_class|energyClassification|lettreDpe', '([A-G])["\']');
    const ges = pick('gesClass|ges_class|classeGes|classe_ges|gesLetter|ges_letter|gesLettre|gesNote|gesCategory|noteEmissionGES|emissionGesClasse|etiquetteGes|etiquette_ges|greenhouseGasClass|greenhouseGasEmissionClassification|lettreGes', '([A-G])["\']');
    if (energy) r.energyClass = energy;
    if (ges) r.gesClass = ges;
    const ep = pick('energyConsumption|energy_consumption|consoEnergie|conso_energie|dpeValue|dpe_value|valeurDpe|consommationEnergie|energyValue', '(\\d{1,4}(?:\\.\\d+)?)');
    const gesV = pick('gesValue|ges_value|valeurGes|emissionGes|emission_ges|greenhouseGasValue|greenhouseGasEmission', '(\\d{1,4}(?:\\.\\d+)?)');
    // « energy_consumption: "0.00" » veut dire « non renseigné » (atHome), pas zéro.
    if (ep && parseNumber(ep) > 0) r.energyConsumption = parseNumber(ep);
    if (gesV && parseNumber(gesV) > 0) r.gesEmission = parseNumber(gesV);
    const postal = pick('postalCode|postal_code|zipCode|zipcode|zip_code|codePostal|code_postal|postCode|itemZipcode', '(\\d{5})');
    if (postal) r.postal = postal;
    const surface = pick('livingArea|living_area|surfaceHabitable|surface_habitable|habitableSurface|livingSurface|liveableSurface|mainSurface|propertySurface|itemSize', '(\\d{1,4}(?:\\.\\d+)?)');
    if (surface) r.surface = ex.normalizeSurface(surface);
    return r;
  }

  // ─── Données structurées embarquées par les sites ───
  // Figaro Immobilier et IAD (Nuxt), Square Habitat et Foncia (Angular), Orpi
  // (attribut data-estate), sites Netty (base64), Next.js. Plus fiables que le
  // texte quand elles existent : ce sont les données qui servent à dessiner la page.

  // Nuxt 3 sérialise son état en tableau plat (format « devalue ») : chaque objet
  // référence ses valeurs par leur position dans le tableau.
  const NUXT_WRAPPERS = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef', 'EmptyRef', 'EmptyShallowRef']);

  function decodeNuxt(arr) {
    const memo = new Map();
    let budget = 300000;
    function hydrate(i, depth) {
      if (typeof i !== 'number' || i < 0 || i >= arr.length) return undefined;
      if (memo.has(i)) return memo.get(i);
      if (--budget < 0 || depth > 60) return undefined;
      const v = arr[i];
      if (v === null || typeof v !== 'object') {
        memo.set(i, v);
        return v;
      }
      if (Array.isArray(v)) {
        if (typeof v[0] === 'string') {
          // Valeur typée : ['ShallowReactive', idx], ['Date', '2026-…'], ['Set', …], ['Map', …].
          if (NUXT_WRAPPERS.has(v[0])) {
            const out = hydrate(v[1], depth + 1);
            memo.set(i, out);
            return out;
          }
          if (v[0] === 'Date') return v[1];
          if (v[0] === 'Set') return v.slice(1).map((x) => hydrate(x, depth + 1));
          if (v[0] === 'Map') {
            const out = {};
            for (let k = 1; k < v.length; k += 2) out[String(hydrate(v[k], depth + 1))] = hydrate(v[k + 1], depth + 1);
            return out;
          }
          return undefined;
        }
        const out = [];
        memo.set(i, out);
        for (const x of v) out.push(hydrate(x, depth + 1));
        return out;
      }
      const out = {};
      memo.set(i, out);
      for (const [k, x] of Object.entries(v)) out[k] = hydrate(x, depth + 1);
      return out;
    }
    return hydrate(0, 0);
  }

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function decodeBase64Json(b64) {
    try {
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
    } catch {
      return null;
    }
  }

  function structuredRoots(doc) {
    const roots = [];
    const nuxt = doc.getElementById('__NUXT_DATA__');
    const nuxtArr = nuxt && parseJson(nuxt.textContent);
    if (Array.isArray(nuxtArr)) roots.push(decodeNuxt(nuxtArr));
    const next = doc.getElementById('__NEXT_DATA__');
    const nextData = next && parseJson(next.textContent);
    if (nextData) roots.push(nextData);
    // Angular TransferState : les anciennes versions échappent les guillemets en « &q; ».
    for (const id of ['ng-state', 'serverApp-state']) {
      const n = doc.getElementById(id);
      if (!n) continue;
      const t = n.textContent.replace(/&q;/g, '"').replace(/&s;/g, "'").replace(/&l;/g, '<').replace(/&g;/g, '>').replace(/&a;/g, '&');
      const j = parseJson(t);
      if (j) roots.push(j);
    }
    for (const n of doc.querySelectorAll('[data-estate]')) {
      const j = parseJson(n.getAttribute('data-estate'));
      if (j) roots.push(j);
    }
    for (const s of doc.querySelectorAll('script:not([src])')) {
      const m = (s.textContent || '').match(/_TEMPLATE_DATA\s*=\s*JSON\.parse\(\s*b64_to_utf8\(\s*["']([A-Za-z0-9+/=]{40,})["']/);
      const j = m && decodeBase64Json(m[1]);
      if (j) roots.push(j);
    }
    return roots;
  }

  // Noms de clés connus, du plus précis au plus vague. « parent.clé » désigne une
  // clé imbriquée (IAD : epcGes.epc.class).
  const KEYS = {
    postal: ['location.postalcode', 'location.postcode', 'localisation.codepostal', 'address.postalcode', 'adresse.codepostal', 'villeinfos.codepostal', 'postalcode', 'postal_code', 'zipcode', 'zip_code', 'codepostal', 'code_postal', 'postcode', 'itemzipcode'],
    city: ['location.cityonly', 'location.city', 'location.place', 'localisation.ville', 'cityonly', 'city', 'ville', 'commune', 'addresslocality', 'itemcity', 'place'],
    surface: ['surfacehabitable', 'livingarea', 'living_area', 'habitablesurface', 'livingsurface', 'liveablesurface', 'mainsurface', 'propertysurface', 'surface.habitable', 'itemsize', 'area', 'surface'],
    land: ['surfaceterrain', 'landsurface', 'lotsurface', 'areaground', 'areasurface', 'plotsurface', 'surface.terrain'],
    energyClass: ['energycategory', 'dpenote', 'dpelettre', 'dpeletter', 'dpeclass', 'energyclass', 'classeenergie', 'consommationclasse', 'noteconsoenergie', 'etiquettedpe', 'energyclassification', 'epc.class', 'dpe.class', 'dpe.classe', 'dpe.lettre'],
    gesClass: ['gescategory', 'gesnote', 'geslettre', 'gesletter', 'gesclass', 'classeges', 'emissiongesclasse', 'noteemissionges', 'etiquetteges', 'greenhousegasclass', 'ges.class', 'ges.classe', 'ges.lettre'],
    energyIndex: ['consumptionindex'],
    gesIndex: ['emissionindex'],
    energyConsumption: ['energyconsumption', 'consoenergie', 'consommationenergie', 'valeurdpe', 'dpevalue', 'consumptionvalue', 'epc.value', 'dpe.value'],
    gesEmission: ['gesvalue', 'emissionges', 'valeurges', 'emissionvalue', 'ges.value'],
    date: ['datedpefr', 'dpedate', 'dpeexecutiondate', 'daterealisationdpe', 'datedpe', 'epcges.date', 'epc.date', 'dpe.date'],
    type: ['propertytype', 'typebien', 'realestatetype', 'prod_type', 'itemtype', 'type'],
    price: ['price', 'prix', 'prixvente', 'prix_vente', 'price2', 'itemprice', 'prixaffiche', 'loyer', 'rent'],
  };
  const ANCHORS = new Set([...KEYS.surface, ...KEYS.land, ...KEYS.energyClass, ...KEYS.energyIndex, 'dpe', 'epcges', 'dpeinfos', 'logementinfos'].filter((k) => !k.includes('.')));

  // Blocs qui décrivent quelqu'un d'autre que le bien (l'agence et son adresse, le
  // vendeur, le contact) : leur code postal n'est pas celui du bien.
  const FOREIGN_PARENTS = /^(agency|agence|agences|advertiser|annonceur|contact|contacts|seller|vendeur|owner|publisher|office|negotiator|negociateur|agent|company|societe|brand|marque|user)$/i;

  // Aplatit un objet sur 3 niveaux, les clés les moins profondes d'abord :
  // { "postalcode": …, "location.postalcode": … }.
  function flatten(obj) {
    const out = new Map();
    let level = [{ o: obj, parent: '' }];
    for (let depth = 0; depth <= 3 && level.length; depth++) {
      const nextLevel = [];
      for (const { o, parent } of level) {
        for (const [k, v] of Object.entries(o)) {
          const key = k.toLowerCase();
          if (v !== null && typeof v === 'object') {
            if (!Array.isArray(v) && !FOREIGN_PARENTS.test(key)) nextLevel.push({ o: v, parent: key });
            continue;
          }
          if (!out.has(key)) out.set(key, v);
          if (parent && !out.has(`${parent}.${key}`)) out.set(`${parent}.${key}`, v);
        }
      }
      level = nextLevel;
    }
    return out;
  }

  function structuredDate(v) {
    const s = String(v);
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    let y;
    let mo;
    let d;
    if (m) [d, mo, y] = [+m[1], +m[2], +m[3]];
    else if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) [y, mo, d] = [+m[1], +m[2], +m[3]];
    else return null;
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (iso < '2021-07-01' || iso > new Date().toISOString().slice(0, 10)) return null;
    return ex.parseDateRange({ year: y, month: mo, day: d });
  }

  function readFields(flat) {
    const first = (keys, accept) => {
      for (const k of keys) {
        if (!flat.has(k)) continue;
        const v = accept(flat.get(k));
        if (v != null) return v;
      }
      return null;
    };
    const num = (min, max) => (v) => {
      const n = typeof v === 'number' ? v : parseNumber(v);
      return n != null && n >= min && n <= max ? n : null;
    };
    const letter = (v) => (typeof v === 'string' && /^[A-Ga-g]$/.test(v.trim()) ? v.trim().toUpperCase() : null);
    const index = (v) => (Number.isInteger(+v) && +v >= 1 && +v <= 7 ? 'ABCDEFG'[+v - 1] : null);
    return {
      postal: first(KEYS.postal, (v) => (/^\d{5}$/.test(String(v)) ? String(v) : null)),
      city: first(KEYS.city, (v) => (typeof v === 'string' && /^[^\d]{2,60}$/.test(v) ? v : null)),
      surface: first(KEYS.surface, num(5, 2000)),
      land: first(KEYS.land, num(10, 9999999)),
      energyClass: first(KEYS.energyClass, letter) || first(KEYS.energyIndex, index),
      gesClass: first(KEYS.gesClass, letter) || first(KEYS.gesIndex, index),
      energyConsumption: first(KEYS.energyConsumption, num(1, 1500)),
      gesEmission: first(KEYS.gesEmission, num(0, 400)),
      dateRange: first(KEYS.date, structuredDate),
      type: first(KEYS.type, (v) => (typeof v === 'string' ? v : null)),
      price: first(KEYS.price, (v) => toAmount(v)),
    };
  }

  // Cherche, dans tous les états embarqués, l'objet qui décrit le mieux l'annonce :
  // celui qui réunit le plus de champs (surface, code postal, DPE…). En cas
  // d'égalité, celui dont la surface correspond au titre de la page, sinon le
  // premier rencontré (l'annonce principale précède les annonces similaires).
  function fromStructured(doc, headSurface) {
    let best = null;
    let visited = 0;
    for (const root of structuredRoots(doc)) {
      const queue = [root];
      const seen = new Set();
      while (queue.length && visited < 30000) {
        const node = queue.shift();
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);
        visited++;
        const values = Array.isArray(node) ? node : Object.values(node);
        for (const v of values) if (v && typeof v === 'object') queue.push(v);
        if (Array.isArray(node) || !Object.keys(node).some((k) => ANCHORS.has(k.toLowerCase()))) continue;
        const f = readFields(flatten(node));
        if (f.surface == null && f.land == null) continue;
        const score = ['postal', 'surface', 'energyClass', 'gesClass', 'energyConsumption', 'dateRange'].filter((k) => f[k] != null).length;
        const matchesHead = headSurface != null && f.surface != null && Math.abs(f.surface - headSurface) < 1;
        if (score < 2) continue;
        if (!best || score > best.score || (score === best.score && matchesHead && !best.matchesHead)) {
          best = { score, matchesHead, fields: f };
        }
      }
    }
    return best ? best.fields : {};
  }

  // ─── Assemblage ───

  function extractFromDocument(doc) {
    const found = {};
    const set = (target, field, value, source) => {
      // La preuve ne vaut que pour l'appel en cours : on la consomme tout de suite.
      const ev = evidence;
      evidence = null;
      if (value == null || value === '' || target[field] != null) return;
      target[field] = value;
      found[field] = source === 'texte' && ev ? `texte « ${ev.trim()} »` : source;
    };

    const head = headline(doc);
    const text = mainText(doc);
    const ld = fromJsonLd(readJsonLd(doc));
    const labels = fromLabels(doc);
    const scripts = fromScripts(doc);
    const st = fromStructured(doc, surfaceFromHeadline(head));
    const r = {};

    // Localisation
    set(r, 'postal', ld.postal, 'json-ld');
    set(r, 'postal', st.postal, 'données du site');
    set(r, 'city', ld.city && cleanCity(ld.city), 'json-ld');
    set(r, 'city', st.city && cleanCity(st.city), 'données du site');
    const pcHead = postalAndCity(head);
    if (pcHead) {
      set(r, 'postal', pcHead.postal, 'titre');
      set(r, 'city', pcHead.city, 'titre');
    }
    const headCity = headlineCity(head);
    const urlCity = cityFromUrl(doc.URL || (typeof location !== 'undefined' ? location.href : ''));
    const labeledPostal = text.match(LABELED_POSTAL);
    const labeledCity = text.match(LABELED_CITY);
    if (labeledPostal && VALID_POSTAL.test(labeledPostal[1])) {
      set(r, 'postal', labeledPostal[1], 'texte');
      if (labeledCity) set(r, 'city', cleanCity(labeledCity[1]), 'texte');
    }
    const crumbs = cleanText(Array.from(doc.querySelectorAll('nav, [class*="breadcrumb" i], [class*="ariane" i]')).map((n) => rawText(n)).join(' | '));
    const pcCrumbs = postalAndCity(crumbs);
    if (pcCrumbs) {
      set(r, 'postal', pcCrumbs.postal, 'fil d’Ariane');
      set(r, 'city', pcCrumbs.city, 'fil d’Ariane');
    }
    if (!r.postal) {
      const pcText = postalAndCity(text);
      // Le titre nomme une autre ville que celle du code postal trouvé dans le texte :
      // ce code postal est sans doute celui de l'agence (Trigone : bien à Houplines,
      // agence à Armentières). On garde la ville du titre.
      if (pcText && !(headCity && pcText.city && !sameCity(headCity, pcText.city))) {
        set(r, 'postal', pcText.postal, 'texte');
        set(r, 'city', pcText.city, 'texte');
      }
    }
    if (!r.postal && !r.city) set(r, 'postal', scripts.postal, 'script');
    if (!r.postal) {
      const cd = cityWithDepartment(head) || cityWithDepartment(crumbs) || cityWithDepartment(text);
      if (cd) {
        set(r, 'city', cd.city, 'titre');
        r.department = cd.department;
      }
      set(r, 'city', headCity, 'titre');
      if (labeledCity) set(r, 'city', cleanCity(labeledCity[1]), 'texte');
      if (!r.city) set(r, 'city', urlCity, 'adresse de la page');
    }
    // Indice de ville (titre, sinon adresse de la page) quand il diffère de la ville lue :
    // le service worker le vérifie dans la liste officielle des communes et remplace le
    // code postal s'il n'appartient pas à cette commune (code postal de l'agence).
    const hint = headCity || urlCity;
    r.cityHint = hint && !sameCity(hint, r.city) ? hint : null;

    const landByType = st.type && /terrain|land|plot/i.test(st.type) && !st.energyClass;
    const kind = isLandListing(head) || landByType ? 'land' : 'dpe';

    if (kind === 'land') {
      let land = st.land || (landByType ? st.surface : null) || null;
      for (const re of land == null ? LAND_PATTERNS : []) {
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
        cityHint: r.cityHint || null,
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
    set(r, 'surface', st.surface != null ? ex.normalizeSurface(st.surface) : null, 'données du site');
    set(r, 'surface', ex.normalizeSurface(firstNumber(text, SURFACE_PATTERNS, { min: 5, max: 2000 })), 'texte');
    set(r, 'surface', surfaceFromHeadline(head), 'titre');
    set(r, 'surface', ex.normalizeSurface(firstNumber(text, SURFACE_WEAK_PATTERNS, { min: 5, max: 2000 })), 'texte');
    set(r, 'surface', scripts.surface, 'script');
    set(r, 'surface', surfaceNearType(text), 'texte');
    // Une maison de moins de 20 m² est une pièce lue par erreur (« chambre de 14 m² ») :
    // on se rabat sur la surface du titre.
    if (r.surface && r.surface < 20 && /\bmaison\b/i.test(head)) {
      r.surface = surfaceFromHeadline(head);
      found.surface = r.surface ? 'titre' : undefined;
    }

    // Valeurs du DPE (kWh et kg CO2), y compris dans les étiquettes SVG intégrées.
    const svgText = svgImageText(doc);
    set(r, 'energyConsumption', st.energyConsumption, 'données du site');
    set(r, 'gesEmission', st.gesEmission, 'données du site');
    set(r, 'energyConsumption', labels.energyConsumption, 'étiquette');
    set(r, 'gesEmission', labels.gesEmission, 'étiquette');
    set(r, 'energyConsumption', firstNumber(text, EP_PATTERNS, { min: 1, max: 1500 }), 'texte');
    set(r, 'energyConsumption', firstNumber(svgText, EP_PATTERNS, { min: 1, max: 1500 }), 'étiquette');
    set(r, 'energyConsumption', scripts.energyConsumption, 'script');
    set(r, 'gesEmission', firstNumber(text, GES_VALUE_PATTERNS, { min: 0, max: 400 }), 'texte');
    set(r, 'gesEmission', firstNumber(svgText, GES_VALUE_PATTERNS, { min: 0, max: 400 }), 'étiquette');
    set(r, 'gesEmission', scripts.gesEmission, 'script');

    // Classes, de la source la plus sûre à la moins sûre : lettre mise en avant sur
    // l'étiquette dessinée, puis calcul depuis les valeurs, puis texte, puis scripts.
    // Le texte vient après car il mélange souvent la lettre et la légende « A B C … ».
    const derived = deriveClasses(r.energyConsumption, r.gesEmission, r.surface);
    set(r, 'energyClass', labels.energyClass, 'étiquette');
    set(r, 'energyClass', st.energyClass, 'données du site');
    set(r, 'energyClass', firstLetter(svgText, ENERGY_PATTERNS), 'étiquette');
    set(r, 'energyClass', derived && derived.energyClass, 'calculée');
    set(r, 'energyClass', firstLetter(text, [AFTER_LEGEND, ...ENERGY_PATTERNS]), 'texte');
    set(r, 'energyClass', firstLetter(text, ENERGY_LOWER_OK, { allowLower: true }), 'texte');
    set(r, 'energyClass', scripts.energyClass, 'script');
    set(r, 'gesClass', labels.gesClass, 'étiquette');
    set(r, 'gesClass', st.gesClass, 'données du site');
    set(r, 'gesClass', firstLetter(svgText, GES_PATTERNS), 'étiquette');
    set(r, 'gesClass', derived && derived.gesClass, 'calculée');
    set(r, 'gesClass', firstLetter(text, GES_PATTERNS), 'texte');
    set(r, 'gesClass', scripts.gesClass, 'script');

    set(r, 'buildingType', buildingTypeFrom(head), 'titre');
    set(r, 'buildingType', ld.buildingType, 'json-ld');
    set(r, 'buildingType', ex.normalizePropertyType(st.type), 'données du site');
    set(r, 'dateRange', st.dateRange, 'données du site');
    set(r, 'dateRange', dpeDateRange(text), 'texte');

    const result = {
      kind: 'dpe',
      postal: r.postal || null,
      city: r.city || null,
      department: r.department || null,
      cityHint: r.cityHint || null,
      surface: r.surface || null,
      energyClass: r.energyClass || null,
      gesClass: r.gesClass || null,
      energyConsumption: r.energyConsumption != null ? Math.round(r.energyConsumption) : null,
      gesEmission: r.gesEmission != null ? Math.round(r.gesEmission) : null,
      buildingType: r.buildingType || null,
      dateRange: r.dateRange || null,
      // « neuf » dans la description vaut souvent « remis à neuf » : on ne regarde que le titre.
      isNewBuild: /\b(VEFA|programme neuf|logement neuf|appartement neuf|maison neuve)\b/i.test(head),
      source: 'generic',
      found,
    };
    result.missing = ['postal', 'surface', 'energyClass'].filter((k) => !result[k] && !(k === 'postal' && result.city));
    return result;
  }

  function computeMissing(result) {
    if (result.kind === 'land') return ['postal', 'surface'].filter((k) => !result[k] && !(k === 'postal' && result.city));
    return ['postal', 'surface', 'energyClass'].filter((k) => !result[k] && !(k === 'postal' && result.city));
  }

  // Étiquettes chargées à part, depuis le même site (Laforêt : /ajax/properties/<id>/dpe
  // renvoie un SVG avec g#DPE_D) : on les télécharge pour y lire la lettre et les valeurs.
  // Les images bitmap (PNG, JPEG) sont ignorées : rien n'y est lisible.
  async function fetchLabelImages(doc) {
    const out = { texts: [], energyClass: null, gesClass: null };
    const urls = new Set();
    for (const node of doc.querySelectorAll('img[src], object[data]')) {
      const src = node.getAttribute('src') || node.getAttribute('data');
      if (!src || src.startsWith('data:')) continue;
      let url;
      try {
        url = new URL(src, doc.baseURI);
      } catch {
        continue;
      }
      if (url.origin !== location.origin) continue;
      if (!/dpe|ges|energ|diagnostic/i.test(url.pathname + url.search)) continue;
      if (/\.(png|jpe?g|gif|webp|avif)$/i.test(url.pathname)) continue;
      urls.add(url.href);
      if (urls.size >= 4) break;
    }
    for (const href of urls) {
      try {
        const res = await fetch(href, { credentials: 'same-origin' });
        if (!/svg|xml/i.test(res.headers.get('content-type') || '')) continue;
        const svg = await res.text();
        const d = svg.match(/id="DPE_([A-G])"/);
        const g = svg.match(/id="GES_([A-G])"/);
        if (d && !out.energyClass) out.energyClass = d[1];
        if (g && !out.gesClass) out.gesClass = g[1];
        out.texts.push(...[...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]));
      } catch {
        // étiquette inaccessible : ignorée
      }
    }
    return out;
  }

  // Version complète, asynchrone : lecture de la page, puis, s'il manque une
  // classe, téléchargement des étiquettes séparées.
  async function extractPageAsync() {
    const r = extractPage();
    if (r.kind !== 'dpe' || (r.energyClass && r.gesClass)) return r;
    const extra = await fetchLabelImages(document);
    const found = r.found || (r.found = {});
    const text = cleanText(extra.texts.join(' '));
    if (r.energyConsumption == null) {
      const n = firstNumber(text, EP_PATTERNS, { min: 1, max: 1500 });
      if (n != null) (r.energyConsumption = Math.round(n)), (found.energyConsumption = 'étiquette téléchargée');
    }
    if (r.gesEmission == null) {
      const n = firstNumber(text, GES_VALUE_PATTERNS, { min: 0, max: 400 });
      if (n != null) (r.gesEmission = Math.round(n)), (found.gesEmission = 'étiquette téléchargée');
    }
    const derived = deriveClasses(r.energyConsumption, r.gesEmission, r.surface);
    if (!r.energyClass && (extra.energyClass || (derived && derived.energyClass))) {
      r.energyClass = extra.energyClass || derived.energyClass;
      found.energyClass = extra.energyClass ? 'étiquette téléchargée' : 'calculée';
    }
    if (!r.gesClass && (extra.gesClass || (derived && derived.gesClass))) {
      r.gesClass = extra.gesClass || derived.gesClass;
      found.gesClass = extra.gesClass ? 'étiquette téléchargée' : 'calculée';
    }
    r.missing = computeMissing(r);
    return r;
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

  // ─── Prix et type de transaction (suivi des biens) ───

  // « 294 000 », « 460.000 », « 1 157,50 » : séparateurs de milliers, décimales éventuelles.
  function toAmount(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) && v > 0 ? Math.round(v) : null;
    const t = String(v).replace(/[   ]/g, ' ').trim();
    const thousands = t.match(/^(\d{1,3}(?:[ .]\d{3})+)(?:,(\d{1,2}))?$/);
    const n = thousands ? parseFloat(thousands[1].replace(/[ .]/g, '') + (thousands[2] ? `.${thousands[2]}` : '')) : parseFloat(t.replace(',', '.'));
    return isFinite(n) && n > 0 ? Math.round(n) : null;
  }

  // Location ou vente, d'après l'adresse de la page et le titre.
  function detectTransaction(doc) {
    const url = (doc.location && doc.location.href) || doc.URL || '';
    return /locations?\b|\/louer|-louer|a-louer|loyer/i.test(url) || /\b(?:location|à louer|a louer|loyer)\b/i.test(headline(doc)) ? 'location' : 'vente';
  }

  const AMOUNT = '(\\d{1,3}(?:[ .\\u202f\\u00a0]\\d{3})+|\\d{3,8})(?:,\\d{1,2})?';
  const PRICE_LABELLED = new RegExp(`(?:prix|loyer)[^\\d\\n€]{0,40}?${AMOUNT}\\s*(?:€|euros?)`, 'i');
  const PRICE_ANY = new RegExp(`${AMOUNT}\\s*(?:€|euros?)(?!\\s*(?:\\/|par)\\s*m)`, 'gi');
  // Montants qui ne sont pas le prix : honoraires, charges, mensualité, dépôt, taxe…
  const NOT_PRICE_BEFORE = /(?:honoraires?|charges?|mensualit[ée]s?|[àa] partir de|d[ée]p[ôo]t|frais|taxe|provision|garantie|soit|dont|budget|estim)[^\d\n]{0,25}$/i;

  // Prix de l'annonce : données du site, puis titre, puis libellé « Prix », puis premier
  // montant plausible du texte. Les bornes dépendent de la transaction (vente ou loyer).
  function extractPrice(doc, transaction = detectTransaction(doc)) {
    const [min, max] = transaction === 'location' ? [100, 20000] : [10000, 30000000];
    const ok = (n) => (n != null && n >= min && n <= max ? n : null);
    for (const o of readJsonLd(doc)) {
      const n = ok(toAmount(o.price ?? (o.offers && !Array.isArray(o.offers) ? o.offers.price : null)));
      if (n) return n;
    }
    for (const sel of ['meta[property="product:price:amount"]', 'meta[property="og:price:amount"]', '[itemprop="price"][content]']) {
      const n = ok(toAmount(doc.querySelector(sel)?.getAttribute('content')));
      if (n) return n;
    }
    const st = fromStructured(doc, null);
    if (ok(st.price)) return st.price;
    const head = headline(doc);
    const text = mainText(doc);
    // « Prix hors honoraires : 480 000 € » ou « net vendeur » n'est pas le prix affiché
    // (century21.fr : 499 000 € honoraires inclus) : ces libellés sont écartés.
    for (const source of [head, text]) {
      const g = new RegExp(PRICE_LABELLED.source, 'gi');
      let m;
      while ((m = g.exec(source))) {
        if (/hors\s+(?:honoraires|frais)|net\s+vendeur|hors\s+charges/i.test(m[0])) continue;
        if (ok(toAmount(m[1]))) return toAmount(m[1]);
      }
    }
    for (const source of [head, text.slice(0, 4000)]) {
      PRICE_ANY.lastIndex = 0;
      let m;
      while ((m = PRICE_ANY.exec(source))) {
        if (NOT_PRICE_BEFORE.test(source.slice(Math.max(0, m.index - 40), m.index))) continue;
        const n = ok(toAmount(m[1]));
        if (n) return n;
      }
    }
    return null;
  }

  window.__immodexGeneric = { extractPage, extractPageAsync, extractFromDocument, extractPrice, detectTransaction, deriveClasses, postalAndCity, dpeDateRange };
})();
