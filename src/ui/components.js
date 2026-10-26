// Composants d'affichage partagés par la carte des annonces (overlay.js) et le
// popup : même rendu des critères, des résultats et des formulaires partout.
(function () {
  'use strict';
  if (window.__immodexUI) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return node;
  }

  // Icônes au trait (24 × 24), dessinées pour Immodex+.
  const ICONS = {
    pin: ['M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z', 'circle:12,9.5,2.5'],
    close: ['M6 6l12 12M18 6L6 18'],
    map: ['M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z', 'M9 4v14M15 6v14'],
    file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z', 'M14 3v5h5M9 13h6M9 17h6'],
    copy: ['rect:9,9,11,11,2', 'M5 15V5a2 2 0 0 1 2-2h10'],
    check: ['M5 12.5l4.5 4.5L19 7'],
    refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
    search: ['circle:11,11,7', 'M20 20l-3.5-3.5'],
    clock: ['circle:12,12,9', 'M12 7v5l3 2'],
    trash: ['M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13'],
    back: ['M15 18l-6-6 6-6'],
    info: ['circle:12,12,9', 'M12 11v6M12 7.5v.5'],
    alert: ['M12 3 2 21h20L12 3z', 'M12 10v5M12 18v.5'],
    layers: ['M12 3 2 8l10 5 10-5-10-5z', 'M2 13l10 5 10-5'],
    scan: ['M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3', 'M8 12h8'],
    plus: ['M12 5v14M5 12h14'],
    edit: ['M4 20h4L19 9l-4-4L4 16v4z'],
    external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
    eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'circle:12,12,3'],
    repeat: ['M17 2l4 4-4 4', 'M3 11V9a3 3 0 0 1 3-3h15', 'M7 22l-4-4 4-4', 'M21 13v2a3 3 0 0 1-3 3H3'],
    euro: ['M4 10h12', 'M4 14h9', 'M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2'],
  };

  function icon(name, size = 16) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    for (const part of ICONS[name] || []) {
      let node;
      if (part.startsWith('circle:')) {
        const [cx, cy, r] = part.slice(7).split(',');
        node = document.createElementNS(SVG_NS, 'circle');
        node.setAttribute('cx', cx);
        node.setAttribute('cy', cy);
        node.setAttribute('r', r);
      } else if (part.startsWith('rect:')) {
        const [x, y, w, h, rx] = part.slice(5).split(',');
        node = document.createElementNS(SVG_NS, 'rect');
        Object.entries({ x, y, width: w, height: h, rx }).forEach(([k, v]) => node.setAttribute(k, v));
      } else {
        node = document.createElementNS(SVG_NS, 'path');
        node.setAttribute('d', part);
      }
      svg.appendChild(node);
    }
    return svg;
  }

  // ─── Formats ───

  const pad2 = (n) => (n < 10 ? '0' + n : String(n));
  const num = (n, digits = 0) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: digits });

  function formatDate(iso) {
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return d && m && y ? `${d}/${m}/${y}` : String(iso);
  }

  function formatDateTime(ts) {
    const d = new Date(ts);
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} à ${pad2(d.getHours())}h${pad2(d.getMinutes())}`;
  }

  // Plage de dates du DPE, au format du champ de saisie (JJ/MM/AAAA, MM/AAAA ou AAAA).
  function formatRangeInput(range) {
    if (!range || !range.gte) return '';
    const [y, m, d] = range.gte.split('-');
    if (range.precision === 'day') return `${d}/${m}/${y}`;
    if (range.precision === 'month') return `${m}/${y}`;
    return y;
  }

  const DATASETS = { dpe03existant: 'DPE logements existants', g3cgx7jb3cmys5voxz1mrm22: 'DPE logements neufs', 'dpe-france': 'DPE avant juillet 2021' };

  // ─── Liens ───

  const links = {
    gmaps: (address, postal, city) =>
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([address, postal, city].filter(Boolean).join(', '))}`,
    gmapsCoord: (lon, lat) => `https://www.google.com/maps?q=${lat.toFixed(6)},${lon.toFixed(6)}`,
    // Vue de la rue à ces coordonnées (adresse officielle « Maps URLs » de Google).
    streetView: (lat, lon) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}`,
    ademe: (id) => `https://observatoire-dpe-audit.ademe.fr/afficher-dpe/${encodeURIComponent(id)}`,
    geoportail: (lon, lat) =>
      `https://www.geoportail.gouv.fr/carte?c=${lon.toFixed(6)},${lat.toFixed(6)}&z=19&l0=CADASTRALPARCELS.PARCELLAIRE_EXPRESS::GEOPORTAIL:OGC:WMTS(1)&permalink=yes`,
    cadastrePhoto: (lon, lat) =>
      `https://www.geoportail.gouv.fr/carte?c=${lon.toFixed(6)},${lat.toFixed(6)}&z=20&l0=ORTHOIMAGERY.ORTHOPHOTOS::GEOPORTAIL:OGC:WMTS(1)&l1=CADASTRALPARCELS.PARCELLAIRE_EXPRESS::GEOPORTAIL:OGC:WMTS(0.7)&permalink=yes`,
  };

  function linkButton(href, label, { variant = '', iconName = null, title = null } = {}) {
    return el(
      'a',
      { class: `imx-btn imx-btn-sm ${variant}`.trim(), href, target: '_blank', rel: 'noopener noreferrer', title },
      iconName ? icon(iconName, 14) : null,
      label
    );
  }

  // Copie de l'adresse : pratique pour la coller dans une autre recherche.
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = el('textarea', { style: 'position:fixed;opacity:0' }, text);
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
  }

  // Pont vers Castorus (historique des prix partagé par ses membres) : pas d'API publique
  // et ses conditions interdisent toute collecte automatique. On copie donc le lien de
  // l'annonce et on ouvre sa « Recherche par URL » ; il reste à coller le lien.
  const CASTORUS_SEARCH = 'https://www.castorus.com/recherche';
  // Castorus suit surtout les grands portails (vérifié sur Bien'ici le 26/10/2026) et
  // écarte les sites de particuliers : pas de bouton là où il ne trouverait rien.
  const CASTORUS_EXCLUDED = /(^|\.)(leboncoin\.fr|pap\.fr)$/;

  function castorusButton(listingUrl, { ghost = true } = {}) {
    let host = '';
    try {
      host = new URL(listingUrl).hostname;
    } catch {
      return null;
    }
    if (CASTORUS_EXCLUDED.test(host)) return null;
    const label = () => [icon('external', 14), 'Castorus'];
    const btn = el(
      'button',
      {
        class: `imx-btn imx-btn-sm${ghost ? ' imx-btn-ghost' : ''}`,
        type: 'button',
        title: 'Copie le lien de l’annonce et ouvre la recherche par URL de Castorus (historique des prix). Castorus suit surtout les grands portails comme Bien’ici ; les sites d’agences y sont rarement connus.',
      },
      label()
    );
    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await copyText(listingUrl);
      window.open(CASTORUS_SEARCH, '_blank', 'noopener');
      btn.replaceChildren(icon('check', 14), 'Lien copié, colle-le');
      setTimeout(() => btn.replaceChildren(...label()), 5000);
    });
    return btn;
  }

  function copyButton(text) {
    const btn = el('button', { class: 'imx-btn imx-btn-sm imx-btn-icon', type: 'button', title: 'Copier l’adresse', 'aria-label': 'Copier l’adresse' }, icon('copy', 14));
    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await copyText(text);
      btn.replaceChildren(icon('check', 14));
      setTimeout(() => btn.replaceChildren(icon('copy', 14)), 1500);
    });
    return btn;
  }

  // ─── Pastilles et messages ───

  function badge(letter, scale = 'dpe') {
    if (!letter) return null;
    return el('span', { class: `imx-badge imx-${scale}-${letter}`, title: `${scale === 'dpe' ? 'Classe énergie' : 'Classe GES'} ${letter}` }, letter);
  }

  function chip(content, { withBadge = false, title = null } = {}) {
    return el('span', { class: `imx-chip${withBadge ? ' has-badge' : ''}`, title }, content);
  }

  function confidence(score, kind = 'dpe') {
    const [high, mid] = kind === 'land' ? [70, 40] : [80, 50];
    if (score >= high) return { level: 'good', label: 'Confiance élevée' };
    if (score >= mid) return { level: 'mid', label: 'Confiance moyenne' };
    return { level: 'low', label: 'Confiance faible' };
  }

  function message(kind, iconName, text, action) {
    return el('div', { class: `imx-${kind}`, role: kind === 'alert' ? 'alert' : 'status' }, icon(iconName, 16), el('span', null, text), action || null);
  }

  const notice = (text, action) => message('notice', 'clock', text, action);
  const alert = (text) => message('alert', 'alert', text);
  const empty = (text) => message('empty', 'info', text);
  const loading = (text) => el('div', { class: 'imx-loading', role: 'status' }, el('span', { class: 'imx-spinner' }), text);

  // ─── Critères lus sur l'annonce ───

  function dateChip(range) {
    if (!range || !range.gte) return null;
    if (range.precision === 'day' && range.gte === range.lte) return `DPE du ${formatDate(range.gte)}`;
    if (range.precision === 'month') return `DPE de ${formatRangeInput(range)}`;
    if (range.precision === 'year') return `DPE de ${range.gte.slice(0, 4)}`;
    return `DPE du ${formatDate(range.gte)} au ${formatDate(range.lte)}`;
  }

  function criteria(payload) {
    const p = payload || {};
    const place = [p.postal, p.city].filter(Boolean).join(' ') || (p.department ? `(${p.department})` : null);
    const items = [];
    if (place) items.push(chip([icon('pin', 13), place]));
    if (p.kind === 'land') {
      if (p.surface) items.push(chip(`Terrain ${num(p.surface)} m²`));
      if (p.section) items.push(chip(`Section ${p.section}`));
    } else {
      if (p.surface) items.push(chip(`${num(p.surface)} m²`));
      if (p.buildingType) items.push(chip(p.buildingType === 'maison' ? 'Maison' : 'Appartement'));
      if (p.energyClass) items.push(chip([badge(p.energyClass, 'dpe'), 'Énergie'], { withBadge: true }));
      if (p.gesClass) items.push(chip([badge(p.gesClass, 'ges'), 'GES'], { withBadge: true }));
      if (p.energyConsumption != null) items.push(chip(`${num(p.energyConsumption)} kWh/m²/an`));
      if (p.gesEmission != null) items.push(chip(`${num(p.gesEmission)} kg CO₂/m²/an`));
      const d = dateChip(p.dateRange);
      if (d) items.push(chip(d));
      if (p.isNewBuild) items.push(chip('Neuf'));
    }
    return el('div', { class: 'imx-chips' }, items);
  }

  // ─── Résultats ───

  function scoreBlock(score, kind) {
    const c = confidence(score, kind);
    return el(
      'div',
      { class: 'imx-confidence' },
      el('span', { class: `imx-pill is-${c.level}` }, c.label),
      el('span', { class: `imx-scorebar is-${c.level}` }, el('span', { style: `width:${Math.max(4, Math.min(100, score))}%` })),
      el('span', { class: 'imx-score' }, `${score}/100`)
    );
  }

  function recordMeta(record) {
    return [
      [record.postal, record.city].filter(Boolean).join(' '),
      record.surface != null ? `${num(record.surface, 1)} m²` : null,
      record.energyConsumption != null ? `${num(record.energyConsumption)} kWh` : null,
      record.date ? `DPE du ${formatDate(record.date)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  function recordBadges(record) {
    const b = [badge(record.energyClass, 'dpe'), badge(record.gesClass, 'ges')].filter(Boolean);
    return b.length ? el('span', { style: 'display:inline-flex;gap:4px;vertical-align:middle;margin-left:6px' }, b) : null;
  }

  function candidateList(rows, title) {
    if (!rows.length) return null;
    return el('div', { class: 'imx-section' }, el('div', { class: 'imx-label' }, title), el('div', { class: 'imx-candidates' }, rows));
  }

  const hasCoords = (o) => o && isFinite(o.lat) && isFinite(o.lon) && o.lat != null && o.lon != null;
  const streetViewButton = (lat, lon, primary) => linkButton(links.streetView(lat, lon), 'Street View', { variant: primary ? '' : 'imx-btn-ghost', iconName: 'eye' });

  // « Carte des candidats » : ouvre une page de l'extension avec tous les candidats
  // numérotés sur un fond OpenStreetMap (onglet ouvert par le service worker).
  function mapButton(points, kind, title, ref) {
    if (points.length < 2) return null;
    const btn = el('button', { class: 'imx-btn imx-btn-block', type: 'button' }, icon('map', 15), `Carte des ${points.length} candidats`);
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      chrome.runtime.sendMessage({ type: 'OPEN_MAP', data: { kind, title, points, ref } }).catch(() => {});
    });
    return btn;
  }

  // ─── Ventes passées (DVF) ───
  // Chargées à la demande : une requête cadastre puis une requête DVF par candidat,
  // affichées sous ses boutons. `ref` porte la surface de l'annonce pour repérer
  // la vente qui lui ressemble (souvent le même logement vendu il y a quelques années).

  const NATURES = {
    "Vente en l'état futur d'achèvement": 'Vente sur plan (VEFA)',
    'Vente terrain à bâtir': 'Terrain à bâtir',
    Echange: 'Échange',
  };

  const closeTo = (value, ref, abs, rel) => value != null && !!ref && Math.abs(value - ref) <= Math.max(abs, ref * rel);

  function saleMatches(sale, ref) {
    if (!ref || !ref.surface) return false;
    if (ref.kind === 'land') return closeTo(sale.terrain, ref.surface, 20, 0.05);
    const home = sale.main.length === 1 ? sale.main[0] : null;
    return !!home && (closeTo(home.surface, ref.surface, 3, 0.07) || closeTo(home.carrez, ref.surface, 3, 0.07));
  }

  function saleDescription(sale) {
    const parts = [];
    if (sale.main.length > 1) parts.push(`${sale.main.length} logements vendus ensemble`);
    else if (sale.main.length === 1) {
      const home = sale.main[0];
      parts.push([home.type, home.surface ? `${num(home.surface)} m²` : null, home.pieces ? `${num(home.pieces)} p.` : null].filter(Boolean).join(' '));
      if (home.carrez && (!home.surface || Math.abs(home.carrez - home.surface) >= 1)) parts.push(`Carrez ${num(home.carrez, 2)} m²`);
      if (home.type === 'Maison' && sale.terrain) parts.push(`terrain ${num(sale.terrain)} m²`);
    } else if (sale.locaux) parts.push(sale.locaux > 1 ? `${sale.locaux} locaux d’activité` : 'Local d’activité');
    else if (sale.terrain) parts.push(`Terrain ${num(sale.terrain)} m²`);
    if (sale.dependances) parts.push(sale.dependances > 1 ? `${sale.dependances} dépendances` : '1 dépendance');
    return parts.join(' · ');
  }

  function saleRow(sale, ref) {
    const match = saleMatches(sale, ref);
    const unit = sale.pricePerM2
      ? `${num(sale.pricePerM2)} €/m²`
      : !sale.main.length && sale.terrain && sale.price
        ? `${num(sale.price / sale.terrain)} €/m² de terrain`
        : null;
    const nature = sale.nature && sale.nature !== 'Vente' ? NATURES[sale.nature] || sale.nature : null;
    return el(
      'div',
      { class: `imx-sale${match ? ' is-match' : ''}` },
      el(
        'div',
        { class: 'imx-sale-head' },
        el('span', { class: 'imx-sale-price' }, sale.price ? `${num(sale.price)} €` : 'prix non publié'),
        el('span', { class: 'imx-meta' }, formatDate(sale.date))
      ),
      el('div', { class: 'imx-meta' }, [saleDescription(sale), unit].filter(Boolean).join(' · ')),
      match || nature
        ? el(
            'div',
            { class: 'imx-sale-tags' },
            match ? el('span', { class: 'imx-tag is-good' }, 'Surface proche de l’annonce') : null,
            nature ? el('span', { class: 'imx-tag' }, nature) : null
          )
        : null
    );
  }

  // Repères de prix : médiane des ventes d'un seul logement du même type, dans la rue et
  // dans la section cadastrale (quelques pâtés de maisons autour de l'adresse).
  function salesBenchmarks(dvf) {
    const what = dvf.type === 'Maison' ? 'maisons' : dvf.type === 'Appartement' ? 'appartements' : 'logements';
    const items = [];
    if (dvf.street) items.push(`rue ${num(dvf.street.median)} €/m² (${dvf.street.count} vente${dvf.street.count > 1 ? 's' : ''})`);
    if (dvf.section) items.push(`secteur ${num(dvf.section.median)} €/m² (${dvf.section.count})`);
    return items.length ? el('div', { class: 'imx-sales-bench', title: 'Secteur : section cadastrale autour de l’adresse' }, `Médiane ${what} : ${items.join(' · ')}`) : null;
  }

  const MAX_SALES = 8;

  function salesPanel(dvf, ref) {
    const years = dvf.period ? `${dvf.period.from.slice(0, 4)}-${dvf.period.to.slice(0, 4)}` : null;
    const rows = dvf.sales.slice(0, MAX_SALES).map((sale) => saleRow(sale, ref));
    const none = dvf.sections && dvf.sections.length ? 'Aucune vente enregistrée à cette adresse sur la période.' : 'Pas de parcelle cadastrale à cet endroit.';
    return el(
      'div',
      { class: 'imx-sales' },
      el('div', { class: 'imx-label' }, `Ventes à cette adresse${years ? ` · ${years}` : ''}`),
      rows.length ? el('div', { class: 'imx-sales-list' }, rows) : el('div', { class: 'imx-meta' }, none),
      dvf.sales.length > MAX_SALES ? el('div', { class: 'imx-meta' }, `+ ${dvf.sales.length - MAX_SALES} ventes plus anciennes`) : null,
      salesBenchmarks(dvf),
      el('div', { class: 'imx-sales-source' }, 'Source : DVF (DGFiP), ventes publiées par Etalab')
    );
  }

  function salesBlock(query, ref, { ghost = false, onChange = null } = {}) {
    const panel = el('div', { class: 'imx-sales-slot' });
    const button = el(
      'button',
      { class: `imx-btn imx-btn-sm${ghost ? ' imx-btn-ghost' : ''}`, type: 'button', 'aria-expanded': 'false', title: 'Ventes enregistrées à cette adresse ces 5 dernières années (DVF)' },
      icon('euro', 14),
      'Ventes passées'
    );
    let state = 'idle';
    const changed = () => onChange && onChange();
    button.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (state === 'loading') return;
      // Second clic : on replie le panneau.
      if (state === 'open') {
        panel.replaceChildren();
        state = 'idle';
        button.setAttribute('aria-expanded', 'false');
        changed();
        return;
      }
      state = 'loading';
      panel.replaceChildren(loading('Recherche des ventes passées…'));
      changed();
      try {
        const res = await chrome.runtime.sendMessage({ type: 'DVF_LOOKUP', query });
        if (!res || !res.ok) throw new Error((res && res.error) || 'pas de réponse');
        panel.replaceChildren(salesPanel(res.dvf, ref));
        state = 'open';
        button.setAttribute('aria-expanded', 'true');
      } catch (e) {
        panel.replaceChildren(alert('Ventes passées indisponibles pour le moment (service DVF injoignable).'));
        state = 'idle';
      }
      changed();
    });
    return { button, panel };
  }

  // Type de logement pour les repères de prix : celui de l'annonce, sinon celui du DPE.
  function homeType(payload, record) {
    const t = String((payload && payload.buildingType) || record.buildingType || '').toLowerCase();
    if (t.includes('maison')) return 'maison';
    if (t.includes('appartement') || t.includes('collectif')) return 'appartement';
    return null;
  }

  const dpeSalesQuery = (record, payload) => ({ lat: record.lat, lon: record.lon, address: record.address || null, type: homeType(payload, record) });

  function dpeResults(result, payload) {
    const candidates = (result && result.candidates) || [];
    if (!candidates.length) {
      return empty(
        result && result.note === 'code postal introuvable'
          ? 'Code postal introuvable pour cette ville. Indique le code postal dans les critères.'
          : 'Aucun logement correspondant dans le registre ADEME. Essaie d’ajuster les critères (surface, classes).'
      );
    }
    const [top, ...others] = candidates;
    const c = confidence(top.score, 'dpe');
    const address = top.record.address || '(adresse inconnue)';
    const ref = { kind: 'dpe', surface: payload && payload.surface ? Number(payload.surface) : null };
    const topSales = hasCoords(top.record) ? salesBlock(dpeSalesQuery(top.record, payload), ref) : null;
    const best = el(
      'div',
      { class: `imx-result is-${c.level}` },
      el('div', { class: 'imx-label' }, 'Adresse la plus probable'),
      el('div', null, el('div', { class: 'imx-address' }, address), el('div', { class: 'imx-meta' }, recordMeta(top.record), recordBadges(top.record))),
      scoreBlock(top.score, 'dpe'),
      el(
        'div',
        { class: 'imx-actions' },
        linkButton(links.gmaps(top.record.address, top.record.postal, top.record.city), 'Voir sur Maps', { variant: 'imx-btn-primary', iconName: 'map' }),
        hasCoords(top.record) ? streetViewButton(top.record.lat, top.record.lon, true) : null,
        top.record.id ? linkButton(links.ademe(top.record.id), 'Fiche ADEME', { iconName: 'file' }) : null,
        topSales ? topSales.button : null,
        copyButton(address)
      ),
      topSales ? topSales.panel : null
    );
    const rows = others.map((alt) => {
      const altAddress = alt.record.address || '(adresse inconnue)';
      const ac = confidence(alt.score, 'dpe');
      const sales = hasCoords(alt.record) ? salesBlock(dpeSalesQuery(alt.record, payload), ref, { ghost: true }) : null;
      return el(
        'div',
        { class: 'imx-candidate' },
        el('div', { class: 'imx-candidate-head' }, el('div', { class: 'imx-candidate-address' }, altAddress), el('span', { class: `imx-pill is-${ac.level}` }, `${alt.score}`)),
        el('div', { class: 'imx-meta' }, recordMeta(alt.record), recordBadges(alt.record)),
        alt.diffs && alt.diffs.length ? el('div', { class: 'imx-diffs' }, `Écarts : ${alt.diffs.join(' ; ')}`) : null,
        el(
          'div',
          { class: 'imx-actions' },
          linkButton(links.gmaps(alt.record.address, alt.record.postal, alt.record.city), 'Maps', { iconName: 'map' }),
          hasCoords(alt.record) ? streetViewButton(alt.record.lat, alt.record.lon, false) : null,
          alt.record.id ? linkButton(links.ademe(alt.record.id), 'ADEME', { variant: 'imx-btn-ghost', iconName: 'file' }) : null,
          sales ? sales.button : null,
          copyButton(altAddress)
        ),
        sales ? sales.panel : null
      );
    });
    const points = candidates
      .map((c, i) => ({ c, n: i + 1 }))
      .filter(({ c }) => hasCoords(c.record))
      .map(({ c, n }) => ({ n, lat: c.record.lat, lon: c.record.lon, label: c.record.address || '(adresse inconnue)', meta: recordMeta(c.record), score: c.score, ademeId: c.record.id || null, type: homeType(payload, c.record) }));
    return el(
      'div',
      { style: 'display:grid;gap:14px' },
      best,
      candidateList(rows, `Autres candidats (${rows.length})`),
      mapButton(points, 'dpe', `${points.length} logements candidats`, ref)
    );
  }

  const landSalesQuery = (parcel) =>
    parcel.idu ? { idu: parcel.idu } : Array.isArray(parcel.centroid) ? { lon: parcel.centroid[0], lat: parcel.centroid[1] } : null;

  function parcelActions(parcel, primary, sales) {
    if (!Array.isArray(parcel.centroid)) return null;
    const [lon, lat] = parcel.centroid;
    return el(
      'div',
      { class: 'imx-actions' },
      linkButton(links.gmapsCoord(lon, lat), primary ? 'Voir sur Maps' : 'Maps', { variant: primary ? 'imx-btn-primary' : '', iconName: 'map' }),
      linkButton(links.geoportail(lon, lat), 'Géoportail', { iconName: 'layers' }),
      streetViewButton(lat, lon, false),
      primary ? linkButton(links.cadastrePhoto(lon, lat), 'Cadastre + photo', { variant: 'imx-btn-ghost' }) : null,
      sales ? sales.button : null
    );
  }

  function parcelMeta(parcel) {
    return [parcel.nom_com, parcel.contenance != null ? `${num(parcel.contenance)} m²` : null, parcel.codeInsee ? `INSEE ${parcel.codeInsee}` : null]
      .filter(Boolean)
      .join(' · ');
  }

  function parcelId(parcel) {
    return [parcel.idu, parcel.section ? `section ${parcel.section}` : null, parcel.numero ? `n° ${parcel.numero}` : null].filter(Boolean).join(' · ');
  }

  function landResults(result, payload) {
    const candidates = (result && result.candidates) || [];
    if (!candidates.length) return empty('Aucune parcelle correspondante dans le cadastre IGN pour ces critères.');
    const [top, ...others] = candidates;
    const c = confidence(top.score, 'land');
    const p = top.parcel;
    const ref = { kind: 'land', surface: payload && payload.surface ? Number(payload.surface) : null };
    const topQuery = landSalesQuery(p);
    const topSales = topQuery ? salesBlock(topQuery, ref) : null;
    const best = el(
      'div',
      { class: `imx-result is-${c.level}` },
      el('div', { class: 'imx-label' }, 'Parcelle la plus probable'),
      el(
        'div',
        null,
        el('div', { class: 'imx-address' }, p.address || p.street || '(adresse approximative)'),
        el('div', { class: 'imx-meta' }, parcelMeta(p)),
        el('div', { class: 'imx-parcel' }, parcelId(p))
      ),
      scoreBlock(top.score, 'land'),
      parcelActions(p, true, topSales),
      topSales ? topSales.panel : null
    );
    const rows = others.map((alt) => {
      const ap = alt.parcel;
      const ac = confidence(alt.score, 'land');
      const altQuery = landSalesQuery(ap);
      const sales = altQuery ? salesBlock(altQuery, ref, { ghost: true }) : null;
      return el(
        'div',
        { class: 'imx-candidate' },
        el('div', { class: 'imx-candidate-head' }, el('div', { class: 'imx-candidate-address' }, ap.address || ap.street || ap.idu || '(parcelle)'), el('span', { class: `imx-pill is-${ac.level}` }, `${alt.score}`)),
        el('div', { class: 'imx-meta' }, parcelMeta(ap)),
        el('div', { class: 'imx-parcel' }, parcelId(ap)),
        parcelActions(ap, false, sales),
        sales ? sales.panel : null
      );
    });
    const points = candidates
      .map((c, i) => ({ c, n: i + 1 }))
      .filter(({ c }) => Array.isArray(c.parcel.centroid))
      .map(({ c, n }) => ({ n, lon: c.parcel.centroid[0], lat: c.parcel.centroid[1], label: c.parcel.address || c.parcel.street || c.parcel.idu || '(parcelle)', meta: parcelMeta(c.parcel), score: c.score, idu: c.parcel.idu || null }));
    return el(
      'div',
      { style: 'display:grid;gap:14px' },
      best,
      candidateList(rows, `Autres parcelles (${rows.length})`),
      mapButton(points, 'land', `${points.length} parcelles candidates`, ref)
    );
  }

  // ─── Suivi des biens : parutions précédentes du même bien ───

  const LEVEL_LABEL = { same: 'même DPE', probable: 'très probable', possible: 'à vérifier' };
  const day = (ts) => {
    const d = new Date(ts);
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  };
  const priceText = (n) => (n ? `${num(n)} €` : 'prix non lu');

  // Évolution du prix sur toutes les parutions sûres : du plus ancien au plus récent.
  function priceTrend(ownPrices, sureMatches) {
    const all = [...sureMatches.flatMap((m) => m.prices || []), ...(ownPrices || [])].filter((p) => p && p.price).sort((x, y) => x.at - y.at);
    if (all.length < 2) return null;
    const first = all[0];
    const last = ownPrices && ownPrices.length ? ownPrices[ownPrices.length - 1] : all[all.length - 1];
    if (first.price === last.price) return null;
    const pct = ((last.price - first.price) / first.price) * 100;
    return `Prix : ${priceText(first.price)} le ${day(first.at)} → ${priceText(last.price)} (${pct > 0 ? '+' : '−'}${num(Math.abs(pct), 1)} %)`;
  }

  function sightings(data) {
    if (!data || !data.sighting) return null;
    const matches = data.matches || [];
    const sure = matches.filter((m) => m.level !== 'possible');
    const maybe = matches.filter((m) => m.level === 'possible');
    const trend = priceTrend(data.sighting.prices, sure);
    if (!sure.length && !maybe.length && !trend) return null;
    const row = (m) =>
      el(
        'div',
        { class: 'imx-candidate' },
        el(
          'div',
          { class: 'imx-candidate-head' },
          el('div', { class: 'imx-candidate-address' }, `${day(m.firstSeen)} · ${m.site || 'annonce'}`),
          el('span', { class: `imx-pill is-${m.level === 'possible' ? 'mid' : 'good'}` }, LEVEL_LABEL[m.level])
        ),
        el('div', { class: 'imx-meta' }, [priceText(m.price), m.address].filter(Boolean).join(' · ')),
        el('div', { class: 'imx-actions' }, linkButton(m.url, 'Voir l’annonce', { iconName: 'external' }))
      );
    const title = sure.length
      ? `Déjà vu dans ${sure.length} autre${sure.length > 1 ? 's' : ''} annonce${sure.length > 1 ? 's' : ''}`
      : maybe.length
        ? 'Peut-être déjà vu (à vérifier sur les photos)'
        : 'Historique du prix';
    return el(
      'div',
      { class: 'imx-section imx-seen' },
      el('div', { class: 'imx-label' }, title),
      trend ? message('notice', 'repeat', trend) : null,
      el('div', { class: 'imx-candidates' }, [...sure, ...maybe].slice(0, 6).map(row))
    );
  }

  // ─── Sélecteur de lettre (classe énergie ou GES) ───

  function letterPicker(scale, initial, onChange) {
    let value = initial || '';
    const buttons = [];
    const render = () => {
      for (const b of buttons) {
        const selected = b.dataset.letter === value;
        b.classList.toggle('is-selected', selected);
        b.setAttribute('aria-pressed', String(selected));
        b.className = b.className.replace(/\bimx-(dpe|ges)-[A-G]\b/g, '').trim();
        if (selected && value) b.classList.add(`imx-${scale}-${value}`);
      }
    };
    for (const letter of ['', 'A', 'B', 'C', 'D', 'E', 'F', 'G']) {
      const b = el(
        'button',
        { type: 'button', class: `imx-letter${letter ? '' : ' is-none'}`, 'data-letter': letter, title: letter ? `Classe ${letter}` : 'Inconnue' },
        letter || '?'
      );
      b.addEventListener('click', () => {
        value = letter;
        render();
        if (onChange) onChange(value);
      });
      buttons.push(b);
    }
    const node = el('div', { class: 'imx-letters', role: 'group' }, buttons);
    render();
    return {
      node,
      get value() {
        return value;
      },
      set value(v) {
        value = v || '';
        render();
      },
    };
  }

  window.__immodexUI = {
    el,
    icon,
    links,
    num,
    formatDate,
    formatDateTime,
    formatRangeInput,
    datasetLabel: (d) => DATASETS[d] || d || 'registre ADEME',
    badge,
    criteria,
    confidence,
    notice,
    alert,
    empty,
    loading,
    dpeResults,
    landResults,
    salesBlock,
    castorusButton,
    letterPicker,
    linkButton,
    sightings,
    priceText,
    day,
  };
})();
