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

  function firstLetter(text, patterns) {
    for (const re of patterns) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let m;
      while ((m = g.exec(text))) {
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
  function rawText(node) {
    if (typeof node.innerText === 'string' && node.innerText !== '') return node.innerText;
    const copy = node.cloneNode(true);
    for (const s of copy.querySelectorAll('script, style, noscript, template')) s.remove();
    // Comme innerText : un retour à la ligne après chaque bloc, pour ne pas coller
    // « B » et « Description » en « BDescription ».
    for (const b of copy.querySelectorAll('p, div, li, br, h1, h2, h3, h4, h5, h6, section, article, tr, dt, dd, ul, ol, header, footer, table')) {
      b.appendChild(b.ownerDocument.createTextNode('\n'));
    }
    return copy.textContent || '';
  }

  // Blocs qui parlent d'autres biens (annonces similaires, recommandations,
  // carrousels) : leurs surfaces et DPE fausseraient la lecture de l'annonce.
  const NOISE =
    '[class*="similar" i], [class*="similaire" i], [class*="related" i], [class*="recommend" i], [class*="suggest" i], ' +
    '[id*="similar" i], [id*="similaire" i], [class*="other-ad" i], [class*="autres-annonces" i], [class*="carousel" i], ' +
    '[class*="slider" i], [class*="swiper" i], footer';

  function visibleText(node) {
    let text = rawText(node);
    for (const noise of node.querySelectorAll(NOISE)) {
      const t = rawText(noise).trim();
      if (t.length > 20) text = text.split(t).join('\n');
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
    const mainContent = main ? visibleText(main) : '';
    if (mainContent.length > 400) return cleanText(mainContent);
    // Sans bloc principal, l'annonce commence à son titre : ce qui précède (menus,
    // vignettes d'autres biens) est écarté, sauf si le titre arrive tard dans la
    // page (on garderait trop peu de texte).
    const all = cleanText(visibleText(body));
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
    /(?:classe|[ée]tiquette|lettre)\s+(?:de\s+)?(?:l['’])?(?:[ée]nergie|[ée]nerg[ée]tique|dpe|consommation)(?:\s*-\s*climat)?\s*(?:\(dpe\))?\s*[:\-–]?\s*\(?([A-Ga-g])\b/i,
    /(?:diagnostic\s+de\s+performance\s+[ée]nerg[ée]tique|performance\s+[ée]nerg[ée]tique|consommations?\s+[ée]nerg[ée]tiques?)\s*(?:\(dpe\))?\s*(?:classe)?\s*[:\-–]?\s*([A-Ga-g])\b/i,
    /\bDPE\s*(?:classe)?\s*[:\-–]?\s*([A-G])\b/,
  ];
  const GES_PATTERNS = [
    /\bGES\s+class[ée]e?\s+(?:en\s+)?([A-G])\b/i,
    /\(GES\)\s*:?\s*([A-G])(?![a-zà-ÿ])/,
    /\b([A-G])\s+(?:indice\s+d['’])?[ée]missions?\s+de\s+gaz/i,
    /(?:classe|[ée]tiquette|lettre)\s+(?:de\s+)?(?:ges|climat|co2|gaz\s+[àa]\s+effet\s+de\s+serre|[ée]missions?)\s*(?:\(ges\))?\s*[:\-–]?\s*\(?([A-Ga-g])\b/i,
    /(?:[ée]missions?\s+de\s+gaz\s+[àa]\s+effet\s+de\s+serre|gaz\s+[àa]\s+effet\s+de\s+serre)\s*(?:\(ges\))?\s*(?:classe)?\s*[:\-–]?\s*([A-Ga-g])\b/i,
    /\bGES\s*(?:classe)?\s*[:\-–]?\s*([A-G])\b/,
  ];
  const EP_PATTERNS = [
    /(\d{1,4}(?:[.,]\d+)?)\s*kWh\s*(?:ep|e\.p\.)?\s*(?:\/|par)\s*m\s*[²2]\s*(?:\/|\.|par|\s)?\s*(?:an|year)/i,
    /consommation[^\d\n]{0,40}(\d{1,4}(?:[.,]\d+)?)\s*kWh/i,
  ];
  const GES_VALUE_PATTERNS = [
    // « 15* kgCO₂/m².an » : l'astérisque renvoie à une note de bas de page.
    /(\d{1,4}(?:[.,]\d+)?)\s*\*?\s*kg\s*(?:[ée]q\.?|eq\.?)?\s*(?:de\s+)?CO\s*[2₂]\s*(?:eq)?\s*(?:\/|par)\s*m\s*[²2]/i,
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

  // Date du DPE : seulement si elle est présentée comme telle (« DPE réalisé le »,
  // « Fait le », « Date du diagnostic »). Les mentions légales (« prix indexés au
  // 1er janvier 2021 », « DPE délivrés à compter du 1er juillet 2021 ») sont ignorées,
  // car une fausse date exclurait le bon logement de la recherche.
  const MONTHS = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
  const DATE_LABEL =
    '(?:(?:dpe|diagnostic(?:\\s+de\\s+performance\\s+[ée]nerg[ée]tique)?)\\s*(?:\\(dpe\\)\\s*)?(?:r[ée]alis[ée]|[ée]tabli|fait|effectu[ée])' +
    '|date\\s+(?:de\\s+r[ée]alisation\\s+)?(?:du\\s+)?(?:dpe|diagnostic)|fait)\\s*(?:le|en)?\\s*:?\\s*';
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
      if (/(terrain|jardin|terrasse|balcon|cave|parcelle|garage|cour)[^\d]{0,15}$/i.test(m[0].slice(0, m[0].lastIndexOf(m[1])))) continue;
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
  const POSTAL_THEN_CITY = new RegExp(`\\b(\\d{5})\\s+(${CITY})`);
  const CITY_THEN_POSTAL = new RegExp(`(${CITY})\\s+(\\d{5})\\b`);
  const CITY_THEN_DEPT = new RegExp(`(${CITY})\\s*\\(\\s*(\\d{2}|2[AB])\\s*\\)`);
  const LEADING_WORDS = /^(?:(?:Vente|Achat|Location|Appartement|Maison|Terrain|Studio|Duplex|Loft|Villa|Immeuble|Bien|Proche|Centre|Quartier)\s+)+/i;

  function cleanCity(raw) {
    let city = String(raw).replace(/\s*\(?\d{5}\)?\s*/g, ' ').replace(LEADING_WORDS, '').trim() || String(raw).trim();
    // « VILLEURBANNE » devient « Villeurbanne » (affichage seulement, la recherche ignore la casse).
    if (city === city.toUpperCase()) city = city.toLowerCase().replace(/(^|[\s\-'’])(\S)/g, (m0, sep, c) => sep + c.toUpperCase());
    return city;
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
      // Pas de \b devant « énergie » : en JavaScript, \b ne reconnaît pas les lettres accentuées.
      // Dans le texte alternatif, la lettre doit être une majuscule isolée (« classe énergie : C »).
      let m = label.match(/(?:dpe|[ée]nergie|consommation)[^A-Za-z]{0,10}([A-G])(?![A-Za-z])/i);
      if (m && !LETTER.test(m[1])) m = null;
      m = m || file.match(/(?:dpe|energie|energy|conso)[-_ ]?([a-g])(?:[-_.]|$)/i);
      if (m && !r.energyClass) r.energyClass = m[1].toUpperCase();
      m = label.match(/(?:ges|climat|co2)[^A-Za-z]{0,10}([A-G])(?![A-Za-z])/i);
      if (m && !LETTER.test(m[1])) m = null;
      m = m || file.match(/(?:ges|climat|co2)[-_ ]?([a-g])(?:[-_.]|$)/i);
      if (m && !r.gesClass) r.gesClass = m[1].toUpperCase();
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
    const r = {};

    // Localisation
    set(r, 'postal', ld.postal, 'json-ld');
    set(r, 'city', ld.city && cleanCity(ld.city), 'json-ld');
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
    set(r, 'surface', surfaceNearType(text), 'texte');

    // Valeurs du DPE (kWh et kg CO2), y compris dans les étiquettes SVG intégrées.
    const svgText = svgImageText(doc);
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
    set(r, 'energyClass', derived && derived.energyClass, 'calculée');
    set(r, 'energyClass', firstLetter(text, [AFTER_LEGEND, ...ENERGY_PATTERNS]), 'texte');
    set(r, 'energyClass', scripts.energyClass, 'script');
    set(r, 'gesClass', labels.gesClass, 'étiquette');
    set(r, 'gesClass', derived && derived.gesClass, 'calculée');
    set(r, 'gesClass', firstLetter(text, GES_PATTERNS), 'texte');
    set(r, 'gesClass', scripts.gesClass, 'script');

    set(r, 'buildingType', buildingTypeFrom(head), 'titre');
    set(r, 'buildingType', ld.buildingType, 'json-ld');

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
      dateRange: dpeDateRange(text),
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

  window.__immodexGeneric = { extractPage, extractFromDocument, deriveClasses, postalAndCity, dpeDateRange };
})();
