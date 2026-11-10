// Ligne d'état d'une lecture automatique en haut du Fil (Leboncoin, SeLoger) : où en est la tournée
// quotidienne du service worker, avec de quoi la couper ou la lancer tout de suite.
const UI = window.__immodexUI;
const { el } = UI;

// Version de l'extension qui porte les tournées : un silence du service worker veut dire qu'elle n'a
// pas été rechargée depuis la mise à jour.
export const EXPECTED_VERSION = '0.30.0';

// `site` : « Leboncoin », « SeLoger » ; `messages` : { status, set, run } (types de messages du service
// worker) ; `tourText` : la phrase d'état, à partir de la réponse du service worker.
export function tourLine({ site, messages, tourText }) {
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
  // Sur l'appli téléphone (pas de fenêtres Chrome) la tournée n'existe pas : la ligne reste cachée.
  const unreachable = () => {
    if (!(chrome.windows && chrome.windows.create)) return;
    text.textContent = `${site} : lecture automatique injoignable. Recharge l’extension dans chrome://extensions (version ${EXPECTED_VERSION} attendue), puis rouvre le Fil.`;
    toggle.classList.add('imx-hidden');
    now.classList.add('imx-hidden');
    line.classList.remove('imx-hidden');
  };
  const ask = async (message) => {
    try {
      const res = await chrome.runtime.sendMessage(message);
      if (res && res.ok && res.status) {
        toggle.classList.remove('imx-hidden');
        draw(res.status);
      } else unreachable();
    } catch {
      unreachable();
    }
  };
  toggle.addEventListener('click', () => ask({ type: messages.set, enabled: !(status && status.enabled) }));
  now.addEventListener('click', () => ask({ type: messages.run }));
  ask({ type: messages.status });
  return line;
}
