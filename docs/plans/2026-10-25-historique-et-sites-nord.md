# Plan : historique des recherches et nouveaux sites (focus métropole lilloise)

Date : 2026-10-25 · Version cible : 0.2.0 · Nom affiché : Immodex+

## Pourquoi

1. **Perte des résultats.** Le popup de l'extension est détruit par Chrome dès qu'il perd le focus (clic sur un lien Maps, changement d'onglet). Les résultats n'étant enregistrés nulle part, la liste des adresses candidates est perdue. Sur les annonces, la carte reste dans l'onglet mais disparaît au rechargement ou à la navigation.
2. **Couverture limitée.** Seuls Leboncoin, Bienici et SeLoger sont lus. Les biens du Lillois passent aussi par d'autres portails et par les sites des agences locales.

## Ce qu'on construit

### 1. Historique (7 jours, 50 recherches max)

- `src/common/history.js` (module du service worker) : stockage dans `chrome.storage.local` (clé `immodex.history.v1`), purge automatique des entrées de plus de 7 jours, 50 entrées max, dédoublonnage par (URL de l'annonce + critères).
- Chaque recherche réussie (annonce ou popup) est enregistrée par le service worker avec : date, critères, candidats (sans le champ `raw` de l'ADEME, trop lourd), URL et titre de la page d'origine.
- Messages : `HISTORY_LIST`, `HISTORY_GET_FOR_URL`, `HISTORY_DELETE`, `HISTORY_CLEAR`, `PREFILL_SET`, `PREFILL_GET`.
- Popup : troisième onglet **HISTORIQUE** (liste, détail avec tous les candidats et leurs liens, lien vers l'annonce, suppression). À la réouverture, le popup réaffiche le dernier résultat consulté (moins d'une heure).
- Annonce : si l'URL a déjà été cherchée, le bouton flottant réaffiche directement le résultat enregistré, avec un lien « Relancer la recherche ».
- « Modifier les champs » (carte sur l'annonce) : pré-remplit vraiment le formulaire du popup (aujourd'hui, l'information est écrite dans le `sessionStorage` de la page, que le popup ne peut pas lire).

### 2. Lecture générique de n'importe quelle annonce

- `src/common/generic-extract.js` : extraction à partir de la page, dans cet ordre de fiabilité :
  1. données structurées JSON-LD (schema.org) ;
  2. réglages propres au site (sélecteurs ou chemins JSON connus, table par nom de domaine) ;
  3. texte visible : classes DPE et GES, consommation (kWh/m²/an) et émissions (kg CO2/m²/an), surface habitable, surface du terrain, code postal et ville, type de bien, date du DPE ;
  4. images d'étiquette DPE (attributs `alt`, `title`, nom de fichier).
- Si la classe n'est pas écrite mais que la consommation et les émissions le sont, la classe est calculée avec les seuils du DPE 2021.
- Popup : bouton **« Analyser cette page »** (permissions `activeTab` + `scripting`, sans accès permanent aux sites) qui lit l'onglet actif, pré-remplit le formulaire et lance la recherche.
- `src/content/generic.js` : bouton flottant sur les sites retenus pour le Lillois (liste dans le manifest), avec la même logique que les trois sites existants.

### 3. Précision du rapprochement ADEME

- La consommation (`conso_5_usages_par_m2_ep`) et les émissions (`emission_ges_5_usages_par_m2`) lues sur l'annonce entrent dans le score (bonus si l'écart est de 1 au plus). Ces valeurs sont souvent affichées par les agences et sont presque uniques à surface et code postal donnés.

## Ce qu'on ne fait pas

- Pas de publication sur le Chrome Web Store (compte développeur à créer par Nathan).
- Pas de contournement des protections anti-robot des sites.
- Pas de serveur : tout reste dans le navigateur, comme l'original.
- Pas de contribution au dépôt d'origine (tonoid/immodex) sans accord.

## Tests

- Tests unitaires Node (`node --test`) : historique (purge, plafond, dédoublonnage), seuils DPE, extraction générique sur des pages HTML enregistrées (`tests/fixtures/`), avec `jsdom` en dépendance de développement uniquement (l'extension elle-même reste sans dépendance).
- Tests de bout en bout dans le Chrome de Nathan (extension chargée en mode développeur) sur de vraies annonces.

## Ordre

1. Historique (service worker, popup, carte sur l'annonce).
2. Extraction générique + bouton « Analyser cette page ».
3. Bouton flottant sur les sites du Lillois retenus.
4. Bonus de score consommation et émissions.
5. Tests, version 0.2.0, README.
