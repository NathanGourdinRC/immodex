// Carte des candidats : tous les logements (ou parcelles) proposés pour une annonce,
// numérotés dans l'ordre du score, pour juger d'un coup d'œil lequel correspond au
// quartier décrit. Les données arrivent dans l'ancre de l'adresse (#…), en JSON.
const UI = window.__immodexUI;
const { el, icon } = UI;

document.getElementById('logo').appendChild(icon('map', 17));

let data = { title: '', kind: 'dpe', points: [] };
try {
  data = JSON.parse(decodeURIComponent(location.hash.slice(1)));
} catch {
  // ancre illisible : carte vide
}
const points = (data.points || []).filter((p) => isFinite(p.lat) && isFinite(p.lon));
document.getElementById('subtitle').textContent = data.title || `${points.length} candidat(s)`;

const map = L.map('map', { zoomControl: true });
L.control.layers(window.__immodexTiles.addBaseLayers(map), null, { collapsed: false }).addTo(map);

let firstMarker = null;
for (const p of points) {
  const level = UI.confidence(p.score, data.kind).level;
  const marker = L.marker([p.lat, p.lon], {
    icon: L.divIcon({ className: '', html: `<div class="imx-pin is-${level}"><span>${p.n}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28] }),
    title: `${p.n}. ${p.label}`,
  }).addTo(map);
  // Ventes passées : la bulle grandit quand le panneau s'ouvre, Leaflet la recadre.
  const query = data.kind === 'land' ? (p.idu ? { idu: p.idu } : { lat: p.lat, lon: p.lon }) : { lat: p.lat, lon: p.lon, address: p.label, type: p.type || null };
  const sales = UI.salesBlock(query, data.ref || null, { onChange: () => marker.getPopup() && marker.getPopup().update() });
  const content = el(
    'div',
    { style: 'display:grid;gap:8px' },
    el('div', { class: 'imx-candidate-address' }, `${p.n}. ${p.label}`),
    p.meta ? el('div', { class: 'imx-meta' }, p.meta) : null,
    el('span', { class: `imx-pill is-${level}` }, `${UI.confidence(p.score, data.kind).label} · ${p.score}/100`),
    el(
      'div',
      { class: 'imx-actions' },
      UI.linkButton(UI.links.gmapsCoord(p.lon, p.lat), 'Maps', { iconName: 'map' }),
      UI.linkButton(UI.links.streetView(p.lat, p.lon), 'Street View', { iconName: 'eye' }),
      p.ademeId ? UI.linkButton(UI.links.ademe(p.ademeId), 'ADEME', { variant: 'imx-btn-ghost', iconName: 'file' }) : null,
      sales.button
    ),
    sales.panel
  );
  marker.bindPopup(content, { maxWidth: 340, maxHeight: 460 });
  if (p.n === 1) firstMarker = marker;
}

// Cadrage d'abord, puis bulle du meilleur candidat (un déplacement de la carte la refermerait).
if (points.length) map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lon])).pad(0.25), { maxZoom: 17 });
else map.setView([50.6292, 3.0573], 12);
if (firstMarker) firstMarker.openPopup();
