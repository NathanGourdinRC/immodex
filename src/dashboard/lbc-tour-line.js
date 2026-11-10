// Ligne « Leboncoin » en haut du Fil : la lecture guidée (src/background/lbc-tour-runner.js). Un clic
// sur « Lire la suivante » ouvre la recherche suivante dans ton Chrome ; l'extension lit ce qui s'affiche.
import { guidedText } from '../common/lbc-tour.js';
import { EXPECTED_VERSION } from './tour-line.js';

const UI = window.__immodexUI;
const { el } = UI;

export function lbcTourLine() {
  const text = el('span');
  const next = el('button', { type: 'button', class: 'imx-btn imx-btn-sm imx-btn-ghost' }, 'Lire la suivante');
  const line = el('div', { class: 'imx-meta imx-lbc-line imx-hidden', style: 'margin:0 0 6px; display:flex; flex-wrap:wrap; align-items:center; gap:8px' }, text, next);
  const draw = (s) => {
    text.textContent = guidedText(s);
    // Plus rien à lire aujourd'hui, ou aucune commune suivie : pas de bouton.
    next.classList.toggle('imx-hidden', !s.total || !s.next);
    next.textContent = s.waiting ? 'Relire la page' : 'Lire la suivante';
    next.disabled = false;
    line.classList.remove('imx-hidden');
  };
  // Sur l'appli téléphone (pas d'onglets Chrome) la lecture guidée n'existe pas : la ligne reste cachée.
  const unreachable = () => {
    if (!(chrome.windows && chrome.windows.create)) return;
    text.textContent = `Leboncoin : lecture guidée injoignable. Recharge l’extension dans chrome://extensions (version ${EXPECTED_VERSION} attendue), puis rouvre le Fil.`;
    next.classList.add('imx-hidden');
    line.classList.remove('imx-hidden');
  };
  const ask = async (message) => {
    try {
      const res = await chrome.runtime.sendMessage(message);
      if (res && res.ok && res.status) draw(res.status);
      else unreachable();
    } catch {
      unreachable();
    }
  };
  next.addEventListener('click', () => {
    // La page met quelques secondes à s'ouvrir et à être lue : un seul clic à la fois.
    next.disabled = true;
    text.textContent = 'Leboncoin : ouverture de la recherche…';
    ask({ type: 'LBC_GUIDED_NEXT' });
  });
  ask({ type: 'LBC_GUIDED_STATUS' });
  return line;
}
