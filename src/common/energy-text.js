// Textes des repères « classe énergie » (prix au m² médian par classe, délai DPE → vente).

const MONTH_DAYS = 30.44;
const months = (days) => Math.max(1, Math.round(days / MONTH_DAYS));

// « Classe D à Wambrechies : 3 379 €/m² médian (82 ventes) », ou null sans statistique.
function classLine(energyClass, insee, energy, communeName, num) {
  const stats = energy && energy[insee] && energy[insee].byClass ? energy[insee].byClass[energyClass] : null;
  if (!energyClass || !stats) return null;
  return `Classe ${energyClass} à ${communeName || 'la commune'} : ${num(stats.median)} €/m² médian (${num(stats.count)} ventes)`;
}

// « Délai médian entre le DPE et la vente : 5 mois (4 à 7 mois), 177 ventes reliées ».
function delayLine(delay, num) {
  if (!delay) return null;
  return `Délai médian entre le DPE et la vente : ${months(delay.median)} mois (${months(delay.p25)} à ${months(delay.p75)} mois), ${num(delay.count)} ventes reliées. Un DPE est fait juste avant la mise en vente ; l’acte suit le compromis de 2 à 3 mois.`;
}

export { classLine, delayLine, months };
