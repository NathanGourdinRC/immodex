// Ligne « Leboncoin » en haut du Fil : où en est la lecture automatique de 10 h (src/background/
// lbc-tour-runner.js), avec de quoi la couper ou la lancer tout de suite.
import { tourText } from '../common/lbc-tour.js';

const UI = window.__immodexUI;
const { el } = UI;

export function lbcTourLine() {
  const text = el('span');
  const toggle = el('button', { type: 'button', class: 'imx-btn imx-btn-sm imx-btn-ghost' });
  const now = el('button', { type: 'button', class: 'imx-btn imx-btn-sm imx-btn-ghost' }, 'Lire maintenant');
  const line = el('div', { class: 'imx-meta imx-lbc-line imx-hidden', style: 'margin:0 0 6px; display:flex; flex-wrap:wrap; align-items:center; gap:8px' }, text, toggle, now);
  let status = null;
  const draw = (s) => {
    status = s;
    text.textContent = tourText(s);
    toggle.textContent = s.enabled ? 'Désactiver' : 'Activer';
    now.classList.toggle('imx-hidden', !s.enabled || (s.tour && s.tour.status === 'running'));
    line.classList.remove('imx-hidden');
  };
  const ask = async (message) => {
    try {
      const res = await chrome.runtime.sendMessage(message);
      if (res && res.ok && res.status) draw(res.status);
    } catch {
      // service worker injoignable : la ligne reste cachée
    }
  };
  toggle.addEventListener('click', () => ask({ type: 'LBC_TOUR_SET', enabled: !(status && status.enabled) }));
  now.addEventListener('click', () => ask({ type: 'LBC_TOUR_RUN_NOW' }));
  ask({ type: 'LBC_TOUR_STATUS' });
  return line;
}
