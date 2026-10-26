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
    repeat: ['M17 2l4 4-4 4', 'M3 11V9a3 3 0 0 1 3-3h15', 'M7 22l-4-4 4-4', 'M21 13v2a3 3 0 0 1-3 3H3'],
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
  function copyButton(text) {
    const btn = el('button', { class: 'imx-btn imx-btn-sm imx-btn-icon', type: 'button', title: 'Copier l’adresse', 'aria-label': 'Copier l’adresse' }, icon('copy', 14));
    btn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const area = el('textarea', { style: 'position:fixed;opacity:0' }, text);
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
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

  function dpeResults(result) {
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
        top.record.id ? linkButton(links.ademe(top.record.id), 'Fiche ADEME', { iconName: 'file' }) : null,
        copyButton(address)
      )
    );
    const rows = others.map((alt) => {
      const altAddress = alt.record.address || '(adresse inconnue)';
      const ac = confidence(alt.score, 'dpe');
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
          alt.record.id ? linkButton(links.ademe(alt.record.id), 'ADEME', { variant: 'imx-btn-ghost', iconName: 'file' }) : null,
          copyButton(altAddress)
        )
      );
    });
    return el('div', { style: 'display:grid;gap:14px' }, best, candidateList(rows, `Autres candidats (${rows.length})`));
  }

  function parcelActions(parcel, primary) {
    if (!Array.isArray(parcel.centroid)) return null;
    const [lon, lat] = parcel.centroid;
    return el(
      'div',
      { class: 'imx-actions' },
      linkButton(links.gmapsCoord(lon, lat), primary ? 'Voir sur Maps' : 'Maps', { variant: primary ? 'imx-btn-primary' : '', iconName: 'map' }),
      linkButton(links.geoportail(lon, lat), 'Géoportail', { iconName: 'layers' }),
      primary ? linkButton(links.cadastrePhoto(lon, lat), 'Cadastre + photo', { variant: 'imx-btn-ghost' }) : null
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

  function landResults(result) {
    const candidates = (result && result.candidates) || [];
    if (!candidates.length) return empty('Aucune parcelle correspondante dans le cadastre IGN pour ces critères.');
    const [top, ...others] = candidates;
    const c = confidence(top.score, 'land');
    const p = top.parcel;
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
      parcelActions(p, true)
    );
    const rows = others.map((alt) => {
      const ap = alt.parcel;
      const ac = confidence(alt.score, 'land');
      return el(
        'div',
        { class: 'imx-candidate' },
        el('div', { class: 'imx-candidate-head' }, el('div', { class: 'imx-candidate-address' }, ap.address || ap.street || ap.idu || '(parcelle)'), el('span', { class: `imx-pill is-${ac.level}` }, `${alt.score}`)),
        el('div', { class: 'imx-meta' }, parcelMeta(ap)),
        el('div', { class: 'imx-parcel' }, parcelId(ap)),
        parcelActions(ap, false)
      );
    });
    return el('div', { style: 'display:grid;gap:14px' }, best, candidateList(rows, `Autres parcelles (${rows.length})`));
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
    letterPicker,
    linkButton,
    sightings,
    priceText,
    day,
  };
})();
