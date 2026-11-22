# Annonces disparues : plan

> Exécuté dans la session (Nathan travaille en autonomie après un tour de questions).

**But :** une annonce disparue de son site passe en « Retiré » dès que le robot voit sa page introuvable.

**Spec :** `docs/superpowers/specs/2026-11-22-annonces-disparues-design.md`

## Contraintes

- Robot poli inchangé : robots.txt, 5 s entre deux pages d'un site, arrêt sur refus.
- Aucun retrait sur un doute : seuls 404, 410 ou renvoi vers une page qui n'est pas une annonce.
- Jamais de tiret cadratin dans le code ni les textes.

## Points à surveiller

- Annonce vue depuis plusieurs communes : une seule page demandée, toutes les copies retirées.
- Annonce revenue dans la liste après un retrait par la page : `mergeCard` la remet en ligne (déjà le cas).
- Site qui renvoie vers la forme canonique de l'annonce (`isListing` vrai) : pas de retrait.
- Temps écoulé : vérification remise au passage suivant, rien n'est noté.
- Site `local` : jamais demandé.

### Tâche 1 : adresse finale dans le robot poli

`api/_lib/polite.js` : `raw` renvoie `url: res.url || url`. Test dans `tests/scan-polite.test.mjs` : une réponse renvoyée garde son adresse finale.

### Tâche 2 : vérification des pages

`api/_lib/scan-run.js` : `PAGE_CHECK_MS = 46 h`, `QUIET_MS = 7 jours`, `needsCheck(l, source, t)`, `isGone(res, source, url)`, boucle après les ventes DVF. Champ `pageCheckedAt` sur l'annonce, `summary.gone`.
Tests dans `tests/scan-run.test.mjs` :
- annonce absente une fois, page 404 : retirée au même passage ; page 200 : en ligne, `pageCheckedAt` posé, pas redemandée avant 46 h ;
- renvoi vers une liste : retirée ; renvoi vers une annonce : en ligne ;
- annonce vue depuis deux communes : une seule demande, deux copies retirées ;
- source `local` : jamais demandée ;
- refus (403) : rien de conclu.

### Tâche 3 : carte du Fil

`src/dashboard/annonces.js` : « retiré le JJ/MM » à la place de « en ligne depuis » pour un bien retiré ; bouton « Source · retirée » pour une annonce retirée. Vérifié par les tests e2e existants et une lecture de la carte.

### Tâche 4 : version, tests complets, commit, push

`manifest.json` et `package.json` en 0.30.18, `npm test`, commit, push sur main.
