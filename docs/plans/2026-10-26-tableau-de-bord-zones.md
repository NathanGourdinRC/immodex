# Tableau de bord et zones de recherche (version 0.7.0)

Date : 26/10/2026. Usage visé : la recherche immobilière personnelle de Nathan (pas de produit multi-utilisateurs).

## Pourquoi

L'extension aide sur une annonce à la fois. Une recherche immobilière dure des semaines, sur une zone : il manque une vue d'ensemble qui garde la trace des annonces vues, signale ce qui bouge dans la zone et donne le prix du marché.

## Choix structurants

- **Pas de serveur, pas de compte.** Une page de l'extension ouverte dans un onglet (comme la carte des candidats). Les données restent dans `chrome.storage.local`. Un serveur ne se justifiera que pour chercher à plusieurs ou consulter sur téléphone.
- **Pas de robot.** La zone se nourrit de données publiques et des annonces que l'utilisateur ouvre lui-même. Aucun portail n'est parcouru automatiquement (anti-robot et CGU).
- **Castorus : pont manuel.** Castorus n'a pas d'API publique et ses conditions interdisent robots et aspiration, y compris sur son extension. Immodex+ copie le lien de l'annonce et ouvre la « Recherche par URL » de Castorus ; l'utilisateur colle le lien. L'extension Castorus peut aussi tourner à côté d'Immodex+ sur les annonces.

## Sources (vérifiées le 26/10/2026)

| Besoin | Source |
| --- | --- |
| Chercher une commune | `geo.api.gouv.fr/communes?nom=…` |
| Contour d'une commune | `geo.api.gouv.fr/communes/{insee}?fields=contour&format=geojson&geometry=contour` |
| Contours des sections cadastrales | `cadastre.data.gouv.fr/bundler/cadastre-etalab/communes/{insee}/geojson/sections` |
| Prix médian au m² par commune et par section (5 ans) | jeu « Statistiques DVF », API tabulaire `tabular-api.data.gouv.fr/api/resources/851d342f-9c96-41c1-924a-11a7a7aae8a6/data/` |
| Nouveaux DPE de la zone | registre ADEME `dpe03existant`, filtres `code_insee_ban_in`, `date_etablissement_dpe_gte` |
| Ventes à une adresse | module DVF existant (`src/common/dvf.js`) |

## Contenu d'une zone

- Nom, communes (code INSEE, codes postaux, centre), type de logement, surface mini et maxi.
- **Nouveaux DPE** des 30 derniers jours (15, 30 ou 90 au choix) : un DPE est obligatoire avant de mettre un bien en vente ou en location, un nouveau DPE est donc souvent une annonce en préparation. Badge « nouveau » depuis la dernière visite du tableau de bord.
- **Annonces vues** dans la zone (suivi des biens) : prix et évolution, republications, statut (à voir, favori, visité, écarté) et note personnelle.
- **Prix du marché** : carte des sections colorées selon le prix médian au m² du type cherché, médiane de chaque commune.

## Fichiers

- `src/common/zones.js` : zones et suivi (statut, note), file d'écriture, données pures testables.
- `src/common/zone-data.js` : requêtes (communes, DPE, statistiques DVF, sections), filtres et classes de prix.
- `src/dashboard/dashboard.html`, `dashboard.js` : la page.
- `src/ui/components.js` : bouton Castorus.
- Popup : bouton « Tableau de bord ».
