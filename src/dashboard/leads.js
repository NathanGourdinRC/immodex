// Biens sans point sur la carte : les pistes d'adresse du robot (logements du registre des DPE
// proches de l'annonce, api/_lib/address.js), que Nathan vérifie sur Street View avant de
// choisir la bonne, ou l'adresse qu'il a trouvée lui-même, cherchée dans la Base Adresse
// Nationale. Le choix est rangé avec le suivi du bien (synchronisé entre Chrome et le téléphone).
import { banSearch } from '../common/geo.js';

const UI = window.__immodexUI;
const { el, icon, num } = UI;

const STRENGTHS = [
  [80, 'piste forte', 'good'],
  [50, 'piste moyenne', 'mid'],
  [0, 'piste faible', 'low'],
];
const strengthOf = (score) => STRENGTHS.find(([min]) => (score || 0) >= min);

function leadMeta(lead) {
  return [
    lead.surface ? `logement de ${num(lead.surface)} m²` : null,
    lead.date ? `DPE du ${UI.formatDate(lead.date)}` : null,
    lead.count > 1 ? `${lead.count} logements à cette adresse` : null,
    // Registre sans numéro : le point est au milieu de la rue, la façade est à chercher.
    /^\d/.test(lead.address) ? null : 'numéro absent du registre, Street View au milieu de la rue',
  ]
    .filter(Boolean)
    .join(' · ');
}

function leadRow(lead, onPlace) {
  const [, label, level] = strengthOf(lead.score);
  const pick = el('button', { type: 'button', class: 'imx-btn imx-btn-sm imx-btn-primary' }, icon('check', 14), 'C’est ici');
  pick.addEventListener('click', () => onPlace({ address: lead.address, lat: lead.lat, lon: lead.lon, by: 'piste' }));
  return el(
    'div',
    { class: 'imx-candidate imx-lead' },
    el('div', { class: 'imx-candidate-head' }, el('div', { class: 'imx-candidate-address' }, lead.address), el('span', { class: `imx-pill is-${level}` }, label)),
    el('div', { class: 'imx-meta' }, leadMeta(lead)),
    lead.diffs && lead.diffs.length ? el('div', { class: 'imx-diffs' }, `Écarts avec l’annonce : ${lead.diffs.join(' ; ')}`) : null,
    el('div', { class: 'imx-actions' }, UI.linkButton(UI.links.streetView(lead.lat, lead.lon), 'Street View', { iconName: 'eye' }), pick)
  );
}

// Adresse trouvée par Nathan (Street View, visite, agence) : cherchée dans la commune du bien.
function manualRow({ insee, communeName, address, onPlace }) {
  const input = el('input', { type: 'text', class: 'imx-input', placeholder: `Autre adresse à ${communeName} (ex. 12 rue Victor Hugo)`, maxlength: '150', enterkeyhint: 'go', 'aria-label': 'Adresse du bien' });
  // Adresse connue du registre mais sans coordonnées : proposée, un clic sur « Placer » suffit.
  if (address) input.value = address;
  const go = el('button', { type: 'button', class: 'imx-btn imx-btn-sm' }, icon('pin', 14), 'Placer');
  const message = el('div', { class: 'imx-meta imx-unknown imx-hidden' });
  const say = (text) => {
    message.textContent = text;
    message.classList.toggle('imx-hidden', !text);
  };
  const submit = async () => {
    if (!input.value.trim()) return;
    go.disabled = true;
    say('');
    try {
      const found = await banSearch(input.value, insee);
      if (found) await onPlace({ ...found, by: 'saisie' });
      else say(`Adresse introuvable à ${communeName} : vérifie le numéro et le nom de la rue.`);
    } catch {
      say('Service des adresses injoignable pour le moment, réessaie plus tard.');
    } finally {
      go.disabled = false;
    }
  };
  go.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  return el('div', { class: 'imx-lead-manual' }, el('div', { class: 'imx-lead-input' }, input, go), message);
}

// Bloc « Où est ce bien ? » d'une carte du Fil, replié tant qu'on ne l'ouvre pas.
function leadsBlock({ leads, hasDpe, pending, address, insee, communeName, onPlace }) {
  const list = leads || [];
  const none = el('button', { type: 'button', class: 'imx-btn imx-btn-sm imx-btn-ghost' }, 'Je ne le trouve pas');
  none.addEventListener('click', () => onPlace({ none: true }));
  const intro = list.length
    ? 'Logements du registre des DPE qui ressemblent à l’annonce : compare la façade sur Street View avec les photos de l’annonce.'
    : address
      ? 'Adresse retrouvée dans le registre des DPE, mais sans coordonnées : vérifie-la sur Street View, puis « Placer ».'
      : pending
        ? 'Le robot cherche les pistes de ce bien à son prochain passage (la nuit). En attendant, si tu trouves la maison sur Street View, saisis son adresse.'
        : hasDpe
      ? 'Aucun logement du registre des DPE ne ressemble assez à l’annonce. Si tu trouves la maison sur Street View, saisis son adresse.'
      : 'L’annonce ne donne pas les chiffres de son DPE : pas de piste dans le registre. Si tu trouves la maison sur Street View, saisis son adresse.';
  return el(
    'details',
    { class: 'imx-leads' },
    el('summary', null, icon('pin', 14), list.length ? `Où est ce bien ? ${list.length} piste${list.length > 1 ? 's' : ''} à vérifier` : 'Où est ce bien ? Saisis son adresse'),
    el('div', { class: 'imx-meta' }, intro),
    list.length ? el('div', { class: 'imx-lead-list' }, list.map((lead) => leadRow(lead, onPlace))) : null,
    manualRow({ insee, communeName, address, onPlace }),
    el('div', { class: 'imx-actions' }, none)
  );
}

// Ligne d'état d'un bien placé à la main (ou laissé sans point), avec retour en arrière.
function placedLine(place, onPlace) {
  const undo = el('button', { type: 'button', class: 'imx-link' }, place.none ? 'Reprendre' : 'Annuler');
  undo.addEventListener('click', () => onPlace(null));
  const text = place.none ? 'introuvable, laissé sans point sur la carte' : `${place.address} · adresse ${place.by === 'saisie' ? 'saisie' : 'choisie'} par toi`;
  return el('div', { class: 'imx-meta imx-placed-by-you' }, text, ' · ', undo);
}

export { leadsBlock, placedLine };
