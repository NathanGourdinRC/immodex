# Immodex+ : recherches enregistrées, scan des annonces et historique des ventes

Document de conception, 2 novembre 2026. Rédigé par Claude à partir des échanges avec Nathan (session du 2 novembre 2026). Les décisions de Nathan sont marquées « décidé » ; les choix faits par Claude sans validation explicite sont marqués « choix de Claude » et listés en fin de document.

## 1. Intention

Immodex+ sert à la recherche immobilière personnelle de Nathan : une maison, aujourd'hui à Wambrechies (59) et autour du lac d'Annecy. Ce n'est pas un produit pour d'autres, et l'usage n'est pas commercial.

Aujourd'hui, Nathan trie ses annonces sur Jinka : il y valide ses favoris. Trois limites l'ont amené à vouloir faire évoluer Immodex+ :

1. **Jinka ne capte plus tout.** Depuis juillet 2026, Jinka ne peut plus diffuser les annonces du groupe SeLoger après ses condamnations pour collecte automatique.
2. **Les prix affichés disparaissent avec les annonces.** Personne ne garde, pour son secteur, l'historique des prix demandés ni le lien avec le prix finalement signé. Les outils qui croisent annonces et ventes existent, mais ils sont réservés aux professionnels et payants (Yanport par exemple). Castorus garde l'historique des prix affichés, sans lien avec la vente.
3. **La carte actuelle d'Immodex+ est pauvre.** Elle ne montre que les 4 sections cadastrales de Wambrechies, colorées par prix DVF médian.

Ce que Nathan veut, dans ses mots : « que les zones soient mieux identifiables, avec un code couleur ou un indicateur du nombre de données » ; « retrouver chaque vente en cours dans un fil d'actualité, liker ou supprimer, retrouver mes favoris sur la carte » ; « un historique exploitable des ventes passées ». Il a ensuite demandé que l'appli fonctionne « par recherche, qu'on pourra enregistrer ».

## 2. Objectifs, non-objectifs, anti-objectifs

### Objectifs
- **O1. Recherches enregistrées.** L'appli (extension Chrome et appli téléphone) s'organise autour de recherches enregistrées et synchronisées.
- **O2. Fil d'actualité.** Pour chaque recherche, un fil des annonces en cours, alimenté par un scan automatique des sites et par les alertes mail des portails verrouillés, avec « Garder » et « Écarter ».
- **O3. Historique des prix affichés.** Chaque annonce scannée garde son premier prix, ses baisses, sa date de mise en ligne et sa date de retrait.
- **O4. Ventes passées exploitables.** Les ventes DVF des communes de la recherche, avec prix au m², terrain et dépendance (souvent un garage).
- **O5. Lien annonce et vente.** Une annonce retirée est reliée à sa vente DVF quand elle paraît, pour mesurer la marge de négociation réelle et la durée en ligne sur le secteur.
- **O6. Carte lisible.** Des secteurs d'environ 400 m avec un niveau de prix honnête et un indicateur de fiabilité, plus les annonces du fil et les biens gardés.

### Non-objectifs
- Pas d'estimation « ce bien vaut X € ». On montre des ventes et des fourchettes, jamais un prix calculé présenté comme juste.
- Pas de locations : ventes seulement.
- Pas de notification sur le téléphone dans cette version (choix de Claude, voir §10).
- Pas d'ouverture à d'autres utilisateurs, pas de compte, pas de page publique.
- Pas de reprise des favoris Jinka : Jinka n'a ni API publique ni export, et on ne se connecte pas à un compte Jinka.

### Anti-objectifs : ce qui ferait échouer le projet même s'il fonctionne
- **Contourner une protection anti-robot**, se faire passer pour un navigateur humain, ou faire bloquer l'adresse de Nathan. Un site qui refuse le robot est retiré, pas forcé.
- **Un scan agressif** : plus d'un passage tous les 2 jours, des requêtes enchaînées sans pause, plus de pages que les règles du §6.2 n'en permettent, ou la relecture d'une page d'annonce déjà lue.
- **La fausse précision** : afficher un prix au m² de secteur au détail près alors que le test sur Wambrechies montre ±16 % d'écart entre deux maisons voisines (§7.3).
- **Les doublons** : le même bien trois fois dans le fil parce qu'il est publié par trois sources.
- **Mélanger prix affiché et prix signé** dans un même chiffre.
- **Perdre les données existantes de Nathan** (zones, suivi, annonces vues, notes) au passage aux recherches.
- **Rendre les données DVF indexables** ou permettre de réidentifier des personnes (conditions de réutilisation de DVF). Le `noindex` actuel reste obligatoire.

## 3. Contraintes

- **Comptes de Nathan uniquement.** Vercel : équipe « releaf2 », offre Hobby gratuite, projet `immodex`. Base : Upstash Redis gratuite (Francfort), créée via le Marketplace Vercel. Aucun service de Guillaume. Aucun nouveau compte ne peut être créé par Claude ; un nouveau service gratuit ne peut être ajouté que si Nathan le crée lui-même.
- **Limites des offres gratuites** (à reconfirmer au moment de construire) :
  - Vercel Hobby : tâches planifiées (cron) au plus une fois par jour, heure de déclenchement imprécise dans l'heure ; nombre de tâches planifiées limité (2 selon le tableau officiel consulté) ; durée maximale d'une fonction : à confirmer.
  - Upstash gratuit : 256 Mo, 500 000 commandes par mois, 10 Go de trafic par mois.
- **Le déploiement Vercel n'installe aucune dépendance** aujourd'hui (`installCommand: ""` dans `vercel.json`). La fonction `api/sync.js` n'en a aucune. Ajouter une bibliothèque côté serveur oblige à changer ce réglage.
- **Respect des sites** : `robots.txt` lu et respecté avant chaque source ; volume limité selon les règles du §6.2 ; passage la nuit, tous les 2 jours.
- **Pas de collecte sur Leboncoin, SeLoger, Logic-Immo, PAP, Figaro Immobilier** : anti-robot actif (DataDome ou Cloudflare), vérifié le 2 novembre 2026. Ces portails passent par leurs alertes mail. Les sites déjà écartés pour anti-robot (Superimmo, MeilleursAgents, Efficity, Abrimmo) restent écartés.
- **Données DVF** : réutilisation sans indexation (`X-Robots-Tag: noindex` déjà en place) et sans réidentification de personnes.
- **iPhone** : l'appli de l'écran d'accueil a son propre stockage ; ne jamais lire le presse-papiers par `navigator.clipboard` ; le partage vers l'appli (`share_target`) ne marche pas sur iPhone.
- **Aucun secret dans le code client**, aucune clé demandée à Nathan dans la conversation.

## 4. Ce qui existe déjà et sur quoi on construit

- **Zones** (`src/common/zones.js`) : nom, communes (code INSEE, nom, codes postaux, centre), type (maison ou appartement), surface min et max ; 20 zones au plus, 30 communes par zone. Synchronisées (collection `zone`).
- **Suivi** (`TRACKING_KEY`) : statut par annonce (`a-voir`, `favori`, `visite`, `ecarte`) et note. Synchronisé (collection `track`).
- **Annonces vues** (`src/common/properties.js`, « sightings ») : empreinte du bien, historique des prix (`prices`), `firstSeen`, `lastSeen`, adresse et DPE retrouvés ; regroupement des annonces d'un même bien ; 12 mois et 3 000 annonces au plus. Synchronisées avec fusion (collection `sight`).
- **Attention** : la collection de synchro `search` existe déjà et désigne l'historique des recherches d'adresse sur 7 jours (`HISTORY_KEY`), pas les recherches enregistrées.
- **Lecteurs d'annonces** : `src/common/generic-extract.js` lit une page d'annonce dans le navigateur (prix, surface, pièces, ville, DPE…), y compris pour les logiciels d'agence courants (Apimo, Netty, 3Clics, La Boîte Immo, Pilotim…). La liste des 80 agences de la métropole lilloise est dans `docs/agences-lilloises.json`.
- **Synchro** (`api/sync.js` et `src/common/sync.js`) : un espace par clé (SHA-256 de la clé), éléments typés, journal par révision, « la plus récente gagne » sauf fusion. Les données sont stockées en clair dans Redis sous l'empreinte de la clé.
- **Données publiques** : ADEME DPE, DVF statistiques, DVF détaillé par section (`app.dvf.etalab.gouv.fr/api/mutations3/{insee}/{prefixe}{section}`, autorise l'appel depuis le navigateur et donne longitude et latitude de chaque vente), sections cadastrales, fond IGN.

## 5. La recherche (décidé)

Une recherche, c'est :

| Champ | Contenu |
|---|---|
| Nom | libre, par défaut la liste des communes |
| Lieux | une ou plusieurs communes, choisies par nom ou code postal |
| Type | maison (appartement reste possible) |
| Budget | minimum et maximum |
| Surface habitable | minimum et maximum |
| Surface de terrain | minimum et maximum |
| Pièces | minimum |
| Chambres | minimum |

- Plusieurs recherches possibles (par exemple Wambrechies et le lac d'Annecy), chacune avec son fil, sa carte et ses ventes passées.
- Enregistrées et synchronisées entre Chrome et l'iPhone.
- **Les zones existantes deviennent des recherches automatiquement** (choix de Claude) : une zone contient déjà communes, type et surface ; les nouveaux champs sont vides. Recommandation au constructeur : garder la collection de synchro `zone` et la clé de stockage, et étendre l'objet, plutôt que créer une nouvelle collection (pas de migration de la synchro, aucun risque de perte). Le mot « zone » disparaît de l'interface au profit de « recherche ».
- **Filtrage d'une annonce par une recherche** :
  - lieu, type, budget : stricts ;
  - surface habitable : marge de 3 m² (déjà la règle de `fpInZone`) ;
  - une information absente de l'annonce (terrain, chambres, souvent absents) n'exclut pas l'annonce ; elle passe avec la mention « terrain non précisé » ou « chambres non précisées » (choix de Claude).

## 6. Le scan et le fil (décidé, sauf mention)

### 6.1 Sources

Vérifiées le 2 novembre 2026, une visite par page, sur Wambrechies :

| Source | Pourquoi | État du test | Voie |
|---|---|---|---|
| Lesiteimmo | source de favoris Jinka de Nathan | page de résultats par commune lisible, `robots.txt` d'accord | scan |
| Orpi | idem | 30 maisons dans la page, `robots.txt` d'accord | scan |
| ParuVendu | idem | 30 maisons dans la page, `robots.txt` d'accord | scan |
| Maes Immobilier (Wambrechies) | idem | liste des ventes lisible, `robots.txt` d'accord | scan |
| Deleu Immobilier (5 agences) | idem | liste des ventes lisible, même logiciel qu'Apimo | scan |
| Agences de `docs/agences-lilloises.json` dont la commune ou le secteur recoupe une recherche | déjà connues de l'extension | sans anti-robot pour celles testées | scan |
| Leboncoin | idem | anti-robot DataDome | alertes mail |
| Figaro Immobilier | idem | anti-robot Cloudflare | alertes mail |
| immoRegion | idem | site lorrain, pages du Nord non trouvées | à identifier, hors première version |

- **Première version : exactement 5 sources scannées**, Lesiteimmo, Orpi, ParuVendu, Maes Immobilier et Deleu Immobilier, plus les alertes mail (choix de Claude). Les 3 portails couvrent aussi le lac d'Annecy. Lesiteimmo reprend une grande partie des annonces d'agences, ce qui couvre déjà beaucoup d'agences sans les scanner une par une.
- **Plus tard** : les agences de `docs/agences-lilloises.json` situées à Wambrechies et dans les communes voisines (Marquette-lez-Lille, Quesnoy-sur-Deûle, Bondues, Lambersart, Verlinghem, Saint-André-lez-Lille), puis celles de `docs/agences-annecy.json`, en commençant par les logiciels d'agence les plus fréquents (un lecteur par logiciel couvre plusieurs agences). Ces fichiers ne donnent aujourd'hui ni secteur ni adresse de page de liste : il faudra ajouter l'adresse de la page « nos biens à vendre » de chaque agence retenue.
- Maes Immobilier (`maesimmobilier.fr`, page de liste `https://www.maesimmobilier.fr/type_offre/vente/`) est ajouté à `docs/agences-lilloises.json`. Deleu Immobilier y figure déjà par son agence de Neuville-en-Ferrain ; sa page de liste est `https://deleuimmobilier.com/fr/ventes` (logiciel Apimo).
- **Portails ouverts** (Orpi, ParuVendu, Lesiteimmo) : leurs conditions d'utilisation interdisent souvent les robots. Ils sont inclus au rythme décrit ci-dessous et retirés au premier signe de blocage (choix de Claude, accepté par Nathan : « C'est très bien »).
- Bien'ici, Ouest-France Immo, Century 21, Laforêt, Guy Hoquet sont ouverts mais hors première version : ils ne figurent pas parmi les sources des favoris de Nathan.

### 6.2 Rythme et règles du scan
- Une tâche planifiée sur le Vercel de Nathan, la nuit, tous les 2 jours (expression de type `0 3 */2 * *`, compatible avec la limite d'une fois par jour).
- **Par commune, pas par recherche** : on fait la liste des communes de toutes les recherches, sans doublon, et chaque commune est lue une seule fois par source et par passage, même si deux recherches la contiennent.
- **Pages de résultats** (choix de Claude) :
  - l'adresse de la page de résultats filtre sur la commune, la vente et le type de bien (maison), mais pas sur le budget ni la surface : l'historique des prix et les marges couvrent ainsi tout le secteur, pas seulement les biens dans le budget ;
  - tri par annonces les plus récentes quand la source le permet ;
  - si la page 1 est pleine, on lit les pages suivantes, **au plus 5 pages par source, par commune et par passage** ;
  - si 5 pages ne suffisent pas (grande commune comme Annecy), on ajoute à l'adresse le budget et la surface de la recherche la plus large qui contient cette commune, et l'historique de cette commune ne couvre alors que ces critères ;
  - pour un site d'agence, une seule page de liste (ou ses pages suivantes, même plafond), filtrée ensuite par commune.
- **Pages d'annonce** (choix de Claude) : le robot ouvre **une seule fois** la page de chaque annonce nouvellement vue, jamais les annonces déjà connues. Sans cette page, pas de valeurs du diagnostic énergie, donc pas d'adresse, pas de rapprochement des doublons, pas de terrain ni de chambres le plus souvent. Le premier passage lit donc environ 30 pages d'annonce par source et par commune ; les suivants, seulement les nouveautés.
- **Rythme** : une requête à la fois par site, avec une pause de plusieurs secondes entre deux requêtes au même site (au constructeur de fixer la valeur, au moins 5 secondes).
- **Retrait fiable** : une annonce n'est comptée absente que si toutes les pages de résultats de sa source et de sa commune ont été lues à ce passage. Si le plafond de pages a été atteint ou si une page a échoué, ce passage ne compte pas pour les retraits.
- `robots.txt` lu avant chaque source ; une page interdite n'est pas lue.
- Robot honnête : un en-tête `User-Agent` qui dit qui il est, par exemple `ImmodexPlus/1.0 (+https://immodex.vercel.app ; usage personnel)` (choix de Claude). Si une source refuse ce robot, on la retire au lieu de se déguiser.
- Une source qui répond par un défi anti-robot, une erreur 403 ou 429 deux passages de suite est mise en pause et signalée dans l'appli.
- Le scan lit les recherches dans l'espace de synchro de Nathan (les éléments sont en clair dans Redis) ; il n'a pas besoin de la clé d'appairage.

### 6.3 Ce que le scan produit
- Une annonce scannée garde : source, adresse de l'annonce, titre, prix et ses changements datés, surface habitable, terrain, pièces, chambres, commune, code postal, photo principale (lien, pas de copie), mention garage si le texte la porte, date de première vue, date de dernière vue.
- Statuts dans le fil :
  - **nouveau** : vue pour la première fois au dernier passage ;
  - **prix baissé** : prix plus bas qu'au passage précédent, avec l'écart ;
  - **retiré** : absente deux passages de suite (choix de Claude, pour éviter les fausses alertes d'un site momentanément en panne).
- **Doublons** : un même bien vu chez plusieurs sources donne une seule carte, avec tous les liens et le prix le plus bas. On réutilise le rapprochement de `properties.js` (même numéro de DPE, ou mêmes valeurs énergie et GES avec une surface à 1 m² près), alimenté par les pages d'annonce. Quand les valeurs du DPE manquent, rapprochement « probable » si même commune, même type, surface à 1 m² près et prix à 5 % près : les deux annonces sont regroupées sous une même carte marquée « même bien probable », que Nathan peut séparer.
- **Adresse** : l'adresse probable d'une annonce scannée est retrouvée côté serveur comme le fait l'extension (valeurs du DPE croisées avec la base ADEME), ce qui place l'annonce sur la carte et permet les 15 ventes les plus proches (§7.4) et le lien sûr (§7.5). Sans adresse, l'annonce est placée au centre de sa commune et la fiche le dit.
- Recommandation au constructeur : une collection de synchro écrite seulement par le serveur (annonces scannées et alertes mail), lue par les appareils, distincte des annonces vues par Nathan dans son navigateur (`sight`). Le fil regroupe les deux par bien. À trancher par le constructeur si la réutilisation directe de `sight` s'avère plus simple sans risque de conflit d'écriture.
- **Durée de conservation** : au moins 3 ans pour les annonces scannées, car leur vente n'apparaît dans DVF que 6 à 12 mois après le retrait (la limite actuelle des annonces vues est de 12 mois et 3 000 éléments).

### 6.4 Alertes mail des portails verrouillés
- **Alertes Jinka d'abord** (choix de Claude) : Nathan les reçoit déjà, et Jinka relaie encore Leboncoin et Figaro Immobilier (ses favoris en viennent). Les alertes de Leboncoin et de Figaro Immobilier eux-mêmes sont un complément possible si Nathan les crée.
- Immodex+ lit ces mails et en tire des annonces pour le fil, avec la mention de la source d'origine (« via Jinka, Leboncoin », etc.). Une annonce d'alerte qui pointe vers un site scanné se fond avec l'annonce scannée (doublon).
- La façon de faire parvenir ces mails à Immodex+ dépend de la boîte qui les reçoit (voir §11, question ouverte). Dans tous les cas, l'envoi vers Immodex+ s'authentifie avec la clé d'appairage que Nathan a déjà (il la colle lui-même dans son script ou sa règle, jamais dans la conversation) : pas de nouveau secret à créer.
- Aucune visite des pages Leboncoin ou Figaro par le serveur : on garde ce que dit le mail (titre, prix, ville, surface, lien).

### 6.5 Garder et écarter
- « Garder » met le bien en statut `favori` (statut existant du suivi) ; « Écarter » le met en `ecarte`.
- Un bien écarté sort du fil mais reste dans l'historique et dans les statistiques.
- Les biens gardés apparaissent sur la carte.

## 7. Ventes passées, carte et lien annonce-vente

### 7.1 Ventes passées (décidé)
- Les ventes DVF des communes de la recherche, du type de la recherche (maison), sur les 5 ans disponibles.
- Colonnes : date, rue, prix, surface habitable, **prix au m²**, **terrain**, **dépendance**.
- **Dépendance** : DVF ne dit pas « garage ». Il signale une dépendance vendue avec la maison (garage, cave, abri). À Wambrechies, 152 ventes de maisons sur 548 en ont une (28 %). Un garage intégré à la maison n'apparaît souvent pas : l'interface dit « dépendance » et ne dit jamais « pas de garage ».
- Le terrain est renseigné pour 530 ventes sur 548 à Wambrechies. Il se calcule par vente en additionnant les parcelles distinctes (une parcelle est répétée sur chaque ligne d'une même vente).
- Les critères de la recherche autres que le type (surface, pièces, terrain) ne filtrent pas le calcul des prix : ils servent seulement à signaler les ventes comparables (§7.3).
- DVF est mis à jour deux fois par an, avec 6 à 12 mois de retard : le 2 novembre 2026, la vente la plus récente publiée pour Wambrechies date du 30 décembre 2025. L'interface affiche la date de la donnée la plus récente.

### 7.2 Carte (décidé)
- **Secteurs hexagonaux d'environ 400 m** (rayon de 220 m), calculés sur **toutes les ventes de maisons** des communes de la recherche.
- **Trois niveaux de couleur**, par rapport à la médiane de la commune :
  - « moins cher » : médiane du secteur au moins 10 % sous celle de la commune ;
  - « dans la moyenne » ;
  - « plus cher » : au moins 10 % au-dessus.
- **Fiabilité** : le nombre de ventes est affiché dans chaque secteur. 10 ventes ou plus : couleur pleine ; moins de 10 : hachuré, sans niveau de prix. Seuils ajustables (choix de Claude).
- Un clic sur un secteur ouvre la liste de ses ventes.
- Par-dessus : les annonces du fil (nouveau, prix baissé) et les biens gardés. Fond de carte IGN (déjà utilisé : OpenStreetMap bloque les pages `chrome-extension://`).
- Les 4 sections cadastrales disparaissent de la carte.
- Pour une recherche sur plusieurs communes, la médiane de référence est celle de chaque commune (choix de Claude).

### 7.3 Pourquoi pas plus fin ni plus précis : le test de Wambrechies
Test fait le 2 novembre 2026 sur 544 ventes de maisons (DVF 2021 à 2025) : chaque vente est cachée à tour de rôle, on devine son prix au m² avec les autres ventes, on mesure l'écart médian.

| Découpage | Écart médian |
|---|---|
| Commune entière | 16,7 % |
| 4 sections cadastrales | 16,5 % |
| Hexagones de 290 m | 16,6 % |
| Hexagones de 380 m | 16,4 % |
| Hexagones de 690 m | 16,1 % |
| 15 ventes les plus proches | 15,6 % |
| Surface à 20 % près, toute la commune | 15,1 % |
| Comparables (4 pièces et plus, 90 à 140 m²) | seulement 39 % des ventes ; secteurs fiables divisés par 2 |

Conclusion partagée avec Nathan : à Wambrechies, l'emplacement change peu le prix au m², l'écart vient surtout de la maison elle-même (état, travaux, énergie, standing), que DVF ignore. D'où trois niveaux de couleur plutôt que des tranches de prix, et des fourchettes plutôt qu'un chiffre.

### 7.4 Juger une annonce (décidé)
- Sur la fiche d'une annonce du fil : les **15 ventes de maisons les plus proches** (rayon médian d'environ 130 m à Wambrechies), avec la **fourchette** de prix au m² formée par la moitié centrale (du 25e au 75e centile), et le nombre de ces ventes qui sont comparables aux critères de la recherche.
- Jamais de « prix juste » calculé.

### 7.5 Lien annonce et vente DVF (décidé)
- Les deux historiques restent séparés : prix affiché (scan, alertes) et prix signé (DVF).
- À chaque nouvelle publication DVF, chaque annonce retirée depuis au moins un mois est rapprochée des ventes publiées :
  - **lien sûr** : même adresse ou même parcelle. L'adresse de l'annonce vient du diagnostic énergie, ce que l'extension sait déjà faire ;
  - **lien probable** : même rue, même type, surface habitable à 5 % près, terrain proche, vente entre 1 et 12 mois après le retrait (seuils indicatifs, au constructeur de les ajuster sur les données) ; affiché comme « probable », jamais comme certain ;
  - sinon, pas de lien.
- Ce que le lien donne : écart entre premier prix affiché et prix signé (marge de négociation), écart entre dernier prix affiché et prix signé, durée en ligne. Agrégé par recherche dès qu'il y a assez de liens, avec leur nombre affiché.
- Le texte de l'annonce complète DVF (garage, état), sans jamais modifier la donnée DVF.
- **Limite connue** : le lien ne produit rien avant environ l'automne 2027, car l'historique des prix affichés commence au premier scan.

### 7.6 Pistes à tester pendant la construction (choix de Claude)
- **Délai de vente historique** : relier chaque vente DVF à son diagnostic énergie par l'adresse et mesurer le temps entre les deux, comme le jeu de données VendreBien publié sur data.gouv (228 communes). Donne une approximation du délai de vente sur 5 ans sans attendre 2027. Approximation seulement : un diagnostic peut précéder de loin la mise en ligne.
- **Classe énergie et prix** : sur les mêmes rapprochements, mesurer si la classe énergie explique une partie des 16 % d'écart. Si oui, l'afficher dans la fourchette d'une annonce.
- Ces deux tests ne bloquent rien : s'ils ne donnent rien d'utile, on ne les affiche pas.

## 8. L'appli (décidé, sur maquette)
- **Écran « Mes recherches »** : liste des recherches avec le nombre de nouveautés, la date du dernier scan, le nombre de biens suivis ; bouton « Nouvelle recherche ».
- **Écran d'une recherche** : trois vues, **Fil**, **Carte**, **Ventes passées** ; bouton pour modifier les critères.
- **Carte du fil** : statut (nouveau, prix baissé avec l'écart, alerte d'un portail), type, pièces, surface, prix, commune, sources, durée en ligne, boutons « Garder » et « Écarter ».
- **Nouveaux diagnostics énergie** (panneau actuel « Nouveaux DPE ») : ils entrent dans le Fil sous l'étiquette « Bientôt en vente ? », filtrés par le type et la surface de la recherche, avec un interrupteur pour les masquer ; ils restent une couche de la carte (choix de Claude). Un diagnostic qui correspond ensuite à une annonce scannée disparaît du fil au profit de l'annonce.
- Même interface dans l'appli téléphone et dans le tableau de bord de l'extension. Dans Chrome, le popup garde « Analyser cette annonce » (choix de Claude).

## 9. Critères de réussite
- Le fil de la recherche Wambrechies montre, après le premier passage, les maisons en vente des 5 sources scannées, sans doublon, avec un lien vers chaque annonce.
- Nathan garde ou écarte une annonce sur son iPhone et retrouve le même état dans Chrome.
- Une baisse de prix et un retrait sont détectés et affichés au passage suivant.
- La carte de Wambrechies montre les secteurs en 3 niveaux, le nombre de ventes, et les biens gardés.
- L'onglet « Ventes passées » donne prix au m², terrain et dépendance pour chaque vente.
- Les données existantes (zones, suivi, annonces vues) sont toutes là après la mise à jour.
- Aucune source n'est contournée ; une source qui bloque est mise en pause et signalée.
- Le tout reste dans les offres gratuites de Vercel et d'Upstash.

## 10. Choix de Claude (non validés explicitement par Nathan)
1. Les zones deviennent des recherches automatiquement, en étendant la collection `zone`.
2. Une annonce sans terrain ou sans chambres précisés n'est pas exclue ; elle porte une mention.
3. Budget strict ; marge de 3 m² sur la surface habitable.
4. « Retiré » après deux passages sans l'annonce.
5. Pas de notification sur le téléphone dans cette version.
6. Robot honnête avec un `User-Agent` qui se nomme ; source retirée si elle le refuse.
7. Portails ouverts inclus et retirés au premier signe de blocage.
8. Seuils de la carte : 10 ventes pour la couleur, ±10 % pour les niveaux de prix.
9. Médiane de référence par commune pour les recherches sur plusieurs communes.
10. Conservation des annonces scannées au moins 3 ans.
11. Tests du délai de vente et de la classe énergie pendant la construction.
12. Dans Chrome, le popup garde « Analyser cette annonce ».
13. Le robot ouvre une seule fois la page de chaque nouvelle annonce (sans elle : ni doublons détectés, ni adresse, ni terrain).
14. Pages de résultats : commune, vente et type dans l'adresse, tri par date, au plus 5 pages par source et par commune ; budget et surface ajoutés seulement si 5 pages ne suffisent pas.
15. Chaque commune est lue une fois par passage, même si plusieurs recherches la contiennent.
16. Première version limitée à 5 sources scannées ; agences de la métropole et d'Annecy ensuite.
17. Alertes Jinka d'abord, authentifiées par la clé d'appairage existante.
18. Les nouveaux diagnostics énergie entrent dans le Fil (« Bientôt en vente ? »), masquables.
19. Doublon « probable » sans DPE : même commune, même type, surface à 1 m² près, prix à 5 % près.

## 11. Question ouverte

- **Boîte mail des alertes.** Dans quelle boîte arrivent les alertes Jinka ? La réponse décide du mécanisme. Par exemple, avec Gmail, un petit script Google Apps Script dans le compte de Nathan qui transmet les alertes à une fonction d'Immodex+ ; avec Outlook, une règle de transfert. La boîte professionnelle Releaf est à éviter pour un usage personnel. Tant que la réponse manque, seul le lot des alertes mail est bloqué ; les autres lots peuvent avancer.

## 12. Laissé au constructeur
- Le découpage en lots et l'ordre de livraison. Suggestion : (1) recherches, migration et refonte de l'appli, ventes passées et carte, qui ne demandent rien côté serveur ; (2) scan et fil ; (3) alertes mail ; (4) lien annonce-vente et tests DPE.
- Le lecteur de chaque source (pages de résultats), la bibliothèque d'analyse HTML côté serveur et le réglage `installCommand` qui va avec, la réutilisation éventuelle de `generic-extract.js` côté serveur.
- La répartition du scan dans les limites de durée des fonctions Vercel (une tâche planifiée qui traite par lots, ou qui se relance).
- Le format exact des éléments synchronisés et les règles de conflit pour les éléments écrits par le serveur.
- Les détails d'interface au-delà de la maquette, les tests unitaires et de bout en bout, la mise à jour du README.
