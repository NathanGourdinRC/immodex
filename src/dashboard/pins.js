// Points des biens sur la carte, comme sur Airbnb : le prix court sur le point ; survoler la
// carte d'un bien dans le Fil met son point en avant, cliquer dessus centre la carte sur lui et
// ouvre sa bulle (sur un téléphone, la vue Carte s'ouvre d'abord). Bulle ouverte = point et
// carte du Fil mis en avant.
import { shortPrice } from '../common/listings.js';

// Clic sur un bouton, un lien, une note ou un menu de la carte du Fil : ce geste-là seulement.
const INTERACTIVE = 'button, a, input, textarea, select, label';

function priceIcon(price, status) {
  return L.divIcon({ className: 'imx-price-pin-wrap', html: `<div class="imx-price-pin is-${status || 'aucun'}">${shortPrice(price) || 'prix ?'}</div>`, iconSize: null });
}

const pinOf = (marker) => (marker.getElement() ? marker.getElement().querySelector('.imx-price-pin') : null);

function setRowSelected(row, on) {
  if (on) document.querySelectorAll('.imx-row.is-selected').forEach((r) => r !== row && r.classList.remove('is-selected'));
  row.classList.toggle('is-selected', on);
  // Bulle ouverte depuis la carte (ordinateur) : la carte du bien rejoint l'écran.
  if (on && row.offsetParent && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
}

// Place un bien sur la carte et le relie à sa carte du Fil. `focus(id)` centre la carte et
// ouvre la bulle (dashboard.js). Rend le marqueur.
function placeListing({ layer, markers, id, lat, lon, price, status, title, popup, row, focus }) {
  const marker = L.marker([lat, lon], { icon: priceIcon(price, status), title: title || '' });
  marker.bindPopup(popup, { maxWidth: 320 });
  marker.on('popupopen', () => {
    const pin = pinOf(marker);
    if (pin) pin.classList.add('is-selected');
    marker.setZIndexOffset(1000);
    if (row) setRowSelected(row, true);
  });
  marker.on('popupclose', () => {
    const pin = pinOf(marker);
    if (pin) pin.classList.remove('is-selected');
    marker.setZIndexOffset(0);
    if (row) setRowSelected(row, false);
  });
  layer.addLayer(marker);
  markers.set(id, marker);
  if (row) {
    row.classList.add('is-placed');
    row.addEventListener('click', (e) => {
      if (e.target.closest(INTERACTIVE)) return;
      focus(id);
    });
    row.addEventListener('mouseenter', () => pinOf(marker) && pinOf(marker).classList.add('is-hover'));
    row.addEventListener('mouseleave', () => pinOf(marker) && pinOf(marker).classList.remove('is-hover'));
  }
  return marker;
}

export { placeListing, priceIcon };
