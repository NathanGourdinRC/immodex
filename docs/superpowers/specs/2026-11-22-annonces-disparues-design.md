# Annonces disparues : le robot vérifie la page (design court)

Validé par Nathan le 22/11/2026.

## Pourquoi

Une maison gardée dans le Fil (ParuVendu, Wambrechies, 420 000 €, 116 m²) affichait « en ligne depuis 20 jours » alors que sa page renvoyait vers une erreur 404 depuis une semaine. Le robot ne déduit un retrait que de l'absence de l'annonce dans les listes de résultats : deux tours complets sans elle (4 jours au mieux), ou 3 semaines sans la revoir pour les sites lus par morceaux. Une liste incomplète (plus de 5 pages, erreur) ne retire jamais rien.

## Ce qui change

1. **Robot** (`api/_lib/scan-run.js`) : une annonce en ligne qui manque à l'appel (une absence comptée, ou plus de 7 jours sans être revue) voit sa page ouverte par le robot, au plus une fois tous les 2 jours.
   - 404 ou 410, ou renvoi vers une page qui n'est pas une annonce du site (`isListing`) : retirée tout de suite.
   - Page encore là, refus du site, robots.txt, erreur, temps écoulé : aucune conclusion, l'ancien mécanisme continue.
   - Jamais pour les sites que le robot ne lit pas (`local`).
   - En même temps que les pages des nouvelles annonces : sur un même site, le robot poli alterne une page de chaque. (Première version, 22/11 : après les lectures ; une file de 431 pages ParuVendu à relire prenait tout le passage, rien n'était vérifié.) Les annonces jamais vérifiées et les plus anciennement vues d'abord ; une annonce en cours de vérification n'est pas lue en plus.
2. **Robot poli** (`api/_lib/polite.js`) : la réponse donne l'adresse finale après les renvois (`url`).
3. **Carte du Fil** (`src/dashboard/annonces.js`) : un bien retiré dit « retiré le 21/11 » au lieu de « en ligne depuis N jours », et le bouton de chaque annonce retirée dit « ParuVendu · retirée ».

## Approches écartées

- Attendre le mécanisme actuel en le raccourcissant (une absence suffit) : plus de faux retraits sur une liste mal lue, et rien pour les listes incomplètes.
- Vérifier seulement les biens gardés : le robot ne connaît pas les verdicts (ils restent dans l'extension).

## Coût

580 pages à vérifier au premier passage (dont 218 ParuVendu), à 5 s par page et par site : rattrapage en quelques nuits, puis quelques pages par nuit.
