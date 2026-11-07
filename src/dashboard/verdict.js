// Garder ou écarter un bien, au doigt comme à la souris : la même paire de boutons sert dans la
// carte du Fil et dans la bulle de son point sur la carte. Les biens écartés sont cachés partout
// (Fil et carte) ; un bouton les montre, en gris. Ce choix vaut pour toute la page et n'est pas
// gardé : chaque ouverture repart avec les écartés cachés.
const UI = window.__immodexUI;
const { el, icon } = UI;

// Paire Garder / Écarter. Un second appui annule (un bien écarté par erreur revient ainsi).
// `onPick(statut)` enregistre ; `apply(statut)` remet les boutons à jour (choix fait ailleurs).
function verdictButtons(onPick) {
  const keep = el('button', { type: 'button', class: 'imx-btn imx-btn-sm imx-verdict-keep', 'aria-pressed': 'false' }, icon('check', 14), 'Garder');
  const drop = el('button', { type: 'button', class: 'imx-btn imx-btn-sm imx-btn-ghost imx-verdict-drop', 'aria-pressed': 'false' }, icon('trash', 14), 'Écarter');
  let current = null;
  const apply = (status) => {
    current = status || null;
    keep.classList.toggle('is-active', current === 'favori');
    drop.classList.toggle('is-active', current === 'ecarte');
    keep.setAttribute('aria-pressed', String(current === 'favori'));
    drop.setAttribute('aria-pressed', String(current === 'ecarte'));
    keep.lastChild.textContent = current === 'favori' ? 'Gardé' : 'Garder';
    drop.lastChild.textContent = current === 'ecarte' ? 'Écarté' : 'Écarter';
  };
  keep.addEventListener('click', () => onPick(current === 'favori' ? null : 'favori'));
  drop.addEventListener('click', () => onPick(current === 'ecarte' ? null : 'ecarte'));
  return { node: el('div', { class: 'imx-actions imx-verdict' }, keep, drop), apply };
}

// ─── Écartés montrés ou cachés (classe imx-show-ecarte sur body, styles dans dashboard.html) ───

let shown = false;
const listeners = new Set();

const droppedShown = () => shown;

// Prévient les boutons « écartées » (Fil, carte) : état changé ou nombre d'écartés changé.
function droppedChanged() {
  for (const fn of [...listeners]) fn(shown);
}

function setDroppedShown(value) {
  shown = !!value;
  document.body.classList.toggle('imx-show-ecarte', shown);
  droppedChanged();
}

// `alive()` faux (autre recherche ouverte depuis) : l'écouteur est oublié.
function onDroppedChange(fn, alive = () => true) {
  const wrapped = (v) => (alive() ? fn(v) : listeners.delete(wrapped));
  listeners.add(wrapped);
}

// Bouton d'une liste : « Afficher les écartées (n) » ou « Masquer les écartées ».
function droppedToggle(count, alive) {
  const button = el('button', { type: 'button', class: 'imx-btn imx-btn-sm imx-btn-ghost' });
  const refresh = () => {
    const n = count();
    button.textContent = shown ? 'Masquer les écartées' : `Afficher les écartées (${n})`;
    button.classList.toggle('imx-hidden', !n && !shown);
  };
  button.addEventListener('click', () => setDroppedShown(!shown));
  onDroppedChange(refresh, alive);
  refresh();
  return button;
}

export { verdictButtons, droppedShown, droppedChanged, setDroppedShown, onDroppedChange, droppedToggle };
