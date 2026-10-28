# Agences du lac d'Annecy (version 0.8.0)

Date : 28/10/2026. Demande de Nathan : couvrir de façon exhaustive les agences où chercher à Saint-Jorioz, Sévrier, Duingt et Annecy.

## Méthode

1. **Registre SIRENE** (API Recherche d'entreprises) : 643 établissements actifs en 68.31Z (agences immobilières) ou 68.32A (administration de biens) dans les 4 communes, Annecy comprise avec Annecy-le-Vieux, Seynod, Cran-Gevrier, Meythet et Pringy. Les entrepreneurs individuels sans enseigne sont écartés : ce sont surtout des mandataires de réseaux, dont les annonces sont sur le site du réseau. Il reste 384 sociétés, dont le site a été cherché une par une.
2. **Annuaire des agences de Bien'ici** (pages publiques, une à la fois) : Annecy (71 agences), Saint-Jorioz, Sévrier, Duingt et les communes voisines du lac (Doussard, Faverges, Talloires, Menthon, Veyrier, Épagny, Argonay, Poisy). La fiche donne le site de l'agence et le logiciel de diffusion.
3. **Réseaux et portails** présents sur le secteur : réseaux de mandataires, réseaux d'agences, portails régionaux, ventes notariales.
4. **Mesure de la lecture** : une annonce par site, ouverte dans un Chromium sans fenêtre, puis lue par `generic-extract.js` (`tests/helpers/summary.mjs`).

## Résultat

- 89 sites retenus, ajoutés au manifeste sous la forme `https://*.domaine/*`, qui couvre aussi le domaine avec et sans « www » : 72 agences, 13 réseaux, 3 portails et 1 site de ventes notariales.
- Lecture mesurée : 47 complètes, 26 partielles, 16 non mesurées.
  - Partielle : le plus souvent une étiquette DPE en image (La Boîte Immo, `/admin/dpe.php`) ; la carte demande alors les lettres.
  - Non mesurée : site joignable, mais aucune fiche d'annonce trouvée automatiquement.
- 28 sites écartés, avec leur raison, dans `docs/agences-annecy.json` : anti-robot non contourné (Optimhome, Capifrance, efficity, Leggett, Belles Demeures, Zimo, RealAdvisor…), injoignables, immobilier d'entreprise, programmes neufs seuls, conciergeries, ventes judiciaires.

## Lecture améliorée

Quatre formes de ville ajoutées au lecteur générique :
- ville du titre suivie d'un mot de liaison (« Appartement 2 pièces Annecy avec grand balcon ») ;
- libellé « Localisation » ;
- valeur au-dessus de son libellé (« Seynod » puis « Ville ») ;
- adresse `/acheter/maison-saint-jorioz-50`.

Libellés exclus des villes : « Code », « Select Value », noms de voies.

Mesure sur les 101 annonces lilloises enregistrées : 83 puis 86 lectures complètes. Sur le lac d'Annecy : 47 sur 78.

## Limites

- Le quota de 200 recherches web par session a été atteint pendant la recherche des sites. Des sociétés SIRENE restent donc classées « introuvable » après une seule recherche ; la plupart sont des SCI, des copropriétés ou des sociétés sans site. L'annuaire Bien'ici a comblé les agences qui publient des annonces.
- Les franchises des grands réseaux (Century 21, Orpi, Laforêt, Foncia, Citya, Square Habitat, iad, SAFTI) étaient déjà couvertes par leur domaine national.
