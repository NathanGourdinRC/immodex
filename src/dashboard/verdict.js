// Garder ou écarter un bien, au doigt comme à la souris : la même paire de boutons sert dans la
// carte du Fil et dans la bulle de son point sur la carte. Les biens écartés sont cachés partout
// (Fil et carte) ; un bouton les montre, en gris. Ce choix vaut pour toute la page et n'est pas
// gardé : chaque ouverture repart avec les écartés cachés.
const UI = window.__immodexUI;
const { el, icon } = UI;

// Garder / Écarter, et Trop cher quand le bien a un prix. Un second appui annule (un bien écarté
// par erreur revient ainsi). « Écarter » : pas pertinent, le bien ne revient jamais. « Trop cher » :
// il revient dans le Fil quand son prix baisse de 2 % (zones.js, returnedByPrice).
// `onPick(statut, raison)` enregistre : raison 'prix' pour « Trop cher », rien sinon.
// `apply(statut)` remet les boutons à jour (choix fait ailleurs) : null, 'favori', 'ecarte' ou
// 'ecarte-prix' (écarté parce que trop cher).
function verdictButtons(onPick, { price = false } = {}) {
  const keep = el('button', { type: 'button', class: 'imx-btn imx-btn-sm imx-verdict-keep', 'aria-pressed': 'false' }, icon('check', 14), 'Garder');
  const drop = el('button', { type: 'button', class: 'imx-btn imx-btn-sm imx-btn-ghost imx-verdict-drop', 'aria-pressed': 'false', title: 'Pas pertinent : ce bien ne reviendra pas' }, icon('trash', 14), 'Écarter');
  const dear = price
    ? el('button', { type: 'button', class: 'imx-btn imx-btn-sm imx-btn-ghost imx-verdict-dear', 'aria-pressed': 'false', title: 'Trop cher : ce bien reviendra si son prix baisse de 2 %' }, icon('euro', 14), 'Trop cher')
    : null;
  let current = null;
  const apply = (status) => {
    current = status || null;
    keep.classList.toggle('is-active', current === 'favori');
    drop.classList.toggle('is-active', current === 'ecarte');
    keep.setAttribute('aria-pressed', String(current === 'favori'));
    drop.setAttribute('aria-pressed', String(current === 'ecarte'));
    keep.lastChild.textContent = current === 'favori' ? 'Gardé' : 'Garder';
    drop.lastChild.textContent = current === 'ecarte' ? 'Écarté' : 'Écarter';
    if (dear) {
      dear.classList.toggle('is-active', current === 'ecarte-prix');
      dear.setAttribute('aria-pressed', String(current === 'ecarte-prix'));
      dear.lastChild.textContent = current === 'ecarte-prix' ? 'Écarté, trop cher' : 'Trop cher';
    }
  };
  keep.addEventListener('click', () => onPick(current === 'favori' ? null : 'favori'));
  drop.addEventListener('click', () => onPick(current === 'ecarte' ? null : 'ecarte'));
  if (dear) dear.addEventListener('click', () => (current === 'ecarte-prix' ? onPick(null) : onPick('ecarte', 'prix')));
  return { node: el('div', { class: 'imx-actions imx-verdict' }, keep, drop, dear), apply };
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
