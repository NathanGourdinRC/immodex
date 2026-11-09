// Lecture d'une page d'annonce SeLoger déjà affichée dans le navigateur de Nathan. Le bloc de
// données de la page (`__UFRN_LIFECYCLE_SERVERREQUEST__`) donne, en plus des lettres du DPE que
// montrent les cartes des listes, la consommation (kWh/m².an), les émissions (kg CO₂/m².an) et
// l'année de construction : de quoi retrouver l'adresse dans le registre des DPE de l'ADEME.
// Rien n'est demandé au site ici ; ce code lit seulement la page ouverte.
(function () {
  'use strict';

  const norm = (s) => String(s == null ? '' : s).replace(/[\s  ]+/g, ' ').trim();
  // « 107,5 m² » → 107.5 ; « 226 kWh/m².an » → 226 ; « 1 026 kWh » → 1026 (premier nombre du texte).
  const firstNumber = (s) => {
    const m = norm(s).match(/(\d{1,3}(?:\s\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)/);
    if (!m) return null;
    const n = Number(m[1].replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const letter = (s) => {
    const v = String(s || '').trim().toUpperCase();
    return /^[A-G]$/.test(v) ? v : null;
  };
  const inRange = (n, min, max) => (n != null && n >= min && n <= max ? n : null);

  // Bloc de données de la page : `window["__UFRN_LIFECYCLE_SERVERREQUEST__"]=JSON.parse("…");`
  function lifecycle(doc) {
    const node = doc.getElementById('__UFRN_LIFECYCLE_SERVERREQUEST__');
    if (!node || !node.textContent) return null;
    const m = node.textContent.match(/JSON\.parse\((".*")\)/s);
    if (!m) return null;
    try {
      return JSON.parse(JSON.parse(m[1]));
    } catch {
      return null;
    }
  }

  function classifiedOf(data) {
    if (!data || typeof data !== 'object') return null;
    for (const key of Object.keys(data)) {
      const c = data[key] && data[key].data && data[key].data.classified;
      if (c) return c;
    }
    return null;
  }

  // Valeurs du diagnostic : chaque échelle (énergie, GES) a une `efficiencyClass.rating` (la lettre)
  // et une liste `values` de { label, value } (« Consommation (énergie primaire) » : « 226 kWh/m².an »,
  // « Émissions » : « 41 kg CO₂/m².an »). Un diagnostic sans chiffres (ancien DPE, annonce
  // incomplète) ne donne que les lettres.
  function energyOf(classified) {
    const energy = (classified && classified.sections && classified.sections.energy) || {};
    const out = { energyClass: null, gesClass: null, energyConsumption: null, gesEmission: null, constructionYear: null };
    for (const cert of energy.certificates || []) {
      for (const scale of cert.scales || []) {
        const type = String(scale.type || '').toUpperCase();
        const isGes = type.includes('GHG') || type.includes('GES');
        const rating = letter(scale.efficiencyClass && scale.efficiencyClass.rating);
        if (isGes) out.gesClass = out.gesClass || rating;
        else out.energyClass = out.energyClass || rating;
        for (const v of scale.values || []) {
          const label = norm(v && v.label).toLowerCase();
          const text = norm(v && v.value);
          const n = firstNumber(text);
          if (n == null) continue;
          if (/kg/i.test(text) || /émission|emission/.test(label)) {
            if (out.gesEmission == null) out.gesEmission = inRange(Math.round(n), 1, 500);
          } else if (/kwh/i.test(text) || /consommation/.test(label)) {
            if (out.energyConsumption == null) out.energyConsumption = inRange(Math.round(n), 1, 1500);
          }
        }
      }
    }
    for (const f of energy.features || []) {
      if (f && f.type === 'yearOfConstruction') {
        const y = firstNumber(f.value);
        out.constructionYear = inRange(y, 1000, 2100);
      }
    }
    return out;
  }

  const TYPES = { HOUSE: 'maison', APARTMENT: 'appartement', LAND: 'terrain' };

  // Carte de l'annonce, au format que le Fil reçoit (voir api/_lib/ingest.js) : null si la page n'a
  // pas de bloc de données (annonce retirée, page de défi anti-robot, autre sorte de page).
  function readDetail(doc, pageUrl) {
    const classified = classifiedOf(lifecycle(doc));
    if (!classified) return null;
    const sections = classified.sections || {};
    const type = TYPES[classified.rawData && classified.rawData.propertyType];
    const facts = (sections.hardFacts && sections.hardFacts.facts) || [];
    const fact = (name) => {
      const f = facts.find((x) => x && x.type === name);
      const n = f ? firstNumber(f.splitValue || f.value) : null;
      return n ? Math.round(n) : null;
    };
    const address = (sections.location && sections.location.address) || {};
    const url = new URL(pageUrl || doc.location.href);
    const surface = fact('livingSpace');
    const city = norm(address.city) || null;
    const price = firstNumber(classified.rawData && classified.rawData.price);
    const e = energyOf(classified);
    return {
      hasData: true,
      card: {
        url: `${url.origin}${url.pathname}`,
        type: type || null,
        price: price && price > 1000 ? Math.round(price) : null,
        title: norm(`${type === 'maison' ? 'Maison' : type === 'appartement' ? 'Appartement' : 'Bien'} ${surface ? `${surface} m²` : ''} ${city || ''} ${address.zipCode || ''}`),
        detail: {
          surface,
          pieces: fact('numberOfRooms'),
          chambres: fact('numberOfBedrooms'),
          terrain: fact('plotSpace') || fact('landSpace'),
          postal: /^\d{5}$/.test(String(address.zipCode || '')) ? String(address.zipCode) : null,
          city,
          energyClass: e.energyClass,
          gesClass: e.gesClass,
          energyConsumption: e.energyConsumption,
          gesEmission: e.gesEmission,
          constructionYear: e.constructionYear,
        },
      },
    };
  }

  // Page de défi anti-robot de SeLoger (DataDome) : une iframe ou un script « captcha-delivery »,
  // ou le texte d'un contrôle de navigateur. Sert seulement à s'arrêter net, jamais à le résoudre.
  function isChallenge(doc) {
    if (doc.querySelector('iframe[src*="captcha-delivery"], script[src*="captcha-delivery"], iframe[src*="datadome"]')) return true;
    const text = norm(doc.body && doc.body.textContent).slice(0, 600).toLowerCase();
    return /captcha|vérification de sécurité|verify you are human|accès refusé|access denied|robot/.test(text) && !doc.getElementById('__UFRN_LIFECYCLE_SERVERREQUEST__');
  }

  window.__immodexSelogerDetail = { lifecycle, classifiedOf, energyOf, readDetail, isChallenge };
})();
