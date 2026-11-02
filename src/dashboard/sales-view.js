// Vue « Ventes passées » d'une recherche : les ventes DVF de ses communes (5 ans), avec prix
// au m², terrain et dépendance, les plus récentes d'abord, et un filtre sur les ventes
// comparables aux critères de la recherche.
import { loadSearchSales } from './sector-layer.js';
import { isComparable } from '../common/sectors.js';

const UI = window.__immodexUI;
const { el, num } = UI;
const PAGE = 50;
const DEPENDANCE_HELP = 'Garage, cave ou abri vendu avec le bien. Un garage intégré à la maison n’apparaît souvent pas.';

function saleRow(v) {
  return el(
    'tr',
    null,
    el('td', null, v.date ? UI.formatDate(v.date) : ''),
    el('td', null, v.address || ''),
    el('td', { class: 'is-num' }, v.price ? UI.priceText(v.price) : ''),
    el('td', { class: 'is-num' }, v.surface ? `${num(v.surface)} m²` : ''),
    el('td', { class: 'is-num' }, `${num(v.pricePerM2)}`),
    el('td', { class: 'is-num' }, v.terrain ? `${num(v.terrain)} m²` : ''),
    // « oui » quand DVF signale une dépendance ; jamais « non » : DVF ne le sait pas.
    el('td', null, v.dependances ? 'oui' : '')
  );
}

async function renderSalesView({ search, isCurrent, body, panel }) {
  const content = el('div', null, UI.loading('Lecture des ventes DVF…'));
  body.replaceChildren(panel('Ventes passées', content).node);
  let data;
  try {
    data = await loadSearchSales(search);
  } catch {
    if (isCurrent()) content.replaceChildren(UI.alert('Ventes DVF injoignables pour le moment.'));
    return;
  }
  if (!isCurrent()) return;
  if (!data.sales.length) {
    content.replaceChildren(UI.empty('Aucune vente DVF pour ces communes (l’Alsace, la Moselle et Mayotte n’y figurent pas).'));
    return;
  }

  const sorted = [...data.sales].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const comparables = sorted.filter((v) => isComparable(v, search));
  let onlyComparable = false;
  let shown = 0;
  const tbody = el('tbody');
  const more = el('button', { type: 'button', class: 'imx-btn imx-btn-block' });
  const current = () => (onlyComparable ? comparables : sorted);
  const showMore = () => {
    const list = current();
    list.slice(shown, shown + PAGE).forEach((v) => tbody.appendChild(saleRow(v)));
    shown = Math.min(list.length, shown + PAGE);
    more.textContent = `Afficher ${PAGE} de plus (${list.length - shown} restantes)`;
    more.classList.toggle('imx-hidden', shown >= list.length);
  };
  const reset = () => {
    tbody.replaceChildren();
    shown = 0;
    showMore();
  };
  more.addEventListener('click', showMore);

  const filter = el('input', { type: 'checkbox' });
  filter.addEventListener('change', () => {
    onlyComparable = filter.checked;
    reset();
  });
  const head = (label, title) => el('th', title ? { title } : null, label);
  const table = el(
    'table',
    { class: 'imx-sales-table' },
    el('thead', null, el('tr', null, head('Date'), head('Rue'), head('Prix'), head('Surface'), head('€/m²'), head('Terrain'), head('Dépendance', DEPENDANCE_HELP))),
    tbody
  );
  const medians = {};
  for (const v of data.sales) (medians[v.commune] = medians[v.commune] || []).push(v.pricePerM2);
  const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  const names = Object.fromEntries(search.communes.map((c) => [c.code, c.nom]));
  content.replaceChildren(
    el(
      'p',
      { class: 'imx-meta', style: 'margin:0 0 6px' },
      `${num(data.sales.length)} ventes sur 5 ans. Médiane : ${Object.entries(medians)
        .map(([code, list]) => `${names[code] || code} ${num(median(list))} €/m²`)
        .join(', ')}.`,
      data.lastDate ? ` Ventes connues jusqu’au ${UI.formatDate(data.lastDate)}.` : ''
    ),
    el('label', { class: 'imx-check' }, filter, ` Comparables à ma recherche seulement (${num(comparables.length)} sur ${num(sorted.length)})`),
    el('div', { class: 'imx-table-wrap' }, table),
    more
  );
  showMore();
}

export { renderSalesView };
